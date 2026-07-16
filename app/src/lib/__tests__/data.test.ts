import { describe, expect, it } from 'vitest';

import type { FetchLike, FetchResponseLike } from '../api';
import {
  boundsCenter,
  DataError,
  fetchMapRoutes,
  fetchMapSpots,
  MapRouteRowSchema,
  resolveSupabaseUrl,
  routesBounds,
  routesToFeatureCollection,
  spotsToFeatureCollection,
  SPOTS_LIMIT,
  type MapRouteRow,
} from '../data';

const ROUTE_ROW: MapRouteRow = {
  id: 'r1',
  name: 'Snake Road Sweep',
  description: '',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.98, 43.22],
      [-79.9, 43.26],
      [-79.88, 43.2],
    ] as Array<[number, number]>,
  },
  bbox: null,
  is_loop: true,
  distance_m: 8000,
  duration_s: 540,
  curviness: 1.2,
  climb_m: 80,
  character_tags: ['twisty'],
  intensity: 'moderate',
  free_tags: ['seed'],
  origin_type: 'manual',
  visibility: 'public',
};

function jsonRes(status: number, body: unknown): FetchResponseLike {
  return {
    ok: status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('resolveSupabaseUrl', () => {
  it('explicit → trimmed; hostUri → local Kong port; fallback localhost', () => {
    expect(resolveSupabaseUrl({ explicit: 'https://ref.supabase.co/' })).toBe(
      'https://ref.supabase.co',
    );
    expect(resolveSupabaseUrl({ hostUri: '192.168.2.34:8081' })).toBe('http://192.168.2.34:54321');
    expect(resolveSupabaseUrl({})).toBe('http://localhost:54321');
  });
});

describe('fetchMapRoutes', () => {
  it('POSTs the rpc with anon headers and returns validated rows', async () => {
    let url = '';
    let headers: Record<string, string> = {};
    let body = '';
    const fetchImpl: FetchLike = (u, init) => {
      url = u;
      headers = init?.headers ?? {};
      body = init?.body ?? '';
      return Promise.resolve(jsonRes(200, [ROUTE_ROW]));
    };
    const rows = await fetchMapRoutes({ url: 'http://sb:54321', anonKey: 'anon-k' }, fetchImpl);
    expect(url).toBe('http://sb:54321/rest/v1/rpc/map_routes');
    expect(headers['apikey']).toBe('anon-k');
    expect(headers['authorization']).toBe('Bearer anon-k');
    expect(JSON.parse(body)).toEqual({ p_limit: 50 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Snake Road Sweep');
  });

  it('rejects WKB-hex geometry (off-schema rows never reach the UI)', async () => {
    const bad = { ...ROUTE_ROW, geometry: '0102000020E61000000300' };
    const fetchImpl: FetchLike = () => Promise.resolve(jsonRes(200, [bad]));
    await expect(
      fetchMapRoutes({ url: 'http://sb', anonKey: 'k' }, fetchImpl),
    ).rejects.toBeInstanceOf(DataError);
  });

  it('maps PostgREST errors to a friendly DataError (no raw dump)', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(jsonRes(401, { message: 'JWSError JWSInvalidSignature', code: 'PGRST301' }));
    await expect(fetchMapRoutes({ url: 'http://sb', anonKey: 'bad' }, fetchImpl)).rejects.toSatisfy(
      (e: unknown) => e instanceof DataError && e.status === 401 && !e.message.includes('JWSError'),
    );
  });

  it('surfaces unreachable hosts as DataError, not a raw TypeError', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new TypeError('Network request failed'));
    await expect(
      fetchMapRoutes({ url: 'http://down', anonKey: 'k' }, fetchImpl),
    ).rejects.toBeInstanceOf(DataError);
  });
});

describe('fetchMapSpots', () => {
  it('queries map_spots (region-wide jsonb aggregate) with the safety-valve limit', async () => {
    let url = '';
    let body: Record<string, unknown> = {};
    const fetchImpl: FetchLike = (u, init) => {
      url = u;
      body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return Promise.resolve(
        jsonRes(200, [
          { id: 's1', name: 'Cafe', type: 'coffee', lat: 43.6, lng: -79.9, source: 'osm' },
        ]),
      );
    };
    const rows = await fetchMapSpots({ url: 'http://sb', anonKey: 'k' }, fetchImpl);
    expect(url).toBe('http://sb/rest/v1/rpc/map_spots');
    // must exceed the region's 5,040 spots — a smaller value truncates the map
    expect(body['p_limit']).toBe(SPOTS_LIMIT);
    expect(SPOTS_LIMIT).toBeGreaterThan(21366); // R16-1 food corpus included
    expect(rows[0]!.type).toBe('coffee');
  });
});

describe('GeoJSON builders + bounds', () => {
  it('routesToFeatureCollection carries render props', () => {
    const fc = routesToFeatureCollection([ROUTE_ROW]);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0]!;
    expect(f.properties.name).toBe('Snake Road Sweep');
    expect(f.properties.is_loop).toBe(true);
    expect(f.geometry.type).toBe('LineString');
  });

  it('spotsToFeatureCollection builds [lng,lat] points with a letter label', () => {
    const fc = spotsToFeatureCollection([
      { id: 's1', name: 'Lookout', type: 'viewpoint', lat: 43.5, lng: -79.8, source: 'osm' },
    ]);
    const f = fc.features[0]!;
    expect(f.geometry.coordinates).toEqual([-79.8, 43.5]);
    expect(f.properties.label).toBe('V');
  });

  it('routesBounds unions all geometries; boundsCenter finds the middle', () => {
    const b = routesBounds([ROUTE_ROW]);
    expect(b).toEqual({ sw: [-79.98, 43.2], ne: [-79.88, 43.26] });
    const c = boundsCenter(b!);
    expect(c.lng).toBeCloseTo(-79.93);
    expect(c.lat).toBeCloseTo(43.23);
  });

  it('routesBounds is null on empty input (camera keeps its default)', () => {
    expect(routesBounds([])).toBeNull();
  });

  it('MapRouteRowSchema accepts the row shape pinned from PostgREST 2026-07-16', () => {
    // Fixture pin only — LIVE drift is covered by db/tests/rls_public_read.test.ts
    // (map_routes against the running stack), not by this typed fixture.
    expect(MapRouteRowSchema.safeParse(ROUTE_ROW).success).toBe(true);
    // and the schema really rejects a live-drift shape (geometry as WKB hex):
    expect(MapRouteRowSchema.safeParse({ ...ROUTE_ROW, geometry: '0102000020E610' }).success).toBe(
      false,
    );
  });
});
