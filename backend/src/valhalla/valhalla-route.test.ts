import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { decodePolyline } from './polyline';
import {
  mapRouteResponse,
  mapRouteResponseDetailed,
  routeThrough,
  scanConstraintViolations,
  ValhallaRouteError,
} from './route';

/**
 * M2-T04 unit tests — run against RECORDED Valhalla 3.7.0 responses (no network):
 * fixtures captured 2026-07-05 from the pinned local instance (June-24 snapshot
 * tiles), Hamilton (43.2557,-79.8711) → St. Catharines (43.1594,-79.2469).
 * Doubles as SPK-05 evidence: flags + maneuvers present, durations plausible.
 */

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));
}

/** Minimal precision-6 polyline encoder for synthetic [lng,lat] test shapes. */
function encodeTest(coords: Array<[number, number]>): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number): string => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let str = '';
    while (n >= 0x20) {
      str += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return str + String.fromCharCode(n + 63);
  };
  for (const [lng, lat] of coords) {
    const ilat = Math.round(lat * 1e6);
    const ilng = Math.round(lng * 1e6);
    out += enc(ilat - prevLat) + enc(ilng - prevLng);
    prevLat = ilat;
    prevLng = ilng;
  }
  return out;
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
  const highwayResult = {
    has_highway: true,
    has_toll: false,
    has_ferry: false,
    has_unpaved: false,
  };

  it('flags a violated hard exclusion', () => {
    expect(scanConstraintViolations({ exclude_highways: true }, highwayResult)).toEqual([
      'highway',
    ]);
  });

  it('is empty when the result complies or nothing was requested', () => {
    const clean = { has_highway: false, has_toll: false, has_ferry: false, has_unpaved: false };
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
describe('R16-2 — legs, break_through, unpaved', () => {
  it('mapRouteResponse preserves per-leg summaries in drive order', () => {
    const body = {
      trip: {
        legs: [
          {
            shape: encodeTest([
              [0, 0],
              [0.01, 0],
            ]),
            summary: { time: 619, length: 10.2 },
          },
          {
            shape: encodeTest([
              [0.01, 0],
              [0.02, 0],
            ]),
            summary: { time: 603, length: 9.8 },
          },
        ],
        summary: { time: 1222, length: 20.0 },
      },
    };
    const out = mapRouteResponse(body);
    expect(out.legs).toEqual([
      { duration_s: 619, distance_m: 10200 },
      { duration_s: 603, distance_m: 9800 },
    ]);
  });

  it('stopIndices route as break_through; other middles keep middleType', async () => {
    let sent: { locations: Array<{ type: string }> } | null = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      sent = JSON.parse(init.body) as typeof sent;
      return {
        ok: true,
        json: async () => ({
          trip: {
            legs: [
              {
                shape: encodeTest([
                  [0, 0],
                  [0.01, 0],
                ]),
                summary: { time: 1, length: 1 },
              },
            ],
            summary: { time: 1, length: 1 },
          },
        }),
      };
    }) as never;
    try {
      await routeThrough('http://x', {
        waypoints: [
          [0, 0],
          [0.005, 0],
          [0.01, 0],
          [0.015, 0],
          [0.02, 0],
        ],
        middleType: 'through',
        stopIndices: [2],
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent!.locations.map((l) => l.type)).toEqual([
      'break',
      'through',
      'break_through',
      'through',
      'break',
    ]);
  });

  it('scanConstraintViolations flags unpaved when excluded but present', () => {
    expect(
      scanConstraintViolations(
        { exclude_unpaved: true },
        { has_highway: false, has_toll: false, has_ferry: false, has_unpaved: true },
      ),
    ).toEqual(['unpaved']);
    expect(
      scanConstraintViolations(
        {},
        { has_highway: false, has_toll: false, has_ferry: false, has_unpaved: true },
      ),
    ).toEqual([]);
  });
});

describe('multi-leg maneuvers (device pass, 2026-09-07)', () => {
  it('drops each intermediate arrival and folds a same-road departure, keeping the total length', () => {
    const body = {
      trip: {
        legs: [
          {
            shape: encodeTest([
              [0, 0],
              [0.01, 0],
            ]),
            summary: { time: 60, length: 1.0 },
            maneuvers: [
              {
                type: 1,
                instruction: 'Drive east on Main Street.',
                length: 0.9,
                street_names: ['Main Street'],
              },
              {
                type: 10,
                instruction: 'Turn right onto Kennedy Road.',
                length: 0.1,
                street_names: ['Kennedy Road'],
              },
              { type: 6, instruction: 'Your destination is on the left.', length: 0 },
            ],
          },
          {
            shape: encodeTest([
              [0.01, 0],
              [0.02, 0],
            ]),
            summary: { time: 60, length: 1.0 },
            maneuvers: [
              {
                type: 1,
                instruction: 'Drive north on Kennedy Road.',
                length: 0.4,
                street_names: ['Kennedy Road'],
              },
              {
                type: 15,
                instruction: 'Turn left onto Old School Road.',
                length: 0.6,
                street_names: ['Old School Road'],
              },
              { type: 4, instruction: 'You have arrived at your destination.', length: 0 },
            ],
          },
        ],
        summary: { time: 120, length: 2.0 },
      },
    };
    const out = mapRouteResponse(body);
    expect(out.maneuvers.map((m) => m.instruction)).toEqual([
      'Drive east on Main Street.',
      'Turn right onto Kennedy Road.',
      'Turn left onto Old School Road.',
      'You have arrived at your destination.',
    ]);
    expect(out.maneuvers[1]!.distance_m).toBeCloseTo(500, 6); // 100 m + the folded 400 m leg
    const sum = out.maneuvers.reduce((s, m) => s + (m.distance_m ?? 0), 0);
    expect(sum).toBeCloseTo(2000, 6);
    expect(out.legs).toHaveLength(2); // per-leg summaries are untouched
  });
});

describe('snapped waypoint locations (device pass, 2026-09-04)', () => {
  it('leg boundaries are the first vertex of each leg plus the last vertex', () => {
    const { output, boundaries } = mapRouteResponseDetailed(DEFAULT);
    expect(boundaries).toEqual([0, output.geometry.coordinates.length - 1]); // one leg
    expect(mapRouteResponse(DEFAULT)).toEqual(output); // the plain mapper is unchanged
  });

  it('routeThrough reports where each BREAK waypoint landed, in request order', async () => {
    const realFetch = globalThis.fetch;
    // two legs: A→B and B→C; the middle waypoint was asked at (0.0052, 0.0001)
    // and the engine put it at (0.005, 0) — the vertex both legs share
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        trip: {
          legs: [
            {
              shape: encodeTest([
                [0, 0],
                [0.0025, 0],
                [0.005, 0],
              ]),
              summary: { time: 1, length: 1 },
            },
            {
              shape: encodeTest([
                [0.005, 0],
                [0.0075, 0],
                [0.01, 0],
              ]),
              summary: { time: 1, length: 1 },
            },
          ],
          summary: { time: 2, length: 2 },
        },
      }),
    })) as never;
    try {
      const out = await routeThrough('http://x', {
        waypoints: [
          [0, 0],
          [0.0052, 0.0001],
          [0.01, 0],
        ],
        middleType: 'break',
      });
      expect(out.geometry.coordinates).toHaveLength(5); // shared vertex once
      expect(out.locations).toHaveLength(3);
      expect(out.locations![1]!.lng).toBeCloseTo(0.005, 6);
      expect(out.locations![1]!.lat).toBeCloseTo(0, 6);
      expect(out.locations![2]!.lng).toBeCloseTo(0.01, 6);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('is omitted when middles are through-type (legs do not line up with waypoints)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        trip: {
          legs: [
            {
              shape: encodeTest([
                [0, 0],
                [0.01, 0],
              ]),
              summary: { time: 1, length: 1 },
            },
          ],
          summary: { time: 1, length: 1 },
        },
      }),
    })) as never;
    try {
      const out = await routeThrough('http://x', {
        waypoints: [
          [0, 0],
          [0.005, 0],
          [0.01, 0],
        ],
        middleType: 'through',
      });
      expect(out.locations).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('BD-203 — corridor exclusions and a departure heading', () => {
  it('sends exclude_polygons and a heading on the first location only when asked; omitted otherwise', async () => {
    const sent: Array<{
      locations: Array<{ heading?: number; heading_tolerance?: number }>;
      exclude_polygons?: number[][][];
    }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as (typeof sent)[number]);
      return {
        ok: true,
        json: async () => ({
          trip: {
            legs: [
              {
                shape: encodeTest([
                  [0, 0],
                  [0.01, 0],
                ]),
                summary: { time: 1, length: 1 },
              },
            ],
            summary: { time: 1, length: 1 },
          },
        }),
      };
    }) as never;
    try {
      const ring: Array<[number, number]> = [
        [0.004, -0.001],
        [0.006, -0.001],
        [0.006, 0.001],
        [0.004, 0.001],
        [0.004, -0.001],
      ];
      await routeThrough('http://x', {
        waypoints: [
          [0, 0],
          [0.005, 0],
          [0.01, 0],
        ],
        middleType: 'through',
        excludePolygons: [ring],
        startHeading: { deg: 450 }, // normalised to 90
      });
      await routeThrough('http://x', {
        waypoints: [
          [0, 0],
          [0.01, 0],
        ],
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent[0]!.exclude_polygons).toEqual([
      [
        [0.004, -0.001],
        [0.006, -0.001],
        [0.006, 0.001],
        [0.004, 0.001],
        [0.004, -0.001],
      ],
    ]);
    expect(sent[0]!.locations[0]).toMatchObject({ heading: 90, heading_tolerance: 70 });
    expect(sent[0]!.locations[1]!.heading).toBeUndefined();
    expect(sent[0]!.locations[2]!.heading).toBeUndefined();
    // the plain request carries neither key (byte-identical contract)
    expect('exclude_polygons' in sent[1]!).toBe(false);
    expect(sent[1]!.locations[0]!.heading).toBeUndefined();
  });
});
