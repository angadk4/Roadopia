import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../api';
import { DataError } from '../data';
import { fetchProfile, updateDisplayName } from '../profile';

/** Profiles are owner-readable since 0032 (review, 2026-09-07): every read
 *  presents the user's token, and a zero-row answer is honest, not a crash. */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };
const UID = '00000000-0000-4000-8000-00000000000a';

function fetchOf(status: number, body: unknown) {
  const holder = { last: { url: '', headers: {} as Record<string, string>, body: '' } };
  const f = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    holder.last = { url, headers: init?.headers ?? {}, body: init?.body ?? '' };
    return {
      ok: status < 300,
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  }) as unknown as FetchLike;
  return { f, holder };
}

describe('fetchProfile', () => {
  it('reads by id WITH the user token, and returns the row', async () => {
    const { f, holder } = fetchOf(200, [{ id: UID, display_name: 'Angad', avatar_url: null }]);
    const p = await fetchProfile(CFG, UID, 'tok', f);
    expect(p?.display_name).toBe('Angad');
    expect(holder.last.url).toContain(`/profiles?id=eq.${UID}`);
    expect(holder.last.headers['authorization']).toBe('Bearer tok');
  });
  it('zero rows (RLS: not yours, or gone) → null, not a throw', async () => {
    const { f } = fetchOf(200, []);
    expect(await fetchProfile(CFG, UID, 'tok', f)).toBeNull();
  });
  it('a malformed row is refused (Hard rule K)', async () => {
    const { f } = fetchOf(200, [{ id: UID, display_name: '', avatar_url: null }]);
    await expect(fetchProfile(CFG, UID, 'tok', f)).rejects.toBeInstanceOf(DataError);
  });
});

describe('updateDisplayName', () => {
  it('PATCHes the trimmed name and returns the representation', async () => {
    const { f, holder } = fetchOf(200, [{ id: UID, display_name: 'Ang', avatar_url: null }]);
    const p = await updateDisplayName(CFG, 'tok', UID, '  Ang ', f);
    expect(p.display_name).toBe('Ang');
    expect(JSON.parse(holder.last.body)).toEqual({ display_name: 'Ang' });
    expect(holder.last.headers['prefer']).toBe('return=representation');
  });
  it('a zero-row PATCH is surfaced honestly (not yours)', async () => {
    const { f } = fetchOf(200, []);
    await expect(updateDisplayName(CFG, 'tok', UID, 'x', f)).rejects.toThrow(/isn’t yours/);
  });
  it('refuses an empty or over-long name before touching the network', async () => {
    const { f, holder } = fetchOf(200, []);
    await expect(updateDisplayName(CFG, 'tok', UID, '   ', f)).rejects.toThrow(/1–40/);
    await expect(updateDisplayName(CFG, 'tok', UID, 'x'.repeat(41), f)).rejects.toThrow(/1–40/);
    expect(holder.last.url).toBe('');
  });
});
