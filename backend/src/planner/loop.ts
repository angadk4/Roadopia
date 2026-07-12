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
import { traceRoadClasses } from '../valhalla/trace';

import type { WaypointCandidate } from './candidates';
import {
  maxRetraceRunM,
  microloopEvents,
  microloopPositions,
  selfOverlapRatio,
  spurEvents,
  SPUR_WINDOW_WIDE_STEPS,
  ORIGIN_GRACE_RADIUS_M,
} from './overlap';
import { maxResidentialRunInfo, residentialShareOf } from './residential';

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
  /** Small closed circuits (crescent/block spins) outside the origin grace
   *  (round 8) — two-tier: assembly rejects ≥2, presentation demotes ≥1. */
  microloops: number;
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
  const route = await routeThrough(baseUrl, {
    waypoints,
    // search waypoints are pass-throughs, never stops (SPK-15). 'through'
    // forbids u-turns at the point — Valhalla then CIRCLES A BLOCK to reverse
    // heading (the round-8 micro-loop root cause); 'via' permits the u-turn,
    // which the u-turn detectors see and punish honestly (rq8 A/B decides).
    middleType,
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
  if (rejectReasons.length === 0) {
    try {
      const edges = await traceRoadClasses(baseUrl, route.geometry);
      residentialShare = residentialShareOf(edges, route.geometry, origin);
      // round 8b: the absolute run (same edges, no extra call) — the share
      // scales with route length, a subdivision weave does not
      const runInfo = maxResidentialRunInfo(edges, route.geometry, origin);
      residentialRunM = runInfo.runM;
      residentialRunMid = runInfo.mid;
      if (residentialShare > RESIDENTIAL_HARD_SHARE) {
        rejectReasons.push(`residential ${(residentialShare * 100).toFixed(0)}%`);
      }
    } catch {
      residentialShare = null;
      residentialRunM = null;
      residentialRunMid = null;
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
    microloops,
    accepted: rejectReasons.length === 0,
    rejectReasons,
  };
}

// --- round 9: detect-and-repair (owner rounds 7–8b made the detectors; this
// pass USES them: when a route carries a LOCALIZED offence — a micro-loop or
// an over-cap residential run — drop the waypoint nearest the offence and
// re-route; the connector that dragged the route through the neighbourhood
// disappears with its waypoint) -------------------------------------------

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

/**
 * assembleLoop + up to REPAIR_PASS_CAP targeted waypoint-drop repairs.
 * Spot-anchored candidates are returned unrepaired (which waypoint is the
 * requested stop is not recoverable here — dropping it would silently lose
 * the stop). Returns the cleanest attempt; the original wins ties.
 */
export async function assembleLoopWithRepair(
  baseUrl: string,
  origin: LatLng,
  candidate: WaypointCandidate,
  costingOptions?: AutoCostingOptions,
  opts: { selfOverlapCap?: number; middleType?: 'through' | 'via' } = {},
): Promise<AssembledLoop & { repairsApplied: number }> {
  let current = await assembleLoop(baseUrl, origin, candidate, costingOptions, opts);
  if (candidate.spotIds.length > 0) return { ...current, repairsApplied: 0 };

  let best = current;
  let bestRepairs = 0;
  let cand = candidate;
  for (let pass = 1; pass <= REPAIR_PASS_CAP; pass++) {
    if (current.accepted && offenceScore(current) === 0) break; // already clean
    const pos = offencePosition(current, origin);
    if (pos === null) break; // nothing localizable — not this pass's problem
    if (cand.waypoints.length < 3) break; // dropping below 2 waypoints = out-and-back
    let nearest = 0;
    let nearestD = Infinity;
    cand.waypoints.forEach((w, i) => {
      const d = Math.hypot(
        (w.lng - pos[0]) * 111_320 * Math.cos((43.2 * Math.PI) / 180),
        (w.lat - pos[1]) * 111_320,
      );
      if (d < nearestD) {
        nearestD = d;
        nearest = i;
      }
    });
    cand = {
      ...cand,
      id: `${cand.id}-rp${pass}`,
      waypoints: cand.waypoints.filter((_, i) => i !== nearest),
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
  }
  return { ...best, repairsApplied: bestRepairs };
}
