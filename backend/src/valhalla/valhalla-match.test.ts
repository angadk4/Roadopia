import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { mapRouteResponse } from './route';

/**
 * M2-T05 — recorded /trace_route response (map_snap of the default route's own
 * shape; 2026-07-05, v3.7.0). Same trip schema as /route → same mapper. SPK-07's
 * real-GPS quality check rides M9 (needs an owner drive).
 */
const TRACE = JSON.parse(
  readFileSync(new URL('./__fixtures__/trace-hamilton-stcatharines.json', import.meta.url), 'utf8'),
) as unknown;

describe('trace_route via mapRouteResponse', () => {
  it('maps a matched trace to the shared route shape', () => {
    const out = mapRouteResponse(TRACE);
    // matching the route's own shape must reproduce ~the same route
    expect(out.distance_m).toBeGreaterThan(50_000);
    expect(out.distance_m).toBeLessThan(60_000);
    expect(out.duration_s).toBeGreaterThan(1_800);
    expect(out.geometry.coordinates.length).toBeGreaterThan(100);
    expect(out.has_highway).toBe(true);
  });
});
