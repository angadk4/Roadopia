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
 */

import type { LatLng, RouteThroughOutput } from '@shared/types';

import { optimizeWaypointOrder } from '../valhalla/optimize';
import { routeThrough, type AutoCostingOptions } from '../valhalla/route';
import { traceRoadClasses, type TraceResult } from '../valhalla/trace';

import { traversalSpanOf, type CandidateSpanRef, type WaypointCandidate } from './candidates';
import { pickInsertSegment, segMidVertex, uturnPositions } from './loop';
import { selfOverlapRatio } from './overlap';
import {
  arterialShareOf,
  countryScoreOf,
  maxResidentialRunInfo,
  residentialShareOf,
} from './residential';
import type { CandidateSegment } from './retrieve';

/** Detour cap (routed distance ÷ direct routed distance); candidate value, M4 tunes. */
export const DETOUR_MAX_DEFAULT = 1.8;
/** A→B self-overlap sanity cap (looser than loops — legitimate shared approaches). */
export const ATOB_SELF_OVERLAP_CAP = 0.3;
/** A→B repair passes (cheaper than loops: pools are smaller, offences fewer). */
export const ATOB_REPAIR_PASS_CAP = 2;
/** A chain may shed spans down to this floor (1 span still beats a centroid). */
export const CORRIDOR_DROP_MIN_SPANS = 1;

export interface AssembledAtoB {
  candidate: WaypointCandidate;
  route: RouteThroughOutput;
  /** Routed distance ÷ direct routed distance. */
  detourRatio: number;
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
}

/**
 * Route one A→B candidate against the direct baseline. `directDistanceM` lets the
 * caller compute the baseline once per request and share it across candidates.
 */
export async function assembleAtoB(
  baseUrl: string,
  origin: LatLng,
  destination: LatLng,
  candidate: WaypointCandidate,
  {
    directDistanceM,
    costingOptions,
    detourMax = DETOUR_MAX_DEFAULT,
    selfOverlapCap = ATOB_SELF_OVERLAP_CAP,
    scanUnpaved = false,
  }: {
    directDistanceM?: number;
    costingOptions?: AutoCostingOptions;
    detourMax?: number;
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
    if (unpavedM > 50) route = { ...route, has_unpaved: true };
  }
  const grace = [origin, destination] as const;
  const residentialShare =
    trace === null ? null : residentialShareOf(trace.edges, route.geometry, grace);
  const residentialRunM =
    trace === null ? null : maxResidentialRunInfo(trace.edges, route.geometry, grace).runM;
  const countryScore = trace === null ? null : countryScoreOf(trace.edges);
  const arterialShare = trace === null ? null : arterialShareOf(trace.edges);

  const detourRatio = route.distance_m / direct;
  const selfOverlap = selfOverlapRatio(route.geometry);

  const rejectReasons: string[] = [];
  if (detourRatio > detourMax) {
    rejectReasons.push(`detour ${detourRatio.toFixed(2)}× > ${detourMax}×`);
  }
  if (selfOverlap > selfOverlapCap) {
    rejectReasons.push(`self_overlap ${selfOverlap.toFixed(2)} > ${selfOverlapCap}`);
  }
  // U-turns are never fun (owner rounds 2–4): assembly rejects repeat offenders
  // only; presentation is strictly u-turn-averse (see loop.ts for the history —
  // assembly-level zero tolerance starved pools twice).
  const uturns = route.maneuvers.filter((m) => m.type.startsWith('uturn')).length;
  if (uturns >= 2) rejectReasons.push(`uturns ${uturns}`);

  return {
    // effective candidate: TSP may have reordered waypoints + stop indices
    candidate: tspOrdered ? { ...candidate, waypoints, stops } : candidate,
    route,
    detourRatio,
    selfOverlap,
    accepted: rejectReasons.length === 0,
    rejectReasons,
    tspOrdered,
    trace,
    residentialShare,
    residentialRunM,
    countryScore,
    arterialShare,
  };
}

/** Weighted offence magnitude for A→B repair aims: detour overflow dominates
 *  (only DROP can fix it), then overlap overflow, then u-turns. */
function offenceScoreAtoB(a: AssembledAtoB): number {
  return (
    Math.max(0, a.detourRatio - DETOUR_MAX_DEFAULT) * 100_000 +
    Math.max(0, a.selfOverlap - ATOB_SELF_OVERLAP_CAP) * 100_000 +
    a.route.maneuvers.filter((m) => m.type.startsWith('uturn')).length * 8_000
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
 *  - u-turn offences aim a SHIFT — relocate the whole offending span onto the
 *    best clean segment near the first u-turn (pickInsertSegment), preserving
 *    span identity; falls back to DROP;
 *  - detour/overlap offences aim a DROP of the span with the largest marginal
 *    straight-line detour (visiting it costs the most corridor deviation).
 * Only span waypoints move — stops are never dropped, their indices are
 * maintained. Every attempt re-runs assembleAtoB, so the detour cap and all
 * gates are re-checked from scratch. The preferred attempt wins; original
 * takes ties. Candidates without spans return the plain assembly untouched.
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
    const uts = uturnPositions(current.route);
    let target = movable[0]!;
    let move: 'shift' | 'drop';
    if (uts.length > 0) {
      // u-turn: the span nearest the first u-turn is the aim; SHIFT first
      const [ux, uy] = uts[0]!;
      target = [...movable].sort((s, t) => {
        const sw = cand.waypoints[s.startIndex]!;
        const tw = cand.waypoints[t.startIndex]!;
        return dM(sw.lng, sw.lat, ux, uy) - dM(tw.lng, tw.lat, ux, uy);
      })[0]!;
      move = 'shift';
    } else {
      // detour/overlap: DROP the span whose visit deviates most from the corridor
      const marginal = (s: CandidateSpanRef) => {
        const w = cand.waypoints[s.startIndex]!;
        return (
          dM(origin.lng, origin.lat, w.lng, w.lat) +
          dM(w.lng, w.lat, destination.lng, destination.lat)
        );
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
    if (movable.length < 1 || cand.spans!.length <= CORRIDOR_DROP_MIN_SPANS) break;
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
