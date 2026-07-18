import type { RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { weightsForPreset, PRESET_WEIGHTS } from './presets';
import {
  ARTERIAL_PRESENT_PENALTY,
  dirtyPenaltyOf,
  DURATION_GRADE_MAX,
  fallbackOffenceUnits,
  PRESENT_TIER_DUROFF,
  curvFit,
  durFit,
  mergeWeights,
  scoreCandidate,
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

  it('R18-2 tier-order property: clean+on > clean+off > dirty+on > dirty+off for ALL grades', () => {
    // presentKey = score − dirtyPenaltyOf − (durOff ? TIER_DUROFF : 0) −
    // durGrade − arterial(2). This property FAILED under the historical 5/10
    // encodings once the R18 grades stacked (score spread 1.35 + durGrade 2 +
    // arterial 2 + dirty grade 4.5 ≈ 10 > 5) — the tier bases are now 100/200
    // so no combination of within-tier grades can ever cross a tier boundary.
    const SCORE_FLOOR = -0.5; // below any reachable scalar score
    const worst = (dirty: boolean, durOff: boolean): number =>
      SCORE_FLOOR -
      dirtyPenaltyOf(dirty, 1000) - // grade caps at TIER_DIRTY + 4.5
      (durOff ? PRESENT_TIER_DUROFF : 0) -
      DURATION_GRADE_MAX -
      ARTERIAL_PRESENT_PENALTY;
    const bestOf = (dirty: boolean, durOff: boolean): number =>
      1 -
      dirtyPenaltyOf(dirty, 0) -
      (durOff ? PRESENT_TIER_DUROFF : 0) -
      (durOff ? DURATION_GRADE_MAX : 0); // off-target always carries the capped grade
    expect(worst(false, false)).toBeGreaterThan(bestOf(false, true));
    expect(worst(false, true)).toBeGreaterThan(bestOf(true, false));
    expect(worst(true, false)).toBeGreaterThan(bestOf(true, true));
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
    expect(
      fallbackOffenceUnits({
        ...base,
        traceNull: true,
        residentialShare: null,
        residentialRunM: null,
      }),
    ).toBe(0.5);
    // one u-turn < u-turn + spur + 2.2 km retrace (the BD-56 pass-through case)
    const single = fallbackOffenceUnits({ ...base, uturns: 1 });
    const multi = fallbackOffenceUnits({ ...base, uturns: 1, spursWide: 1, retraceRunM: 2200 });
    expect(single).toBeLessThan(multi);
    // dirtyPenaltyOf: graded within tier, capped below the next tier boundary
    expect(dirtyPenaltyOf(false, 99)).toBe(0);
    expect(dirtyPenaltyOf(true, 0)).toBe(200);
    expect(dirtyPenaltyOf(true, 1)).toBe(201.5);
    expect(dirtyPenaltyOf(true, 99)).toBe(204.5); // cap: TIER + 4.5
  });

  it('mergeWeights honours §30 keys only and ignores junk', () => {
    const merged = mergeWeights(DEFAULT_WEIGHTS, { cur: 0.9, nonsense: 5, dur: -1 });
    expect(merged.cur).toBe(0.9);
    expect(merged.dur).toBe(DEFAULT_WEIGHTS.dur); // negative rejected
    expect((merged as unknown as Record<string, number>)['nonsense']).toBeUndefined();
  });
});
