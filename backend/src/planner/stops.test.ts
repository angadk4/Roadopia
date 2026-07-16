import { describe, expect, it } from 'vitest';

import type { CandidateStop } from './candidates';
import { resolveStopArrivals, stopCoverageOf, stopCoverScore } from './stops';

/**
 * R16-3 — stop bookkeeping: per-type coverage math + measured-arrival
 * resolution from break_through legs (alignment rule: legs = stops + 1).
 */

function stop(over: Partial<CandidateStop> = {}): CandidateStop {
  return {
    spotId: 's1',
    name: 'Ridge Café',
    spotType: 'coffee',
    requestedType: 'coffee',
    atFraction: null,
    waypointIndex: 1,
    ...over,
  };
}

describe('stopCoverageOf / stopCoverScore', () => {
  it('tallies per type; strongest importance wins on duplicates', () => {
    const cov = stopCoverageOf(
      [
        { type: 'coffee', count: 1, importance: 'nice_to_have', at_fraction: null },
        { type: 'coffee', count: 1, importance: 'required', at_fraction: 0.5 },
        { type: 'fuel', count: 1, importance: 'required', at_fraction: null },
      ],
      [stop()],
    );
    const coffee = cov.find((c) => c.type === 'coffee')!;
    expect(coffee.requested).toBe(2);
    expect(coffee.included).toBe(1);
    expect(coffee.importance).toBe('required');
    const fuel = cov.find((c) => c.type === 'fuel')!;
    expect(fuel.included).toBe(0);
  });

  it('score = mean of per-type min(1, included/requested); 1 with no requests', () => {
    expect(stopCoverScore([])).toBe(1);
    // coffee fully covered, fuel missing → 0.5 (the old scalar would say 1/2 too,
    // but 2-coffee-0-fuel would score 1 — per-type means it cannot)
    expect(
      stopCoverScore([
        { type: 'coffee', importance: 'required', requested: 1, included: 1 },
        { type: 'fuel', importance: 'required', requested: 1, included: 0 },
      ]),
    ).toBe(0.5);
    // over-inclusion never scores above 1
    expect(
      stopCoverScore([{ type: 'coffee', importance: 'nice_to_have', requested: 1, included: 2 }]),
    ).toBe(1);
  });
});

describe('resolveStopArrivals', () => {
  it('arrival_j = Σ legs[0..j-1] when legs align (stops + 1 legs)', () => {
    const stops = [
      stop({ spotId: 'a', waypointIndex: 3 }),
      stop({ spotId: 'b', spotType: 'fuel', requestedType: 'fuel', waypointIndex: 1 }),
    ];
    const legs = [
      { duration_s: 600, distance_m: 9_000 },
      { duration_s: 1200, distance_m: 20_000 },
      { duration_s: 900, distance_m: 14_000 },
    ];
    const resolved = resolveStopArrivals(stops, { legs });
    // sorted by waypointIndex: b (idx 1) then a (idx 3)
    expect(resolved.map((s) => s.spotId)).toEqual(['b', 'a']);
    expect(resolved[0]!.arrivalS).toBe(600);
    expect(resolved[1]!.arrivalS).toBe(1800);
  });

  it('misaligned legs (engine merged) → every arrival honest null', () => {
    const resolved = resolveStopArrivals([stop()], {
      legs: [{ duration_s: 600, distance_m: 9_000 }], // 1 leg for 1 stop: needs 2
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.arrivalS).toBeNull();
  });

  it('no stops → empty, regardless of legs', () => {
    expect(resolveStopArrivals([], { legs: [{ duration_s: 600, distance_m: 9_000 }] })).toEqual([]);
  });
});
