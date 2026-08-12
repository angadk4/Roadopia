import { describe, expect, it, vi } from 'vitest';

import type { FetchLike } from '../api';
import {
  AuthApiError,
  needsRefresh,
  refreshSession,
  REFRESH_SKEW_S,
  sendOtp,
  verifyOtp,
  type AuthSession,
} from '../auth';
import { AuthEngine } from '../auth_state';
import { memorySessionStore } from '../session_store';

/**
 * M8-T01 — Supabase Auth (FR-200/201). The pure GoTrue client + the gate
 * state machine, fully in node. The FR-201 contract is pinned hard: sign-in
 * is requested ONLY by a gated action, the parked action runs exactly once
 * after verify, and dismissing drops it.
 */

const CFG = { url: 'http://sb.local', anonKey: 'anon-key' };

function fakeFetch(
  routes: Record<string, { status: number; body: unknown }>,
): FetchLike & { calls: Array<{ url: string; body?: string }> } {
  const calls: Array<{ url: string; body?: string }> = [];
  const f = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, ...(init?.body !== undefined ? { body: init.body } : {}) });
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`unrouted ${url}`);
    const [, r] = hit;
    return {
      ok: r.status < 300,
      status: r.status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(r.body)),
    };
  }) as unknown as FetchLike & { calls: typeof calls };
  f.calls = calls;
  return f;
}

const TOKENS = {
  access_token: 'at-1',
  refresh_token: 'rt-1',
  expires_in: 3600,
  user: { id: 'user-1', email: 'a@b.co' },
};

describe('GoTrue client (pure)', () => {
  it('sendOtp posts the email with the anon key and create_user', async () => {
    const f = fakeFetch({ '/auth/v1/otp': { status: 200, body: {} } });
    await sendOtp(CFG, 'a@b.co', f);
    expect(f.calls[0]!.url).toBe('http://sb.local/auth/v1/otp');
    expect(JSON.parse(f.calls[0]!.body!)).toEqual({ email: 'a@b.co', create_user: true });
  });

  it('verifyOtp returns a session with computed expiry', async () => {
    const f = fakeFetch({ '/auth/v1/verify': { status: 200, body: TOKENS } });
    const s = await verifyOtp(CFG, 'a@b.co', '123456', { fetchImpl: f, now: () => 1000 });
    expect(s.accessToken).toBe('at-1');
    expect(s.expiresAt).toBe(1000 + 3600);
    expect(s.user).toEqual({ id: 'user-1', email: 'a@b.co' });
  });

  it('a wrong code is a friendly error, never a raw dump', async () => {
    const f = fakeFetch({
      '/auth/v1/verify': {
        status: 401,
        body: { error_description: 'Token has expired or is invalid' },
      },
    });
    await expect(verifyOtp(CFG, 'a@b.co', '000000', { fetchImpl: f })).rejects.toThrow(
      /code didn’t match/,
    );
  });

  it('an unexpected verify body is rejected (Hard rule K), not trusted', async () => {
    const f = fakeFetch({ '/auth/v1/verify': { status: 200, body: { access_token: 42 } } });
    await expect(verifyOtp(CFG, 'a@b.co', '123456', { fetchImpl: f })).rejects.toBeInstanceOf(
      AuthApiError,
    );
  });

  it('refresh exchanges the token and recomputes expiry', async () => {
    const f = fakeFetch({
      '/auth/v1/token?grant_type=refresh_token': {
        status: 200,
        body: { ...TOKENS, access_token: 'at-2', refresh_token: 'rt-2' },
      },
    });
    const s = await refreshSession(CFG, 'rt-1', { fetchImpl: f, now: () => 5000 });
    expect(s.accessToken).toBe('at-2');
    expect(s.refreshToken).toBe('rt-2');
    expect(s.expiresAt).toBe(5000 + 3600);
  });

  it('needsRefresh honors the skew window', () => {
    const s: AuthSession = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 1000,
      user: { id: 'u', email: '' },
    };
    expect(needsRefresh(s, 1000 - REFRESH_SKEW_S - 1)).toBe(false);
    expect(needsRefresh(s, 1000 - REFRESH_SKEW_S)).toBe(true);
  });
});

describe('AuthEngine — the FR-201 gate', () => {
  function engineWith(
    routes: Record<string, { status: number; body: unknown }>,
    initial: AuthSession | null = null,
  ): { engine: AuthEngine; fetch: ReturnType<typeof fakeFetch> } {
    const f = fakeFetch(routes);
    const engine = new AuthEngine({
      cfg: CFG,
      store: memorySessionStore(initial),
      fetchImpl: f,
      now: () => 1000,
    });
    return { engine, fetch: f };
  }

  it('anonymous browse never opens the sheet; a gated action does', async () => {
    const { engine } = engineWith({});
    await engine.init();
    expect(engine.getState().status).toBe('anon');
    expect(engine.getState().sheetOpen).toBe(false); // FR-201: never at launch
    const action = vi.fn();
    engine.gate(action);
    expect(action).not.toHaveBeenCalled(); // parked, not run
    expect(engine.getState().sheetOpen).toBe(true);
  });

  it('verify runs the parked action exactly once and closes the sheet', async () => {
    const { engine } = engineWith({ '/auth/v1/verify': { status: 200, body: TOKENS } });
    await engine.init();
    const action = vi.fn();
    engine.gate(action);
    await engine.verifyCode('a@b.co', '123456');
    expect(action).toHaveBeenCalledTimes(1);
    expect(engine.getState().status).toBe('signedIn');
    expect(engine.getState().sheetOpen).toBe(false);
    // a second verify (hypothetical) must not re-run it
    await engine.verifyCode('a@b.co', '123456').catch(() => undefined);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('dismissing the sheet drops the parked action for good', async () => {
    const { engine } = engineWith({ '/auth/v1/verify': { status: 200, body: TOKENS } });
    await engine.init();
    const action = vi.fn();
    engine.gate(action);
    engine.dismissSheet();
    await engine.verifyCode('a@b.co', '123456'); // signs in later some other way
    expect(action).not.toHaveBeenCalled();
  });

  it('signed-in gate runs immediately, no sheet', async () => {
    const session: AuthSession = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 999999,
      user: { id: 'u1', email: 'a@b.co' },
    };
    const { engine } = engineWith({}, session);
    await engine.init();
    const action = vi.fn();
    engine.gate(action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(engine.getState().sheetOpen).toBe(false);
  });

  it('freshAccessToken refreshes when stale and persists rotation', async () => {
    const stale: AuthSession = {
      accessToken: 'at-old',
      refreshToken: 'rt-old',
      expiresAt: 1000, // now=1000 → inside skew → refresh
      user: { id: 'u1', email: '' },
    };
    const { engine } = engineWith(
      {
        '/auth/v1/token?grant_type=refresh_token': {
          status: 200,
          body: { ...TOKENS, access_token: 'at-new', refresh_token: 'rt-new' },
        },
      },
      stale,
    );
    await engine.init();
    expect(await engine.freshAccessToken()).toBe('at-new');
    expect(engine.getState().session?.refreshToken).toBe('rt-new');
  });

  it('a rejected refresh silently returns to anon (no user-facing error)', async () => {
    const stale: AuthSession = {
      accessToken: 'at-old',
      refreshToken: 'rt-revoked',
      expiresAt: 1000,
      user: { id: 'u1', email: '' },
    };
    const { engine } = engineWith(
      { '/auth/v1/token?grant_type=refresh_token': { status: 401, body: {} } },
      stale,
    );
    await engine.init();
    expect(await engine.freshAccessToken()).toBeNull();
    expect(engine.getState().status).toBe('anon');
  });

  it('signOut clears local state even when the server is unreachable', async () => {
    const session: AuthSession = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 999999,
      user: { id: 'u1', email: '' },
    };
    const { engine } = engineWith({}, session); // /logout is unrouted → throws inside
    await engine.init();
    await engine.signOut();
    expect(engine.getState().status).toBe('anon');
    expect(engine.getState().session).toBeNull();
  });
});
