import type { RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { parsePoly } from '../lib/region';
import { buildServer } from '../server';
import { ValhallaRouteError } from '../valhalla/route';

/** M6-T03 AC: valid requests return typed routes; out-of-region rejected.
 *  Unit tests mock the engine; the tail test hits REAL Valhalla (skip-if-down). */

const POLY = `south_central_ontario
1
   -81.85   44.95
   -77.60   44.95
   -77.60   42.55
   -81.85   42.55
   -81.85   44.95
END
END
`;
const region = parsePoly(POLY, 'south-central-ontario');

const FIXTURE: RouteThroughOutput = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.9, 43.2],
      [-79.87, 43.22],
    ],
  },
  distance_m: 4200,
  duration_s: 300,
  maneuvers: [{ type: 'start', instruction: 'Drive northeast.' }],
  has_highway: false,
  has_toll: false,
  has_ferry: false,
  has_unpaved: false,
};

const VALHALLA_URL = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

function appWith(
  routeFn?: () => Promise<RouteThroughOutput>,
  matchFn?: () => Promise<RouteThroughOutput>,
) {
  return buildServer({
    valhallaUrl: VALHALLA_URL,
    region,
    ...(routeFn ? { routeFn } : {}),
    ...(matchFn ? { matchFn } : {}),
  });
}

const HAMILTON = { lat: 43.2557, lng: -79.8711 };
const DUNDAS = { lat: 43.2665, lng: -79.9525 };
const OTTAWA = { lat: 45.4215, lng: -75.6972 }; // outside the region box

describe('POST /route (M6-T03)', () => {
  it('valid waypoints → typed route', async () => {
    const app = appWith(async () => FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/route',
      payload: { waypoints: [HAMILTON, DUNDAS] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(FIXTURE);
  });

  it('out-of-region waypoint → 400 out_of_region (friendly, not raw)', async () => {
    const app = appWith(async () => FIXTURE);
    const res = await app.inject({
      method: 'POST',
      url: '/route',
      payload: { waypoints: [HAMILTON, OTTAWA] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('out_of_region');
    expect(body.error.message).toContain('south-central Ontario');
  });

  it('schema bounds: 1 waypoint rejected 400; 31 waypoints rejected 400', async () => {
    const app = appWith(async () => FIXTURE);
    const one = await app.inject({
      method: 'POST',
      url: '/route',
      payload: { waypoints: [HAMILTON] },
    });
    expect(one.statusCode).toBe(400);
    const many = await app.inject({
      method: 'POST',
      url: '/route',
      payload: { waypoints: Array.from({ length: 31 }, () => HAMILTON) },
    });
    expect(many.statusCode).toBe(400);
  });

  it('no drivable path → 422 no_route; engine down → 503 unavailable (§40 rung 5)', async () => {
    const noRoute = appWith(async () => {
      throw new ValhallaRouteError(442, 400, 'No path could be found');
    });
    const r1 = await noRoute.inject({
      method: 'POST',
      url: '/route',
      payload: { waypoints: [HAMILTON, DUNDAS] },
    });
    expect(r1.statusCode).toBe(422);
    expect((r1.json() as { error: { code: string } }).error.code).toBe('no_route');

    const down = appWith(async () => {
      throw new TypeError('fetch failed');
    });
    const r2 = await down.inject({
      method: 'POST',
      url: '/route',
      payload: { waypoints: [HAMILTON, DUNDAS] },
    });
    expect(r2.statusCode).toBe(503);
    const body = r2.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('route_engine_unavailable');
    expect(body.error.message).not.toContain('fetch'); // no internals leak
  });
});

describe('POST /match (M6-T03)', () => {
  it('valid trace → snapped route; out-of-region trace → 400', async () => {
    const app = appWith(undefined, async () => FIXTURE);
    const ok = await app.inject({
      method: 'POST',
      url: '/match',
      payload: { trace: [HAMILTON, DUNDAS] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual(FIXTURE);

    const out = await app.inject({
      method: 'POST',
      url: '/match',
      payload: { trace: [HAMILTON, OTTAWA] },
    });
    expect(out.statusCode).toBe(400);
    expect((out.json() as { error: { code: string } }).error.code).toBe('out_of_region');
  });
});

describe('integration against real Valhalla (skip-if-down)', () => {
  it('routes Hamilton → Dundas, then matches the returned shape', async (ctx) => {
    try {
      const ping = await fetch(`${VALHALLA_URL}/status`, { signal: AbortSignal.timeout(1500) });
      if (!ping.ok) return ctx.skip();
    } catch {
      return ctx.skip();
    }

    const app = buildServer({ valhallaUrl: VALHALLA_URL, region });
    const routed = await app.inject({
      method: 'POST',
      url: '/route',
      payload: { waypoints: [HAMILTON, DUNDAS] },
    });
    expect(routed.statusCode).toBe(200);
    const route = routed.json() as RouteThroughOutput;
    expect(route.geometry.coordinates.length).toBeGreaterThan(5);
    expect(route.duration_s).toBeGreaterThan(60);

    // matched replay of the routed shape (subsample to a plausible GPS trace)
    const every = Math.max(1, Math.floor(route.geometry.coordinates.length / 50));
    const trace = route.geometry.coordinates
      .filter((_, i) => i % every === 0)
      .map(([lng, lat]) => ({ lat, lng }));
    const matched = await app.inject({
      method: 'POST',
      url: '/match',
      payload: { trace, shape_match: 'map_snap' },
    });
    expect(matched.statusCode).toBe(200);
    const m = matched.json() as RouteThroughOutput;
    expect(m.distance_m).toBeGreaterThan(route.distance_m * 0.7);
    expect(m.distance_m).toBeLessThan(route.distance_m * 1.3);
  });
});
