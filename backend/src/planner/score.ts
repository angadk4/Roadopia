/**
 * Deterministic weighted scoring (M3-T10; Protocol §3.6/§14, Spec §30).
 *
 *   score(ρ) = w_dur·dur_fit + w_cur·curv_fit + w_stop·stop_cover
 *            + w_scenic·scenic_signal − w_overlap·self_overlap − w_uturn·uturn_penalty
 *
 * All terms ∈ [0,1]; the SCENIC term is GATED (Hard rule C / [GATE-S]) — its weight
 * defaults to 0 everywhere until the gate passes; the slot exists so the objective
 * shape is stable. Term definitions are candidates, frozen at M4 [GATE-W].
 */

import type { RouteThroughOutput, Weights } from '@shared/types';

/** Reference curvature for "very twisty" (1/km) — scales curv_fit; M4 calibrates. */
export const CURV_REF = 3.0;

export interface ScoreInput {
  route: RouteThroughOutput;
  selfOverlap: number;
  /** Requested duration target (s), if any. */
  durationTargetS: number | null;
  /** Route curviness (C7, 1/km) measured on final geometry (M3-T05). */
  curviness: number;
  /** Twistiness preference 0..1 (null = "curvier is better" default shaping). */
  twistinessPref: number | null;
  /** Satisfied ÷ requested stops (1 when nothing was requested). */
  stopCover: number;
  /** Scenic signal 0..1 (labels/signals only until [GATE-S]; unused at weight 0). */
  scenicSignal: number;
}

/** The frozen weight-vector shape (§30). */
export interface WeightVector {
  dur: number;
  cur: number;
  stop: number;
  scenic: number;
  overlap: number;
  uturn: number;
}

export const DEFAULT_WEIGHTS: WeightVector = {
  dur: 0.3,
  cur: 0.3,
  stop: 0.2,
  scenic: 0, // GATED OFF until [GATE-S] (Hard rule C)
  overlap: 0.15,
  uturn: 0.1,
};

/** Duration fit: 1 at the target, linear falloff to 0 at ±100 % error. */
export function durFit(durationS: number, targetS: number | null): number {
  if (targetS === null || targetS <= 0) return 1;
  return Math.max(0, 1 - Math.abs(durationS - targetS) / targetS);
}

/**
 * Curviness fit: with a preference, 1 at the implied target (pref·CURV_REF) with
 * linear falloff; without, saturating "curvier is better" up to CURV_REF.
 */
export function curvFit(curviness: number, twistinessPref: number | null): number {
  if (twistinessPref === null) return Math.min(1, curviness / CURV_REF);
  const target = twistinessPref * CURV_REF;
  if (target <= 0) return Math.max(0, 1 - curviness / CURV_REF);
  return Math.max(0, 1 - Math.abs(curviness - target) / CURV_REF);
}

/** U-turn penalty: fraction of maneuvers that are u-turns, saturating at 3. */
export function uturnPenalty(route: RouteThroughOutput): number {
  const uturns = route.maneuvers.filter((m) => m.type.startsWith('uturn')).length;
  return Math.min(1, uturns / 3);
}

export interface ScoreBreakdown {
  score: number;
  terms: {
    dur_fit: number;
    curv_fit: number;
    stop_cover: number;
    scenic_signal: number;
    self_overlap: number;
    uturn_penalty: number;
  };
  weights: WeightVector;
}

/** Compute the deterministic scalar score with full term breakdown (trace-ready). */
export function scoreCandidate(
  input: ScoreInput,
  weights: WeightVector = DEFAULT_WEIGHTS,
): ScoreBreakdown {
  const terms = {
    dur_fit: durFit(input.route.duration_s, input.durationTargetS),
    curv_fit: curvFit(input.curviness, input.twistinessPref),
    stop_cover: Math.max(0, Math.min(1, input.stopCover)),
    scenic_signal: Math.max(0, Math.min(1, input.scenicSignal)),
    self_overlap: Math.max(0, Math.min(1, input.selfOverlap)),
    uturn_penalty: uturnPenalty(input.route),
  };
  const score =
    weights.dur * terms.dur_fit +
    weights.cur * terms.curv_fit +
    weights.stop * terms.stop_cover +
    weights.scenic * terms.scenic_signal -
    weights.overlap * terms.self_overlap -
    weights.uturn * terms.uturn_penalty;
  return { score, terms, weights };
}

/**
 * Merge advanced slider weights (§3.4 open record) over a base vector — only the
 * §30 keys are honoured; unknown keys are ignored (never a crash path).
 */
export function mergeWeights(base: WeightVector, sliders: Weights | null): WeightVector {
  if (!sliders) return base;
  const merged = { ...base };
  for (const key of ['dur', 'cur', 'stop', 'scenic', 'overlap', 'uturn'] as const) {
    const v = sliders[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) merged[key] = v;
  }
  return merged;
}
