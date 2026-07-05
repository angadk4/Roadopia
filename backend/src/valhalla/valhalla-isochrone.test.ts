import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { mapIsochroneResponse } from './isochrone';

/** M2-T05 — recorded 15-min auto isochrone around Hamilton (2026-07-05, v3.7.0). */
const FIXTURE = JSON.parse(
  readFileSync(new URL('./__fixtures__/isochrone-hamilton-15min.json', import.meta.url), 'utf8'),
) as unknown;

describe('mapIsochroneResponse', () => {
  it('maps the outer ring to §50 { polygon: LatLng[] }', () => {
    const out = mapIsochroneResponse(FIXTURE);
    expect(out.polygon.length).toBeGreaterThan(20);
    // ring stays near the origin (Hamilton) — all points within ~40 km
    for (const p of out.polygon) {
      expect(p.lat).toBeGreaterThan(42.9);
      expect(p.lat).toBeLessThan(43.6);
      expect(p.lng).toBeGreaterThan(-80.4);
      expect(p.lng).toBeLessThan(-79.3);
    }
  });

  it('rejects malformed bodies (rule K)', () => {
    expect(() => mapIsochroneResponse({ features: [] })).toThrow();
    expect(() => mapIsochroneResponse({})).toThrow();
  });
});
