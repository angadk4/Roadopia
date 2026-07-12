import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { TraceEdge } from '../valhalla/trace';

import { maxResidentialRunM, residentialShareOf } from './residential';

/**
 * Round 7 — residential exposure math. Geometry: a straight west→east line at
 * 43.5°N; 0.01° lng ≈ 809 m there, so 40 points spaced 0.01° ≈ 31.5 km total.
 */
const LINE: LineString = {
  type: 'LineString',
  coordinates: Array.from({ length: 40 }, (_, i) => [-80 + i * 0.01, 43.5]),
};
const ORIGIN = { lat: 43.5, lng: -80 }; // at the line's west end
const TOTAL_M = 39 * 809; // ≈ 31.5 km

const edge = (roadClass: string, lengthM: number): TraceEdge => ({ roadClass, lengthM });

describe('residentialShareOf (owner round 7)', () => {
  it('is 0 for a fully rural route', () => {
    expect(residentialShareOf([edge('tertiary', TOTAL_M)], LINE, ORIGIN)).toBe(0);
  });

  it('measures a mid-route residential stretch against the outside-grace total', () => {
    // 10 km tertiary · 2 km residential · rest tertiary — all beyond 2.5 km grace
    const edges = [
      edge('tertiary', 10_000),
      edge('residential', 2_000),
      edge('tertiary', TOTAL_M - 12_000),
    ];
    const share = residentialShareOf(edges, LINE, ORIGIN);
    // grace exempts the first ~2.5 km (tertiary), so denominator ≈ TOTAL−2.5 km
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.09);
  });

  it("exempts the driver's own street: residential INSIDE the origin grace is free", () => {
    const edges = [
      edge('residential', 1_500), // leaving your own subdivision
      edge('tertiary', TOTAL_M - 3_000),
      edge('residential', 1_500), // returning through it
    ];
    // both residential stretches sit within 2.5 km of the origin… the return
    // one is at the FAR end of this straight line, so only the first is exempt
    const share = residentialShareOf(edges, LINE, ORIGIN);
    const expected = 1_500 / (TOTAL_M - 1_500);
    expect(share).toBeCloseTo(expected, 2);
  });

  it('flags a subdivision-heavy route well above the hard cap', () => {
    const edges = [edge('tertiary', TOTAL_M / 2), edge('residential', TOTAL_M / 2)];
    expect(residentialShareOf(edges, LINE, ORIGIN)).toBeGreaterThan(0.4);
  });

  it('returns 0 on empty inputs (fail-safe, never NaN)', () => {
    expect(residentialShareOf([], LINE, ORIGIN)).toBe(0);
    const dot: LineString = { type: 'LineString', coordinates: [[-80, 43.5]] };
    expect(residentialShareOf([edge('residential', 500)], dot, ORIGIN)).toBe(0);
  });
});

describe('maxResidentialRunM (owner round 8b: Bolton subdivision weave)', () => {
  it('measures the longest contiguous residential run, bridging short connectors', () => {
    // 10 km tertiary · [800 r · 200 u · 500 r] weave · rest tertiary — the
    // 200 m unclassified blip does NOT end the run (≤ 250 m bridge)
    const edges = [
      edge('tertiary', 10_000),
      edge('residential', 800),
      edge('unclassified', 200),
      edge('residential', 500),
      edge('tertiary', TOTAL_M - 11_500),
    ];
    expect(maxResidentialRunM(edges, LINE, ORIGIN)).toBeCloseTo(1_500, 0);
  });

  it('a long connector ends the run (two separate short runs stay under cap)', () => {
    const edges = [
      edge('tertiary', 10_000),
      edge('residential', 400),
      edge('secondary', 1_000), // > bridge — run ends
      edge('residential', 450),
      edge('tertiary', TOTAL_M - 11_850),
    ];
    expect(maxResidentialRunM(edges, LINE, ORIGIN)).toBeCloseTo(450, 0);
  });

  it("exempts the driver's own street inside the origin grace", () => {
    const edges = [edge('residential', 1_800), edge('tertiary', TOTAL_M - 1_800)];
    // the 1.8 km residential leg starts AT the origin — midpoint 900 m < 2.5 km grace
    expect(maxResidentialRunM(edges, LINE, ORIGIN)).toBe(0);
  });

  it('returns 0 on empty inputs', () => {
    expect(maxResidentialRunM([], LINE, ORIGIN)).toBe(0);
  });
});
