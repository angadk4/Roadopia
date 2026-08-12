import type { Route } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../api';
import { DataError } from '../data';
import { buildSavePayload, listMyRoutes, saveRoute } from '../saves';

/** M8-T04 — save payload building + the RPC/list wire paths (FR-080/091). */

const ROUTE: Route = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.9, 43.2],
      [-79.89, 43.21],
    ],
  },
  is_loop: true,
  waypoints: [],
  distance_m: 40000,
  duration_s: 3600,
  curviness: 1.2,
  elevation_profile: null,
  climb_m: null,
  highway_flag: false,
  toll_flag: false,
  ferry_flag: false,
  unpaved_flag: false,
  character_tags: ['backroad'],
  intensity: 'chill',
  free_tags: [],
  visibility: 'private',
  owner_id: null,
  origin_type: 'ai',
  forked_from: null,
  stops: [],
} as unknown as Route;

function fetchOf(
  status: number,
  body: unknown,
): FetchLike & { last: { url: string; body?: string; headers?: Record<string, string> } } {
  const holder = { last: { url: '' } } as {
    last: { url: string; body?: string; headers?: Record<string, string> };
  };
  const f = (async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    holder.last = {
      url,
      ...(init?.body !== undefined ? { body: init.body } : {}),
      ...(init?.headers ? { headers: init.headers } : {}),
    };
    return {
      ok: status < 300,
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  }) as unknown as FetchLike & {
    last: { url: string; body?: string; headers?: Record<string, string> };
  };
  Object.defineProperty(f, 'last', { get: () => holder.last });
  return f;
}

const CFG = { url: 'http://sb.local', anonKey: 'anon' };

describe('buildSavePayload', () => {
  it('caps the name, defaults visibility private, never sends owner', () => {
    const p = buildSavePayload({ route: ROUTE, name: 'x'.repeat(200) });
    expect((p['name'] as string).length).toBe(80);
    expect(p['visibility']).toBe('private');
    expect('owner_id' in p).toBe(false);
  });
  it('an empty name falls back honestly', () => {
    expect(buildSavePayload({ route: ROUTE, name: '   ' })['name']).toBe('Untitled drive');
  });
});

describe('saveRoute / listMyRoutes', () => {
  it('posts the RPC with the user token and returns the uuid', async () => {
    const f = fetchOf(200, '9f0403ea-65db-4f11-938c-d567a8033c2b');
    const id = await saveRoute(CFG, 'user-token', { route: ROUTE, name: 'My loop' }, f);
    expect(id).toBe('9f0403ea-65db-4f11-938c-d567a8033c2b');
    expect(f.last.url).toBe('http://sb.local/rest/v1/rpc/save_route');
    expect(f.last.headers?.['authorization']).toBe('Bearer user-token');
    expect(JSON.parse(f.last.body!)['p']['name']).toBe('My loop');
  });

  it('401 becomes the friendly sign-in message', async () => {
    const f = fetchOf(401, {});
    await expect(saveRoute(CFG, 'stale', { route: ROUTE, name: 'x' }, f)).rejects.toThrow(
      /Sign in to save/,
    );
  });

  it('a malformed RPC body is rejected, not trusted (Hard rule K)', async () => {
    const f = fetchOf(200, { not: 'a uuid' });
    await expect(saveRoute(CFG, 't', { route: ROUTE, name: 'x' }, f)).rejects.toBeInstanceOf(
      DataError,
    );
  });

  it('listMyRoutes filters by owner, validates rows, newest first', async () => {
    const f = fetchOf(200, [
      {
        id: '9f0403ea-65db-4f11-938c-d567a8033c2b',
        name: 'My loop',
        visibility: 'private',
        is_loop: true,
        distance_m: 40000,
        duration_s: 3600,
        created_at: '2026-08-12T00:00:00Z',
      },
    ]);
    const rows = await listMyRoutes(CFG, 'tok', 'user-1', f);
    expect(rows).toHaveLength(1);
    expect(f.last.url).toContain('owner_id=eq.user-1');
    expect(f.last.url).toContain('order=created_at.desc');
  });
});
