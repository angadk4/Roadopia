import { createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildServer } from '../server';

import { JwtVerifier, requireAuth, type Jwk } from './jwt';

/** M6-T02 AC: invalid JWT rejected on gated routes; verifier accepts only
 *  well-signed, unexpired, right-audience Supabase tokens. All keys are
 *  generated in-test (node:crypto) — no live Supabase needed. */

const ISSUER = 'https://example.supabase.co/auth/v1';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeEs256Token(
  privateKey: KeyObject,
  claims: Record<string, unknown>,
  kid = 'kid-1',
): string {
  const h = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid })));
  const p = b64url(Buffer.from(JSON.stringify(claims)));
  const signer = createSign('sha256');
  signer.update(`${h}.${p}`);
  const sig = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64url(sig)}`;
}

function makeHs256Token(secret: string, claims: Record<string, unknown>): string {
  const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(Buffer.from(JSON.stringify(claims)));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}

function keypairWithJwk(kid = 'kid-1'): { privateKey: KeyObject; jwk: Jwk } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid, alg: 'ES256' };
  return { privateKey, jwk };
}

const NOW = 1_800_000_000;
const GOOD_CLAIMS = {
  sub: 'user-123',
  aud: 'authenticated',
  iss: ISSUER,
  role: 'authenticated',
  exp: NOW + 3600,
};

describe('JwtVerifier (M6-T02)', () => {
  it('accepts a well-signed ES256 token via JWKS and returns the identity', async () => {
    const { privateKey, jwk } = keypairWithJwk();
    const v = new JwtVerifier({ issuer: ISSUER, fetchJwks: async () => [jwk], now: () => NOW });
    const id = await v.verify(makeEs256Token(privateKey, GOOD_CLAIMS));
    expect(id).toEqual({ sub: 'user-123', role: 'authenticated' });
  });

  it('rejects: expiry, wrong audience, wrong issuer, foreign signature', async () => {
    const { privateKey, jwk } = keypairWithJwk();
    const v = new JwtVerifier({ issuer: ISSUER, fetchJwks: async () => [jwk], now: () => NOW });

    await expect(
      v.verify(makeEs256Token(privateKey, { ...GOOD_CLAIMS, exp: NOW - 120 })),
    ).rejects.toThrow('expired');
    await expect(
      v.verify(makeEs256Token(privateKey, { ...GOOD_CLAIMS, aud: 'anon' })),
    ).rejects.toThrow('audience');
    await expect(
      v.verify(makeEs256Token(privateKey, { ...GOOD_CLAIMS, iss: 'https://evil.example' })),
    ).rejects.toThrow('issuer');

    const intruder = keypairWithJwk('kid-1'); // same kid, different key
    await expect(v.verify(makeEs256Token(intruder.privateKey, GOOD_CLAIMS))).rejects.toThrow(
      'bad signature',
    );
  });

  it('key rotation: a kid miss triggers exactly one JWKS refetch', async () => {
    const { privateKey, jwk } = keypairWithJwk('kid-2');
    let fetches = 0;
    const v = new JwtVerifier({
      issuer: ISSUER,
      fetchJwks: async () => {
        fetches++;
        return fetches === 1 ? [] : [jwk]; // rotated in after first fetch
      },
      now: () => NOW,
    });
    const id = await v.verify(makeEs256Token(privateKey, GOOD_CLAIMS, 'kid-2'));
    expect(id.sub).toBe('user-123');
    expect(fetches).toBe(2);
  });

  it('HS256 (legacy secret) verifies; wrong secret rejects', async () => {
    const v = new JwtVerifier({ issuer: ISSUER, hs256Secret: 's3cret', now: () => NOW });
    const id = await v.verify(makeHs256Token('s3cret', GOOD_CLAIMS));
    expect(id.sub).toBe('user-123');
    await expect(v.verify(makeHs256Token('wrong', GOOD_CLAIMS))).rejects.toThrow('bad signature');
  });
});

describe('auth on the server (M6-T02)', () => {
  function appWith(verifier: JwtVerifier): ReturnType<typeof buildServer> {
    const app = buildServer({ verifier });
    app.get('/gated', { preHandler: requireAuth }, async (req) => ({ sub: req.user?.sub }));
    app.get('/open', async (req) => ({ anon: req.user === null }));
    return app;
  }

  it('gated route: 401 without a token, 401 with an invalid one, 200 with a valid one', async () => {
    const { privateKey, jwk } = keypairWithJwk();
    const app = appWith(
      new JwtVerifier({ issuer: ISSUER, fetchJwks: async () => [jwk], now: () => NOW }),
    );

    const none = await app.inject({ method: 'GET', url: '/gated' });
    expect(none.statusCode).toBe(401);
    expect((none.json() as { error: { code: string } }).error.code).toBe('auth_required');

    const bad = await app.inject({
      method: 'GET',
      url: '/gated',
      headers: { authorization: 'Bearer not.a.token' },
    });
    expect(bad.statusCode).toBe(401);
    expect((bad.json() as { error: { code: string } }).error.code).toBe('invalid_token');

    const good = await app.inject({
      method: 'GET',
      url: '/gated',
      headers: { authorization: `Bearer ${makeEs256Token(privateKey, GOOD_CLAIMS)}` },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ sub: 'user-123' });
  });

  it('anon-allowed route works with no token, but a BAD token is still rejected', async () => {
    const { jwk } = keypairWithJwk();
    const app = appWith(
      new JwtVerifier({ issuer: ISSUER, fetchJwks: async () => [jwk], now: () => NOW }),
    );

    const anon = await app.inject({ method: 'GET', url: '/open' });
    expect(anon.statusCode).toBe(200);
    expect(anon.json()).toEqual({ anon: true });

    const bad = await app.inject({
      method: 'GET',
      url: '/open',
      headers: { authorization: 'Bearer forged.token.here' },
    });
    expect(bad.statusCode).toBe(401); // bad credentials never pass as anonymous
  });
});
