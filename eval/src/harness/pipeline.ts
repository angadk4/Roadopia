/**
 * Shared planner-in-the-loop pipeline for M4 experiments (§14 "same candidate
 * pool for all; vary only selection").
 *
 * This is the SPK-15 loop_quality pipeline (search pass → duration-resize
 * retry → ladder assist → prefilter → score → diversify → validate) returning
 * the FULL kept set with per-candidate stats + verdicts, so ranking/correction
 * experiments can vary one stage while holding the pool constant.
 * loop_quality.ts is left untouched (it is the SPK-15 record); this module is
 * the experiment-facing extraction of the same logic.
 *
 * Two entry levels:
 *  - planKeptSet(): the production-shaped AUTO flow (resize retry + ladder
 *    assist), used by [GATE-R]/[GATE-W].
 *  - runSearchPass()/mergePass()/finalizeKept(): explicit pass-by-pass control
 *    for [GATE-F], where correction MOVES must be applied one at a time.
 */

import type { LineString, ParsedConstraints } from '@shared/types';
import type { Client } from 'pg';

import { generateLoopCandidates, resizedSpeed } from '../../../backend/src/planner/candidates';
import { measureCurvature } from '../../../backend/src/planner/curvature';
import {
  diversify,
  K_PRESENT_DEFAULT,
  prefilterByDuration,
  TAU_OVERLAP_DEFAULT,
} from '../../../backend/src/planner/diversify';
import { lookupInRegion } from '../../../backend/src/planner/gazetteer';
import {
  assembleLoop,
  assembleLoopWithRepair,
  RESIDENTIAL_RUN_SOFT_M,
  RESIDENTIAL_SOFT_SHARE,
  RETRACE_RUN_SOFT_M,
} from '../../../backend/src/planner/loop';
import { pairOverlap } from '../../../backend/src/planner/overlap';
import { weightsForPreset } from '../../../backend/src/planner/presets';
import { retrieveAnchorPoints, retrieveCandidates } from '../../../backend/src/planner/retrieve';
import { buildScope } from '../../../backend/src/planner/scope';
import {
  mergeWeights,
  scoreCandidate,
  uturnCount,
  UTURN_PRESENT_PENALTY,
  type ScoreBreakdown,
  type WeightVector,
} from '../../../backend/src/planner/score';
import { validateCandidate, type ValidationVerdict } from '../../../backend/src/planner/validate';
import type { RequestExample } from '../../src/datasets/schema';

export interface KeptCandidate {
  id: string;
  durationS: number;
  distanceM: number;
  curviness: number;
  selfOverlap: number;
  uturns: number;
  spursWide: number;
  retraceRunM: number;
  /** Residential-class share outside origin grace; null = trace failed. */
  residentialShare: number | null;
  /** Longest contiguous residential run (m) outside grace; null = trace failed. */
  residentialRunM: number | null;
  /** Crescent/block spins outside origin grace (round 8). */
  microloops: number;
  closureM: number;
  stopsIncluded: number;
  score: number;
  presentKey: number;
  breakdown: ScoreBreakdown;
  feasible: boolean;
  verdict: ValidationVerdict;
  geometry: LineString;
}

export interface PlanOutcome {
  constraints: ParsedConstraints;
  targetS: number;
  requestedStops: number;
  kept: KeptCandidate[];
  /** The merged search pool — weights touch only scoring, so [GATE-W] sweeps
   *  re-finalize this pool instead of regenerating it. */
  pool: PoolState;
  notes: string[];
  ms: number;
}

export interface PassSpec {
  tauMult: number;
  theta?: number;
  avgSpeedKmh?: number;
  idPrefix?: string;
}

/** Generation-parameter overrides for M4-T12 calibration sweeps (§21). */
export interface CalibConfig {
  alpha?: number;
  nSectors?: number;
  kClusters?: number;
  nCandidates?: number;
  /** Initial sizing speed override (base is 55, or 42 with avoid.highways). */
  baseSpeedKmh?: number;
  /** Valhalla maneuver_penalty seconds (round-7 sweep; engine default 5). */
  maneuverPenaltyS?: number;
  /** Middle-waypoint type (round-8 A/B: 'through' circles blocks to reverse
   *  heading, 'via' u-turns visibly instead). */
  middleType?: 'through' | 'via';
}

type Assembly = NonNullable<Awaited<ReturnType<typeof assembleLoop>>>;
export interface PoolState {
  candidateIds: Set<string>;
  attempts: Array<Assembly | null>;
  /** assembleLoop calls made so far (route-engine cost proxy). */
  engineCalls: number;
}

export function baseSpeedOf(constraints: ParsedConstraints): number {
  return constraints.avoid.highways ? 42 : 55;
}

/** Gold constraints of a runnable loop brief with the origin resolved, or null. */
export function resolveRunnableConstraints(example: RequestExample): ParsedConstraints | null {
  const gold = example.gold;
  if (!gold || gold.expected_disposition !== 'proceed') return null;
  if (gold.constraints.shape !== 'loop') return null; // M3 planner is loops-only
  const c = gold.constraints;
  if (c.origin && typeof c.origin === 'object') return c;
  if (typeof c.origin === 'string' && c.origin !== 'current') {
    const hit = lookupInRegion(c.origin);
    if (hit) return { ...c, origin: { lat: hit.lat, lng: hit.lng } };
  }
  return null; // 'current' / null / unresolvable — not runnable in offline eval
}

/** One scope→retrieve→generate→assemble pass. */
export async function runSearchPass(
  db: Client,
  valhallaUrl: string,
  constraints: ParsedConstraints,
  durationS: number,
  spec: PassSpec,
  calib: CalibConfig = {},
): Promise<{ candidates: Array<{ id: string }>; attempts: Array<Assembly | null> }> {
  const origin = constraints.origin;
  if (origin === null || typeof origin === 'string') {
    throw new Error('origin did not resolve to coordinates');
  }
  const scope = await buildScope(valhallaUrl, {
    origin,
    shape: 'loop',
    durationS: Math.round(durationS * spec.tauMult),
    ...(calib.alpha !== undefined ? { alpha: calib.alpha } : {}),
  });
  const retrieved = await retrieveCandidates(db, scope, {
    stopTypes: constraints.stops.map((s) => s.type),
    ...(spec.theta !== undefined ? { thetaCurvy: spec.theta } : {}),
  });
  const anchorPoints = await retrieveAnchorPoints(db, scope);
  const candidates = generateLoopCandidates(origin, retrieved.segments, retrieved.spots, {
    anchorSpots: retrieved.spots.length > 0,
    durationS,
    anchorPoints,
    avgSpeedKmh: spec.avgSpeedKmh ?? calib.baseSpeedKmh ?? baseSpeedOf(constraints),
    ...(calib.nSectors !== undefined ? { nSectors: calib.nSectors } : {}),
    ...(calib.kClusters !== undefined ? { kClusters: calib.kClusters } : {}),
    ...(calib.nCandidates !== undefined ? { nCandidates: calib.nCandidates } : {}),
    ...(spec.idPrefix !== undefined ? { idPrefix: spec.idPrefix } : {}),
  });
  const attempts = await Promise.all(
    candidates.map(async (c) => {
      try {
        // round 9: targeted waypoint-drop repair rides on every assembly
        return await assembleLoopWithRepair(
          valhallaUrl,
          origin,
          c,
          {
            exclude_highways: constraints.avoid.highways,
            exclude_tolls: constraints.avoid.tolls,
            exclude_ferries: constraints.avoid.ferries,
            ...(calib.maneuverPenaltyS !== undefined
              ? { maneuver_penalty: calib.maneuverPenaltyS }
              : {}),
          },
          calib.middleType !== undefined ? { middleType: calib.middleType } : {},
        );
      } catch {
        return null;
      }
    }),
  );
  return { candidates, attempts };
}

export function newPool(): PoolState {
  return { candidateIds: new Set(), attempts: [], engineCalls: 0 };
}

/** Merge a pass into the pool, deduping by candidate id (assist-merge rule). */
export function mergePass(
  pool: PoolState,
  pass: { candidates: Array<{ id: string }>; attempts: Array<Assembly | null> },
): void {
  pool.engineCalls += pass.candidates.length;
  const fresh = new Set(pass.candidates.map((c) => c.id));
  for (const id of fresh) pool.candidateIds.add(id);
  const seen = new Set(pool.attempts.filter((a) => a !== null).map((a) => a!.candidate.id));
  for (const a of pass.attempts) {
    if (a === null || !seen.has(a.candidate.id)) pool.attempts.push(a);
  }
}

export function acceptedOf(pool: PoolState): Assembly[] {
  return pool.attempts.filter((a): a is Assembly => a !== null && a.accepted);
}

/** Median assembled duration (s) of the pool, or null when nothing assembled. */
export function medianDurationOf(pool: PoolState): number | null {
  const durs = acceptedOf(pool)
    .map((a) => a.route.duration_s)
    .sort((x, y) => x - y);
  return durs.length ? durs[Math.floor(durs.length / 2)]! : null;
}

/** Prefilter → score → diversify → validate the pool into the kept set. */
export function finalizeKept(
  pool: PoolState,
  constraints: ParsedConstraints,
  weightsOverride?: Partial<WeightVector>,
  validateOpts?: { durationTolerance?: number; tauOverlap?: number },
): { kept: KeptCandidate[]; requestedStops: number } {
  const weights = mergeWeights(
    mergeWeights(weightsForPreset(constraints.preset), constraints.weights),
    weightsOverride ?? null,
  );
  const assembled = acceptedOf(pool);
  const requestedStops = constraints.stops.reduce((s, x) => s + x.count, 0);
  const durationFiltered = prefilterByDuration(
    assembled,
    constraints.duration_target_s,
    (a) => a.route.duration_s,
  );
  const scored = durationFiltered.map((a) => {
    const curv = measureCurvature(a.route.geometry);
    const breakdown = scoreCandidate(
      {
        route: a.route,
        selfOverlap: a.selfOverlap,
        durationTargetS: constraints.duration_target_s,
        curviness: curv.curviness,
        twistinessPref: constraints.twistiness_pref,
        stopCover:
          requestedStops > 0 ? Math.min(1, a.candidate.spotIds.length / requestedStops) : 1,
        scenicSignal: 0,
      },
      weights,
    );
    const dirty =
      uturnCount(a.route) > 0 ||
      a.spursWide > 0 ||
      a.retraceRunM > RETRACE_RUN_SOFT_M ||
      (a.residentialShare ?? 0) > RESIDENTIAL_SOFT_SHARE || // round 7
      (a.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M || // round 8b
      a.microloops > 0; // round 8
    const presentKey = breakdown.score - (dirty ? UTURN_PRESENT_PENALTY : 0);
    return { a, curv, breakdown, presentKey };
  });

  const { kept } = diversify(
    scored.map((s) => ({
      id: s.a.candidate.id,
      score: s.presentKey,
      geometry: s.a.route.geometry,
      payload: s,
    })),
    validateOpts?.tauOverlap !== undefined ? { tauOverlap: validateOpts.tauOverlap } : {},
  );

  const keptOut: KeptCandidate[] = kept.map((k) => {
    const s = (k as unknown as { payload: (typeof scored)[number] }).payload;
    const verdict = validateCandidate(
      {
        route: s.a.route,
        constraints,
        closureM: s.a.closureM,
        selfOverlap: s.a.selfOverlap,
        includedStops: s.a.candidate.spotIds.length,
        requestedStops,
      },
      validateOpts ?? {},
    );
    return {
      id: s.a.candidate.id,
      durationS: s.a.route.duration_s,
      distanceM: s.a.route.distance_m,
      curviness: s.curv.curviness,
      selfOverlap: s.a.selfOverlap,
      uturns: uturnCount(s.a.route),
      spursWide: s.a.spursWide,
      retraceRunM: s.a.retraceRunM,
      residentialShare: s.a.residentialShare,
      residentialRunM: s.a.residentialRunM,
      microloops: s.a.microloops,
      closureM: s.a.closureM,
      stopsIncluded: s.a.candidate.spotIds.length,
      score: s.breakdown.score,
      presentKey: s.presentKey,
      breakdown: s.breakdown,
      feasible: verdict.feasible,
      verdict,
      geometry: s.a.route.geometry,
    };
  });
  return { kept: keptOut, requestedStops };
}

/**
 * Run the deterministic pipeline in production shape (resize retry + ladder
 * assist) and return every presented candidate. Throws if the origin is
 * unresolved. `weightsOverride` lets [GATE-W] sweep the vector on a fixed pool.
 */
export async function planKeptSet(
  db: Client,
  valhallaUrl: string,
  constraints: ParsedConstraints,
  weightsOverride?: Partial<WeightVector>,
  calib: CalibConfig = {},
): Promise<PlanOutcome> {
  const t0 = performance.now();
  const notes: string[] = [];
  const durationS = constraints.duration_target_s ?? 5400;

  const pool = newPool();
  mergePass(
    pool,
    await runSearchPass(db, valhallaUrl, constraints, durationS, { tauMult: 1 }, calib),
  );

  // duration-resize retry (mirrors runPlanner / loop_quality): judged on the
  // LATEST batch's median, up to two attempts
  let latest = pool.attempts;
  let sizingV = calib.baseSpeedKmh ?? baseSpeedOf(constraints);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const durs = latest
      .filter((a): a is Assembly => a !== null && a.accepted)
      .map((a) => a.route.duration_s)
      .sort((x, y) => x - y);
    if (durs.length === 0) break;
    const median = durs[Math.floor(durs.length / 2)]!;
    if (Math.abs(median - durationS) / durationS <= 0.25) break;
    sizingV = resizedSpeed(sizingV, durationS, median);
    const rz = await runSearchPass(
      db,
      valhallaUrl,
      constraints,
      durationS,
      { tauMult: 1, avgSpeedKmh: sizingV, idPrefix: `rz${attempt}-` },
      calib,
    );
    mergePass(pool, rz);
    latest = rz.attempts;
    notes.push(`resized×${attempt}`);
  }

  // ladder assist when distinct kept corridors run thin
  const distinct = (() => {
    const keptGeoms: LineString[] = [];
    for (const a of acceptedOf(pool)) {
      if (keptGeoms.every((g) => pairOverlap(a.route.geometry, g) <= TAU_OVERLAP_DEFAULT)) {
        keptGeoms.push(a.route.geometry);
      }
    }
    return keptGeoms.length;
  })();
  if (distinct < K_PRESENT_DEFAULT) {
    mergePass(
      pool,
      await runSearchPass(
        db,
        valhallaUrl,
        constraints,
        durationS,
        { tauMult: 1.3, theta: 0.4 },
        calib,
      ),
    );
    notes.push('ladder-assisted');
  }

  const { kept, requestedStops } = finalizeKept(pool, constraints, weightsOverride);
  return {
    constraints,
    targetS: durationS,
    requestedStops,
    kept,
    pool,
    notes,
    ms: performance.now() - t0,
  };
}
