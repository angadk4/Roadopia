import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  identityOrder,
  mapOptimizedResponse,
  MIN_TSP_WAYPOINTS,
  optimizeWaypointOrder,
} from './optimize';

/** M2-T05 — recorded /optimized_route over 5 corridor towns (2026-07-05, v3.7.0). */
const FIVE_TOWNS = JSON.parse(
  readFileSync(new URL('./__fixtures__/optimized-5towns.json', import.meta.url), 'utf8'),
) as unknown;

describe('mapOptimizedResponse', () => {
  it('extracts the optimized visit order (a permutation, fixed endpoints)', () => {
    const out = mapOptimizedResponse(FIVE_TOWNS);
    expect(out.ordered_indices).toHaveLength(5);
    expect([...out.ordered_indices].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(out.ordered_indices[0]).toBe(0); // start fixed
    expect(out.ordered_indices.at(-1)).toBe(4); // end fixed
    // recorded run: Grimsby (2) is visited before Niagara Falls (1)
    expect(out.ordered_indices).toEqual([0, 2, 1, 3, 4]);
  });
});

describe('TSP guard (< 4 waypoints → deterministic identity, NO engine call)', () => {
  it('returns identity order without touching the network', async () => {
    const wp = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ lat: 43 + i / 100, lng: -79 - i / 100 }));
    for (const n of [2, 3]) {
      // unroutable baseUrl proves no fetch happens — a call would reject
      const out = await optimizeWaypointOrder('http://127.0.0.1:1', {
        waypoints: wp(n),
        costing: 'auto',
      });
      expect(out).toEqual(identityOrder(n));
    }
  });

  it('threshold is 4 (guidance: reject <4, fall back to given order)', () => {
    expect(MIN_TSP_WAYPOINTS).toBe(4);
  });
});
