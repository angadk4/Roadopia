/**
 * Supabase Auth (GoTrue) client — hand-built over the same FetchLike as
 * api.ts/data.ts (M8-T01; FR-200..203).
 *
 * BD-48 (M7) deferred the auth client to M8; measured at M8 the need is FOUR
 * REST endpoints, so the repo's raw-and-transparent pattern (data.ts PostgREST,
 * backend jwt.ts on node:crypto) extends here instead of adopting
 * @supabase/supabase-js and its RN storage/polyfill baggage (recorded BD-188).
 *
 * Method: EMAIL OTP (6-digit code) — works in the Expo dev client with no
 * deep-link configuration, no passwords stored anywhere, and sign-in stays a
 * 30-second sheet at the first gated action (FR-201, FR-206).
 *
 * PURE module (no Expo/React imports): every path unit-tested in node. All
 * responses are zod-validated before use (Hard rule K); error messages are
 * friendly and never a raw server dump (§18). Tokens are handled as opaque
 * strings and never logged (Hard rule H).
 */

import { z } from 'zod';

import type { FetchLike } from './api';
import type { SupabaseConfig } from './data';

/** A signed-in session. `expiresAt` is epoch SECONDS (computed at verify). */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds when accessToken expires. */
  expiresAt: number;
  user: { id: string; email: string };
}

/** Refresh this many seconds BEFORE expiry (JWT default lifetime is 1h). */
export const REFRESH_SKEW_S = 120;

export class AuthApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  user: z.object({ id: z.string().min(1), email: z.string().optional() }),
});

function friendly(status: number, bodyText: string): string {
  // GoTrue error bodies vary ({error_description} | {msg} | {message}); pick
  // the human one when safe, else a friendly generic (§18 honest states).
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      const msg = p['error_description'] ?? p['msg'] ?? p['message'];
      if (typeof msg === 'string' && msg.length < 200) return msg;
    }
  } catch {
    /* non-JSON body — generic below */
  }
  if (status === 429) return 'Too many attempts — wait a minute and try again.';
  return 'Sign-in is temporarily unavailable — try again in a moment.';
}

async function authPost(
  cfg: SupabaseConfig,
  path: string,
  body: Record<string, unknown> | null,
  opts: { accessToken?: string; fetchImpl?: FetchLike } = {},
): Promise<{ status: number; text: string }> {
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    res = await f(`${cfg.url}/auth/v1${path}`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        'content-type': 'application/json',
        ...(opts.accessToken !== undefined
          ? { authorization: `Bearer ${opts.accessToken}` }
          : { authorization: `Bearer ${cfg.anonKey}` }),
      },
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new AuthApiError('Could not reach the sign-in service — check your connection.', null, {
      cause: err,
    });
  }
  return { status: res.status, text: await res.text() };
}

/** Step 1 — email a 6-digit code (creates the account on first sign-in). */
export async function sendOtp(
  cfg: SupabaseConfig,
  email: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const { status, text } = await authPost(
    cfg,
    '/otp',
    { email, create_user: true },
    { ...(fetchImpl ? { fetchImpl } : {}) },
  );
  if (status < 200 || status >= 300) throw new AuthApiError(friendly(status, text), status);
}

function toSession(raw: unknown, nowS: number): AuthSession {
  const parsed = TokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthApiError('Sign-in returned an unexpected response.', null);
  }
  const d = parsed.data;
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresAt: nowS + d.expires_in,
    user: { id: d.user.id, email: d.user.email ?? '' },
  };
}

/** Step 2 — verify the emailed code → a session. */
export async function verifyOtp(
  cfg: SupabaseConfig,
  email: string,
  code: string,
  opts: { fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<AuthSession> {
  const { status, text } = await authPost(
    cfg,
    '/verify',
    { type: 'email', email, token: code },
    { ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) },
  );
  if (status < 200 || status >= 300) {
    throw new AuthApiError(
      status === 401 || status === 403 || status === 422
        ? 'That code didn’t match — check it and try again.'
        : friendly(status, text),
      status,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AuthApiError('Sign-in returned an unexpected response.', null);
  }
  const nowS = opts.now ? opts.now() : Math.floor(Date.now() / 1000);
  return toSession(raw, nowS);
}

/** Exchange the refresh token for a fresh session (rotation-safe: the new
 *  refresh token replaces the old). */
export async function refreshSession(
  cfg: SupabaseConfig,
  refreshToken: string,
  opts: { fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<AuthSession> {
  const { status, text } = await authPost(
    cfg,
    '/token?grant_type=refresh_token',
    { refresh_token: refreshToken },
    { ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) },
  );
  if (status < 200 || status >= 300) {
    throw new AuthApiError('Your session expired — sign in again to continue.', status);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AuthApiError('Sign-in returned an unexpected response.', null);
  }
  const nowS = opts.now ? opts.now() : Math.floor(Date.now() / 1000);
  return toSession(raw, nowS);
}

/** Best-effort server-side sign-out (local session removal is the real act). */
export async function signOutRemote(
  cfg: SupabaseConfig,
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  try {
    await authPost(cfg, '/logout', null, {
      accessToken,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  } catch {
    /* offline sign-out is still a sign-out — the local token is discarded */
  }
}

/** Does this session need a refresh before its access token is usable? */
export function needsRefresh(session: AuthSession, nowS?: number): boolean {
  const now = nowS ?? Math.floor(Date.now() / 1000);
  return session.expiresAt - REFRESH_SKEW_S <= now;
}
