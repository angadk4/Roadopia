/**
 * Supabase JWT verification (M6-T02; Spec §54 "The backend verifies JWTs for
 * gated agent/routing calls; anonymous /plan is allowed but rate-limited";
 * FR-203).
 *
 * Implemented on `node:crypto` ONLY — no new dependency (Build Contract §5;
 * the §43 philosophy is raw SDKs + hand-built, transparent code):
 *   - ES256/RS256 (current Supabase signing keys): verified against the
 *     project JWKS at `<issuer>/.well-known/jwks.json`, cached, one refetch
 *     on kid miss (key rotation). ES256 signatures are raw r||s per RFC 7518
 *     → `dsaEncoding: 'ieee-p1363'`.
 *   - HS256 (legacy projects): HMAC with SUPABASE_JWT_SECRET when provided.
 * Claims checked: signature, exp (60 s skew), aud === 'authenticated',
 * iss === the configured issuer, non-empty sub. Tokens are DATA — nothing
 * from an unverified token is ever trusted or logged (rules H/K).
 */

import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '../lib/errors';

export interface AuthIdentity {
  sub: string;
  role: string;
}

export interface Jwk {
  kty: string;
  kid?: string;
  crv?: string;
  alg?: string;
  [k: string]: unknown;
}

export class JwtError extends Error {
  constructor(readonly reason: string) {
    super(`jwt rejected: ${reason}`);
    this.name = 'JwtError';
  }
}

export interface JwtVerifierOptions {
  /** `${SUPABASE_URL}/auth/v1` */
  issuer: string;
  /** Legacy HS256 secret (optional; asymmetric projects don't need it). */
  hs256Secret?: string;
  /** DI for tests; default fetches `<issuer>/.well-known/jwks.json`. */
  fetchJwks?: () => Promise<Jwk[]>;
  now?: () => number; // seconds since epoch
}

const CLOCK_SKEW_S = 60;
const JWKS_TTL_MS = 10 * 60 * 1000;

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export class JwtVerifier {
  private jwks: { keys: Jwk[]; at: number } | null = null;

  constructor(private readonly opts: JwtVerifierOptions) {}

  private async loadJwks(forceRefresh = false): Promise<Jwk[]> {
    const now = Date.now();
    if (!forceRefresh && this.jwks && now - this.jwks.at < JWKS_TTL_MS) return this.jwks.keys;
    const fetcher =
      this.opts.fetchJwks ??
      (async (): Promise<Jwk[]> => {
        const res = await fetch(`${this.opts.issuer}/.well-known/jwks.json`);
        if (!res.ok) throw new JwtError(`jwks fetch failed (${res.status})`);
        const body = (await res.json()) as { keys?: Jwk[] };
        return body.keys ?? [];
      });
    const keys = await fetcher();
    this.jwks = { keys, at: now };
    return keys;
  }

  private async keyFor(kid: string | undefined, kty: string): Promise<Jwk> {
    let keys = await this.loadJwks();
    let hit = keys.find((k) => (kid === undefined || k.kid === kid) && k.kty === kty);
    if (!hit) {
      keys = await this.loadJwks(true); // rotation: one forced refetch
      hit = keys.find((k) => (kid === undefined || k.kid === kid) && k.kty === kty);
    }
    if (!hit) throw new JwtError('no matching JWKS key');
    return hit;
  }

  async verify(token: string): Promise<AuthIdentity> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new JwtError('malformed token');
    const [h, p, s] = parts as [string, string, string];

    let header: { alg?: string; kid?: string };
    let payload: Record<string, unknown>;
    try {
      header = JSON.parse(b64urlToBuf(h).toString('utf8')) as { alg?: string; kid?: string };
      payload = JSON.parse(b64urlToBuf(p).toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new JwtError('undecodable token');
    }

    const data = Buffer.from(`${h}.${p}`);
    const sig = b64urlToBuf(s);

    switch (header.alg) {
      case 'HS256': {
        if (!this.opts.hs256Secret) throw new JwtError('HS256 not configured');
        const expected = createHmac('sha256', this.opts.hs256Secret).update(data).digest();
        if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
          throw new JwtError('bad signature');
        }
        break;
      }
      case 'ES256': {
        const jwk = await this.keyFor(header.kid, 'EC');
        const key = createPublicKey({ key: jwk as never, format: 'jwk' });
        if (!cryptoVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)) {
          throw new JwtError('bad signature');
        }
        break;
      }
      case 'RS256': {
        const jwk = await this.keyFor(header.kid, 'RSA');
        const key = createPublicKey({ key: jwk as never, format: 'jwk' });
        if (!cryptoVerify('sha256', data, key, sig)) throw new JwtError('bad signature');
        break;
      }
      default:
        throw new JwtError(`unsupported alg ${header.alg ?? '(none)'}`);
    }

    const now = this.opts.now ? this.opts.now() : Math.floor(Date.now() / 1000);
    const exp = typeof payload['exp'] === 'number' ? payload['exp'] : 0;
    if (exp + CLOCK_SKEW_S <= now) throw new JwtError('expired');
    if (payload['aud'] !== 'authenticated') throw new JwtError('wrong audience');
    if (payload['iss'] !== this.opts.issuer) throw new JwtError('wrong issuer');
    const sub = typeof payload['sub'] === 'string' ? payload['sub'] : '';
    if (!sub) throw new JwtError('missing sub');

    return { sub, role: typeof payload['role'] === 'string' ? payload['role'] : 'authenticated' };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthIdentity | null;
  }
}

/**
 * Register auth on the app: a Bearer token, when PRESENT, must verify (an
 * invalid token is always 401, even on anon-allowed routes — presenting bad
 * credentials is never treated as anonymous). No token → anon (user null).
 */
export function registerAuth(app: FastifyInstance, verifier: JwtVerifier | null): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return; // anonymous
    if (!verifier) {
      throw new AppError(503, 'auth_unavailable', 'Sign-in is temporarily unavailable.');
    }
    try {
      request.user = await verifier.verify(header.slice('Bearer '.length));
    } catch {
      // reason goes nowhere near the client (token contents are untrusted data)
      throw new AppError(401, 'invalid_token', 'Invalid or expired token.');
    }
  });
}

/** preHandler for gated routes (save/favourite/… — M8+). */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.user) {
    throw new AppError(401, 'auth_required', 'Sign in to use this feature.');
  }
}
