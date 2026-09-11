/**
 * A→B assembly (M3-T08; Protocol §11 — A4 hybrid corridor, detour-capped).
 *
 * Routes o → stops/curvy-waypoints → d with:
 *   - DETOUR CAP: candidate rejected when distance / direct_distance > detour_max
 *     (scenic-but-ridiculous protection; tunable, calibrated M4);
 *   - ORDERING: `optimize_waypoint_order` ONLY with ≥ 4 total locations
 *     (verification §11 guard, via the M2-T05 wrapper which enforces it);
 *     otherwise the candidate's progress order stands (M3-T06 already sorted).
 *     SKIPPED for span-carrying candidates (R18-3): a span encodes a
 *     deliberate entry→exit traversal in corridor-progress order — the
 *     optimizer would split or reverse it.
 * Rejections carry reasons for the relaxation ladder.
 *
 * R18-3 parity with loops: ALWAYS-TRACE (fail-open) so A→B routes carry
 * measured arterial/residential/country truth — grace at BOTH endpoints (the
 * user chose them; leaving town at either end is not the route's fault) — and
 * `assembleAtoBWithRepair` gives A→B the span-atomic SHIFT/DROP repair moves
 * the loop path earned in rounds 9-13, with the detour cap re-checked on
 * every attempt (assembleAtoB recomputes it from scratch).
 *
 * BD-203 — THE JUDGE'S EYES IN SELECTION AND REPAIR. The A→B structural law
 * (BD-179) refused stubs / crescents / crossings that nothing upstream could
 * see: assembly measured only detour, overlap and u-turns; run.ts hard-coded
 * spurs/microloops to 0 for every A→B row; repair aimed only at u-turns. The
 * law then deleted the five BEST gold corridors (43-70 % backroad) for one
 * defect each. Now every assembly measures the same defects the judge refuses
 * (`atobStructuralDefects`, graced 500 m at BOTH endpoints — BD-185:
 * destination block-loops are how you legally arrive), returns them for
 * selection, and repair SHIFTs the span nearest ANY defect. ONE direct
 * baseline per request (`routeDirectBaseline`: engine-fastest, the full avoid
 * set) feeds the detour cap, the duration-ratio guard BD-108 asked for, the
 * worth-it gate and the honest direct serve — "backroads" is only ever claimed
 * against a measured direct.
 */

import type { LatLng, ParsedConstraints, RouteThroughOutput } from '@shared/types';

import type { LonLat } from '../../../data/curvature/geometry';
import { optimizeWaypointOrder } from '../valhalla/optimize';
import { routeThrough, ValhallaRouteError, type AutoCostingOptions } from '../valhalla/route';
import { traceRoadClasses, type TraceResult } from '../valhalla/trace';

import { traversalSpanOf, type CandidateSpanRef, type WaypointCandidate } from './candidates';
import { selfIntersections, summarizeCrossings, type Crossing } from './crossings';
import {
  pickInsertSegment,
  RESIDENTIAL_HARD_RUN_M,
  RESIDENTIAL_HARD_RUN_ON,
  RESIDENTIAL_HARD_SHARE,
  segMidVertex,
  UNPAVED_MIN_M,
  uturnPositions,
} from './loop';
import {
  maxRetraceRunM,
  microloopPositions,
  selfOverlapRatio,
  spurPositions,
  SPUR_WINDOW_WIDE_STEPS,
} from './overlap';
import {
  arterialShareOf,
  classRunStatsOf,
  countryScoreOf,
  maxClassRunInfo,
  maxResidentialRunInfo,
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

/** Detour cap (routed distance ÷ direct routed distance); candidate value, M4 tunes.
 *  R24-U16: the audit found ~⅓ of A→B rides arterials; the hypothesis was this
 *  cull rejects curvy corridor detours. FALSIFIED by the 15-brief A/B (2026-07-22):
 *  loosening to 2.2× left arterial share UNCHANGED at 83 % (curviness even dipped
 *  0.96→0.94) — the extra distance is more arterial, not more curvy. Root cause is
 *  structural (same as the refused loop chains): connecting scattered points across
 *  the region uses arterial connectors; the cap is not the lever. Kept at 1.8;
 *  ATOB_DETOUR_MAX re-runs the sweep. */
export const DETOUR_MAX_DEFAULT = Number(process.env['ATOB_DETOUR_MAX'] ?? 1.8);
/** A→B self-overlap sanity cap (looser than loops — legitimate shared approaches). */
export const ATOB_SELF_OVERLAP_CAP = 0.3;
/** A→B repair passes (cheaper than loops: pools are smaller, offences fewer). */
export const ATOB_REPAIR_PASS_CAP = 2;
/** A chain may shed spans down to this floor (1 span still beats a centroid). */
export const CORRIDOR_DROP_MIN_SPANS = 1;
/**
 * R25-U6c — value-aware repair (audit-v11 issue #6): with no u-turn present,
 * DROP used to remove the span with the largest straight-line marginal detour
 * — the most off-corridor one, which is SYSTEMATICALLY the curviest (curvy
 * roads are why you leave the corridor). Under the flag: (1) drop by worst
 * detour-PER-UNIT-VALUE instead; (2) the keep-floor rises 1 → 2 spans (a
 * "chain" of one span is a single-touch commute); (3) an ACCEPTED route never
 * runs a DROP pass at all — the audit's hamilton→guelph chain passed with
 * zero reject reasons and was then repaired into a worse single-touch route.
 */
export const ATOB_REPAIR_VALUE_AWARE_ON = process.env['ATOB_REPAIR_VALUE_AWARE'] !== 'off'; // R25-U6c ADOPTED (BD-89)
export const CORRIDOR_DROP_MIN_SPANS_V2 = 2;
/**
 * R25-U6d — rung 5 never reached A→B (RELAXED_ASSEMBLY_CAPS sat inside the
 * isLoop branch). Under the flag the ladder's last rung relaxes the A→B
 * self-overlap cap — EXPLICITLY NOT the detour cap (loosening it was
 * falsified, BD-82: the extra kilometres bought more arterial, not more fun).
 */
export const ATOB_ASSEMBLY_RELAX_ON = process.env['ATOB_ASSEMBLY_RELAX'] !== 'off'; // R25-U6d ADOPTED (BD-89)
/** R25-U5e — A→B gains the residential gates + origin-graced self-overlap
 *  that loops always had. OFF = byte-identical legacy. */
export const ATOB_GATES_V2_ON = process.env['ATOB_GATES_V2'] !== 'off'; // R25-U5e/U6 ADOPTED (BD-89)

/**
 * BD-203 (C) — BD-108's duration-growth guard, finally built. A backroads A→B
 * may take at most this multiple of the ENGINE-FASTEST direct route's
 * duration (the same baseline as the detour cap, routed once per request).
 * The distance cap alone let a 1.02× route ship at 2 % backroad and said
 * nothing about time. Documented, pre-registered bar — owner to confirm;
 * ATOB_DURATION_RATIO_MAX=<n> re-runs the sweep (the DETOUR_MAX pattern).
 */
export const ATOB_DURATION_RATIO_MAX = Number(process.env['ATOB_DURATION_RATIO_MAX'] ?? 1.5);
/**
 * BD-203 (D) — THE WORTH-IT BAR (NEW product bar, pre-registered under BD-203;
 * owner to confirm). A backroads-framed A→B ships as backroads only when its
 * traced backroad share beats the direct route's by at least this much (10
 * percentage points) AND the duration ratio holds; otherwise the honest
 * direct is served with the reason in plain words. Before this the only bound
 * was the binary 1.8× distance cap, and 6/25 gold corridors shipped a
 * ≤ 21 %-backroad route labelled 'backroad' with status ok.
 * ATOB_WORTH_IT_MIN_GAIN=<0..1> re-runs the sweep.
 */
export const ATOB_WORTH_IT_MIN_GAIN = Number(process.env['ATOB_WORTH_IT_MIN_GAIN'] ?? 0.1);
/**
 * BD-203 (A/B) — structural-law grace at BOTH endpoints (m). The user chose
 * them: a stub, crescent or crossing within this radius of the origin OR the
 * destination is how you legally leave or arrive (BD-185 recorded the owner's
 * law for destination block-loops). Residential already graced both ends
 * (R18-3). U-turns share the grace (see AtobDefects.uturns — owner to confirm).
 */
export const ATOB_ENDPOINT_GRACE_M = 500;

export interface AssembledAtoB {
  candidate: WaypointCandidate;
  route: RouteThroughOutput;
  /** Routed distance ÷ direct routed distance. */
  detourRatio: number;
  /** BD-203: routed duration ÷ direct duration; null when no baseline was given. */
  durationRatio: number | null;
  selfOverlap: number;
  accepted: boolean;
  rejectReasons: string[];
  /** True when TSP reordering was applied (≥4 locations, no spans). */
  tspOrdered: boolean;
  /** R18-3: always attempted (fail-open null) — measured route truth. */
  trace: TraceResult | null;
  /** Residential-class share outside BOTH endpoint graces; null = trace failed. */
  residentialShare: number | null;
  /** Longest contiguous residential run (m) outside grace; null = trace failed. */
  residentialRunM: number | null;
  /** Length-weighted countryness of traced edges; null = trace failed. */
  countryScore: number | null;
  /** Arterial-class share of traced edges; null = trace failed. */
  arterialShare: number | null;
  /** R25-U0 road-class truth (audit-v11 buckets); null = trace failed. */
  classMix: ClassMix | null;
  /** R25-U0 backroad continuity: longest contiguous backroad run (m), ungraced. */
  backroadLongestM: number | null;
  /** Mean backroad run length (m); null = trace failed. */
  backroadMeanM: number | null;
  /** R25-U0: longest contiguous hood-class run (m), ungraced; null = untraced. */
  hoodRunM: number | null;
  /** R25-U0 flow: total maneuvers per 10 driving minutes. */
  turnsPer10min: number | null;
  /** BD-203: the structural-law defects the judge would refuse, measured at
   *  assembly with the same detectors and the same endpoint grace. */
  defects: AtobDefects;
  /** Wide-window street stubs outside both graces (defects.spurs.length). */
  spursWide: number;
  /** Crescent / block-spin events outside both graces (defects.crescents.length). */
  microloops: number;
  /** Transversal self-crossings outside both graces (knots + pierces). */
  crossings: number;
  /** Longest contiguous doubled-roadway run (m) outside the origin grace —
   *  measured (loop parity); run.ts used to hard-code 0 for every A→B row. */
  retraceRunM: number;
}

// --- BD-203 (A/B/F): the structural law as a pure, shared measurement ------

export interface AtobDefects {
  /** Wide-window street stubs outside both endpoint graces ([lng, lat] where each bit). */
  spurs: LonLat[];
  /** Crescent / block-spin closure points outside both endpoint graces. */
  crescents: LonLat[];
  /** Transversal self-crossings outside both endpoint graces. */
  crossings: Crossing[];
  /** U-turn maneuvers OUTSIDE both endpoint graces. The owner's u-turn law
   *  (rounds 2-4) never had a grace; BD-203 extends the endpoint grace to it
   *  because the law was deleting a 29 %-backroad corridor for "make a left
   *  U-turn to stay on Broadway" 75 m from the origin PIN (the pin-side twin
   *  of BD-185's arrival block-loop). A u-turn whose position cannot be
   *  recovered is always counted — never excuse what cannot be located.
   *  Owner to confirm. Selection still ranks ANY u-turn as dirty. */
  uturns: number;
  /** Ungraced u-turn positions recovered from maneuver distances (repair aim). */
  uturnPositions: LonLat[];
}

const LAT_M = 111_320;
const LNG_M = 111_320 * Math.cos((43.2 * Math.PI) / 180);

const metresFrom = (p: LonLat, q: LatLng): number =>
  Math.hypot((p[0] - q.lng) * LNG_M, (p[1] - q.lat) * LAT_M);

/**
 * The A→B structural defects of a routed line: stubs, crescents and
 * self-crossings outside `graceM` of the origin AND the destination (the
 * detectors grace the origin natively; the destination is post-filtered by
 * position — the same rule at both ends), plus u-turns (ungraced). This is
 * the ONE measurement the final judge, the assembly row, the repair aim and
 * the alternates filter all read — nothing can be refused that selection
 * could not see.
 */
export function atobStructuralDefects(
  route: RouteThroughOutput,
  origin: LatLng,
  destination: LatLng,
  graceM: number = ATOB_ENDPOINT_GRACE_M,
): AtobDefects {
  const geo = route.geometry;
  const awayFromDestination = (p: LonLat): boolean => metresFrom(p, destination) > graceM;
  const spurs = spurPositions(geo, origin, graceM, SPUR_WINDOW_WIDE_STEPS).filter(
    awayFromDestination,
  );
  const crescents = microloopPositions(geo, origin, graceM).filter(awayFromDestination);
  const crossings = selfIntersections(geo, origin, graceM).filter((c) =>
    awayFromDestination(c.point),
  );
  const allUturns = route.maneuvers.filter((m) => m.type.startsWith('uturn')).length;
  const located = uturnPositions(route).map((p) => [p[0], p[1]] as LonLat);
  const gracedUturns = located.filter(
    (p) => metresFrom(p, origin) <= graceM || metresFrom(p, destination) <= graceM,
  ).length;
  const uturnPos = located.filter(
    (p) => metresFrom(p, origin) > graceM && metresFrom(p, destination) > graceM,
  );
  return {
    spurs,
    crescents,
    crossings,
    uturns: Math.max(0, allUturns - gracedUturns),
    uturnPositions: uturnPos,
  };
}

/** Knots + pierces of the measured crossings (the judge's crossing count). */
export function atobCrossingCount(d: AtobDefects): number {
  const x = summarizeCrossings(d.crossings);
  return x.knots + x.pierces;
}

/** Total law defects — 0 means the judge would pass this route. */
export function atobDefectCount(d: AtobDefects): number {
  return d.spurs.length + d.crescents.length + atobCrossingCount(d) + d.uturns;
}

/** The judge's vocabulary, one label per defect kind present (empty = clean). */
export function atobDefectLabels(d: AtobDefects): string[] {
  const out: string[] = [];
  if (d.spurs.length > 0) out.push(`street stubs ×${d.spurs.length}`);
  if (d.crescents.length > 0) out.push(`crescents ×${d.crescents.length}`);
  if (d.uturns > 0) out.push(`u-turn${d.uturns > 1 ? 's' : ''} ×${d.uturns}`);
  const x = atobCrossingCount(d);
  if (x > 0) out.push(`self-crossings ×${x}`);
  return out;
}

/** Every defect position ([lng, lat]) — the repair pass aims at the nearest. */
export function atobDefectPositions(d: AtobDefects): LonLat[] {
  return [...d.uturnPositions, ...d.spurs, ...d.crescents, ...d.crossings.map((c) => c.point)];
}

/**
 * BD-203 (A): the SHIFT aim generalized from "the span nearest the first
 * u-turn" to "the movable span nearest ANY defect" (u-turns ∪ stubs ∪
 * crescents ∪ crossing points). Distance from a defect to a span is the
 * nearest of the span's waypoints. Null when there is nothing to aim at.
 */
export function nearestSpanToDefects(
  spans: readonly CandidateSpanRef[],
  waypoints: readonly LatLng[],
  defects: readonly LonLat[],
): CandidateSpanRef | null {
  if (spans.length === 0 || defects.length === 0) return null;
  let best: CandidateSpanRef | null = null;
  let bestD = Infinity;
  for (const sp of spans) {
    const lo = Math.min(sp.startIndex, sp.endIndex);
    const hi = Math.max(sp.startIndex, sp.endIndex);
    for (let i = lo; i <= hi; i++) {
      const w = waypoints[i];
      if (w === undefined) continue;
      for (const dpt of defects) {
        const dist = metresFrom(dpt, w);
        if (dist < bestD) {
          bestD = dist;
          best = sp;
        }
      }
    }
  }
  return best;
}

/** BD-203 (F): keep only the alternates the structural judge would pass. */
export function filterAtoBAlternates<T extends { route: RouteThroughOutput }>(
  alternates: readonly T[],
  origin: LatLng,
  destination: LatLng,
): T[] {
  return alternates.filter(
    (a) => atobDefectCount(atobStructuralDefects(a.route, origin, destination)) === 0,
  );
}

// --- BD-203 (C/D/E): the direct baseline and the worth-it gate --------------

export interface DirectBaseline {
  /** Engine-fastest o→d under the full avoid set, with trace-truth has_* flags. */
  route: RouteThroughOutput;
  distanceM: number;
  durationS: number;
  trace: TraceResult | null;
  classMix: ClassMix | null;
  countryScore: number | null;
  arterialShare: number | null;
  backroadLongestM: number | null;
  backroadMeanM: number | null;
  hoodRunM: number | null;
  turnsPer10min: number | null;
  /** false when the avoid set made the direct UNROUTABLE and the baseline had
   *  to be routed without the exclusions — disclosed whenever it is served. */
  avoidHonoured: boolean;
}

/** The direct route's costing: engine-fastest (no `shortest`, no profile
 *  knobs) with the user's FULL avoid set as hard exclusions. */
export function directCostingOptions(avoid: ParsedConstraints['avoid']): AutoCostingOptions {
  return {
    exclude_highways: avoid.highways,
    exclude_tolls: avoid.tolls,
    exclude_ferries: avoid.ferries,
    exclude_unpaved: avoid.unpaved,
  };
}

/**
 * Route the direct A→B ONCE per request. The old pipeline routed a direct per
 * candidate per repair pass (as a denominator only, under the candidate's
 * costing) and a different one — engine-fastest, highway-avoid only — for the
 * fallback. One baseline now serves the detour cap, the duration guard, the
 * worth-it gate, the fallback payload and every disclosure. Traced once
 * (fail-open) so has_highway / has_unpaved carry trace truth and the backroad
 * share is measured. If the avoid set leaves no route at all, the baseline is
 * routed without exclusions and marked `avoidHonoured: false`.
 */
export async function routeDirectBaseline(
  baseUrl: string,
  origin: LatLng,
  destination: LatLng,
  avoid: ParsedConstraints['avoid'],
): Promise<DirectBaseline> {
  const waypoints = [
    [origin.lng, origin.lat],
    [destination.lng, destination.lat],
  ] as const;
  const anyAvoid = avoid.highways || avoid.tolls || avoid.ferries || avoid.unpaved;
  let route: RouteThroughOutput;
  let avoidHonoured = true;
  try {
    route = await routeThrough(baseUrl, { waypoints, costingOptions: directCostingOptions(avoid) });
  } catch (err) {
    // only an ENGINE answer ("no route under these exclusions") earns the
    // unexcluded retry; a transport failure propagates — never a guess
    if (!anyAvoid || !(err instanceof ValhallaRouteError)) throw err;
    route = await routeThrough(baseUrl, { waypoints });
    avoidHonoured = false;
  }
  let trace: TraceResult | null = null;
  try {
    trace = await traceRoadClasses(baseUrl, route.geometry);
  } catch {
    trace = null; // fail-open: summary flags stand, shares stay null
  }
  if (trace !== null) {
    const unpavedM = trace.edges.reduce((acc, e) => acc + (e.unpaved === true ? e.lengthM : 0), 0);
    if (unpavedM > UNPAVED_MIN_M) route = { ...route, has_unpaved: true };
    if (TRACE_HIGHWAY_TRUTH_ON) {
      route = { ...route, has_highway: tracedHighwayM(trace.edges) > TRACE_HIGHWAY_FLOOR_M };
    }
  }
  const grace = [origin, destination] as const;
  const backStats =
    trace === null
      ? null
      : classRunStatsOf(trace.edges, route.geometry, BACKROAD_CLASSES, grace, 0);
  return {
    route,
    distanceM: route.distance_m,
    durationS: route.duration_s,
    trace,
    classMix: trace === null ? null : classMixOf(trace.edges),
    countryScore: trace === null ? null : countryScoreOf(trace.edges),
    arterialShare: trace === null ? null : arterialShareOf(trace.edges),
    backroadLongestM: backStats === null ? null : backStats.longestM,
    backroadMeanM: backStats === null ? null : backStats.meanM,
    hoodRunM:
      trace === null
        ? null
        : maxClassRunInfo(trace.edges, route.geometry, HOOD_CLASSES, grace, 0).runM,
    turnsPer10min: turnsPer10minOf(route),
    avoidHonoured,
  };
}

/**
 * Honest words for a served direct route that carries something the user
 * asked to avoid: either the engine had NO route under that exclusion (the
 * baseline was routed without it), or the exclusion held and the trace still
 * found the thing (shown, never hidden). Empty when nothing asked is present.
 */
export function directAvoidDisclosures(
  baseline: Pick<DirectBaseline, 'route' | 'avoidHonoured'>,
  avoid: ParsedConstraints['avoid'],
): string[] {
  const rows: Array<[boolean, boolean, string, string]> = [
    [avoid.highways, baseline.route.has_highway, 'a stretch of highway', 'highway-free'],
    [avoid.tolls, baseline.route.has_toll, 'a toll road', 'toll-free'],
    [avoid.ferries, baseline.route.has_ferry, 'a ferry', 'ferry-free'],
    [avoid.unpaved, baseline.route.has_unpaved, 'unpaved road', 'fully paved'],
  ];
  const out: string[] = [];
  for (const [asked, present, what, free] of rows) {
    if (!asked || !present) continue;
    out.push(
      baseline.avoidHonoured
        ? `the direct way still includes ${what} (shown honestly)`
        : `the direct way uses ${what} — no ${free} direct route exists here`,
    );
  }
  return out;
}

export interface AtobWorthItInput {
  /** Traced backroad share of the backroads-framed route (null = untraced). */
  routeBackroadShare: number | null;
  /** Traced backroad share of the direct baseline (null = untraced). */
  directBackroadShare: number | null;
  /** route.duration_s ÷ direct duration (null = no baseline duration). */
  durationRatio: number | null;
  minGain?: number;
  maxDurationRatio?: number;
}

export interface AtobWorthItVerdict {
  worthIt: boolean;
  /** Plain-language reasons the backroads option is NOT served (empty = worth it). */
  reasons: string[];
  /** Measured gain in percentage points (route − direct); null when unmeasured. */
  gainPp: number | null;
}

/**
 * BD-203 (D) — the worth-it decision for a backroads-framed A→B. Worth it iff
 * the route's traced backroad share ≥ the direct's + ATOB_WORTH_IT_MIN_GAIN
 * AND the duration ratio ≤ ATOB_DURATION_RATIO_MAX. An UNMEASURED share is
 * never rewarded (Hard rule: no claimed measurement) — it reads as not worth
 * it, with the reason saying so. Pure; the decision table is unit-tested.
 */
export function atobWorthItVerdict(i: AtobWorthItInput): AtobWorthItVerdict {
  const minGain = i.minGain ?? ATOB_WORTH_IT_MIN_GAIN;
  const maxRatio = i.maxDurationRatio ?? ATOB_DURATION_RATIO_MAX;
  const reasons: string[] = [];
  let gainPp: number | null = null;
  if (i.routeBackroadShare === null || i.directBackroadShare === null) {
    reasons.push('the backroads option could not be measured against the direct way');
  } else {
    gainPp = Math.round((i.routeBackroadShare - i.directBackroadShare) * 100);
    if (i.routeBackroadShare < i.directBackroadShare + minGain - 1e-9) {
      reasons.push(
        `the backroads option was not meaningfully better than the direct way ` +
          `(${Math.round(i.routeBackroadShare * 100)}% backroads vs ` +
          `${Math.round(i.directBackroadShare * 100)}% on the direct route)`,
      );
    }
  }
  if (i.durationRatio !== null && i.durationRatio > maxRatio + 1e-9) {
    reasons.push(
      `it would take about ${Math.round((i.durationRatio - 1) * 100)}% longer than the direct way`,
    );
  }
  return { worthIt: reasons.length === 0, reasons, gainPp };
}

/**
 * Route one A→B candidate against the direct baseline. `directDistanceM` and
 * `directDurationS` let the caller compute the baseline ONCE per request and
 * share it across candidates and repair passes (run.ts does, since BD-203);
 * without them the candidate's own costing routes a distance-only baseline
 * (legacy callers) and the duration guard cannot apply.
 */
export async function assembleAtoB(
  baseUrl: string,
  origin: LatLng,
  destination: LatLng,
  candidate: WaypointCandidate,
  {
    directDistanceM,
    directDurationS,
    costingOptions,
    detourMax = DETOUR_MAX_DEFAULT,
    durationRatioMax = ATOB_DURATION_RATIO_MAX,
    selfOverlapCap = ATOB_SELF_OVERLAP_CAP,
    scanUnpaved = false,
  }: {
    directDistanceM?: number;
    /** BD-203: the engine-fastest direct's duration — arms the duration guard. */
    directDurationS?: number;
    costingOptions?: AutoCostingOptions;
    detourMax?: number;
    durationRatioMax?: number;
    selfOverlapCap?: number;
    /** R16-2: flag unpaved metres from the trace (only meaningful when
     *  avoid.unpaved is in play — the flag is otherwise not_applicable). */
    scanUnpaved?: boolean;
  } = {},
): Promise<AssembledAtoB> {
  // direct baseline (shared across candidates when provided)
  let direct = directDistanceM;
  if (direct === undefined) {
    const directRoute = await routeThrough(baseUrl, {
      waypoints: [
        [origin.lng, origin.lat],
        [destination.lng, destination.lat],
      ],
      ...(costingOptions ? { costingOptions } : {}),
    });
    direct = directRoute.distance_m;
  }

  // ordering: TSP only with ≥ 4 total locations (o + wps + d); wrapper enforces
  // too. SKIPPED when any stop is fraction-timed (R16-3) — the optimizer would
  // undo the deliberate early/midway/late placement — and for SPAN candidates
  // (R18-3): entry→exit traversal order is the candidate's whole point.
  let waypoints = candidate.waypoints;
  let stops = candidate.stops;
  let tspOrdered = false;
  const totalLocations = candidate.waypoints.length + 2;
  const hasFractionStop = candidate.stops.some((s) => s.atFraction !== null);
  const hasSpans = (candidate.spans ?? []).length > 0;
  if (totalLocations >= 4 && !hasFractionStop && !hasSpans) {
    const order = await optimizeWaypointOrder(baseUrl, {
      waypoints: [origin, ...candidate.waypoints, destination],
      costing: 'auto',
    });
    // keep endpoints fixed; apply the optimizer's ordering to the middles
    const middle = order.ordered_indices
      .slice(1, -1)
      .map((i) => [origin, ...candidate.waypoints, destination][i]!)
      .filter((p) => p !== origin && p !== destination);
    if (middle.length === candidate.waypoints.length) {
      waypoints = middle;
      tspOrdered = true;
      // re-derive stop indices by object identity (middle holds the SAME
      // LatLng references, just reordered)
      stops = candidate.stops.map((s) => ({
        ...s,
        waypointIndex: middle.indexOf(candidate.waypoints[s.waypointIndex]!),
      }));
    }
  }

  let route = await routeThrough(baseUrl, {
    waypoints: [
      [origin.lng, origin.lat],
      ...waypoints.map((w) => [w.lng, w.lat] as [number, number]),
      [destination.lng, destination.lat],
    ],
    middleType: 'through', // search waypoints are pass-throughs, never stops (SPK-15)
    // R16-3: stop waypoints split legs (break_through) → measured arrivals
    stopIndices: stops.map((s) => s.waypointIndex + 1),
    ...(costingOptions ? { costingOptions } : {}),
  });

  // R18-3: ALWAYS trace (fail-open) — measured truth, loop parity. Grace at
  // BOTH endpoints: the user chose them, so town streets there are not the
  // route's fault.
  let trace: TraceResult | null = null;
  try {
    trace = await traceRoadClasses(baseUrl, route.geometry);
  } catch {
    trace = null; // fail-open: flags stay false, measurements stay null
  }
  if (scanUnpaved && trace !== null) {
    // R16-2: honest unpaved measurement (route summaries carry no surface flag)
    const unpavedM = trace.edges.reduce((acc, e) => acc + (e.unpaved === true ? e.lengthM : 0), 0);
    if (unpavedM > UNPAVED_MIN_M) route = { ...route, has_unpaved: true };
  }
  // R25-U4: has_highway from the TRACE — the summary misses `trunk` (probed:
  // summary false on 33 % trunk). Same pattern as has_unpaved (fail-open).
  if (TRACE_HIGHWAY_TRUTH_ON && trace !== null) {
    route = { ...route, has_highway: tracedHighwayM(trace.edges) > TRACE_HIGHWAY_FLOOR_M };
  }
  const grace = [origin, destination] as const;
  const residentialShare =
    trace === null
      ? null
      : residentialShareOf(trace.edges, route.geometry, grace, RESIDENTIAL_GRACE_RADIUS_M);
  const residentialRunM =
    trace === null
      ? null
      : maxResidentialRunInfo(trace.edges, route.geometry, grace, RESIDENTIAL_GRACE_RADIUS_M).runM;
  const countryScore = trace === null ? null : countryScoreOf(trace.edges);
  const arterialShare = trace === null ? null : arterialShareOf(trace.edges);
  // R25-U0: road-class truth + continuity — same edges, no extra calls.
  const classMix = trace === null ? null : classMixOf(trace.edges);
  const backStats =
    trace === null
      ? null
      : classRunStatsOf(trace.edges, route.geometry, BACKROAD_CLASSES, grace, 0);
  const hoodRunM =
    trace === null
      ? null
      : maxClassRunInfo(trace.edges, route.geometry, HOOD_CLASSES, grace, 0).runM;

  const detourRatio = route.distance_m / direct;
  const durationRatio = directDurationS === undefined ? null : route.duration_s / directDurationS;
  // R25-U5e: grace the ORIGIN like loops do — A→B was judged UNgraced against
  // the same 0.3 cap loops meet WITH 2.5 km of grace (apples to oranges; it
  // also silently punished every candidate for leaving the user's own town).
  const selfOverlap = ATOB_GATES_V2_ON
    ? selfOverlapRatio(route.geometry, undefined, origin)
    : selfOverlapRatio(route.geometry);
  // BD-203 (A): the judge's defects, measured HERE with the judge's grace —
  // selection ranks on them, repair aims at them, the judge refuses nothing
  // upstream could not see.
  const defects = atobStructuralDefects(route, origin, destination);
  const retraceRunM = maxRetraceRunM(route.geometry, undefined, origin);

  const rejectReasons: string[] = [];
  if (detourRatio > detourMax) {
    rejectReasons.push(`detour ${detourRatio.toFixed(2)}× > ${detourMax}×`);
  }
  // BD-203 (C): BD-108's duration-growth guard, next to the distance cap.
  if (durationRatio !== null && durationRatio > durationRatioMax) {
    rejectReasons.push(`duration ${durationRatio.toFixed(2)}× > ${durationRatioMax}×`);
  }
  if (selfOverlap > selfOverlapCap) {
    rejectReasons.push(`self_overlap ${selfOverlap.toFixed(2)} > ${selfOverlapCap}`);
  }
  // U-turns are never fun (owner rounds 2–4): assembly rejects repeat offenders
  // only; presentation is strictly u-turn-averse (see loop.ts for the history —
  // assembly-level zero tolerance starved pools twice).
  if (defects.uturns >= 2) rejectReasons.push(`uturns ${defects.uturns}`);
  // R25-U5e: A→B had NO residential gate at all (loops have both). Same
  // constants as loops — one source of truth.
  if (ATOB_GATES_V2_ON) {
    if (residentialShare !== null && residentialShare > RESIDENTIAL_HARD_SHARE) {
      rejectReasons.push(`residential ${(residentialShare * 100).toFixed(0)}%`);
    }
    if (
      RESIDENTIAL_HARD_RUN_ON &&
      residentialRunM !== null &&
      residentialRunM > RESIDENTIAL_HARD_RUN_M
    ) {
      rejectReasons.push(`residential_run ${Math.round(residentialRunM)}m`);
    }
  }

  return {
    // effective candidate: TSP may have reordered waypoints + stop indices
    candidate: tspOrdered ? { ...candidate, waypoints, stops } : candidate,
    route,
    detourRatio,
    durationRatio,
    selfOverlap,
    accepted: rejectReasons.length === 0,
    rejectReasons,
    tspOrdered,
    trace,
    residentialShare,
    residentialRunM,
    countryScore,
    arterialShare,
    classMix,
    backroadLongestM: backStats === null ? null : backStats.longestM,
    backroadMeanM: backStats === null ? null : backStats.meanM,
    hoodRunM,
    turnsPer10min: turnsPer10minOf(route),
    defects,
    spursWide: defects.spurs.length,
    microloops: defects.crescents.length,
    crossings: atobCrossingCount(defects),
    retraceRunM,
  };
}

/**
 * Weighted offence magnitude for A→B repair aims: detour / duration overflow
 * dominate (only DROP can fix them), then overlap overflow, then the law
 * defects on the loop.ts scale (crescents 10 000 · u-turns 8 000 · crossings
 * 8 000 — refused like a u-turn · stubs 6 000). BD-203: an ACCEPTED route
 * carrying a law defect now scores > 0, so repair keeps working on it
 * instead of breaking at "nothing to fix". Exported for tests.
 */
export function offenceScoreAtoB(a: AssembledAtoB): number {
  return (
    Math.max(0, a.detourRatio - DETOUR_MAX_DEFAULT) * 100_000 +
    Math.max(0, (a.durationRatio ?? 0) - ATOB_DURATION_RATIO_MAX) * 100_000 +
    Math.max(0, a.selfOverlap - ATOB_SELF_OVERLAP_CAP) * 100_000 +
    a.microloops * 10_000 +
    a.defects.uturns * 8_000 +
    a.crossings * 8_000 +
    a.spursWide * 6_000
  );
}

/** Prefer accepted over rejected, then the smaller offence (ties keep `b`). */
function preferredAtoB(a: AssembledAtoB, b: AssembledAtoB): AssembledAtoB {
  if (a.accepted !== b.accepted) return a.accepted ? a : b;
  return offenceScoreAtoB(a) < offenceScoreAtoB(b) ? a : b;
}

const dM = (aLng: number, aLat: number, bLng: number, bLat: number): number =>
  Math.hypot((aLng - bLng) * 111_320 * Math.cos((43.2 * Math.PI) / 180), (aLat - bLat) * 111_320);

/**
 * assembleAtoB + up to ATOB_REPAIR_PASS_CAP span-atomic repairs (R18-3):
 *  - law-defect offences (BD-203: u-turns ∪ stubs ∪ crescents ∪ crossings —
 *    was u-turns only) aim a SHIFT — relocate the whole span nearest ANY
 *    defect onto the best clean segment near it (pickInsertSegment),
 *    preserving span identity; falls back to DROP;
 *  - detour/overlap offences aim a DROP of the span with the largest marginal
 *    straight-line detour (visiting it costs the most corridor deviation).
 * Only span waypoints move — stops are never dropped, their indices are
 * maintained. Every attempt re-runs assembleAtoB, so the detour cap and all
 * gates are re-checked from scratch. The preferred attempt wins; original
 * takes ties. Candidates without spans return the plain assembly untouched.
 * An ACCEPTED candidate that still carries a law defect is repaired too (the
 * judge would refuse it; before BD-203 repair broke at "nothing to fix").
 */
export async function assembleAtoBWithRepair(
  baseUrl: string,
  origin: LatLng,
  destination: LatLng,
  candidate: WaypointCandidate,
  opts: Parameters<typeof assembleAtoB>[4] & {
    repairSegments?: readonly CandidateSegment[];
    /** Cost bound: checked at each pass top (run.ts passes outOfBudget). */
    shouldStop?: () => boolean;
  } = {},
): Promise<AssembledAtoB & { repairsApplied: number }> {
  let current = await assembleAtoB(baseUrl, origin, destination, candidate, opts);
  let best = current;
  let bestRepairs = 0;
  let cand = candidate;

  for (let pass = 1; pass <= ATOB_REPAIR_PASS_CAP; pass++) {
    if (opts.shouldStop?.() === true) break;
    if ((cand.spans ?? []).length === 0) break; // span-atomic moves only
    if (current.accepted && offenceScoreAtoB(current) === 0) break; // nothing to fix

    // pinned user-intent spans are never repair targets (R18-4)
    const movable = cand.spans!.filter((sp) => sp.pinned !== true);
    if (movable.length === 0) break;
    // BD-203 (A): aim at ANY law defect, not only u-turns
    const aims = atobDefectPositions(current.defects);
    let target = movable[0]!;
    let move: 'shift' | 'drop';
    if (aims.length > 0) {
      // the span nearest a defect is the aim; SHIFT first
      target = nearestSpanToDefects(movable, cand.waypoints, aims) ?? movable[0]!;
      move = 'shift';
    } else {
      // R25-U6c: an ACCEPTED chain is never DROP-repaired — the audit's
      // hamilton→guelph chain passed with zero reject reasons and repair
      // then "improved" it into a worse single-touch route
      if (ATOB_REPAIR_VALUE_AWARE_ON && current.accepted) break;
      // detour/overlap: DROP the span whose visit deviates most from the
      // corridor — under U6c, PER UNIT of chain value (the most off-corridor
      // span is systematically the curviest; blind DROP amputated the point)
      const marginal = (s: CandidateSpanRef) => {
        const w = cand.waypoints[s.startIndex]!;
        const detour =
          dM(origin.lng, origin.lat, w.lng, w.lat) +
          dM(w.lng, w.lat, destination.lng, destination.lat);
        return ATOB_REPAIR_VALUE_AWARE_ON ? detour / Math.max(1, s.value ?? 1) : detour;
      };
      target = [...movable].sort((s, t) => marginal(t) - marginal(s))[0]!;
      move = 'drop';
    }

    if (move === 'shift' && opts.repairSegments !== undefined) {
      const w = cand.waypoints[target.startIndex]!;
      const others = cand.waypoints.filter(
        (_, i) => i !== target.startIndex && i !== target.endIndex,
      );
      const seg = pickInsertSegment(opts.repairSegments, [w.lng, w.lat], others);
      if (seg !== null) {
        const isTouch = target.startIndex === target.endIndex;
        const shifted: WaypointCandidate = {
          ...cand,
          id: `${cand.id}-sh${pass}`,
          waypoints: cand.waypoints.map((p, i) => {
            if (isTouch) return i === target.startIndex ? segMidVertex(seg) : p;
            if (i === target.startIndex) return traversalSpanOf(seg)[0];
            if (i === target.endIndex) return traversalSpanOf(seg)[1];
            return p;
          }),
          spans: cand.spans!.map((sp) => (sp === target ? { ...sp, segmentId: seg.id } : sp)),
        };
        try {
          const attempt = await assembleAtoB(baseUrl, origin, destination, shifted, opts);
          if (
            preferredAtoB(attempt, current) === attempt &&
            offenceScoreAtoB(attempt) < offenceScoreAtoB(current)
          ) {
            cand = shifted;
            current = attempt;
            if (preferredAtoB(current, best) === current) {
              best = current;
              bestRepairs = pass;
            }
            continue;
          }
        } catch {
          // shift route failed — fall through to DROP
        }
      }
    }

    // DROP the target span (also the SHIFT fallback); pinned spans don't
    // count toward the keep-floor (they can never be dropped anyway)
    const dropFloor = ATOB_REPAIR_VALUE_AWARE_ON
      ? CORRIDOR_DROP_MIN_SPANS_V2 // R25-U6c: one span is not a chain
      : CORRIDOR_DROP_MIN_SPANS;
    if (movable.length < 1 || cand.spans!.length <= dropFloor) break;
    const isTouch = target.startIndex === target.endIndex;
    const [lo, hi] = [target.startIndex, target.endIndex].sort((a, b) => a - b) as [number, number];
    const shiftIdx = isTouch
      ? (i: number): number => (i > lo ? i - 1 : i)
      : (i: number): number => (i > hi ? i - 2 : i > lo ? i - 1 : i);
    cand = {
      ...cand,
      id: `${cand.id}-rp${pass}`,
      waypoints: cand.waypoints.filter((_, i) => i !== lo && i !== hi),
      stops: cand.stops.map((st) => ({ ...st, waypointIndex: shiftIdx(st.waypointIndex) })),
      spans: cand
        .spans!.filter((sp) => sp !== target)
        .map((sp) => ({
          ...sp,
          startIndex: shiftIdx(sp.startIndex),
          endIndex: shiftIdx(sp.endIndex),
        })),
    };
    try {
      current = await assembleAtoB(baseUrl, origin, destination, cand, opts);
    } catch {
      break; // repair route failed outright — keep the best so far
    }
    if (preferredAtoB(current, best) === current) {
      best = current;
      bestRepairs = pass;
    }
  }

  return { ...best, repairsApplied: bestRepairs };
}
