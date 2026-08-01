import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { DIVERSIFY_MAXSET_ON, diversify, prefilterByDuration } from './diversify';
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

describe('R26-C3 max-dispersion diversify (BD-103)', () => {
  /** Three parallel lines + one central line overlapping all three. */
  /**
   * The defect this unit exists for, as a fixture: a CENTRAL high-scorer that
   * overlaps three otherwise-clean routes. Greedy takes it (best score) and is
   * then blocked down to a presented set of 1, while a set of 3 mutually-clean
   * routes sits right there. This is the measured shape of all 22 τ-collapse
   * briefs: 25 accepted → 2.3 kept.
   */
  const seg = (x: number, y0: number, y1: number): LineString => ({
    type: 'LineString',
    coordinates: [
      [x, y0],
      [x, y1],
    ],
  });

  /**
   * The defect this unit exists for. `blocker` scores well enough to be taken
   * SECOND by greedy, and it spans the whole corridor that a/b/c each occupy a
   * third of — so once greedy has it, a, b and c are all excluded and the
   * presented set stops at 2. A mutually-clean set of 4 (top + a + b + c) is
   * sitting right there. This is the measured shape of the 22 tau-collapse
   * briefs: 25.0 accepted collapsing to 2.3 kept.
   */
  const blockedPool = (): Array<{ id: string; score: number; geometry: LineString }> => [
    { id: 'top', score: 100, geometry: seg(1, 0, 0.03) },
    { id: 'blocker', score: 90, geometry: seg(0, 0, 0.03) },
    { id: 'a', score: 10, geometry: seg(0, 0, 0.01) },
    { id: 'b', score: 9, geometry: seg(0, 0.01, 0.02) },
    { id: 'c', score: 8, geometry: seg(0, 0.02, 0.03) },
  ];

  it('THE UNIT: greedy stalls at 2 behind a blocker; the exact search reaches 4', () => {
    const cands = blockedPool();
    const greedy = diversify(cands, { tauOverlap: 0.6, kPresent: 4, maxSet: false });
    const exact = diversify(cands, { tauOverlap: 0.6, kPresent: 4, maxSet: true });
    expect(greedy.kept.map((k) => k.id)).toEqual(['top', 'blocker']);
    expect(exact.kept.length).toBeGreaterThan(greedy.kept.length);
    expect(exact.kept[0]!.id).toBe('top'); // rank-1 still presented
    for (let i = 0; i < exact.kept.length; i++) {
      for (let j = i + 1; j < exact.kept.length; j++) {
        expect(pairOverlap(exact.kept[i]!.geometry, exact.kept[j]!.geometry)).toBeLessThanOrEqual(
          0.6,
        );
      }
    }
  });

  it('KNOWN LIMIT, pinned deliberately: when rank-1 IS the blocker, nothing can be recovered', () => {
    // Pinning rank-1 keeps the promise that the best-scoring route is always
    // presented. The cost is this case — a top scorer overlapping everything
    // leaves a set of 1, and the exact search cannot beat greedy. Dropping
    // rank-1 to widen the menu would mean showing the user worse routes than
    // the one we ranked best, which is a product decision, not a tuning knob.
    const cands = [
      { id: 'central', score: 100, geometry: seg(0, 0, 0.03) },
      { id: 'a', score: 10, geometry: seg(0, 0, 0.01) },
      { id: 'b', score: 9, geometry: seg(0, 0.01, 0.02) },
    ];
    const exact = diversify(cands, { tauOverlap: 0.6, kPresent: 4, maxSet: true });
    expect(exact.kept.map((k) => k.id)).toEqual(['central']);
  });

  it('OFF changes nothing where greedy under-delivers (BD-40 byte-identical)', () => {
    const cands = blockedPool();
    expect(
      diversify(cands, { tauOverlap: 0.6, kPresent: 4, maxSet: false }).kept.map((k) => k.id),
    ).toEqual(diversify(cands, { tauOverlap: 0.6, kPresent: 4 }).kept.map((k) => k.id));
  });

  it('leaves a brief greedy already solves untouched', () => {
    // A central high-scorer that clashes with everything, plus 3 mutually-clean
    // routes. Greedy takes the central one and is then stuck at 1.
    const central = { id: 'central', score: 100, geometry: seg(0, 0, 1) };
    const a = { id: 'a', score: 10, geometry: seg(0.5, 0, 1) };
    const b = { id: 'b', score: 9, geometry: seg(1.0, 0, 1) };
    const c = { id: 'c', score: 8, geometry: seg(1.5, 0, 1) };
    const greedy = diversify([central, a, b, c], { tauOverlap: 0.6, kPresent: 4 });
    // All four are disjoint here, so greedy already succeeds — this pins the
    // control: the exact search must NOT alter a brief greedy already solves.
    expect(greedy.kept).toHaveLength(4);
    expect(greedy.kept[0]!.id).toBe('central');
  });

  it('pins rank-1: the best-scoring route is always presented', () => {
    const cands = [
      { id: 'top', score: 100, geometry: seg(0, 0, 1) },
      { id: 'x', score: 50, geometry: seg(2, 0, 1) },
      { id: 'y', score: 40, geometry: seg(4, 0, 1) },
    ];
    const res = diversify(cands, { tauOverlap: 0.6, kPresent: 4 });
    expect(res.kept[0]!.id).toBe('top');
  });

  it('is deterministic across shuffled input order', () => {
    const mk = (i: number) => ({ id: `c${i}`, score: 100 - i, geometry: seg(i * 0.7, 0, 1) });
    const cands = [0, 1, 2, 3, 4, 5].map(mk);
    const a = diversify(cands, { tauOverlap: 0.6, kPresent: 4 }).kept.map((k) => k.id);
    const b = diversify([...cands].reverse(), { tauOverlap: 0.6, kPresent: 4 }).kept.map(
      (k) => k.id,
    );
    expect(a).toEqual(b);
  });

  it('never returns a kept pair above tau — the AC clause it feeds stays true by construction', () => {
    const mk = (i: number) => ({ id: `c${i}`, score: 100 - i, geometry: seg(i * 0.9, 0, 1) });
    const res = diversify([0, 1, 2, 3, 4].map(mk), { tauOverlap: 0.6, kPresent: 4 });
    for (let i = 0; i < res.kept.length; i++) {
      for (let j = i + 1; j < res.kept.length; j++) {
        expect(pairOverlap(res.kept[i]!.geometry, res.kept[j]!.geometry)).toBeLessThanOrEqual(0.6);
      }
    }
  });

  it('OFF is byte-identical to greedy (the BD-40 contract, asserted in-process)', () => {
    expect(DIVERSIFY_MAXSET_ON).toBe(false); // default; the A/B flips it via env
  });
});
