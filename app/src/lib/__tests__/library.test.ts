import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../api';
import { DataError } from '../data';
import {
  deleteAccount,
  deleteRoute,
  favouriteRoute,
  fetchRouteById,
  forkRoute,
  getPreferences,
  listFavouriteRouteIds,
  normalizeRouteRow,
  renameRoute,
  setPreferences,
  unfavouriteRoute,
  updateVisibility,
  visibilityLabel,
} from '../library';

/** M8-T05..T10 — the library wire paths: headers, idempotence hints, zod
 *  boundaries, and honest RLS zero-row surfacing. */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };
const RID = '9f0403ea-65db-4f11-938c-d567a8033c2b';

function fetchOf(status: number, body: unknown) {
  const holder = {
    last: { url: '', headers: {} as Record<string, string>, body: undefined as string | undefined },
  };
  const f = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    holder.last = { url, headers: init?.headers ?? {}, body: init?.body };
    return {
      ok: status < 300,
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  }) as unknown as FetchLike;
  return { f, holder };
}

describe('favourites (T06)', () => {
  it('favourite is idempotent via ignore-duplicates', async () => {
    const { f, holder } = fetchOf(201, []);
    await favouriteRoute(CFG, 'tok', 'u1', RID, f);
    expect(holder.last.headers['prefer']).toBe('resolution=ignore-duplicates');
    expect(JSON.parse(holder.last.body!)).toEqual({ user_id: 'u1', route_id: RID });
  });
  it('unfavourite deletes by composite key', async () => {
    const { f, holder } = fetchOf(204, []);
    await unfavouriteRoute(CFG, 'tok', 'u1', RID, f);
    expect(holder.last.url).toContain(`user_id=eq.u1&route_id=eq.${RID}`);
  });
  it('list validates and unwraps ids', async () => {
    const { f } = fetchOf(200, [{ route_id: RID }]);
    expect(await listFavouriteRouteIds(CFG, 'tok', f)).toEqual([RID]);
  });
});

describe('route ops (T05/07/08/09)', () => {
  it('fetchRouteById returns null for invisible/absent (RLS empty)', async () => {
    const { f, holder } = fetchOf(200, []);
    expect(await fetchRouteById(CFG, RID, null, f)).toBeNull();
    // 0032: the by-id read is the least-privilege RPC, never a table list
    expect(holder.last.url).toBe('http://sb.local/rest/v1/rpc/route_by_id');
    expect(JSON.parse(holder.last.body!)).toEqual({ p_id: RID });
    expect(holder.last.headers['authorization']).toBe('Bearer anon');
  });
  it('fetchRouteById presents the user token when there is one', async () => {
    const { f, holder } = fetchOf(200, []);
    await fetchRouteById(CFG, RID, 'tok', f);
    expect(holder.last.headers['authorization']).toBe('Bearer tok');
  });
  it('fork posts the RPC and validates the uuid', async () => {
    const { f, holder } = fetchOf(200, RID);
    expect(await forkRoute(CFG, 'tok', RID, f)).toBe(RID);
    expect(holder.last.url).toContain('/rpc/fork_route');
  });
  it('visibility change on a non-owned route surfaces honestly (zero rows)', async () => {
    const { f } = fetchOf(200, []);
    await expect(updateVisibility(CFG, 'tok', RID, 'public', f)).rejects.toThrow(/isn’t yours/);
  });
  it('deleteAccount calls the BACKEND (blob sweep lives there), user token only', async () => {
    const { f, holder } = fetchOf(204, null);
    await deleteAccount('http://api.local', 'tok', f);
    expect(holder.last.url).toBe('http://api.local/account');
    expect(holder.last.headers['authorization']).toBe('Bearer tok');
  });
});

describe('preferences (T10)', () => {
  it('get returns {} when no row exists', async () => {
    const { f } = fetchOf(200, []);
    expect(await getPreferences(CFG, 'tok', f)).toEqual({});
  });
  it('set upserts via merge-duplicates on user_id', async () => {
    const { f, holder } = fetchOf(201, []);
    await setPreferences(CFG, 'tok', 'u1', { preset: 'backroads' }, f);
    expect(holder.last.url).toContain('on_conflict=user_id');
    expect(holder.last.headers['prefer']).toBe('resolution=merge-duplicates');
  });
  it('malformed prefs are rejected, not trusted', async () => {
    const { f } = fetchOf(200, [{ weights: 'not-an-object' }]);
    await expect(getPreferences(CFG, 'tok', f)).rejects.toBeInstanceOf(DataError);
  });
});

describe('rename + delete (device pass, 2026-09-04)', () => {
  it('rename PATCHes the trimmed, capped name and asks for the row back', async () => {
    const { f, holder } = fetchOf(200, [{ id: RID }]);
    const name = await renameRoute(CFG, 'tok', RID, '  Sunday ridge loop  ', f);
    expect(name).toBe('Sunday ridge loop');
    expect(holder.last.url).toContain(`/routes?id=eq.${RID}`);
    expect(holder.last.headers['prefer']).toBe('return=representation');
    expect(JSON.parse(holder.last.body!)).toEqual({ name: 'Sunday ridge loop' });
  });
  it('rename refuses an empty name before touching the network', async () => {
    const { f, holder } = fetchOf(200, [{ id: RID }]);
    await expect(renameRoute(CFG, 'tok', RID, '   ', f)).rejects.toThrow(/name/);
    expect(holder.last.url).toBe('');
  });
  it('rename on a non-owned route surfaces honestly (zero rows)', async () => {
    const { f } = fetchOf(200, []);
    await expect(renameRoute(CFG, 'tok', RID, 'x', f)).rejects.toThrow(/isn’t yours/);
  });
  it('delete asks for the deleted row back so a silent no-op cannot pass as done', async () => {
    const { f, holder } = fetchOf(200, [{ id: RID }]);
    await deleteRoute(CFG, 'tok', RID, f);
    expect(holder.last.headers['prefer']).toBe('return=representation');
    const { f: none } = fetchOf(200, []);
    await expect(deleteRoute(CFG, 'tok', RID, none)).rejects.toThrow(/isn’t yours/);
  });
  it('visibility labels are plain words, never the raw enum', () => {
    expect(visibilityLabel('private')).toBe('Private');
    expect(visibilityLabel('unlisted')).toBe('Link only');
    expect(visibilityLabel('public')).toBe('Public');
  });
});

describe('a saved row as PostgREST really serialises it (device pass, 2026-09-07)', () => {
  // Captured shape: PostGIS geometry columns come back as GeoJSON WITH a `crs`
  // member, and `bbox` (st_envelope) as a POLYGON, not the wire tuple. Every
  // saved drive failed RouteSchema on the phone because of the bbox alone.
  const POSTGREST_ROW = {
    id: RID,
    owner_id: '00000000-0000-4000-8000-00000000000a',
    name: 'Escarpment sweep',
    description: '',
    geometry: {
      type: 'LineString',
      crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      coordinates: [
        [-79.9, 43.2],
        [-79.89, 43.21],
        [-79.88, 43.2],
      ],
    },
    geometry_simplified: {
      type: 'LineString',
      crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      coordinates: [
        [-79.9, 43.2],
        [-79.88, 43.2],
      ],
    },
    bbox: {
      type: 'Polygon',
      crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      coordinates: [
        [
          [-79.9, 43.2],
          [-79.9, 43.21],
          [-79.88, 43.21],
          [-79.88, 43.2],
          [-79.9, 43.2],
        ],
      ],
    },
    is_loop: false,
    waypoints: [],
    distance_m: 2000,
    duration_s: 120,
    curviness: 0,
    elevation_profile: null,
    climb_m: null,
    character_tags: [],
    intensity: 'chill',
    free_tags: [],
    highway_flag: false,
    toll_flag: false,
    ferry_flag: false,
    unpaved_flag: false,
    visibility: 'private',
    origin_type: 'manual',
    forked_from: null,
    generation_request_id: null,
    satisfied_constraints: null,
    agent_explanation: null,
    created_at: '2026-09-04T20:51:00+00:00',
    maneuvers: [
      { type: 'start', instruction: 'Drive east.', distance_m: 1000 },
      { type: 'left', instruction: 'Turn left.', distance_m: 1000, street_names: ['Forks Rd'] },
    ],
  };

  it('fetchRouteById accepts the real row shape and carries the turns', async () => {
    const { f } = fetchOf(200, [POSTGREST_ROW]);
    const route = await fetchRouteById(CFG, RID, 'tok', f);
    expect(route).not.toBeNull();
    expect(route!.name).toBe('Escarpment sweep');
    expect(route!.bbox).toEqual([-79.9, 43.2, -79.88, 43.21]);
    expect(route!.maneuvers).toHaveLength(2);
    expect(route!.geometry.coordinates).toHaveLength(3);
  });

  it('a "Link only" row reopens — the wire schema accepts unlisted (review, 2026-09-07)', async () => {
    const { f } = fetchOf(200, [{ ...POSTGREST_ROW, visibility: 'unlisted' }]);
    const route = await fetchRouteById(CFG, RID, 'tok', f);
    expect(route?.visibility).toBe('unlisted');
  });

  it('a stored stop with explicit nulls (0032 sanitize_stops) parses', async () => {
    const { f } = fetchOf(200, [
      {
        ...POSTGREST_ROW,
        stops: [
          {
            name: 'Ridge Café',
            type: 'cafe',
            requested_type: 'coffee',
            arrival_s: null,
            at_fraction: null,
            location: { lat: 43.21, lng: -79.89 },
            waypoint_index: 1,
          },
        ],
        legs: null,
      },
    ]);
    const route = await fetchRouteById(CFG, RID, 'tok', f);
    expect(route?.stops).toHaveLength(1);
    expect(route?.stops[0]?.name).toBe('Ridge Café');
  });

  it('normalizeRouteRow leaves a tuple bbox, a null bbox and non-rows alone', () => {
    expect(normalizeRouteRow({ bbox: [1, 2, 3, 4] })).toEqual({ bbox: [1, 2, 3, 4] });
    expect(normalizeRouteRow({ bbox: null })).toEqual({ bbox: null });
    expect(normalizeRouteRow(null)).toBeNull();
    // an empty/odd polygon degrades to null rather than a throw
    expect(normalizeRouteRow({ bbox: { type: 'Polygon', coordinates: [] } })).toEqual({
      bbox: null,
    });
  });
});
