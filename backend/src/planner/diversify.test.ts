import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { diversify, prefilterByDuration } from './diversify';
import { edgeOverlapRatio, pairOverlap } from './overlap';

/**
 * M3-T09 — overlap math + greedy dedup, engine-free. Lines are built on a metre
 * grid at Niagara latitude so overlap fractions are analytically predictable.
 */

function line(points: Array<[number, number]>): LineString {
  return { type: 'LineString', coordinates: points };
}

/** A straight west→east line at `lat`, from x0 km to x1 km (origin -79.9/43.2). */
function ew(lat: number, x0km: number, x1km: number): LineString {
  const lngPerKm = 1 / (111.32 * Math.cos((43.2 * Math.PI) / 180));
  const n = Math.max(2, Math.round(Math.abs(x1km - x0km) * 4));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const x = x0km + ((x1km - x0km) * i) / n;
    pts.push([-79.9 + x * lngPerKm, lat]);
  }
  return line(pts);
}

describe('edge/pair overlap (M3-T09)', () => {
  it('identical lines overlap ≈ 1; disjoint lines ≈ 0; half-shared ≈ 0.5', () => {
    const a = ew(43.2, 0, 10);
    expect(pairOverlap(a, ew(43.2, 0, 10))).toBeGreaterThan(0.95);
    expect(pairOverlap(a, ew(43.28, 0, 10))).toBe(0); // ~9 km north — disjoint
    const half = edgeOverlapRatio(ew(43.2, 0, 5), ew(43.2, 0, 10));
    expect(half).toBeGreaterThan(0.9); // the 5 km line lies fully on the 10 km line
    const partial = edgeOverlapRatio(ew(43.2, 0, 10), ew(43.2, 5, 10));
    expect(partial).toBeGreaterThan(0.4);
    expect(partial).toBeLessThan(0.62);
  });
});

describe('diversify (M3-T09)', () => {
  const A = { id: 'A', score: 10, geometry: ew(43.2, 0, 10) };
  const Adup = { id: 'Adup', score: 9, geometry: ew(43.2, 0.2, 10) }; // near-duplicate of A
  const B = { id: 'B', score: 8, geometry: ew(43.3, 0, 10) }; // far north — distinct
  const C = { id: 'C', score: 7, geometry: ew(43.4, 0, 10) }; // farther — distinct
  const D = { id: 'D', score: 6, geometry: ew(43.5, 0, 10) };
  const E = { id: 'E', score: 5, geometry: ew(43.1, 0, 10) };

  it('keeps the best of near-duplicates and reports the drop', () => {
    const { kept, dropped } = diversify([Adup, A, B], { tauOverlap: 0.6, kPresent: 4 });
    expect(kept.map((k) => k.id)).toEqual(['A', 'B']);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.candidate.id).toBe('Adup');
    expect(dropped[0]!.overlapWith).toBe('A');
    expect(dropped[0]!.overlap).toBeGreaterThan(0.6);
  });

  it('caps the presented set at K_PRESENT, highest scores first', () => {
    const { kept } = diversify([E, D, C, B, A], { kPresent: 3 });
    expect(kept.map((k) => k.id)).toEqual(['A', 'B', 'C']);
  });

  it('pairwise overlap of the kept set is ≤ τ (the AC invariant)', () => {
    const { kept } = diversify([A, Adup, B, C, D, E], { tauOverlap: 0.6, kPresent: 4 });
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        expect(pairOverlap(kept[i]!.geometry, kept[j]!.geometry)).toBeLessThanOrEqual(0.6);
      }
    }
  });

  it('an out-and-back pair (same corridor both ways) collapses to one', () => {
    const there = ew(43.2, 0, 10);
    const mirror = {
      id: 'mirror',
      score: 4,
      geometry: line([...there.coordinates].reverse() as Array<[number, number]>),
    };
    const { kept, dropped } = diversify([A, mirror], { tauOverlap: 0.6 });
    expect(kept.map((k) => k.id)).toEqual(['A']);
    expect(dropped[0]!.candidate.id).toBe('mirror');
  });

  it('is deterministic under input permutation', () => {
    const inputs = [A, Adup, B, C, D, E];
    const r1 = diversify(inputs);
    const r2 = diversify([...inputs].reverse());
    expect(r1.kept.map((k) => k.id)).toEqual(r2.kept.map((k) => k.id));
  });
});

describe('prefilterByDuration (BD-21, owner round 3)', () => {
  const items = [
    { id: 'a', d: 5400 },
    { id: 'b', d: 9000 },
    { id: 'c', d: 12000 },
  ];
  const dur = (i: { d: number }) => i.d;

  it('keeps only in-band candidates when any exist', () => {
    expect(prefilterByDuration(items, 5400, dur).map((i) => i.id)).toEqual(['a']);
  });

  it('whole pool misses ⇒ keeps ONLY the single closest (no wrong-length flood)', () => {
    expect(prefilterByDuration(items, 1000, dur).map((i) => i.id)).toEqual(['a']);
  });

  it('no target ⇒ untouched', () => {
    expect(prefilterByDuration(items, null, dur)).toEqual(items);
  });

  it('deterministic on ties: the first closest wins', () => {
    const tie = [
      { id: 'x', d: 800 },
      { id: 'y', d: 1200 },
    ];
    expect(prefilterByDuration(tie, 1000, dur, 0.1).map((i) => i.id)).toEqual(['x']);
  });
});
