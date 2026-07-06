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
import {
  maxRetraceRunM,
  selfOverlapRatio,
  spurEvents,
  SPUR_WINDOW_WIDE_STEPS,
  ORIGIN_GRACE_RADIUS_M,
} from './overlap';

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
  // Country-road bias (owner rounds 2+3). Live-probed on Valhalla 3.7 (BD-21):
  // use_highways is STEP-LIKE — 1.0/0.6/0.4 route byte-identically onto the 401
  // (round 2's "0.6" was a no-op) and the flip sits between 0.4 and 0.3. So 0.25
  // genuinely sheds 400-series connectors. Round 2's "0.3 over-correction" (all
  // loops funnelling one escarpment corridor) was a scarcity artifact of the
  // residential-swamped corpus (~6 usable segments); with class-filtered
  // retrieval (BD-21) there are hundreds of rural corridors to spread across.
  // NOT top_speed: probed +25 % duration distortion on unchanged paths.
  // 0.2 (round 4): owner wants the main-road share pushed down further.
  const biasedCosting = { use_highways: 0.2, ...costingOptions };
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
  const spursWide = spurEvents(
    route.geometry,
    origin,
    ORIGIN_GRACE_RADIUS_M,
    SPUR_WINDOW_WIDE_STEPS,
  );
  const retraceRunM = maxRetraceRunM(route.geometry, undefined, origin);

  return {
    candidate,
    route,
    closureM,
    selfOverlap,
    spurs,
    spursWide,
    retraceRunM,
    accepted: rejectReasons.length === 0,
    rejectReasons,
  };
}
