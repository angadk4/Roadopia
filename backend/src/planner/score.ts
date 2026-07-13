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
  /** Route countryness 0..1 (owner round 11) — length-weighted class factor of
   *  the FULL traced route (backroads ≈ 1, arterials ≈ 0), from the same
   *  trace_attributes edges as the residential gate; null = trace failed
   *  (term contributes 0 — unknown is never rewarded). */
  countryScore?: number | null;
}

/** The frozen weight-vector shape (§30). */
export interface WeightVector {
  dur: number;
  cur: number;
  stop: number;
  scenic: number;
  overlap: number;
  uturn: number;
  /** Countryness reward (owner round 11): prefers backroad-heavy routes —
   *  the BD-26-validated class factor, applied to the WHOLE traced route so
   *  Valhalla's arterial connectors cost rank. Swept at rq11; 0 = off. */
  country: number;
}

export const DEFAULT_WEIGHTS: WeightVector = {
  dur: 0.3,
  // owner round 5 ("more twisty, more fun"): curviness 0.3 → 0.35, stops 0.15
  // → 0.10 (required stops stay hard-checked at validation regardless)
  cur: 0.35,
  stop: 0.1,
  scenic: 0, // GATED OFF until [GATE-S] (Hard rule C)
  // owner round 3: "avoid the same road twice at all costs" — overlap pressure
  // raised 0.15 → 0.25 (the hard caps stay; scoring separates the survivors)
  overlap: 0.25,
  uturn: 0.1,
  country: 0, // set by the rq11 sweep (round 11); 0 until the winner freezes
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

/** Count of u-turn maneuvers in a routed result. */
export function uturnCount(route: RouteThroughOutput): number {
  return route.maneuvers.filter((m) => m.type.startsWith('uturn')).length;
}

/** U-turn penalty: fraction of maneuvers that are u-turns, saturating at 3. */
export function uturnPenalty(route: RouteThroughOutput): number {
  return Math.min(1, uturnCount(route) / 3);
}

/**
 * Presentation-layer u-turn aversion (owner rounds 2–4): subtract this from a
 * candidate's PRESENTATION key when its route contains any u-turn — scores live
 * in [-0.35, 1], so 10 is lexicographic (every clean route outranks every
 * u-turn route). Assembly still admits single-u-turn routes (hard zero
 * tolerance starved pools twice: 3/33 round 2, 8/36 round 4) — this makes them
 * pure last-resort material rather than pool poison.
 */
export const UTURN_PRESENT_PENALTY = 10;

/**
 * Presentation-layer duration aversion (owner round 14: "the timing issue is
 * dumb"). The undershoot bias was a SELECTION fault, not a generation one —
 * probed pools already CONTAIN a clean on-target candidate, but a shorter,
 * twistier route outranked it because the curviness gain beat the duration-fit
 * loss in the scalar score. This adds a SECOND lexicographic tier BELOW the
 * quality one: a route whose |duration error| exceeds the tolerance ranks
 * under every in-tolerance route of the same quality tier — but a clean
 * on-target route still beats nothing that a clean short route would lose to,
 * and a clean route ALWAYS beats a dirty one (5 < 10). Ordering:
 *   clean+on-target 0 · clean+off −5 · quality-dirty+on −10 · dirty+off −15.
 * In road-sparse towns where no on-target route exists, every candidate is
 * equally duration-penalised, so it falls through to score (best-so-far) —
 * the honest short loop still surfaces, now correctly labelled off-target.
 */
export const DURATION_PRESENT_PENALTY = 5;

export interface ScoreBreakdown {
  score: number;
  terms: {
    dur_fit: number;
    curv_fit: number;
    stop_cover: number;
    scenic_signal: number;
    self_overlap: number;
    uturn_penalty: number;
    country: number;
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
    country: Math.max(0, Math.min(1, input.countryScore ?? 0)),
  };
  const score =
    weights.dur * terms.dur_fit +
    weights.cur * terms.curv_fit +
    weights.stop * terms.stop_cover +
    weights.scenic * terms.scenic_signal -
    weights.overlap * terms.self_overlap -
    weights.uturn * terms.uturn_penalty +
    weights.country * terms.country;
  return { score, terms, weights };
}

/**
 * Merge advanced slider weights (§3.4 open record) over a base vector — only the
 * §30 keys are honoured; unknown keys are ignored (never a crash path).
 */
export function mergeWeights(base: WeightVector, sliders: Weights | null): WeightVector {
  if (!sliders) return base;
  const merged = { ...base };
  for (const key of ['dur', 'cur', 'stop', 'scenic', 'overlap', 'uturn', 'country'] as const) {
    const v = sliders[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) merged[key] = v;
  }
  return merged;
}
