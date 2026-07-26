import type { RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { weightsForPreset, PRESET_WEIGHTS } from './presets';
import {
  ARTERIAL_PRESENT_PENALTY,
  DIRTY_GRADE_CAP,
  DIRTY_GRADE_CAP_V2,
  dirtyPenaltyOf,
  DURATION_GRADE_MAX,
  DURATION_HARD_ERR,
  fallbackOffenceUnits,
  PRESENT_GRADE_BUDGET,
  presentationKey,
  PRESENT_TIER_DUROFF,
  curvFit,
  durFit,
  mergeWeights,
  scoreCandidate,
  TRACE_NULL_UNITS_STRICT,
  turnGradeOf,
  TURN_GRADE_MAX,
  TURNS_GRADE_HARD,
  TURNS_GRADE_SOFT,
  DEFAULT_WEIGHTS,
} from './score';

/**
 * M3-T10 — deterministic scoring: monotonic responsiveness (raising a weight moves
 * the ranking in that dimension's favour) + preset character + gated scenic term.
 */

function route(durationS: number, uturns = 0): RouteThroughOutput {
  return {
    geometry: {
      type: 'LineString',
      coordinates: [
        [-79.9, 43.2],
        [-79.8, 43.25],
      ],
    },
    distance_m: 30_000,
    duration_s: durationS,
    legs: [],
    maneuvers: [
      { type: 'start', instruction: 'go' },
      ...Array.from({ length: uturns }, () => ({ type: 'uturn_left', instruction: 'u' })),
      { type: 'destination', instruction: 'stop' },
    ],
    has_highway: false,
    has_toll: false,
    has_ferry: false,
    has_unpaved: false,
  };
}

/** Candidate A: perfect duration, gentle. Candidate B: off-duration, very curvy. */
const A = {
  route: route(5400),
  selfOverlap: 0.05,
  durationTargetS: 5400,
  curviness: 0.5,
  twistinessPref: null,
  stopCover: 1,
  scenicSignal: 0.9,
};
const B = { ...A, route: route(7200), curviness: 3.0 };

describe('scoring responsiveness (M3-T10 AC)', () => {
  it('raising the curviness weight flips the ranking toward the curvier route', () => {
    const flat = { ...DEFAULT_WEIGHTS, cur: 0.1, dur: 0.5 };
    const curvy = { ...DEFAULT_WEIGHTS, cur: 0.7, dur: 0.1 };
    expect(scoreCandidate(A, flat).score).toBeGreaterThan(scoreCandidate(B, flat).score);
    expect(scoreCandidate(B, curvy).score).toBeGreaterThan(scoreCandidate(A, curvy).score);
  });

  it('curviness-weight sweep is monotonic for the curvier candidate (responsiveness)', () => {
    let prevGap = -Infinity;
    for (const w of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const weights = { ...DEFAULT_WEIGHTS, cur: w };
      const gap = scoreCandidate(B, weights).score - scoreCandidate(A, weights).score;
      expect(gap).toBeGreaterThan(prevGap);
      prevGap = gap;
    }
  });

  it('self-overlap and u-turns strictly reduce the score', () => {
    const clean = scoreCandidate(A).score;
    expect(scoreCandidate({ ...A, selfOverlap: 0.5 }).score).toBeLessThan(clean);
    expect(scoreCandidate({ ...A, route: route(5400, 3) }).score).toBeLessThan(clean);
  });

  it('the scenic term contributes NOTHING at the gated default weight (Hard rule C)', () => {
    const withScenic = scoreCandidate({ ...A, scenicSignal: 1 }).score;
    const withoutScenic = scoreCandidate({ ...A, scenicSignal: 0 }).score;
    expect(withScenic).toBe(withoutScenic);
  });
});

describe('term shapes', () => {
  it('durFit peaks at the target and decays linearly; neutral without a target', () => {
    expect(durFit(5400, 5400)).toBe(1);
    expect(durFit(6480, 5400)).toBeCloseTo(0.8, 5);
    expect(durFit(10800, 5400)).toBe(0);
    expect(durFit(1234, null)).toBe(1);
  });

  it('curvFit targets pref·CURV_REF with a preference, saturates without', () => {
    expect(curvFit(3.0, null)).toBe(1);
    expect(curvFit(1.5, null)).toBeCloseTo(0.5, 5);
    expect(curvFit(1.5, 0.5)).toBe(1); // target = 1.5
    expect(curvFit(3.0, 0.5)).toBeCloseTo(0.5, 5); // over-twisty vs moderate pref
  });
});

describe('presets (M3-T10 AC)', () => {
  it('twisty preset ranks the curvy candidate first; chill preset the on-time one', () => {
    const twisty = weightsForPreset('twisty');
    const chill = weightsForPreset('chill');
    expect(scoreCandidate(B, twisty).score).toBeGreaterThan(scoreCandidate(A, twisty).score);
    expect(scoreCandidate(A, chill).score).toBeGreaterThan(scoreCandidate(B, chill).score);
  });

  it('coffee_stop preset punishes missing stops hardest', () => {
    const weights = weightsForPreset('coffee_stop');
    const withStop = scoreCandidate({ ...A, stopCover: 1 }, weights).score;
    const withoutStop = scoreCandidate({ ...A, stopCover: 0 }, weights).score;
    expect(withStop - withoutStop).toBeCloseTo(weights.stop, 5);
    expect(weights.stop).toBeGreaterThan(weightsForPreset('twisty').stop);
  });

  it('every preset keeps the scenic weight at 0 until [GATE-S] (Hard rule C)', () => {
    for (const vector of Object.values(PRESET_WEIGHTS)) {
      expect(vector.scenic).toBe(0);
    }
  });

  it("R16-4: 'simple' is BYTE-IDENTICAL to chill's frozen vector (relabel, no new science)", () => {
    expect(weightsForPreset('simple')).toEqual(weightsForPreset('chill'));
  });

  it('R18-2/R25-U9a tier-order property: clean+on > clean+off > dirty+on > dirty+off for ALL grades', () => {
    // R25-U9a: the proof now exercises THE presentationKey function itself
    // (score.ts) instead of a hand-copied deduction stack — a new subtractive
    // term added to presentationKey but not declared in PRESENT_GRADE_BUDGET
    // fails the budget assertion below instead of silently un-covering this
    // proof. Historical context: the 5/10 encodings failed once the R18
    // grades stacked; the 100/200 tier bases make crossing impossible.
    const SCORE_FLOOR = -0.5; // below any reachable scalar score
    const MAX_SCORE_SPREAD = 1.5; // scalar score ∈ ~[-0.35, 1]; 1.5 is generous
    // The budget must leave the tier bases uncrossable — the mechanism that
    // keeps every future within-tier grade honest.
    expect(PRESENT_GRADE_BUDGET + MAX_SCORE_SPREAD).toBeLessThan(PRESENT_TIER_DUROFF);
    // R25-U5ab: the budget must ALSO hold with the V2 dirty cap active (the
    // env-dependent DIRTY_GRADE_CAP means this test runs with 4.5; assert the
    // V2 state statically so neither flag state can cross a tier).
    expect(
      DURATION_GRADE_MAX +
        ARTERIAL_PRESENT_PENALTY +
        DIRTY_GRADE_CAP_V2 +
        TURN_GRADE_MAX +
        MAX_SCORE_SPREAD,
    ).toBeLessThan(PRESENT_TIER_DUROFF);
    // worst possible key within a tier: floor score, every grade maxed.
    // R25-U7 (BD-87): the durations stay UNDER the 50 % wild-miss bar — past
    // it a clean route DELIBERATELY drops to the dirty tier's level (its own
    // test below); this proof covers the four ordinary states.
    const worst = (dirty: boolean, durOff: boolean): number =>
      presentationKey({
        score: SCORE_FLOOR,
        dirty,
        units: 1000, // grade caps at TIER_DIRTY + DIRTY_GRADE_CAP
        durOff,
        contextHeavy: true,
        durationS: 1400, // err 40 % ⇒ duration grade maxed (caps at 20 %), not wild
        durationTargetS: 1000,
      });
    // best possible key within a tier: top score, zero grades (durOff still
    // carries the capped duration grade — off-target implies err > band)
    const bestOf = (dirty: boolean, durOff: boolean): number =>
      presentationKey({
        score: 1,
        dirty,
        units: 0,
        durOff,
        contextHeavy: false,
        durationS: durOff ? 1400 : 1000,
        durationTargetS: 1000,
      });
    expect(worst(false, false)).toBeGreaterThan(bestOf(false, true));
    expect(worst(false, true)).toBeGreaterThan(bestOf(true, false));
    expect(worst(true, false)).toBeGreaterThan(bestOf(true, true));
  });

  it('R25-U9b: turn-density grade — zero under the clean bar, graded to max, flag-gated', () => {
    // shape: the ~90 % of routes under the bar pay ZERO — this targets the tail
    expect(turnGradeOf(null)).toBe(0);
    expect(turnGradeOf(3.3)).toBe(0); // suite mean
    expect(turnGradeOf(TURNS_GRADE_SOFT)).toBe(0);
    expect(turnGradeOf(6.5)).toBeCloseTo(TURN_GRADE_MAX / 2, 5);
    expect(turnGradeOf(TURNS_GRADE_HARD)).toBe(TURN_GRADE_MAX);
    expect(turnGradeOf(99)).toBe(TURN_GRADE_MAX); // saturates
    const mk = (turnsPer10min: number): Parameters<typeof presentationKey>[0] => ({
      score: 0.8,
      dirty: false,
      units: 0,
      durOff: false,
      contextHeavy: false,
      durationS: 3600,
      durationTargetS: 3600,
      turnsPer10min,
    });
    // OFF (default here): turn-heavy and flowing key identically
    expect(presentationKey(mk(8))).toBe(presentationKey(mk(3)));
    // ON: the grade separates them by exactly the declared max — within-tier
    const gap =
      presentationKey(mk(3), { turnGrade: true }) - presentationKey(mk(8), { turnGrade: true });
    expect(gap).toBeCloseTo(TURN_GRADE_MAX, 5);
    expect(gap).toBeLessThan(PRESENT_TIER_DUROFF); // taste never crosses a tier
  });

  it('R25-U7a: beyond DURATION_HARD_ERR a second duration tier stacks (flag-gated)', () => {
    const mk = (durationS: number): Parameters<typeof presentationKey>[0] => ({
      score: 0.8,
      dirty: false,
      units: 0,
      durOff: true,
      contextHeavy: false,
      durationS,
      durationTargetS: 3600,
    });
    const mild = mk(4700); // +31 % — over the band, under the hard bar
    const wild = mk(7000); // +94 % — the audit's worst case (asked 60, got 116)
    expect(4700 / 3600 - 1).toBeLessThan(DURATION_HARD_ERR);
    expect(7000 / 3600 - 1).toBeGreaterThan(DURATION_HARD_ERR);
    // OFF (explicit — the tier is ON by default since BD-87): only the small
    // duration grade separates them
    expect(
      presentationKey(mild, { durHardTier: false }) - presentationKey(wild, { durHardTier: false }),
    ).toBeLessThanOrEqual(DURATION_GRADE_MAX + 1e-9);
    // ON: the wild miss drops a full extra tier — no within-tier grade can rescue it
    const gap =
      presentationKey(mild, { durHardTier: true }) - presentationKey(wild, { durHardTier: true });
    expect(gap).toBeGreaterThan(PRESENT_TIER_DUROFF - DURATION_GRADE_MAX - 1e-9);
    // an on-target route is untouched by the flag in EITHER state
    const onTarget = { ...mk(3600), durOff: false };
    expect(presentationKey(onTarget, { durHardTier: true })).toBe(
      presentationKey(onTarget, { durHardTier: false }),
    );
  });

  it('R18-2 fallbackOffenceUnits: graded, unknown-is-dirty, least-offence orders correctly', () => {
    const base = {
      uturns: 0,
      microloops: 0,
      spursWide: 0,
      selfOverlap: 0.05,
      retraceRunM: 0,
      residentialShare: 0.02 as number | null,
      residentialRunM: 100 as number | null,
      traceNull: false,
    };
    expect(fallbackOffenceUnits(base)).toBe(0); // everything under soft caps
    expect(fallbackOffenceUnits({ ...base, uturns: 1 })).toBe(1);
    // R25-U8c (BD-90): unmeasured costs TRACE_NULL_UNITS_STRICT under the
    // adopted default (was 0.5 — half a u-turn; env TRACE_NULL_STRICT=off
    // restores it). Pin the constant, not one flag state's literal.
    expect(
      fallbackOffenceUnits({
        ...base,
        traceNull: true,
        residentialShare: null,
        residentialRunM: null,
      }),
    ).toBe(TRACE_NULL_UNITS_STRICT);
    // one u-turn < u-turn + spur + 2.2 km retrace (the BD-56 pass-through case)
    const single = fallbackOffenceUnits({ ...base, uturns: 1 });
    const multi = fallbackOffenceUnits({ ...base, uturns: 1, spursWide: 1, retraceRunM: 2200 });
    expect(single).toBeLessThan(multi);
    // dirtyPenaltyOf: graded within tier, capped below the next tier boundary.
    // R25-U5 adoption note: DIRTY_GRADE_CAP is ruler-relative (V2 default 30,
    // env HOOD_MEASURE_V2=off restores 4.5) — pin against the constant so the
    // test states the invariant, not one flag state's literal.
    expect(dirtyPenaltyOf(false, 99)).toBe(0);
    expect(dirtyPenaltyOf(true, 0)).toBe(200);
    expect(dirtyPenaltyOf(true, 1)).toBe(201.5);
    expect(dirtyPenaltyOf(true, 999)).toBe(200 + DIRTY_GRADE_CAP); // capped
    expect(200 + DIRTY_GRADE_CAP).toBeLessThan(300); // never crosses the next tier
  });

  it('mergeWeights honours §30 keys only and ignores junk', () => {
    const merged = mergeWeights(DEFAULT_WEIGHTS, { cur: 0.9, nonsense: 5, dur: -1 });
    expect(merged.cur).toBe(0.9);
    expect(merged.dur).toBe(DEFAULT_WEIGHTS.dur); // negative rejected
    expect((merged as unknown as Record<string, number>)['nonsense']).toBeUndefined();
  });
});
