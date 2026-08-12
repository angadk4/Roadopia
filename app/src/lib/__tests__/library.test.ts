import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../api';
import { DataError } from '../data';
import {
  deleteAccount,
  favouriteRoute,
  fetchRouteById,
  forkRoute,
  getPreferences,
  listFavouriteRouteIds,
  setPreferences,
  unfavouriteRoute,
  updateVisibility,
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
    const { f } = fetchOf(200, []);
    expect(await fetchRouteById(CFG, RID, null, f)).toBeNull();
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
  it('deleteAccount posts the RPC with the user token', async () => {
    const { f, holder } = fetchOf(204, null);
    await deleteAccount(CFG, 'tok', f);
    expect(holder.last.url).toContain('/rpc/delete_account');
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
