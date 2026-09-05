import { describe, expect, it } from 'vitest';

import { removeByPrefix, removeObject, StorageError, type StorageConfig } from './storage';

/**
 * Device pass (2026-09-04) — the prefix sweep against Storage's REAL list
 * semantics (one level at a time; a sub-folder is an entry with id null).
 * The first live account deletion of a user WITH a photo failed because the
 * sweep listed `<owner>/`, got the spot folder back, and tried to DELETE the
 * folder path. No test had ever exercised the sweep against a nested layout.
 */

const CFG: StorageConfig = { url: 'http://sb.local', serviceRoleKey: 'srv', bucket: 'photos' };

/** A Storage stand-in holding these object keys, listing one level deep. */
function storageWith(keys: string[]) {
  const objects = new Set(keys);
  const deleted: string[] = [];
  const listed: string[] = [];
  const fetchImpl = async (url: string, init?: Record<string, unknown>) => {
    const method = (init?.['method'] as string) ?? 'GET';
    if (url.endsWith('/object/list/photos') && method === 'POST') {
      const { prefix } = JSON.parse(init?.['body'] as string) as { prefix: string };
      listed.push(prefix);
      const seen = new Map<string, boolean>(); // name → isFolder
      for (const k of objects) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash === -1) seen.set(rest, false);
        else seen.set(rest.slice(0, slash), true);
      }
      const body = [...seen.entries()].map(([name, folder]) => ({
        name,
        id: folder ? null : `id-${name}`,
        metadata: folder ? null : { size: 1 },
      }));
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }
    if (method === 'DELETE') {
      const key = decodeURIComponent(url.split('/object/photos/')[1] ?? '');
      deleted.push(key);
      if (!objects.has(key)) return { ok: false, status: 400, text: async () => 'not an object' };
      objects.delete(key);
      return { ok: true, status: 200, text: async () => '{}' };
    }
    return { ok: false, status: 500, text: async () => 'unexpected' };
  };
  return { fetchImpl, deleted, listed, remaining: () => [...objects] };
}

describe('removeByPrefix', () => {
  it('sweeps an ACCOUNT prefix through the spot folders down to every file', async () => {
    const s = storageWith([
      'owner-a/spot-1/p1.jpg',
      'owner-a/spot-1/p1_thumb.jpg',
      'owner-a/spot-2/p2.jpg',
      'owner-b/spot-9/other.jpg', // someone else's — untouched
    ]);
    const n = await removeByPrefix(CFG, 'owner-a/', s.fetchImpl);
    expect(n).toBe(3);
    expect(s.remaining()).toEqual(['owner-b/spot-9/other.jpg']);
    // never a DELETE aimed at a folder path
    expect(s.deleted.every((k) => k.endsWith('.jpg'))).toBe(true);
    expect(s.listed).toEqual(['owner-a/', 'owner-a/spot-1/', 'owner-a/spot-2/']);
  });

  it('a SPOT prefix (leaf level) still works as before', async () => {
    const s = storageWith(['owner-a/spot-1/p1.jpg', 'owner-a/spot-1/p1_thumb.jpg']);
    expect(await removeByPrefix(CFG, 'owner-a/spot-1/', s.fetchImpl)).toBe(2);
    expect(s.remaining()).toEqual([]);
  });

  it('an empty prefix is a no-op, not an error', async () => {
    const s = storageWith(['owner-b/spot-9/other.jpg']);
    expect(await removeByPrefix(CFG, 'owner-a/', s.fetchImpl)).toBe(0);
    expect(s.deleted).toEqual([]);
  });

  it('a failed list fails CLOSED (the caller must not delete the rows)', async () => {
    const failing = async () => ({ ok: false, status: 503, text: async () => 'down' });
    await expect(removeByPrefix(CFG, 'owner-a/', failing)).rejects.toBeInstanceOf(StorageError);
  });
});

describe('removeObject', () => {
  it('treats 404 as already gone — removal is idempotent', async () => {
    const gone = async () => ({ ok: false, status: 404, text: async () => 'not found' });
    await expect(removeObject(CFG, 'owner-a/spot-1/p1.jpg', gone)).resolves.toBeUndefined();
  });
});
