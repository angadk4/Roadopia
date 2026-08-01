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
  /** R21-1 shape degeneracy (loops only). null/undefined → contributes 0 (a
   *  byte-identical no-op when SHAPE_QUALITY_ON is off / on non-loops); optional
   *  so existing callers and score.test.ts compile unchanged. */
  loopiness?: number | null;
  corridorDoubling?: number | null;
  /**
   * R27 — longest stretch driven twice in opposite directions (m).
   *
   * THE reason the out-and-back assembly reject alone did not fix the defect:
   * when every candidate is rejected the planner still presents the LEAST BAD
   * one (never-empty), and this ranking decided which that was — with no term
   * for doubling at all. `retraceRunM` above does not cover it: it keys on
   * named-road repetition and misses reversals that cross a name change or run
   * on unnamed rural road, which is exactly the population audit-v13 found.
   * Optional so existing callers stay byte-identical when absent.
   */
  outAndBackLongestM?: number | null;
}

/** R27: below this a reversal is junction furniture, not a drive defect
 *  (mirrors OAB_MIN_RUN_M in outandback.ts; no import cycle). */
export const OUT_AND_BACK_UNIT_FLOOR_M = 250;
export const RETRACE_UNIT_SOFT_M = 1_200; // mirrors RETRACE_RUN_SOFT_M (no import cycle)
// R25-U5ab: mirror loop.ts's ruler-relative recalibration (paired Milton
// probe; see loop.ts RESIDENTIAL_SOFT_SHARE) — the graded units must start
// where the dirty clause starts, in BOTH flag states.
export const RESIDENTIAL_UNIT_SOFT_SHARE = process.env['HOOD_MEASURE_V2'] !== 'off' ? 0.08 : 0.05;
export const RESIDENTIAL_UNIT_SOFT_RUN_M = process.env['HOOD_MEASURE_V2'] !== 'off' ? 800 : 500;

// --- R21-1: loop-shape degeneracy units (folded into the DIRTY tier) --------
// The audit found thin "loops" (out-and-backs), showcase routes that drive one
// road out and shadow it back (corridor doubling), and 0.15-0.30 self-overlap
// pavement repeats — all report-only until now. Folding them into the existing
// dirty machinery (not a new lexicographic tier) keeps BD-42 provable BY
// CONSTRUCTION: dirtyPenaltyOf caps at TIER_DIRTY + DIRTY_GRADE_CAP = 204.5
// regardless of unit magnitude, and score.test.ts already tests the dirty tier
// at dirtyPenaltyOf(dirty, 1000) — so no tier-order re-proof is needed. Graded
// (not step) so a mildly-off loop demotes less than a pure sliver; a sliver
// weighs < 1.0 unit → ranks BELOW every clean route but ABOVE a u-turn (1.0).
/** Below this isoperimetric loopiness (4πA/P²) a "loop" is a thin out-and-back.
 *  Good rural loops sit 0.4-0.6; degenerate slivers read < 0.10. 0.20 leaves
 *  the 0.2-0.4 grey zone unpenalized — fail-safe toward NOT demoting borderline
 *  loops. */
export const LOOPINESS_SOFT_FLOOR = 0.2;
/** Above this directed corridor-doubling ratio a loop shadows one road out and
 *  back. Documented accepted floors (shallow crossings, switchback stacks) sit
 *  below 0.30; real out-and-back doubling measures well above. */
export const CORRIDOR_DOUBLING_SOFT = 0.3;
export const SHAPE_UNIT_LOOPINESS = 1.0; // units at loopiness 0 (< a u-turn's 1.0)
export const SHAPE_UNIT_CORRIDOR = 2.0; // units per unit of corridor over soft

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
  // R21-1 shape degeneracy — loopiness is the primary signal (grid-free, catches
  // the parallel-corridor / near-origin doubling the grid detectors miss);
  // corridor doubling is a secondary contributor. null/undefined → 0 (no-op).
  if (d.loopiness != null) {
    units +=
      SHAPE_UNIT_LOOPINESS *
      Math.max(0, (LOOPINESS_SOFT_FLOOR - d.loopiness) / LOOPINESS_SOFT_FLOOR);
  }
  if (d.corridorDoubling != null) {
    units += SHAPE_UNIT_CORRIDOR * Math.max(0, d.corridorDoubling - CORRIDOR_DOUBLING_SOFT);
  }
  // R27: a kilometre of road driven twice costs a full u-turn unit (1.0). A
  // u-turn IS the cheapest possible out-and-back, so anything longer must cost
  // at least as much, and the 15 km cases audit-v13 found now dominate the
  // ranking instead of being invisible to it.
  if (d.outAndBackLongestM != null) {
    units += Math.max(0, d.outAndBackLongestM - OUT_AND_BACK_UNIT_FLOOR_M) / 1000;
  }
  if (d.traceNull) units += TRACE_NULL_STRICT_ON ? TRACE_NULL_UNITS_STRICT : 0.5;
  return Math.round(units * 100) / 100;
}

/**
 * R25-U8c — unmeasured must never outrank measured-clean (audit-v11 issue
 * #13: a failed trace cost 0.5 units — HALF a u-turn — so a route nobody
 * measured could beat a route measured clean). Strict: an unmeasured route
 * costs 2.0 units AND the dirty clause fires on traceNull (run.ts/eval), so
 * it sits in the dirty tier below every measured-clean pool-mate — presented
 * only when nothing measured survives, reported as its own bucket.
 */
export const TRACE_NULL_STRICT_ON = process.env['TRACE_NULL_STRICT'] !== 'off'; // R25-U8c ADOPTED (BD-90)
export const TRACE_NULL_UNITS_STRICT = 2.0;

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
 *
 * R25-U5ab iterate — the 4.5 cap was calibrated when units were u-turn-scale
 * (0-3); with HOOD_MEASURE_V2 removing the residential blindness, hoody-town
 * pools go ALL-dirty with units of 3-20, and the cap SATURATES: measured on
 * St. Jacobs, a 19.1 %-residential winner (u 8.24 → capped 4.5) beat a 7.2 %
 * pool-mate (u 2.79 → 4.19) on a 0.07 score edge — the grade could no longer
 * tell "a bit residential" from "a subdivision weave". Under V2 the cap rises
 * to 30 (20 units × 1.5), still ≪ the 100-point tier gap, so the tier-order
 * proof budget holds in BOTH flag states (asserted in score.test.ts).
 * Env read mirrors residential.ts's flag literal (no import cycle — the
 * RETRACE_UNIT_SOFT_M precedent above).
 */
export const DIRTY_GRADE_UNIT = 1.5;
export const DIRTY_GRADE_CAP_V2 = 30;
export const DIRTY_GRADE_CAP = process.env['HOOD_MEASURE_V2'] !== 'off' ? DIRTY_GRADE_CAP_V2 : 4.5;

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

/**
 * R25-U9a — THE presentation key, extracted. The formula previously lived
 * hand-copied in run.ts, eval/loop_quality.ts and (as a deduction stack) in
 * the tier-order proof — every new term had to be mirrored three ways, and a
 * missed mirror silently un-covered the proof. One function, one budget.
 *
 * ANY new subtractive within-tier term MUST be added here AND declared in
 * PRESENT_GRADE_BUDGET — the proof asserts budget + score spread < TIER bases,
 * so an undeclared term fails the test instead of rotting the ordering.
 */
export interface PresentationInput {
  /** Scalar candidate score (scoreCandidate().score). */
  score: number;
  dirty: boolean;
  /** fallbackOffenceUnits — grades within the dirty tier. */
  units: number;
  durOff: boolean;
  contextHeavy: boolean;
  /** Routed duration + the brief's target — the within-tier duration grade. */
  durationS: number;
  durationTargetS: number | null;
  /** R25-U9b — total maneuvers per 10 driving minutes (turnsPer10minOf).
   *  Optional/null → grade 0 (byte-identical for callers that don't measure). */
  turnsPer10min?: number | null;
  /** R25-U10 — longest contiguous backroad run (m). null/undefined under the
   *  flag → FULL deduction (unknown is never rewarded). */
  backroadLongestM?: number | null;
  /** R25-U10 — true for the `simple` profile (fast main roads are the ask). */
  mixExempt?: boolean;
  /**
   * R27 — MEASURED road-class shares of the routed drive (% of traced metres).
   *
   * The owner's rule, stated in his own words and never once encoded in the
   * ranking until now: **backroads must be the MAJORITY of a fun drive.**
   * R25-U10 designed a majority grade alongside the continuity grade; only the
   * continuity half was ever wired (BD-88), so the planner has been ranking on
   * "longest backroad-class run" with nothing at all rewarding backroad SHARE.
   * audit-v14 measured the consequence: 59 of 90 routes are main-road majority.
   * null/undefined → no contribution (byte-identical for callers that do not
   * measure), which is safe here because the assembly path always traces.
   */
  mainPct?: number | null;
  backroadPct?: number | null;
}

/**
 * R25-U9b — turn density as a graded within-tier term (audit-v11 issue #7:
 * "a stop sign or light every 2 minutes"; mean one maneuver per 2.8 min,
 * worst 1.5 min, 11/60 over 5/10min — measured NOWHERE before U0, scored
 * nowhere before this). Deliberately NOT an OffenceInput field: offences only
 * bite when dirty is already true, which misses the entire clean-but-
 * turn-heavy population — and road taste doesn't belong in the −200 offence
 * vocabulary. The grade starts at the clean-drive bar (5.0) and saturates at
 * the observed worst (8.0), so the ~90 % of routes under the bar pay ZERO —
 * this targets the flow-killing tail, not twisty roads (a twisty road's
 * curves are geometry, not maneuvers; only instructions count here).
 * BD-62's warning applies (a presentation tool aimed at a generation
 * property) — the A/B carries a curviness KILL condition for exactly that.
 */
export const TURN_GRADE_ON = process.env['TURN_GRADE'] === 'on';
export const TURN_GRADE_MAX = 12;
export const TURNS_GRADE_SOFT = 5.0; // grade starts (the clean-drive bar)
export const TURNS_GRADE_HARD = 8.0; // grade saturates (observed max 8.1)

export function turnGradeOf(turnsPer10min: number | null | undefined): number {
  if (turnsPer10min == null) return 0;
  const t = Math.min(
    1,
    Math.max(0, (turnsPer10min - TURNS_GRADE_SOFT) / (TURNS_GRADE_HARD - TURNS_GRADE_SOFT)),
  );
  return TURN_GRADE_MAX * t;
}

/**
 * R25-U10 (continuity half ONLY — the U1 diagnostic's pre-registered verdict,
 * 2026-07-26): within-pool SD(backroadLongestM) is REAL on 11/12 briefs
 * (1.5-10 km) — pools genuinely contain one-long-stretch and many-fragments
 * variants of the same drive — while SD(backroadShare) clears the bar on only
 * 3/12 (rq11's curse persists: most pools straddle nothing, so the MAJORITY
 * grade was CANCELLED in favour of U19, publicly). The owner's ask this term
 * serves: long CONTINUOUS backroad stretches beat many short fragments — and
 * every road-class switch is a junction, so it pays down "too many turns"
 * with the same lever. Unknown is never rewarded: an untraced route takes the
 * FULL deduction. The `simple` profile is exempt (fast main roads are the
 * ask — the ARTERIAL_PRESENT_PENALTY precedent). Not loop-gated (U6e: A→B
 * needs it too).
 */
export const MIX_GRADE_ON = process.env['MIX_GRADE'] !== 'off';
/** R27 majority grade. OFF = byte-identical to the pre-R27 key. */
export const MAJORITY_GRADE_ON = (process.env['MAJORITY_GRADE'] ?? 'off') !== 'off'; // R25-U10 ADOPTED (BD-88)
/**
 * R27 rebalance. Continuity was 6 against a `score` whose ENTIRE range is ~1
 * (weights sum <1 over 0..1 terms; curviness, the dominant quality term for
 * backroads, is weighted 0.4). So a within-tier "tie-breaker" was outweighing
 * every quality signal by ~6-15x, and the planner could not see the difference
 * between a good drive and a bad one — the owner's "there are clear better
 * paths it doesn't take". Continuity is also a WEAK proxy: `backroadLongestM`
 * measures a run of road CLASS, not of one road, so a zigzag through the
 * concession grid scores as continuous. It stays, subordinate to majority.
 */
export const CONTINUITY_GRADE_MAX = 3;
/**
 * R27 — the majority grade. Zero at parity (a main road through fields is a
 * legitimate connector — the owner's own concession), rising to the maximum
 * when main road exceeds backroad by MAJORITY_SPAN_PP. Deliberately the largest
 * within-tier term, because it is the owner's first-order product rule.
 */
export const MAJORITY_GRADE_MAX = 8;
export const MAJORITY_SPAN_PP = 40;

export function majorityGradeOf(
  mainPct: number | null | undefined,
  backroadPct: number | null | undefined,
): number {
  if (mainPct == null || backroadPct == null) return 0;
  const excess = mainPct - backroadPct;
  if (excess <= 0) return 0; // backroads already the majority — nothing owed
  return MAJORITY_GRADE_MAX * Math.min(1, excess / MAJORITY_SPAN_PP);
}
/** Full marks at one unbroken backroad stretch of this length. 8000 (the
 *  ribbon-core floor) zeroes the gradient right where the pool mean already
 *  sits (9.5 km) — env-swept; the A/B picks the value. */
export const CONTINUITY_TARGET_M = Number(process.env['CONTINUITY_TARGET'] ?? 12_000); // swept 8k/12k; 12k met the +1000 m bar

export function continuityGradeOf(backroadLongestM: number | null | undefined): number {
  if (backroadLongestM == null) return CONTINUITY_GRADE_MAX; // unknown ≠ rewarded
  return (
    CONTINUITY_GRADE_MAX *
    Math.min(1, Math.max(0, (CONTINUITY_TARGET_M - backroadLongestM) / CONTINUITY_TARGET_M))
  );
}

/** Sum of every within-tier grade maximum. The tier-order proof asserts
 *  PRESENT_GRADE_BUDGET + max score spread < PRESENT_TIER_DUROFF.
 *  TURN_GRADE_MAX / CONTINUITY_GRADE_MAX are declared unconditionally — the
 *  proof must hold with the flags in EITHER state. */
export const PRESENT_GRADE_BUDGET =
  DURATION_GRADE_MAX +
  ARTERIAL_PRESENT_PENALTY +
  DIRTY_GRADE_CAP +
  TURN_GRADE_MAX +
  CONTINUITY_GRADE_MAX +
  MAJORITY_GRADE_MAX;

/**
 * R25-U7a — a SECOND duration tier for wild misses (audit-v11: 7/60 loops
 * overshot the asked time by >25 %, worst +93 % — "asked 60 min, got 116").
 * Mechanically: those routes won because EVERY pool-mate was durOff, so the
 * flat −100 tier couldn't separate +30 % from +93 %. Beyond DURATION_HARD_ERR
 * a second −100 stacks (total −200): a wildly-over route only ever wins when
 * literally nothing closer exists — which the never-empty fallback then
 * presents WITH the existing overshoot disclosure. Tier stacking is safe by
 * the same construction as durOff (within-tier spread ≈ 10 ≪ 100).
 */
export const DUR_HARD_TIER_ON = process.env['DUR_HARD_TIER'] !== 'off'; // R25-U7 ADOPTED (BD-87)
export const DURATION_HARD_ERR = 0.5;

export function presentationKey(
  i: PresentationInput,
  opts?: { durHardTier?: boolean; turnGrade?: boolean; mixGrade?: boolean },
): number {
  const durHardOff =
    (opts?.durHardTier ?? DUR_HARD_TIER_ON) &&
    i.durationTargetS !== null &&
    i.durationTargetS > 0 &&
    Math.abs(i.durationS - i.durationTargetS) / i.durationTargetS > DURATION_HARD_ERR;
  const turnGrade = (opts?.turnGrade ?? TURN_GRADE_ON) ? turnGradeOf(i.turnsPer10min) : 0;
  const mixOn = (opts?.mixGrade ?? MIX_GRADE_ON) && i.mixExempt !== true;
  const continuityGrade = mixOn ? continuityGradeOf(i.backroadLongestM) : 0;
  const majorityGrade = mixOn && MAJORITY_GRADE_ON ? majorityGradeOf(i.mainPct, i.backroadPct) : 0;
  return (
    i.score -
    dirtyPenaltyOf(i.dirty, i.units) -
    (i.durOff ? PRESENT_TIER_DUROFF : 0) -
    (durHardOff ? PRESENT_TIER_DUROFF : 0) -
    (i.contextHeavy ? ARTERIAL_PRESENT_PENALTY : 0) -
    durationGradeOf(i.durationS, i.durationTargetS) -
    turnGrade -
    continuityGrade -
    majorityGrade
  );
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
