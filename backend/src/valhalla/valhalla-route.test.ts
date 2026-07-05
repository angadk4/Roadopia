import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { decodePolyline } from './polyline';
import { mapRouteResponse, scanConstraintViolations, ValhallaRouteError } from './route';

/**
 * M2-T04 unit tests — run against RECORDED Valhalla 3.7.0 responses (no network):
 * fixtures captured 2026-07-05 from the pinned local instance (June-24 snapshot
 * tiles), Hamilton (43.2557,-79.8711) → St. Catharines (43.1594,-79.2469).
 * Doubles as SPK-05 evidence: flags + maneuvers present, durations plausible.
 */

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));
}

const DEFAULT = fixture('route-hamilton-stcatharines-default');
const NOHIGHWAY = fixture('route-hamilton-stcatharines-nohighway');
const ERROR_BODY = fixture('route-error-outside-region');

describe('decodePolyline', () => {
  it('decodes the canonical Google example (precision 5)', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(pts).toHaveLength(3);
    expect(pts[0]![0]).toBeCloseTo(-120.2, 5);
    expect(pts[0]![1]).toBeCloseTo(38.5, 5);
    expect(pts[2]![0]).toBeCloseTo(-126.453, 5);
    expect(pts[2]![1]).toBeCloseTo(43.252, 5);
  });
});

describe('mapRouteResponse (recorded fixtures)', () => {
  it('maps the default route to the shared §50 shape with correct units', () => {
    const out = mapRouteResponse(DEFAULT);
    // km → m, seconds passthrough (guards against unit regressions)
    expect(out.distance_m).toBeCloseTo(56543, 0);
    expect(out.duration_s).toBeCloseTo(2295.287, 1);
    expect(out.has_highway).toBe(true);
    expect(out.has_toll).toBe(false);
    expect(out.has_ferry).toBe(false);
    expect(out.has_unpaved).toBe(false); // 3.7 exposes no unpaved flag (documented)
    // geometry decoded from polyline6, endpoints near the requested OD (snap offset)
    expect(out.geometry.type).toBe('LineString');
    expect(out.geometry.coordinates.length).toBeGreaterThan(100);
    const [startLon, startLat] = out.geometry.coordinates[0]!;
    const [endLon, endLat] = out.geometry.coordinates.at(-1)!;
    expect(startLon).toBeCloseTo(-79.8711, 2);
    expect(startLat).toBeCloseTo(43.2557, 2);
    expect(endLon).toBeCloseTo(-79.2469, 2);
    expect(endLat).toBeCloseTo(43.1594, 2);
    // maneuvers present and mapped (SPK-05: metadata available)
    expect(out.maneuvers.length).toBeGreaterThan(3);
    expect(out.maneuvers[0]!.type).toMatch(/^start/);
    expect(out.maneuvers.at(-1)!.type).toMatch(/^destination/);
    expect(out.maneuvers.every((m) => m.instruction.length > 0)).toBe(true);
  });

  it('maps the exclude_highways route: compliant flags + slower/longer (SPK-06)', () => {
    const def = mapRouteResponse(DEFAULT);
    const alt = mapRouteResponse(NOHIGHWAY);
    expect(alt.has_highway).toBe(false);
    expect(alt.duration_s).toBeGreaterThan(def.duration_s);
  });

  it('durations are physically plausible (unit-regression guard, SPK-05)', () => {
    for (const [out, lo, hi] of [
      [mapRouteResponse(DEFAULT), 40, 110],
      [mapRouteResponse(NOHIGHWAY), 30, 90],
    ] as const) {
      const kmh = out.distance_m / 1000 / (out.duration_s / 3600);
      expect(kmh).toBeGreaterThan(lo);
      expect(kmh).toBeLessThan(hi);
    }
  });

  it('rejects a malformed/error body (external input is validated — rule K)', () => {
    expect(() => mapRouteResponse(ERROR_BODY)).toThrow(z.ZodError);
  });
});

describe('scanConstraintViolations (result-scan caveat, BD-16)', () => {
  const highwayResult = { has_highway: true, has_toll: false, has_ferry: false };

  it('flags a violated hard exclusion', () => {
    expect(scanConstraintViolations({ exclude_highways: true }, highwayResult)).toEqual([
      'highway',
    ]);
  });

  it('is empty when the result complies or nothing was requested', () => {
    const clean = { has_highway: false, has_toll: false, has_ferry: false };
    expect(scanConstraintViolations({ exclude_highways: true }, clean)).toEqual([]);
    expect(scanConstraintViolations(undefined, highwayResult)).toEqual([]);
  });
});

describe('ValhallaRouteError', () => {
  it('classifies no-route codes for the relaxation ladder', () => {
    expect(new ValhallaRouteError(442, 400, 'no route').noRoute).toBe(true);
    expect(new ValhallaRouteError(171, 400, 'no edges').noRoute).toBe(true);
    expect(new ValhallaRouteError(154, 400, 'exceeds limit').noRoute).toBe(false);
  });
});
