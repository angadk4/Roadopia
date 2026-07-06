/**
 * A→B assembly (M3-T08; Protocol §11 — A4 hybrid corridor, detour-capped).
 *
 * Routes o → stops/curvy-waypoints → d with:
 *   - DETOUR CAP: candidate rejected when distance / direct_distance > detour_max
 *     (scenic-but-ridiculous protection; tunable, calibrated M4);
 *   - ORDERING: `optimize_waypoint_order` ONLY with ≥ 4 total locations
 *     (verification §11 guard, via the M2-T05 wrapper which enforces it);
 *     otherwise the candidate's progress order stands (M3-T06 already sorted).
 * Rejections carry reasons for the relaxation ladder.
 */

import type { LatLng, RouteThroughOutput } from '@shared/types';

import { optimizeWaypointOrder } from '../valhalla/optimize';
import { routeThrough, type AutoCostingOptions } from '../valhalla/route';

import type { WaypointCandidate } from './candidates';
import { selfOverlapRatio } from './overlap';

/** Detour cap (routed distance ÷ direct routed distance); candidate value, M4 tunes. */
export const DETOUR_MAX_DEFAULT = 1.8;
/** A→B self-overlap sanity cap (looser than loops — legitimate shared approaches). */
export const ATOB_SELF_OVERLAP_CAP = 0.3;

export interface AssembledAtoB {
  candidate: WaypointCandidate;
  route: RouteThroughOutput;
  /** Routed distance ÷ direct routed distance. */
  detourRatio: number;
  selfOverlap: number;
  accepted: boolean;
  rejectReasons: string[];
  /** True when TSP reordering was applied (≥4 locations). */
  tspOrdered: boolean;
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
  }: {
    directDistanceM?: number;
    costingOptions?: AutoCostingOptions;
    detourMax?: number;
    selfOverlapCap?: number;
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

  // ordering: TSP only with ≥ 4 total locations (o + wps + d); wrapper enforces too
  let waypoints = candidate.waypoints;
  let tspOrdered = false;
  const totalLocations = candidate.waypoints.length + 2;
  if (totalLocations >= 4) {
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
    }
  }

  const route = await routeThrough(baseUrl, {
    waypoints: [
      [origin.lng, origin.lat],
      ...waypoints.map((w) => [w.lng, w.lat] as [number, number]),
      [destination.lng, destination.lat],
    ],
    middleType: 'through', // search waypoints are pass-throughs, never stops (SPK-15)
    ...(costingOptions ? { costingOptions } : {}),
  });

  const detourRatio = route.distance_m / direct;
  const selfOverlap = selfOverlapRatio(route.geometry);

  const rejectReasons: string[] = [];
  if (detourRatio > detourMax) {
    rejectReasons.push(`detour ${detourRatio.toFixed(2)}× > ${detourMax}×`);
  }
  if (selfOverlap > selfOverlapCap) {
    rejectReasons.push(`self_overlap ${selfOverlap.toFixed(2)} > ${selfOverlapCap}`);
  }
  // U-turns are never fun (owner round 2): hard-reject repeat offenders only;
  // a single u-turn is scored down (zero-tolerance starved the pool).
  const uturns = route.maneuvers.filter((m) => m.type.startsWith('uturn')).length;
  if (uturns >= 2) rejectReasons.push(`uturns ${uturns}`);

  return {
    candidate,
    route,
    detourRatio,
    selfOverlap,
    accepted: rejectReasons.length === 0,
    rejectReasons,
    tspOrdered,
  };
}
