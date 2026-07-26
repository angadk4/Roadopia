/**
 * Loop assembly (M3-T07; Protocol §10 — L3 radial-sector + L4 angular order came
 * from candidate generation; this module ROUTES the circuit and enforces loop
 * sanity): o → w₁ … wₙ → o via Valhalla, then
 *   - closure: routed start/end must both snap within ε of the origin;
 *   - retrace: self_overlap ≤ the cap (out-and-back rejection).
 * Rejections carry reasons — the relaxation ladder (M3-T12) consumes them.
 */

import type { LatLng, RouteThroughOutput } from '@shared/types';

import { haversineMeters } from '../../../data/curvature/geometry';
import { routeThrough, type AutoCostingOptions } from '../valhalla/route';
import { traceRoadClasses, type TraceResult } from '../valhalla/trace';

import {
  countryClassFactor,
  effectiveCurviness,
  traversalSpanOf,
  type WaypointCandidate,
} from './candidates';
import {
  maxRetraceRunM,
  microloopEvents,
  maxRetraceRunInfo,
  microloopPositions,
  selfOverlapRatio,
  spurEvents,
  spurPositions,
  SPUR_WINDOW_WIDE_STEPS,
  ORIGIN_GRACE_RADIUS_M,
} from './overlap';
import {
  arterialShareOf,
  classRunStatsOf,
  countryScoreOf,
  maxClassRunInfo,
  maxResidentialRunInfo,
  pointAt,
  RESIDENTIAL_GRACE_RADIUS_M,
  residentialShareOf,
} from './residential';
import type { CandidateSegment } from './retrieve';
import {
  BACKROAD_CLASSES,
  classMixOf,
  HOOD_CLASSES,
  TRACE_HIGHWAY_FLOOR_M,
  TRACE_HIGHWAY_TRUTH_ON,
  tracedHighwayM,
  turnsPer10minOf,
  type ClassMix,
} from './roadclass';

/** Pin-snap sanity cap (R18-2): a "loop from X" whose nearest drivable road
 *  is further than this from the pin is dishonest to present. */
export const SNAP_OFFSET_MAX_M = 1_500;

/** Loop-closure tolerance ε (m): the routed loop's start↔end self-closure
 *  (R18-2 semantics fix — was distance-to-the-origin-pin, which conflated
 *  closure with snap offset). */
export const EPSILON_CLOSURE_M = 300;
/** Self-overlap SOFT threshold (scoring/validation annotation; §3.6 default). */
export const SELF_OVERLAP_CAP = 0.15;
/**
 * Assembly HARD reject (SPK-15 finding): the origin-street spur double-counts on
 * every real loop (~5–15 % on short ones), so 0.15 as a hard filter killed
 * legitimate circuits. Assembly now rejects only real out-and-back junk (> 0.30);
 * 0.15 stays the soft line that scoring penalises and validation annotates.
 * Candidate values — M4 [GATE-L] finalises both.
 */
export const SELF_OVERLAP_HARD_REJECT = 0.3;

/**
 * Longest same-road there-and-back (owner round 6): the overlap RATIO misses a
 * long contiguous doubling on a big loop, so the RUN gets its own soft cap at
 * PRESENTATION/AC ("only when completely necessary"). A HARD assembly cap was
 * tried at 3 km and rejected 687 candidates across 40 briefs (0/40): shared
 * origin corridors beyond the 2.5 km grace are necessary doubling in
 * funnel-topology towns — an assembly gate cannot distinguish necessary from
 * lazy, the presentation ranking can (clean routes win wherever they exist).
 * M4 calibrates the cap with the measured distribution.
 */
export const RETRACE_RUN_SOFT_M = 1_200;

/**
 * Residential exposure two-tier (owner round 7: neighbourhood streets "shouldn't
 * be there at all"). Valhalla auto costing has NO residential knob (verified
 * against 3.7 source), so exposure is measured per assembled route via
 * trace_attributes. Same two-tier shape as u-turns/spurs — the proven split:
 * assembly rejects only the unambiguous junk (a fifth of the drive in
 * subdivisions), presentation ranks ANY notable exposure below every clean
 * route, and the AC bar holds the presented best to ≤ the soft share.
 */
/**
 * R25-U5ab recalibration — the soft bars are RULER-RELATIVE. 0.05 / 500 m
 * were calibrated against the V1 measure (class === 'residential' only,
 * 2.5 km origin grace). HOOD_MEASURE_V2 widens the classes (service /
 * living_street / …) and tightens the grace to 700 m, so the SAME physical
 * route measures more: paired Milton probe (2026-07-26, same winner id) —
 * run 458 → 584 m, a 0 m pool-mate → 530 m (formerly-graced town-exit
 * metres), share 1.5 → 3.5 % / 3.9 → 5.8 %. Keeping the old numbers under
 * the new ruler would be an uncalibrated ~1.5-2× tightening nobody
 * pre-registered — entire pools flip dirty at 530 m and selection goes
 * chaotic (measured: AC 20→17). Under V2: run 800 m (≈ 500 V1-equivalent +
 * the measured ~300 m exposed town-exit), share 8 % (0.05 × the measured
 * ~1.6 share widening). V1 values byte-identical when the flag is off.
 * The env literal mirrors residential.ts (no import cycle).
 */
const HOOD_V2 = process.env['HOOD_MEASURE_V2'] !== 'off'; // R25-U5 ADOPTED (BD-86)
export const RESIDENTIAL_SOFT_SHARE = HOOD_V2 ? 0.08 : 0.05;
export const RESIDENTIAL_HARD_SHARE = 0.2;
/**
 * Longest contiguous residential run (m), presentation/AC soft cap (round 8b,
 * Bolton): the SHARE cap scales with route length — 4 % of 101 km hid a
 * 1.3 km subdivision weave. The RUN metric is absolute, like retraceRunM
 * (round-6 lesson: ratios cannot see contiguity). Presentation/AC only —
 * no assembly rejection (the 20 % share hard cap handles egregious cases).
 */
export const RESIDENTIAL_RUN_SOFT_M = HOOD_V2 ? 800 : 500;

/**
 * Boring-connector detector (owner round 11: 'prioritize fun back roads
 * whenever possible'): the longest contiguous ARTERIAL stretch
 * (motorway/trunk/primary/secondary, 250 m bridging, origin-graced). Beyond
 * the trigger, the repair pass INSERTS a waypoint on the best nearby curvy
 * segment to drag the connector onto backroads — kept only if countryness
 * genuinely improves without duration/cleanliness cost. Scoring re-rank was
 * tried first and measured USELESS (rq11: pool candidates differ by ~0.007
 * countryScore — every candidate rode the same arterials; the pool, not the
 * ranking, was the blind spot).
 */
export const ARTERIAL_CLASSES: ReadonlySet<string> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
]);
export const ARTERIAL_RUN_TRIGGER_M = 4_000;
/**
 * INSERT keeps its result on any real (non-noise) countryness gain. The rq11b
 * probe showed a single segment swap on a long route tops out around
 * +0.02…+0.04 raw — 0.05 discarded every healthy insert (Hamilton: three
 * clean +0.02/+0.04 inserts, all killed) while the duration and cleanliness
 * guards already stop the bad ones (Woodstock: route-doubling inserts died on
 * accepted/self_overlap, not on this bar).
 */
export const INSERT_MIN_COUNTRY_GAIN = 0.02;
/** …and only if the detour does not blow the duration up. */
export const INSERT_MAX_DURATION_GROWTH = 1.25;

export interface AssembledLoop {
  candidate: WaypointCandidate;
  route: RouteThroughOutput;
  /** Start↔end self-closure (m) — R18-2 semantics. */
  closureM: number;
  /** Distance from the user's pin to the routed start/end (m) — disclosed
   *  when notable; rejected above SNAP_OFFSET_MAX_M. */
  snapOffsetM: number;
  selfOverlap: number;
  /** Micro-retrace excursions, ASSEMBLY window (round 5 gate: reject ≥2). */
  spurs: number;
  /** Spur events under the WIDE window (block spins; presentation/AC only). */
  spursWide: number;
  /** Longest contiguous same-road doubling in metres (presentation/AC only). */
  retraceRunM: number;
  /** Residential-class share outside the origin grace; null = trace failed
   *  (fail-open at assembly, unknown at presentation/AC). */
  residentialShare: number | null;
  /** Longest contiguous residential run (m) outside grace; null = trace failed. */
  residentialRunM: number | null;
  /** Midpoint [lng, lat] of that run — the repair pass aims at it. */
  residentialRunMid: [number, number] | null;
  /** Route countryness 0..1 (round 11) — length-weighted class factor of the
   *  traced route; null = trace failed. Scoring term (w_country). */
  countryScore: number | null;
  /** Arterial share 0..1 (R18-1 honesty metric) — length-weighted
   *  motorway/trunk/primary/secondary(+ramps) share; null = trace failed. */
  arterialShare: number | null;
  /** Longest contiguous ARTERIAL run (m) outside grace; null = trace failed. */
  arterialRunM: number | null;
  /** Midpoint [lng, lat] of that run — the INSERT repair aims at it. */
  arterialRunMid: [number, number] | null;
  /** Small closed circuits (crescent/block spins) outside the origin grace
   *  (round 8) — two-tier: assembly rejects ≥2, presentation demotes ≥1. */
  microloops: number;
  /** Raw trace result for scoring's class-aware curvature (round 15/FB-5);
   *  null = trace failed or not attempted (fail-open, tag-blind fallback). */
  trace: TraceResult | null;
  /** R25-U0 road-class truth: length-weighted bucket shares of the traced
   *  route (audit-v11 convention); null = trace failed/not attempted. */
  classMix: ClassMix | null;
  /** R25-U0 backroad CONTINUITY: longest contiguous backroad run (m), no
   *  grace (a reward metric, not a penalty); null = trace failed. */
  backroadLongestM: number | null;
  /** Mean backroad run length (m); null = trace failed. */
  backroadMeanM: number | null;
  /** R25-U0 hood-run truth: longest contiguous neighbourhood-class run (m),
   *  no grace (measurement; the GATE keeps its own grace); null = untraced. */
  hoodRunM: number | null;
  /** R25-U0 flow: total maneuvers per 10 driving minutes (always computed —
   *  needs no trace). */
  turnsPer10min: number | null;
  accepted: boolean;
  rejectReasons: string[];
}

/** Route one loop candidate and evaluate closure + retrace sanity. */
export async function assembleLoop(
  baseUrl: string,
  origin: LatLng,
  candidate: WaypointCandidate,
  costingOptions?: AutoCostingOptions,
  {
    selfOverlapCap = SELF_OVERLAP_HARD_REJECT,
    middleType = 'through',
    maxUturns = 1,
    maxSpurs = 1,
    maxMicroloops = 1,
    residentialHardShare = RESIDENTIAL_HARD_SHARE,
    residentialHardRunM = RESIDENTIAL_HARD_RUN_M,
    avoidHighways = false,
  }: AssemblyOpts = {},
): Promise<AssembledLoop> {
  const waypoints: Array<[number, number]> = [
    [origin.lng, origin.lat],
    ...candidate.waypoints.map((w) => [w.lng, w.lat] as [number, number]),
    [origin.lng, origin.lat],
  ];
  // Country-road bias (owner rounds 2+3). Live-probed on Valhalla 3.7 (BD-21):
  // use_highways is STEP-LIKE — 1.0/0.6/0.4 route byte-identically onto the 401
  // (round 2's "0.6" was a no-op) and the flip sits between 0.4 and 0.3. So 0.25
  // genuinely sheds 400-series connectors. Round 2's "0.3 over-correction" (all
  // loops funnelling one escarpment corridor) was a scarcity artifact of the
  // residential-swamped corpus (~6 usable segments); with class-filtered
  // retrieval (BD-21) there are hundreds of rural corridors to spread across.
  // NOT top_speed: probed +25 % duration distortion on unchanged paths.
  // 0.2 (round 4): owner wants the main-road share pushed down further.
  // use_living_streets 0 (round 7): living streets ARE neighbourhood streets;
  // Valhalla's default 0.1 already avoids them mostly — pin to 0.
  const biasedCosting = { use_highways: 0.2, use_living_streets: 0, ...costingOptions };
  let route = await routeThrough(baseUrl, {
    waypoints,
    // search waypoints are pass-throughs, never stops (SPK-15). 'through'
    // forbids u-turns at the point — Valhalla then CIRCLES A BLOCK to reverse
    // heading (the round-8 micro-loop root cause); 'via' permits the u-turn,
    // which the u-turn detectors see and punish honestly (rq8 A/B decides).
    middleType,
    // R16-3: stop waypoints ARE stops — break_through splits legs there (real
    // arrival times) while still forbidding u-turns. +1 skips the origin slot.
    stopIndices: candidate.stops.map((s) => s.waypointIndex + 1),
    costingOptions: biasedCosting,
  });

  const coords = route.geometry.coordinates;
  const start = coords[0]!;
  const end = coords[coords.length - 1]!;
  // R18-2 closure-semantics fix (found via the Hockley kill-town): closure =
  // does the loop CLOSE ON ITSELF (start↔end). The old max-distance-to-the-
  // ORIGIN-PIN conflated closure with SNAP OFFSET — a gazetteer pin 346 m
  // off-road auto-rejected every loop from that town as "broken" even though
  // the routed loop closed perfectly. The snap offset is tracked separately,
  // capped sanely, and DISCLOSED (never silently teleported).
  const closureM = haversineMeters(start, end);
  const snapOffsetM = Math.max(
    haversineMeters([origin.lng, origin.lat], start),
    haversineMeters([origin.lng, origin.lat], end),
  );
  const selfOverlap = selfOverlapRatio(route.geometry, undefined, origin);

  const rejectReasons: string[] = [];
  if (closureM > EPSILON_CLOSURE_M) rejectReasons.push(`closure ${Math.round(closureM)} m > ε`);
  if (snapOffsetM > SNAP_OFFSET_MAX_M) {
    rejectReasons.push(`snap offset ${Math.round(snapOffsetM)} m — pin too far from any road`);
  }
  if (selfOverlap > selfOverlapCap) {
    rejectReasons.push(`self_overlap ${selfOverlap.toFixed(2)} > ${selfOverlapCap}`);
  }
  // U-turns are never fun (owner rounds 2–4). Zero tolerance at ASSEMBLY was
  // tried twice and starved the pool both times (3/33 round 2; 8/36 round 4 —
  // four towns to kept-0). The working split: assembly rejects repeat offenders
  // (≥2) to keep pools alive, and the PRESENTATION layer is strictly
  // u-turn-averse (any u-turn ranks below every clean route; run.ts / eval).
  const uturns = route.maneuvers.filter((m) => m.type.startsWith('uturn')).length;
  if (uturns > maxUturns) rejectReasons.push(`uturns ${uturns}`);
  // Spurs (round 5): same two-tier shape as u-turns — repeat offenders die at
  // assembly (narrow window, proven pool-viable), singles are last-resort
  // presentation material only. The wide window + retrace run are computed for
  // the presentation layer and NEVER reject here (round-6 lesson above).
  const spurs = spurEvents(route.geometry, origin);
  if (spurs > maxSpurs) rejectReasons.push(`spurs ${spurs}`);
  // Micro-loops (round 8): crescent/block spins — small closed circuits with
  // no doubled travel, no u-turn maneuver, negligible residential share; only
  // a cycle detector sees them. Same two-tier: repeat offenders die here,
  // singles are last-resort presentation material ranked below every clean route.
  const microloops = microloopEvents(route.geometry, origin);
  if (microloops > maxMicroloops) rejectReasons.push(`microloops ${microloops}`);
  const spursWide = spurEvents(
    route.geometry,
    origin,
    ORIGIN_GRACE_RADIUS_M,
    SPUR_WINDOW_WIDE_STEPS,
  );
  const retraceRunM = maxRetraceRunM(route.geometry, undefined, origin);

  // Residential exposure (round 7) — measured only for otherwise-accepted
  // candidates (one trace_attributes call each; rejected ones never present).
  // Trace failure fails OPEN at assembly (share = null): a matching hiccup
  // must not starve the pool; presentation/AC treat null as unknown-dirty.
  let residentialShare: number | null = null;
  let residentialRunM: number | null = null;
  let residentialRunMid: [number, number] | null = null;
  let countryScore: number | null = null;
  let arterialShare: number | null = null;
  let arterialRunM: number | null = null;
  let arterialRunMid: [number, number] | null = null;
  let trace: TraceResult | null = null;
  let classMix: ClassMix | null = null;
  let backroadLongestM: number | null = null;
  let backroadMeanM: number | null = null;
  let hoodRunM: number | null = null;
  if (rejectReasons.length === 0) {
    try {
      trace = await traceRoadClasses(baseUrl, route.geometry);
      const edges = trace.edges;
      // R16-2 honesty: Valhalla route summaries carry no unpaved flag — the
      // trace does. Override the mapper's constant-false from measurement
      // (UNPAVED_MIN_M floor absorbs snap noise). Trace failure keeps false;
      // trace:null already marks the candidate unknown at presentation.
      const unpavedM = edges.reduce((acc, e) => acc + (e.unpaved === true ? e.lengthM : 0), 0);
      if (unpavedM > UNPAVED_MIN_M) route = { ...route, has_unpaved: true };
      // R25-U4: has_highway from the TRACE — the summary misses `trunk`
      // (probed: summary false on 33 % trunk). Same pattern as has_unpaved.
      if (TRACE_HIGHWAY_TRUTH_ON) {
        route = { ...route, has_highway: tracedHighwayM(edges) > TRACE_HIGHWAY_FLOOR_M };
      }
      // R25-U3v2: the no-highway rule as a MEASURED reject — keeps `shortest`
      // (the backroad lever) for every clean candidate instead of trading the
      // whole region onto fastest+no-hwy (A/B: that cost −6 pp backroad).
      if (avoidHighways && tracedHighwayM(edges) > TRACE_HIGHWAY_FLOOR_M) {
        rejectReasons.push(`highway ${Math.round(tracedHighwayM(edges))}m`);
      }
      // R25-U5b: the residential gate gets its OWN grace (~700 m under V2 —
      // 2,500 m exempted whole towns); arterial keeps 2,500 m below.
      residentialShare = residentialShareOf(
        edges,
        route.geometry,
        origin,
        RESIDENTIAL_GRACE_RADIUS_M,
      );
      // round 8b: the absolute run (same edges, no extra call) — the share
      // scales with route length, a subdivision weave does not
      const runInfo = maxResidentialRunInfo(
        edges,
        route.geometry,
        origin,
        RESIDENTIAL_GRACE_RADIUS_M,
      );
      residentialRunM = runInfo.runM;
      residentialRunMid = runInfo.mid;
      countryScore = countryScoreOf(edges); // round 11 — same edges, no extra call
      arterialShare = arterialShareOf(edges); // R18-1 — same edges, no extra call
      const artInfo = maxClassRunInfo(edges, route.geometry, ARTERIAL_CLASSES, origin);
      arterialRunM = artInfo.runM;
      arterialRunMid = artInfo.mid;
      // R25-U0: road-class truth + backroad continuity + hood run — same
      // edges, zero extra calls. Continuity/hood-run measure UNgraced (truth
      // metrics; the residential GATE above keeps its own grace).
      classMix = classMixOf(edges);
      const backStats = classRunStatsOf(edges, route.geometry, BACKROAD_CLASSES, origin, 0);
      backroadLongestM = backStats.longestM;
      backroadMeanM = backStats.meanM;
      hoodRunM = maxClassRunInfo(edges, route.geometry, HOOD_CLASSES, origin, 0).runM;
      if (residentialShare > residentialHardShare) {
        rejectReasons.push(`residential ${(residentialShare * 100).toFixed(0)}%`);
      }
      // R25-U5c: absolute run reject — a share gate scales with route length,
      // a subdivision weave does not (flag-gated; relaxed cap on rung 5)
      if (
        RESIDENTIAL_HARD_RUN_ON &&
        residentialRunM !== null &&
        residentialRunM > residentialHardRunM
      ) {
        rejectReasons.push(`residential_run ${Math.round(residentialRunM)}m`);
      }
    } catch {
      residentialShare = null;
      residentialRunM = null;
      residentialRunMid = null;
      countryScore = null;
      arterialShare = null;
      arterialRunM = null;
      arterialRunMid = null;
      trace = null;
      classMix = null;
      backroadLongestM = null;
      backroadMeanM = null;
      hoodRunM = null;
    }
  }

  return {
    candidate,
    route,
    closureM,
    snapOffsetM,
    selfOverlap,
    spurs,
    spursWide,
    retraceRunM,
    residentialShare,
    residentialRunM,
    residentialRunMid,
    countryScore,
    arterialShare,
    arterialRunM,
    arterialRunMid,
    microloops,
    trace,
    classMix,
    backroadLongestM,
    backroadMeanM,
    hoodRunM,
    turnsPer10min: turnsPer10minOf(route),
    accepted: rejectReasons.length === 0,
    rejectReasons,
  };
}

// --- round 9: detect-and-repair (owner rounds 7–8b made the detectors; this
// pass USES them: when a route carries a LOCALIZED offence — a micro-loop or
// an over-cap residential run — drop the waypoint nearest the offence and
// re-route; the connector that dragged the route through the neighbourhood
// disappears with its waypoint) -------------------------------------------

/** Snap-noise floor for the unpaved result-scan (R16-2; config v10). */
export const UNPAVED_MIN_M = 50;

/** Max repair re-routes per candidate (R18-2: 2 → 4; passes 3-4 run only while
 *  the offence score strictly improves — no burn on unrepairable candidates). */
export const REPAIR_PASS_CAP = 4;

/**
 * Assembly gate caps (R18-2). Defaults reproduce the frozen behavior
 * byte-identically (round-6 lesson: NEVER default-relax); the ladder's
 * assembly-relax rung passes the RELAXED set below — with disclosure — as the
 * last resort before any redirect.
 */
export interface AssemblyOpts {
  selfOverlapCap?: number;
  middleType?: 'through' | 'via';
  maxUturns?: number;
  maxSpurs?: number;
  maxMicroloops?: number;
  residentialHardShare?: number;
  /** R25-U5c: absolute hood-run reject (share-only gates let an 8.2 km
   *  subdivision weave pass at 8 % share on a long route). */
  residentialHardRunM?: number;
  /** R25-U3v2: reject a candidate whose TRACE carries highway metres. Used
   *  for the IMPOSED fun no-highway rule so the costing can keep `shortest`
   *  (the backroad-character lever) — clean pool-mates win; the ladder
   *  relaxes with disclosure where a region is highway-locked. */
  avoidHighways?: boolean;
}
export const SELF_OVERLAP_RELAXED = 0.45;
export const UTURNS_RELAXED_MAX = 2;
export const SPURS_RELAXED_MAX = 2;
export const MICROLOOPS_RELAXED_MAX = 2;
export const RESIDENTIAL_HARD_RELAXED = 0.3;
/**
 * R25-U5c — a contiguous neighbourhood run beyond this is an assembly REJECT
 * (flag HOOD_HARD_RUN; audit-v11 worst run 8,176 m passed every gate). 1,500 m
 * is 3× the presentation soft cap, NOT the soft cap itself — the round-6
 * hard-cap starvation lesson. The never-empty fallback + rung-5 relax exist
 * now; the A/B watches pool survival (kill: assembled/brief < 75 % of base).
 */
export const RESIDENTIAL_HARD_RUN_ON = process.env['HOOD_HARD_RUN'] === 'on';
export const RESIDENTIAL_HARD_RUN_M = 1_500;
export const RESIDENTIAL_HARD_RUN_RELAXED_M = 3_000;
/** Span-atomic DROP floor: a chain reduced below this many spans is gutted. */
export const CHAIN_DROP_MIN_SPANS = 2;
/** INSERT waypoint-count guard (was a literal 6; chains carry up to 15). */
export const INSERT_MAX_WAYPOINTS = 16;

export const RELAXED_ASSEMBLY_CAPS: AssemblyOpts = {
  selfOverlapCap: SELF_OVERLAP_RELAXED,
  maxUturns: UTURNS_RELAXED_MAX,
  maxSpurs: SPURS_RELAXED_MAX,
  maxMicroloops: MICROLOOPS_RELAXED_MAX,
  residentialHardShare: RESIDENTIAL_HARD_RELAXED,
  residentialHardRunM: RESIDENTIAL_HARD_RUN_RELAXED_M, // R25-U5c
};

/** U-turn positions [lng, lat] recovered from cumulative maneuver distance
 *  (maneuvers carry no shape index — R18-2; ±tens of metres is ample aim). */
export function uturnPositions(route: RouteThroughOutput): Array<readonly [number, number]> {
  const coords = route.geometry.coordinates as Array<[number, number]>;
  if (coords.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1]! + haversineMeters(coords[i - 1]!, coords[i]!));
  }
  const out: Array<readonly [number, number]> = [];
  let d = 0;
  for (const m of route.maneuvers) {
    if (m.type.startsWith('uturn')) out.push(pointAt(coords, cum, d));
    if (m.distance_m === undefined) return out.length > 0 ? out : []; // fail-open
    d += m.distance_m;
  }
  return out;
}

/** Weighted offence magnitude (R18-2: eyes on ALL repairable offence classes;
 *  self-overlap overflow dominates, then micro-loops/u-turns/spurs, then
 *  over-cap run metres). preferred() and the SHIFT keep-rule see improvement
 *  on every class the repair pass can now aim at. */
/**
 * R25-U5d — repair-aim scaling fix. Legacy scored residential/retrace overflow
 * at 1 point per metre while one u-turn scored 8,000 — a 1.3 km subdivision
 * weave weighed LESS than a single u-turn, so the repair pass aimed almost
 * anywhere else first (audit-v11: 53/60 loops carried a hood run; repair never
 * targeted them). Under V2 a 1 km overflow ≡ one u-turn (8 pts/m residential,
 * 4 pts/m retrace). Changes REPAIR TARGETING + the SHIFT keep-rule +
 * presentDirtyBest ordering — NOT presentation ranking (fallbackOffenceUnits
 * is a separate function). OFF = byte-identical.
 */
export const OFFENCE_SCALE_V2_ON = process.env['OFFENCE_SCALE_V2'] !== 'off'; // R25-U5 ADOPTED (BD-86)
export const RESIDENTIAL_OFFENCE_PER_M = 8;
export const RETRACE_OFFENCE_PER_M = 4;

function offenceScore(a: AssembledLoop): number {
  const resPerM = OFFENCE_SCALE_V2_ON ? RESIDENTIAL_OFFENCE_PER_M : 1;
  const retPerM = OFFENCE_SCALE_V2_ON ? RETRACE_OFFENCE_PER_M : 1;
  return (
    Math.max(0, a.selfOverlap - 0.15) * 20_000 * 5 +
    a.microloops * 10_000 +
    uturnCountOf(a.route) * 8_000 +
    a.spursWide * 6_000 +
    Math.max(0, (a.residentialRunM ?? 0) - RESIDENTIAL_RUN_SOFT_M) * resPerM +
    Math.max(0, a.retraceRunM - RETRACE_RUN_SOFT_M) * retPerM
  );
}

function uturnCountOf(route: RouteThroughOutput): number {
  return route.maneuvers.filter((m) => m.type.startsWith('uturn')).length;
}

/** [lng, lat] of the worst LOCALIZED offence, or null when nothing repairable.
 *  Priority: micro-loops → u-turns → spurs → residential run → retrace run
 *  (R18-2 gave the repair pass eyes for the classes it previously ignored). */
function offencePosition(a: AssembledLoop, origin: LatLng): readonly [number, number] | null {
  const loops = microloopPositions(a.route.geometry, origin);
  if (loops.length > 0) return loops[0]!;
  const uts = uturnPositions(a.route);
  if (uts.length > 0) return uts[0]!;
  // R25-U5d: under V2 the residential run outranks spurs as a repair aim —
  // it is now the heavier offence (see offenceScore) and the top-frequency
  // owner complaint; legacy order preserved when the flag is off.
  if (
    OFFENCE_SCALE_V2_ON &&
    (a.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M &&
    a.residentialRunMid !== null
  ) {
    return a.residentialRunMid;
  }
  const spurs = spurPositions(
    a.route.geometry,
    origin,
    ORIGIN_GRACE_RADIUS_M,
    SPUR_WINDOW_WIDE_STEPS,
  );
  if (spurs.length > 0) return spurs[0]!;
  if ((a.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M) return a.residentialRunMid;
  if (a.retraceRunM > RETRACE_RUN_SOFT_M) {
    const info = maxRetraceRunInfo(a.route.geometry, undefined, origin);
    if (info.mid !== null) return info.mid;
  }
  return null;
}

/** Prefer accepted over rejected, then the smaller offence (ties keep `b`). */
function preferred(a: AssembledLoop, b: AssembledLoop): AssembledLoop {
  if (a.accepted !== b.accepted) return a.accepted ? a : b;
  return offenceScore(a) < offenceScore(b) ? a : b;
}

const dM = (aLng: number, aLat: number, bLng: number, bLat: number): number =>
  Math.hypot((aLng - bLng) * 111_320 * Math.cos((43.2 * Math.PI) / 180), (aLat - bLat) * 111_320);

/** Mid vertex of a candidate segment — the INSERT waypoint (round 11b).
 *  Exported for the A→B repair pass (R18-3 parity). */
export function segMidVertex(seg: CandidateSegment): LatLng {
  const coords = seg.geometry.coordinates;
  const [lng, lat] = coords[Math.floor(coords.length / 2)]!;
  return { lat, lng };
}

/**
 * Pick the best repair segment near the arterial run's midpoint: highest
 * BD-26 rank (curviness·length·classFactor) within reach, not already
 * shadowed by an existing waypoint. Exported for the A→B repair pass (R18-3).
 */
export function pickInsertSegment(
  segments: readonly CandidateSegment[],
  runMid: readonly [number, number],
  waypoints: readonly LatLng[],
): CandidateSegment | null {
  let best: CandidateSegment | null = null;
  let bestRank = 0;
  for (const s of segments) {
    const v = segMidVertex(s);
    if (dM(v.lng, v.lat, runMid[0], runMid[1]) > 20_000) continue; // out of reach
    if (waypoints.some((w) => dM(v.lng, v.lat, w.lng, w.lat) < 1_500)) continue; // shadowed
    // R19: never repair-INSERT a subdivision collector (urbanShare fail-open 0)
    // R24: effectiveCurviness de-prioritizes switchbacks here too (OFF = raw)
    const rank =
      effectiveCurviness(s) * s.lengthM * countryClassFactor(s.highway) * (1 - (s.urbanShare ?? 0));
    if (rank > bestRank) {
      bestRank = rank;
      best = s;
    }
  }
  return best;
}

/** Insertion slot minimizing added detour across the o→w₁…wₙ→o sequence. */
function insertSlot(waypoints: readonly LatLng[], origin: LatLng, p: LatLng): number {
  const seq = [origin, ...waypoints, origin];
  let bestI = 0;
  let bestAdd = Infinity;
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i]!;
    const b = seq[i + 1]!;
    const add =
      dM(a.lng, a.lat, p.lng, p.lat) +
      dM(p.lng, p.lat, b.lng, b.lat) -
      dM(a.lng, a.lat, b.lng, b.lat);
    if (add < bestAdd) {
      bestAdd = add;
      bestI = i; // insert into waypoints at index i (after seq[i])
    }
  }
  return bestI;
}

/** The INSERT result is kept only on a REAL countryness gain at bounded cost. */
function insertBetter(after: AssembledLoop, before: AssembledLoop): boolean {
  return (
    after.accepted &&
    offenceScore(after) <= offenceScore(before) &&
    (after.countryScore ?? 0) >= (before.countryScore ?? 0) + INSERT_MIN_COUNTRY_GAIN &&
    after.route.duration_s <= before.route.duration_s * INSERT_MAX_DURATION_GROWTH
  );
}

/**
 * assembleLoop + up to REPAIR_PASS_CAP targeted repairs, two moves:
 *  - DROP (round 9): a micro-loop or over-cap residential run → drop the
 *    waypoint nearest the offence (R16-fix: STOP waypoints are excluded from
 *    the search and never dropped; the remaining stops' indices are maintained
 *    so break_through routing stays correct).
 *  - INSERT (round 11b): no offence, but the longest ARTERIAL run exceeds the
 *    trigger → insert a waypoint on the best nearby curvy segment to drag the
 *    boring connector onto backroads; kept ONLY when countryness gains ≥
 *    INSERT_MIN_COUNTRY_GAIN without offence/duration cost. Needs
 *    opts.repairSegments (the retrieval set) — without it, DROP-only.
 * Returns the preferred attempt; the original wins ties.
 */
export async function assembleLoopWithRepair(
  baseUrl: string,
  origin: LatLng,
  candidate: WaypointCandidate,
  costingOptions?: AutoCostingOptions,
  opts: AssemblyOpts & {
    repairSegments?: readonly CandidateSegment[];
    /** R18-2 cost bound: checked at each pass top (run.ts passes outOfBudget). */
    shouldStop?: () => boolean;
  } = {},
): Promise<AssembledLoop & { repairsApplied: number }> {
  let current = await assembleLoop(baseUrl, origin, candidate, costingOptions, opts);

  let best = current;
  let bestRepairs = 0;
  let cand = candidate;
  // R16-fix: repair now runs on STOP-carrying candidates too. Stop waypoints are
  // never moved (the offence search below excludes them); DROP/INSERT maintain
  // every stop's waypointIndex so break_through leg-splitting stays correct
  // through the repair (assembleLoop reads candidate.stops for stopIndices).
  // R18-2: passes 3-4 run only while the offence score strictly improved.
  let prevOffence = Infinity;
  for (let pass = 1; pass <= REPAIR_PASS_CAP; pass++) {
    if (opts.shouldStop?.() === true) break;
    const curOffence = offenceScore(current);
    if (pass > 2 && curOffence >= prevOffence) break; // no longer improving
    prevOffence = curOffence;
    const pos = offencePosition(current, origin);
    if (pos !== null) {
      // only NON-stop (search) waypoints are movable — never relocate/drop a
      // stop, and never touch a PINNED user-intent span (R18-4: "through
      // Forks of the Credit" survives every repair pass)
      const stopIdx = new Set(cand.stops.map((s) => s.waypointIndex));
      const pinnedIdx = new Set<number>();
      for (const sp of cand.spans ?? []) {
        if (sp.pinned === true) {
          pinnedIdx.add(sp.startIndex);
          pinnedIdx.add(sp.endIndex);
        }
      }
      let nearest = -1;
      let nearestD = Infinity;
      cand.waypoints.forEach((w, i) => {
        if (stopIdx.has(i) || pinnedIdx.has(i)) return;
        const d = dM(w.lng, w.lat, pos[0], pos[1]);
        if (d < nearestD) {
          nearestD = d;
          nearest = i;
        }
      });
      if (nearest === -1) break; // no movable waypoint left — keep best so far

      // --- SHIFT first (round 13): RELOCATE the offending waypoint onto the
      // best clean curvy segment near the offence — preserves the loop's
      // reach (DROP shrinks it) and works on 2-waypoint candidates (the
      // Bolton class DROP could never touch). Falls back to DROP below.
      // R18-3: if the offending waypoint belongs to a chained SPAN, repair the
      // whole span atomically — never leave a dangling endpoint.
      const hitSpan = (cand.spans ?? []).find(
        (sp) => sp.startIndex === nearest || sp.endIndex === nearest,
      );
      if (opts.repairSegments !== undefined) {
        const others = cand.waypoints.filter(
          (_, i) => i !== nearest && i !== hitSpan?.startIndex && i !== hitSpan?.endIndex,
        );
        const seg = pickInsertSegment(opts.repairSegments, pos, others);
        if (seg !== null) {
          const shifted = hitSpan
            ? {
                ...cand,
                id: `${cand.id}-sh${pass}`,
                waypoints: cand.waypoints.map((w, i) => {
                  if (hitSpan.startIndex === hitSpan.endIndex) {
                    // touch span — one waypoint, relocate to the new segment
                    return i === hitSpan.startIndex ? segMidVertex(seg) : w;
                  }
                  if (i === hitSpan.startIndex) return traversalSpanOf(seg)[0];
                  if (i === hitSpan.endIndex) return traversalSpanOf(seg)[1];
                  return w;
                }),
                spans: (cand.spans ?? []).map((sp) =>
                  sp === hitSpan ? { ...sp, segmentId: seg.id } : sp,
                ),
              }
            : {
                ...cand,
                id: `${cand.id}-sh${pass}`,
                waypoints: cand.waypoints.map((w, i) => (i === nearest ? segMidVertex(seg) : w)),
              };
          try {
            const attempt = await assembleLoop(baseUrl, origin, shifted, costingOptions, opts);
            if (
              preferred(attempt, current) === attempt &&
              offenceScore(attempt) < offenceScore(current)
            ) {
              cand = shifted;
              current = attempt;
              if (preferred(current, best) === current) {
                best = current;
                bestRepairs = pass;
              }
              continue; // shift earned its keep — next pass may repair further
            }
          } catch {
            // shift route failed — fall through to DROP
          }
        }
      }

      // --- DROP (round 9) — the fallback when SHIFT has no target or no win ---
      if (hitSpan) {
        // span-atomic drop: all of the span's waypoints + its record
        const isTouch = hitSpan.startIndex === hitSpan.endIndex;
        const removed = isTouch ? 1 : 2;
        if (
          cand.waypoints.length - removed < 2 ||
          (cand.spans ?? []).length <= CHAIN_DROP_MIN_SPANS
        ) {
          break; // dropping the span would gut the chain — keep best
        }
        const [lo, hi] = [hitSpan.startIndex, hitSpan.endIndex].sort((a, b) => a - b) as [
          number,
          number,
        ];
        const shiftIdx = isTouch
          ? (i: number): number => (i > lo ? i - 1 : i)
          : (i: number): number => (i > hi ? i - 2 : i > lo ? i - 1 : i);
        cand = {
          ...cand,
          id: `${cand.id}-rp${pass}`,
          waypoints: cand.waypoints.filter((_, i) => i !== lo && i !== hi),
          stops: cand.stops.map((st) => ({ ...st, waypointIndex: shiftIdx(st.waypointIndex) })),
          spans: (cand.spans ?? [])
            .filter((sp) => sp !== hitSpan)
            .map((sp) => ({
              ...sp,
              startIndex: shiftIdx(sp.startIndex),
              endIndex: shiftIdx(sp.endIndex),
            })),
        };
      } else {
        if (cand.waypoints.length < 3) break; // dropping below 2 waypoints = out-and-back
        cand = {
          ...cand,
          id: `${cand.id}-rp${pass}`,
          waypoints: cand.waypoints.filter((_, i) => i !== nearest),
          // dropped index `nearest` is non-stop; shift stops above it down by one
          stops: cand.stops.map((st) =>
            st.waypointIndex > nearest ? { ...st, waypointIndex: st.waypointIndex - 1 } : st,
          ),
          spans: (cand.spans ?? []).map((sp) => ({
            ...sp,
            startIndex: sp.startIndex > nearest ? sp.startIndex - 1 : sp.startIndex,
            endIndex: sp.endIndex > nearest ? sp.endIndex - 1 : sp.endIndex,
          })),
        };
      }
      try {
        current = await assembleLoop(baseUrl, origin, cand, costingOptions, opts);
      } catch {
        break; // repair route failed outright — keep the best so far
      }
      if (preferred(current, best) === current) {
        best = current;
        bestRepairs = pass;
      }
      continue;
    }

    // --- INSERT (round 11b): boring-connector upgrade ---
    if (
      current.accepted &&
      offenceScore(current) === 0 &&
      (current.arterialRunM ?? 0) > ARTERIAL_RUN_TRIGGER_M &&
      current.arterialRunMid !== null &&
      opts.repairSegments !== undefined &&
      cand.waypoints.length <= INSERT_MAX_WAYPOINTS
    ) {
      const seg = pickInsertSegment(opts.repairSegments, current.arterialRunMid, cand.waypoints);
      if (seg === null) break; // no reachable country material — honest stop
      const p = segMidVertex(seg);
      const slot = insertSlot(cand.waypoints, origin, p);
      const nextCand = {
        ...cand,
        id: `${cand.id}-in${pass}`,
        waypoints: [...cand.waypoints.slice(0, slot), p, ...cand.waypoints.slice(slot)],
        // new point occupies `slot`; shift stops + spans at/after it up by one
        stops: cand.stops.map((s) =>
          s.waypointIndex >= slot ? { ...s, waypointIndex: s.waypointIndex + 1 } : s,
        ),
        spans: (cand.spans ?? []).map((sp) => ({
          ...sp,
          startIndex: sp.startIndex >= slot ? sp.startIndex + 1 : sp.startIndex,
          endIndex: sp.endIndex >= slot ? sp.endIndex + 1 : sp.endIndex,
        })),
      };
      let attempt: AssembledLoop;
      try {
        attempt = await assembleLoop(baseUrl, origin, nextCand, costingOptions, opts);
      } catch {
        break;
      }
      if (insertBetter(attempt, current)) {
        cand = nextCand;
        current = attempt;
        best = attempt;
        bestRepairs = pass;
        continue; // another arterial run may remain — cap governs
      }
      break; // insert did not earn its keep — keep what we had
    }

    break; // nothing left to repair
  }
  return { ...best, repairsApplied: bestRepairs };
}
