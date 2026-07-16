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

import { countryClassFactor, type WaypointCandidate } from './candidates';
import {
  maxRetraceRunM,
  microloopEvents,
  microloopPositions,
  selfOverlapRatio,
  spurEvents,
  SPUR_WINDOW_WIDE_STEPS,
  ORIGIN_GRACE_RADIUS_M,
} from './overlap';
import {
  countryScoreOf,
  maxClassRunInfo,
  maxResidentialRunInfo,
  residentialShareOf,
} from './residential';
import type { CandidateSegment } from './retrieve';

/** Loop-closure tolerance ε (m): both routed endpoints within this of the origin. */
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
export const RESIDENTIAL_SOFT_SHARE = 0.05;
export const RESIDENTIAL_HARD_SHARE = 0.2;
/**
 * Longest contiguous residential run (m), presentation/AC soft cap (round 8b,
 * Bolton): the SHARE cap scales with route length — 4 % of 101 km hid a
 * 1.3 km subdivision weave. The RUN metric is absolute, like retraceRunM
 * (round-6 lesson: ratios cannot see contiguity). Presentation/AC only —
 * no assembly rejection (the 20 % share hard cap handles egregious cases).
 */
export const RESIDENTIAL_RUN_SOFT_M = 500;

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
  closureM: number;
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
  }: { selfOverlapCap?: number; middleType?: 'through' | 'via' } = {},
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
  const closureM = Math.max(
    haversineMeters([origin.lng, origin.lat], start),
    haversineMeters([origin.lng, origin.lat], end),
  );
  const selfOverlap = selfOverlapRatio(route.geometry, undefined, origin);

  const rejectReasons: string[] = [];
  if (closureM > EPSILON_CLOSURE_M) rejectReasons.push(`closure ${Math.round(closureM)} m > ε`);
  if (selfOverlap > selfOverlapCap) {
    rejectReasons.push(`self_overlap ${selfOverlap.toFixed(2)} > ${selfOverlapCap}`);
  }
  // U-turns are never fun (owner rounds 2–4). Zero tolerance at ASSEMBLY was
  // tried twice and starved the pool both times (3/33 round 2; 8/36 round 4 —
  // four towns to kept-0). The working split: assembly rejects repeat offenders
  // (≥2) to keep pools alive, and the PRESENTATION layer is strictly
  // u-turn-averse (any u-turn ranks below every clean route; run.ts / eval).
  const uturns = route.maneuvers.filter((m) => m.type.startsWith('uturn')).length;
  if (uturns >= 2) rejectReasons.push(`uturns ${uturns}`);
  // Spurs (round 5): same two-tier shape as u-turns — repeat offenders die at
  // assembly (narrow window, proven pool-viable), singles are last-resort
  // presentation material only. The wide window + retrace run are computed for
  // the presentation layer and NEVER reject here (round-6 lesson above).
  const spurs = spurEvents(route.geometry, origin);
  if (spurs >= 2) rejectReasons.push(`spurs ${spurs}`);
  // Micro-loops (round 8): crescent/block spins — small closed circuits with
  // no doubled travel, no u-turn maneuver, negligible residential share; only
  // a cycle detector sees them. Same two-tier: repeat offenders die here,
  // singles are last-resort presentation material ranked below every clean route.
  const microloops = microloopEvents(route.geometry, origin);
  if (microloops >= 2) rejectReasons.push(`microloops ${microloops}`);
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
  let arterialRunM: number | null = null;
  let arterialRunMid: [number, number] | null = null;
  let trace: TraceResult | null = null;
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
      residentialShare = residentialShareOf(edges, route.geometry, origin);
      // round 8b: the absolute run (same edges, no extra call) — the share
      // scales with route length, a subdivision weave does not
      const runInfo = maxResidentialRunInfo(edges, route.geometry, origin);
      residentialRunM = runInfo.runM;
      residentialRunMid = runInfo.mid;
      countryScore = countryScoreOf(edges); // round 11 — same edges, no extra call
      const artInfo = maxClassRunInfo(edges, route.geometry, ARTERIAL_CLASSES, origin);
      arterialRunM = artInfo.runM;
      arterialRunMid = artInfo.mid;
      if (residentialShare > RESIDENTIAL_HARD_SHARE) {
        rejectReasons.push(`residential ${(residentialShare * 100).toFixed(0)}%`);
      }
    } catch {
      residentialShare = null;
      residentialRunM = null;
      residentialRunMid = null;
      countryScore = null;
      arterialRunM = null;
      arterialRunMid = null;
      trace = null;
    }
  }

  return {
    candidate,
    route,
    closureM,
    selfOverlap,
    spurs,
    spursWide,
    retraceRunM,
    residentialShare,
    residentialRunM,
    residentialRunMid,
    countryScore,
    arterialRunM,
    arterialRunMid,
    microloops,
    trace,
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

/** Max repair re-routes per candidate (latency-bounded; §33 spirit). */
export const REPAIR_PASS_CAP = 2;

/** Weighted offence magnitude — micro-loops dominate, then over-cap run metres. */
function offenceScore(a: AssembledLoop): number {
  return a.microloops * 10_000 + Math.max(0, (a.residentialRunM ?? 0) - RESIDENTIAL_RUN_SOFT_M);
}

/** [lng, lat] of the worst LOCALIZED offence, or null when nothing repairable. */
function offencePosition(a: AssembledLoop, origin: LatLng): readonly [number, number] | null {
  const loops = microloopPositions(a.route.geometry, origin);
  if (loops.length > 0) return loops[0]!;
  if ((a.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M) return a.residentialRunMid;
  return null;
}

/** Prefer accepted over rejected, then the smaller offence (ties keep `b`). */
function preferred(a: AssembledLoop, b: AssembledLoop): AssembledLoop {
  if (a.accepted !== b.accepted) return a.accepted ? a : b;
  return offenceScore(a) < offenceScore(b) ? a : b;
}

const dM = (aLng: number, aLat: number, bLng: number, bLat: number): number =>
  Math.hypot((aLng - bLng) * 111_320 * Math.cos((43.2 * Math.PI) / 180), (aLat - bLat) * 111_320);

/** Mid vertex of a candidate segment — the INSERT waypoint (round 11b). */
function segMidVertex(seg: CandidateSegment): LatLng {
  const coords = seg.geometry.coordinates;
  const [lng, lat] = coords[Math.floor(coords.length / 2)]!;
  return { lat, lng };
}

/**
 * Pick the best repair segment near the arterial run's midpoint: highest
 * BD-26 rank (curviness·length·classFactor) within reach, not already
 * shadowed by an existing waypoint.
 */
function pickInsertSegment(
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
    const rank = s.curviness * s.lengthM * countryClassFactor(s.highway);
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
  opts: {
    selfOverlapCap?: number;
    middleType?: 'through' | 'via';
    repairSegments?: readonly CandidateSegment[];
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
  for (let pass = 1; pass <= REPAIR_PASS_CAP; pass++) {
    const pos = offencePosition(current, origin);
    if (pos !== null) {
      // only NON-stop (search) waypoints are movable — never relocate/drop a stop
      const stopIdx = new Set(cand.stops.map((s) => s.waypointIndex));
      let nearest = -1;
      let nearestD = Infinity;
      cand.waypoints.forEach((w, i) => {
        if (stopIdx.has(i)) return;
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
      if (opts.repairSegments !== undefined) {
        const others = cand.waypoints.filter((_, i) => i !== nearest);
        const seg = pickInsertSegment(opts.repairSegments, pos, others);
        if (seg !== null) {
          const shifted = {
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
      if (cand.waypoints.length < 3) break; // dropping below 2 waypoints = out-and-back
      cand = {
        ...cand,
        id: `${cand.id}-rp${pass}`,
        waypoints: cand.waypoints.filter((_, i) => i !== nearest),
        // dropped index `nearest` is non-stop; shift stops above it down by one
        stops: cand.stops.map((s) =>
          s.waypointIndex > nearest ? { ...s, waypointIndex: s.waypointIndex - 1 } : s,
        ),
      };
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
      cand.waypoints.length <= 6
    ) {
      const seg = pickInsertSegment(opts.repairSegments, current.arterialRunMid, cand.waypoints);
      if (seg === null) break; // no reachable country material — honest stop
      const p = segMidVertex(seg);
      const slot = insertSlot(cand.waypoints, origin, p);
      const nextCand = {
        ...cand,
        id: `${cand.id}-in${pass}`,
        waypoints: [...cand.waypoints.slice(0, slot), p, ...cand.waypoints.slice(slot)],
        // new point occupies `slot`; shift stops at/after it up by one
        stops: cand.stops.map((s) =>
          s.waypointIndex >= slot ? { ...s, waypointIndex: s.waypointIndex + 1 } : s,
        ),
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
