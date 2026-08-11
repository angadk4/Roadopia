/** R33-U6 — continuity metric contracts. */
import type { Maneuver } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { continuityOf } from './continuity';

const m = (name: string | null, distM: number): Maneuver => ({
  type: 'turn',
  instruction: 'x',
  distance_m: distM,
  ...(name !== null ? { street_names: [name] } : {}),
});

describe('continuityOf', () => {
  it('one sustained road = one run, zero hops', () => {
    const c = continuityOf([m('Fallbrook Trail', 12_000)], 1200)!;
    expect(c.maxRunM).toBe(12_000);
    expect(c.nameHopsPer10min).toBe(0);
    expect(c.distinctNames).toBe(1);
  });

  it('road-hopping scores badly: many short runs, high hops/10min', () => {
    const hoppy = continuityOf(
      [m('A St', 400), m('B Ave', 300), m('C Rd', 500), m('D Line', 350), m('E Side', 450)],
      600, // 10 minutes
    )!;
    expect(hoppy.nameHopsPer10min).toBe(4);
    expect(hoppy.meanRunM).toBeLessThan(500);
    const sustained = continuityOf([m('A St', 1000), m('Long Rd', 9_000)], 600)!;
    expect(sustained.nameHopsPer10min).toBeLessThan(hoppy.nameHopsPer10min);
    expect(sustained.maxRunM).toBeGreaterThan(hoppy.maxRunM);
  });

  it('unnamed stretches EXTEND the current run (rural name gaps are not hops)', () => {
    const c = continuityOf([m('River Rd', 3_000), m(null, 2_000), m('River Rd', 4_000)], 900)!;
    expect(c.maxRunM).toBe(9_000);
    expect(c.nameHopsPer10min).toBe(0);
  });

  it('name comparison is case-insensitive and trimmed', () => {
    const c = continuityOf(
      [m('Forks Of The Credit ', 2_000), m('forks of the credit', 3_000)],
      600,
    )!;
    expect(c.distinctNames).toBe(1);
    expect(c.maxRunM).toBe(5_000);
  });

  it('degenerate inputs → null, never NaN (the R32 invariant discipline)', () => {
    expect(continuityOf([], 600)).toBeNull();
    expect(continuityOf([m('A', 100)], 0)).toBeNull();
    const c = continuityOf([m(null, 500)], 600);
    expect(c).toBeNull(); // never named — no runs to measure
  });
});
