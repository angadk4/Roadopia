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

/**
 * Presentation-layer arterial aversion (R18-1). The R18 audit measured bests
 * at 76 % mean arterial share — "boring main roads" was the owner's core
 * complaint, and the scalar `w_country` lever was DISPROVEN (BD-39: pool
 * variance ~0.007 under identical connectors). A THRESHOLD tier works where
 * the scalar couldn't: once costing profiles make connectors differ, a clean
 * on-target backroad route must beat a clean on-target arterial route, while
 * cleanliness (−10) and timing (−5) still dominate (2 < 5 < 10 keeps every
 * BD-42 tier strictly separated). Applies only above the soft share; the
 * `simple` profile is exempt (fast arterials are what "simple" asked for).
 */
export const ARTERIAL_PRESENT_PENALTY = 2;
export const ARTERIAL_SHARE_SOFT = 0.5;

// --- R18-2: graded dirtiness + within-tier duration grade -------------------

/**
 * Graded offence units (R18-2) — replaces the boolean dirty flag's blindness:
 * in an all-dirty pool, one u-turn must beat u-turn+spur+retrace (BD-56's
 * "single-offence pass-through" gap). Unknown-is-dirty: a missing trace adds
 * half a unit rather than reading as clean (fixes the `?? 0` inconsistency).
 * Canonical here; the eval harness imports THIS (never a local copy).
 */
export interface OffenceInput {
  uturns: number;
  microloops: number;
  spursWide: number;
  selfOverlap: number;
  retraceRunM: number;
  residentialShare: number | null;
  residentialRunM: number | null;
  traceNull: boolean;
}

export const RETRACE_UNIT_SOFT_M = 1_200; // mirrors RETRACE_RUN_SOFT_M (no import cycle)
export const RESIDENTIAL_UNIT_SOFT_SHARE = 0.05;
export const RESIDENTIAL_UNIT_SOFT_RUN_M = 500;

export function fallbackOffenceUnits(d: OffenceInput): number {
  let units = 0;
  units += d.uturns * 1.0;
  units += d.microloops * 1.0;
  units += d.spursWide * 0.75;
  units += Math.max(0, d.selfOverlap - 0.15) / 0.05;
  units += Math.max(0, d.retraceRunM - RETRACE_UNIT_SOFT_M) / 1000;
  if (d.residentialShare !== null) {
    units += Math.max(0, d.residentialShare - RESIDENTIAL_UNIT_SOFT_SHARE) * 20;
  }
  if (d.residentialRunM !== null) {
    units += Math.max(0, d.residentialRunM - RESIDENTIAL_UNIT_SOFT_RUN_M) / 500;
  }
  if (d.traceNull) units += 0.5;
  return Math.round(units * 100) / 100;
}

/**
 * Tier bases (R18-2). BD-42's ordering was always LEXICOGRAPHIC intent —
 * clean+on > clean+off > dirty+on > dirty+off — but the historical −5/−10
 * encodings only worked because nothing else moved the scalar. With the R18
 * within-tier grades stacked (duration grade ≤ 2 + arterial tier 2 + dirty
 * grade ≤ 4.5 + score spread ~1.35 ≈ 10), 5-point gaps can interleave — the
 * tier-order property test PROVED it. Fix: tier bases far larger than any
 * possible within-tier spread (100 ≫ ~10), making the ordering un-crossable
 * by construction instead of by hope. Same semantics, provable encoding.
 */
export const PRESENT_TIER_DUROFF = 100;
export const PRESENT_TIER_DIRTY = 200;

/**
 * Within-dirty grading: dirtyPenalty = TIER_DIRTY + min(CAP, units × UNIT) —
 * in an all-dirty pool, least-offence wins (one whole offence unit, 1.5,
 * outweighs the ~1.35 max scalar-score spread). DIRTY_GRADE_UNIT = 0 reverts
 * to boolean tiering exactly.
 */
export const DIRTY_GRADE_UNIT = 1.5;
export const DIRTY_GRADE_CAP = 4.5;

export function dirtyPenaltyOf(dirty: boolean, units: number): number {
  if (!dirty) return 0;
  return PRESENT_TIER_DIRTY + Math.min(DIRTY_GRADE_CAP, units * DIRTY_GRADE_UNIT);
}

/**
 * Within-tier duration grade (R18-2): the 10-20 % undershoot zone sat in the
 * dead band between the resize trigger (25 %) and the −5 demotion (20 %), and
 * durFit (w 0.3) lost to cur (w 0.35). This grade — max 2.0 at the band edge,
 * linear below — makes a 4 %-err clean route beat a 16 %-err clean route
 * unless the latter is genuinely much better. 2 < 5 < 10 preserves the BD-42
 * lexicographic order exactly; DURATION_GRADE_MAX = 0 disables (exact no-op).
 */
export const DURATION_GRADE_MAX = 2.0;

export function durationGradeOf(durationS: number, targetS: number | null): number {
  if (targetS === null || targetS <= 0) return 0;
  const err = Math.abs(durationS - targetS) / targetS;
  return DURATION_GRADE_MAX * (Math.min(err, 0.2) / 0.2);
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
