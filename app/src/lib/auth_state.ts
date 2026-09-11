/**
 * Auth session state + the FR-201 gate primitive (M8-T01).
 *
 * PURE state machine (no React imports) so every transition is node-tested;
 * the thin React context lives in use_auth.tsx. Design:
 *
 *   - the app NEVER blocks on auth: anonymous users browse and plan freely
 *     (FR-200); `status` starts 'loading' only for the initial persisted-
 *     session read, then 'anon' | 'signedIn'.
 *   - `gate(action)` is the ONLY sign-in trigger in the product (FR-201):
 *     signed-in → the action runs immediately; anonymous → the action is
 *     parked, the sheet opens, and a successful verify runs it exactly once.
 *   - refresh happens lazily: `freshAccessToken()` refreshes when within the
 *     skew window, persists the rotated tokens, and signs out locally when
 *     the refresh token is rejected (expired/revoked) — an expired session
 *     silently returns to anon rather than erroring at the user.
 */

import type { FetchLike } from './api';
import {
  AuthApiError,
  needsRefresh,
  refreshSession,
  sendOtp,
  signOutRemote,
  verifyOtp,
  type AuthSession,
} from './auth';
import type { SupabaseConfig } from './data';
import type { SessionStore } from './session_store';

export type AuthStatus = 'loading' | 'anon' | 'signedIn';

export interface AuthState {
  status: AuthStatus;
  session: AuthSession | null;
  /** Sheet visibility — driven ONLY by gate()/dismiss()/verify success. */
  sheetOpen: boolean;
}

export interface AuthEngineOptions {
  cfg: SupabaseConfig;
  store: SessionStore;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** State change notifications (the React layer re-renders from these).
   *  Optional at construction — the provider attaches via setListener. */
  onChange?: (state: AuthState) => void;
}

export interface GateOptions {
  /** Called when the sheet is dismissed WITHOUT signing in, so the screen can
   *  say what did not happen ("Not saved — sign in to keep this drive").
   *  Before this hook the parked action vanished silently (device pass). */
  onDismiss?: () => void;
}

interface Pending {
  run: () => void;
  onDismiss?: () => void;
}

export class AuthEngine {
  private state: AuthState = { status: 'loading', session: null, sheetOpen: false };
  private pending: Pending | null = null;
  private listener: ((state: AuthState) => void) | null = null;

  constructor(private readonly opts: AuthEngineOptions) {}

  getState(): AuthState {
    return this.state;
  }

  /** The React provider (or a test) attaches here; replaces any previous. */
  setListener(fn: (state: AuthState) => void): void {
    this.listener = fn;
  }

  private set(next: Partial<AuthState>): void {
    this.state = { ...this.state, ...next };
    this.opts.onChange?.(this.state);
    this.listener?.(this.state);
  }

  /** Load the persisted session once at startup. An action gated while the
   *  read was still in flight is flushed here: run if the held session is
   *  good, else the sheet opens now (never earlier — a cold-start tap must not
   *  show the sign-in sheet to someone who IS signed in). */
  async init(): Promise<void> {
    const held = await this.opts.store.load();
    if (held === null) {
      this.set({ status: 'anon', session: null, sheetOpen: this.pending !== null });
      return;
    }
    this.set({ status: 'signedIn', session: held });
    const run = this.pending;
    this.pending = null;
    if (run) run.run();
  }

  /** FR-201: run now if signed in; else park the action and open the sheet
   *  (or, during the initial session read, park it and let init() decide). */
  gate(action: () => void, opts: GateOptions = {}): void {
    if (this.state.status === 'signedIn') {
      action();
      return;
    }
    this.pending = { run: action, ...(opts.onDismiss ? { onDismiss: opts.onDismiss } : {}) };
    if (this.state.status === 'loading') return;
    this.set({ sheetOpen: true });
  }

  /** Sheet dismissed without signing in — the parked action is dropped and
   *  its owner is told so it can say what did not happen. */
  dismissSheet(): void {
    const dropped = this.pending;
    this.pending = null;
    this.set({ sheetOpen: false });
    dropped?.onDismiss?.();
  }

  async sendCode(email: string): Promise<void> {
    await sendOtp(this.opts.cfg, email, this.opts.fetchImpl);
  }

  async verifyCode(email: string, code: string): Promise<void> {
    const session = await verifyOtp(this.opts.cfg, email, code, {
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(this.opts.now ? { now: this.opts.now } : {}),
    });
    await this.opts.store.save(session);
    this.set({ status: 'signedIn', session, sheetOpen: false });
    const run = this.pending;
    this.pending = null;
    if (run) run.run(); // exactly once, after the state is signed-in
  }

  /**
   * The access token for API calls, refreshed when stale. Returns null for
   * anonymous users AND when a refresh fails terminally (silent return to
   * anon — the next gated action re-prompts).
   */
  async freshAccessToken(): Promise<string | null> {
    const s = this.state.session;
    if (this.state.status !== 'signedIn' || s === null) return null;
    const nowS = this.opts.now ? this.opts.now() : Math.floor(Date.now() / 1000);
    if (!needsRefresh(s, nowS)) return s.accessToken;
    try {
      const next = await this.refresh(s.refreshToken);
      return next.accessToken;
    } catch (err) {
      // Terminal ONLY when GoTrue rejected the token itself (revoked, expired,
      // already used): 400 invalid_grant, 401, 403. A dead cell link, a 5xx or
      // a 429 keeps the session — signing out on those stranded a driver in
      // the car and made them redo the email code once signal returned
      // (review finding, 2026-09-07). Those are RETHROWN, never null: the
      // re-gate callers (`if (!token) gate(retry)`) would loop forever on a
      // null from a still-signed-in engine.
      const status = err instanceof AuthApiError ? err.status : null;
      if (status === 400 || status === 401 || status === 403) {
        // a stale loser never clears a session another caller already rotated
        if (this.state.session?.refreshToken === s.refreshToken) {
          await this.opts.store.clear();
          this.set({ status: 'anon', session: null });
        }
        return null;
      }
      throw new AuthApiError(
        status === 429
          ? 'Too many sign-in checks at once — wait a minute and try again.'
          : status !== null
            ? 'The sign-in service is having trouble — try again in a moment.'
            : err instanceof AuthApiError
              ? err.message
              : 'Could not reach the sign-in service — check your connection.',
        status,
        { cause: err },
      );
    }
  }

  /** In-flight refresh, keyed by the token it rotates. N screens refreshing
   *  on the same focus used to contend for one single-use refresh token; now
   *  they await ONE request (review finding). */
  private refreshing: { token: string; p: Promise<AuthSession> } | null = null;

  private refresh(refreshToken: string): Promise<AuthSession> {
    if (this.refreshing !== null && this.refreshing.token === refreshToken) {
      return this.refreshing.p;
    }
    const p = (async (): Promise<AuthSession> => {
      const next = await refreshSession(this.opts.cfg, refreshToken, {
        ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
        ...(this.opts.now ? { now: this.opts.now } : {}),
      });
      await this.opts.store.save(next);
      this.set({ session: next });
      return next;
    })();
    this.refreshing = { token: refreshToken, p };
    void p
      .finally(() => {
        if (this.refreshing?.p === p) this.refreshing = null;
      })
      .catch(() => undefined);
    return p;
  }

  async signOut(): Promise<void> {
    const s = this.state.session;
    if (s !== null) {
      void signOutRemote(this.opts.cfg, s.accessToken, this.opts.fetchImpl);
    }
    await this.opts.store.clear();
    this.pending = null;
    this.set({ status: 'anon', session: null, sheetOpen: false });
  }
}

/** The line a screen shows when `freshAccessToken()` THREW (a transient
 *  refresh failure — the session is still held, a retry is one tap away). */
export function sessionProblem(err: unknown): string {
  return err instanceof AuthApiError
    ? err.message
    : 'Could not reach the sign-in service — check your connection.';
}
