import { createHmac } from 'node:crypto';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JwtVerifier } from '../auth/jwt';
import { hasExif } from '../images/process';
import type { StorageConfig } from '../images/storage';
import { buildServer } from '../server';

import { reachableFrom } from './photos';

/**
 * M10-T05 — the upload→display integration AC: a GPS-tagged upload is
 * processed (EXIF gone) BEFORE storage; the response references ONLY the
 * processed signed URLs; bad types and strangers are rejected; deletion
 * removes blobs with the row.
 */

const ISSUER = 'http://sb.local/auth/v1';
const SECRET = 'test-secret';
const NOW = 1_800_000_000;
const OWNER = '45186192-aebd-4c7c-a46e-0bfa810d9254';
const SPOT = '7c9e6679-7425-40de-963d-92a4d1c8e2a1';

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function tokenFor(sub: string): string {
  const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(
    Buffer.from(
      JSON.stringify({
        sub,
        aud: 'authenticated',
        iss: ISSUER,
        role: 'authenticated',
        exp: NOW + 3600,
      }),
    ),
  );
  const sig = createHmac('sha256', SECRET).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}

const STORAGE: StorageConfig = { url: 'http://sb.local', serviceRoleKey: 'srv', bucket: 'photos' };

async function gpsJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 500, channels: 3, background: { r: 20, g: 40, b: 80 } },
  })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestCam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '43/1 18/1 0/1' },
    })
    .toBuffer();
}

interface Harness {
  app: ReturnType<typeof buildServer>;
  uploads: Map<string, Buffer>;
  dbRows: Record<string, unknown[][]>;
  removed: string[];
  /** Prefix sweeps, in call order, interleaved with 'rpc:delete_account'. */
  swept: string[];
}

function harness(
  dbResponses: Array<Array<Record<string, unknown>>>,
  extra: Record<string, unknown> = {},
): Harness {
  const uploads = new Map<string, Buffer>();
  const removed: string[] = [];
  const swept: string[] = [];
  const responses = [...dbResponses];
  const app = buildServer({
    verifier: new JwtVerifier({ issuer: ISSUER, hs256Secret: SECRET, now: () => NOW }),
    photos: {
      db: {
        query: async () => ({ rows: (responses.shift() ?? []) as Array<Record<string, unknown>> }),
      },
      storage: STORAGE,
      uploadFn: async (_cfg, path, body) => {
        uploads.set(path, body);
      },
      signFn: async (_cfg, path) =>
        `http://sb.local/storage/v1/object/sign/photos/${path}?token=signed`,
      removeFn: async (_cfg, path) => {
        removed.push(path);
      },
      sweepFn: async (_cfg: unknown, prefix: string) => {
        swept.push(prefix);
        return 0;
      },
      ...extra,
    },
  });
  return { app, uploads, dbRows: {}, removed, swept };
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(async () => {});

describe('POST /spots/:id/photos', () => {
  it('strips EXIF before storage and answers with processed signed URLs only', async () => {
    const h = harness([
      [{ owner_id: OWNER, source: 'user' }], // spot lookup
      [{ n: 0 }], // photo count
      [], // insert
    ]);
    const res = await h.app.inject({
      method: 'POST',
      url: `/spots/${SPOT}/photos`,
      headers: {
        authorization: `Bearer ${tokenFor(OWNER)}`,
        'content-type': 'application/octet-stream',
      },
      payload: await gpsJpeg(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; url: string; thumb_url: string };
    expect(body.url).toContain('/object/sign/photos/'); // signed, never a raw path
    expect(body.thumb_url).toContain('_thumb.jpg');

    // what actually landed in storage carries ZERO EXIF
    expect(h.uploads.size).toBe(2);
    for (const buf of h.uploads.values()) {
      expect(await hasExif(buf)).toBe(false);
    }
    await h.app.close();
  });

  it("rejects a stranger's spot, an OSM seed, and a non-image — nothing stored", async () => {
    const stranger = harness([[{ owner_id: 'someone-else', source: 'user' }]]);
    const r1 = await stranger.app.inject({
      method: 'POST',
      url: `/spots/${SPOT}/photos`,
      headers: { authorization: `Bearer ${tokenFor(OWNER)}`, 'content-type': 'image/jpeg' },
      payload: await gpsJpeg(),
    });
    expect(r1.statusCode).toBe(404);
    expect(stranger.uploads.size).toBe(0);
    await stranger.app.close();

    const osm = harness([[{ owner_id: OWNER, source: 'osm' }]]);
    const r2 = await osm.app.inject({
      method: 'POST',
      url: `/spots/${SPOT}/photos`,
      headers: { authorization: `Bearer ${tokenFor(OWNER)}`, 'content-type': 'image/jpeg' },
      payload: await gpsJpeg(),
    });
    expect(r2.statusCode).toBe(404);
    await osm.app.close();

    const bad = harness([[{ owner_id: OWNER, source: 'user' }], [{ n: 0 }]]);
    const r3 = await bad.app.inject({
      method: 'POST',
      url: `/spots/${SPOT}/photos`,
      headers: { authorization: `Bearer ${tokenFor(OWNER)}`, 'content-type': 'image/jpeg' },
      payload: Buffer.from('%PDF-1.4 definitely not an image'),
    });
    expect(r3.statusCode).toBe(400);
    expect(bad.uploads.size).toBe(0); // fail closed: nothing reached storage
    await bad.app.close();
  });

  it('storage outage fails CLOSED with plain words (M11-T07) — no row recorded', async () => {
    const h = harness([[{ owner_id: OWNER, source: 'user' }], [{ n: 0 }]], {
      uploadFn: async () => {
        const { StorageError } = await import('../images/storage');
        throw new StorageError('storage upload failed', 503);
      },
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/spots/${SPOT}/photos`,
      headers: { authorization: `Bearer ${tokenFor(OWNER)}`, 'content-type': 'image/jpeg' },
      payload: await gpsJpeg(),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'storage_down' } });
    await h.app.close();
  });

  it('requires auth — anonymous uploads are refused', async () => {
    const h = harness([]);
    const res = await h.app.inject({
      method: 'POST',
      url: `/spots/${SPOT}/photos`,
      headers: { 'content-type': 'image/jpeg' },
      payload: await gpsJpeg(),
    });
    expect(res.statusCode).toBe(401);
    await h.app.close();
  });
});

describe('signed URLs are reachable FROM THE PHONE (dev LAN)', () => {
  it('rewrites a loopback storage host to the host the client dialled', () => {
    const loopback = 'http://127.0.0.1:54321/storage/v1/object/sign/photos/a.jpg?token=t';
    expect(reachableFrom(loopback, '192.168.50.25:8080')).toBe(
      'http://192.168.50.25:54321/storage/v1/object/sign/photos/a.jpg?token=t',
    );
    // a hosted URL is NEVER rewritten, whatever host the client used
    const hosted = 'https://abc.supabase.co/storage/v1/object/sign/photos/a.jpg?token=t';
    expect(reachableFrom(hosted, '192.168.50.25:8080')).toBe(hosted);
    // desktop client on loopback keeps loopback; missing header changes nothing
    expect(reachableFrom(loopback, '127.0.0.1:8080')).toBe(loopback);
    expect(reachableFrom(loopback, undefined)).toBe(loopback);
  });

  it('the upload response carries the rewritten host end to end', async () => {
    const h = harness([[{ owner_id: OWNER, source: 'user' }], [{ n: 0 }], []], {
      signFn: async (_cfg: unknown, path: string) =>
        `http://127.0.0.1:54321/storage/v1/object/sign/photos/${path}?token=signed`,
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/spots/${SPOT}/photos`,
      headers: {
        authorization: `Bearer ${tokenFor(OWNER)}`,
        'content-type': 'image/jpeg',
        host: '192.168.50.25:8080',
      },
      payload: await gpsJpeg(),
    });
    const body = res.json() as { url: string; thumb_url: string };
    expect(body.url).toContain('http://192.168.50.25:54321/');
    expect(body.thumb_url).toContain('http://192.168.50.25:54321/');
    await h.app.close();
  });
});

describe('DELETE /spots/:id and /account (blob-sweeping cascades)', () => {
  it("spot deletion sweeps the spot's whole blob prefix (no row list to go stale)", async () => {
    const h = harness([[{ id: SPOT }]]); // delete … returning
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/spots/${SPOT}`,
      headers: { authorization: `Bearer ${tokenFor(OWNER)}` },
    });
    expect(res.statusCode).toBe(204);
    // one sweep covering every photo of that spot, including any uploaded
    // between the row read and the delete
    expect(h.swept).toEqual([`${OWNER}/${SPOT}/`]);
    await h.app.close();
  });

  it("a stranger's spot deletes nothing and sweeps nothing", async () => {
    const h = harness([[]]); // delete returns no rows
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/spots/${SPOT}`,
      headers: { authorization: `Bearer ${tokenFor(OWNER)}` },
    });
    expect(res.statusCode).toBe(404);
    expect(h.swept).toEqual([]);
    await h.app.close();
  });

  it('account deletion sweeps blobs BEFORE the unretryable row delete, as the CALLER', async () => {
    const order: string[] = [];
    const h = harness([], {
      deleteAccountFn: async (_url: string, userToken: string) => {
        order.push(`rpc:${userToken === tokenFor(OWNER) ? 'caller-token' : 'WRONG-CREDENTIAL'}`);
      },
    });
    // record sweep order against the RPC on the same list
    const originalSweep = h.swept;
    const res = await h.app.inject({
      method: 'DELETE',
      url: '/account',
      headers: { authorization: `Bearer ${tokenFor(OWNER)}` },
    });
    expect(res.statusCode).toBe(204);
    // the sweep covers everything this owner ever uploaded …
    expect(originalSweep).toEqual([`${OWNER}/`]);
    // … and it ran with the USER's own bearer token, never a service credential
    expect(order).toEqual(['rpc:caller-token']);
    await h.app.close();
  });

  it('a failed blob sweep leaves the account ALIVE so the user can retry', async () => {
    const rpcCalls: string[] = [];
    const h = harness([], {
      sweepFn: async () => {
        throw new Error('storage list failed');
      },
      deleteAccountFn: async () => {
        rpcCalls.push('called');
      },
    });
    const res = await h.app.inject({
      method: 'DELETE',
      url: '/account',
      headers: { authorization: `Bearer ${tokenFor(OWNER)}` },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    // the irreversible step never ran — retry is still possible
    expect(rpcCalls).toEqual([]);
    await h.app.close();
  });
});

describe('DELETE /photos/:id', () => {
  it('removes both blobs with the row (deletion is real — Hard rule E)', async () => {
    const h = harness([[{ storage_path: 'u/s/p.jpg', thumb_path: 'u/s/p_thumb.jpg' }]]);
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/photos/${SPOT}`,
      headers: { authorization: `Bearer ${tokenFor(OWNER)}` },
    });
    expect(res.statusCode).toBe(204);
    expect(h.removed).toEqual(['u/s/p.jpg', 'u/s/p_thumb.jpg']);
    await h.app.close();
  });
});
