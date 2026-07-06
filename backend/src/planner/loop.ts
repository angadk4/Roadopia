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

import type { WaypointCandidate } from './candidates';
import { selfOverlapRatio } from './overlap';

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

export interface AssembledLoop {
  candidate: WaypointCandidate;
  route: RouteThroughOutput;
  closureM: number;
  selfOverlap: number;
  accepted: boolean;
  rejectReasons: string[];
}

/** Route one loop candidate and evaluate closure + retrace sanity. */
export async function assembleLoop(
  baseUrl: string,
  origin: LatLng,
  candidate: WaypointCandidate,
  costingOptions?: AutoCostingOptions,
  { selfOverlapCap = SELF_OVERLAP_HARD_REJECT }: { selfOverlapCap?: number } = {},
): Promise<AssembledLoop> {
  const waypoints: Array<[number, number]> = [
    [origin.lng, origin.lat],
    ...candidate.waypoints.map((w) => [w.lng, w.lat] as [number, number]),
    [origin.lng, origin.lat],
  ];
  // Country-road bias (owner round 2: "relying on main roads, forgetting inner
  // country roads"): soft-bias connectors toward county roads. 0.3 was tried and
  // over-corrected — with highways effectively banned, every loop funnelled
  // through the same 1–2 escarpment corridors and died at the overlap cap
  // (canonical Hamilton brief → redirect). 0.6 = mild preference; M4 calibrates.
  const biasedCosting = { use_highways: 0.6, ...costingOptions };
  const route = await routeThrough(baseUrl, {
    waypoints,
    middleType: 'through', // search waypoints are pass-throughs, never stops (SPK-15)
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
  // U-turns are never fun (owner round 2). Zero-tolerance was tried and it
  // slaughtered the pool (one stray intersection u-turn killed great loops;
  // 3/33): hard-reject only repeat offenders; a single u-turn is scored down.
  const uturns = route.maneuvers.filter((m) => m.type.startsWith('uturn')).length;
  if (uturns >= 2) rejectReasons.push(`uturns ${uturns}`);

  return {
    candidate,
    route,
    closureM,
    selfOverlap,
    accepted: rejectReasons.length === 0,
    rejectReasons,
  };
}
