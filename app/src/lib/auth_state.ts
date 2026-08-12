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

export class AuthEngine {
  private state: AuthState = { status: 'loading', session: null, sheetOpen: false };
  private pending: (() => void) | null = null;
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

  /** Load the persisted session once at startup. */
  async init(): Promise<void> {
    const held = await this.opts.store.load();
    if (held === null) {
      this.set({ status: 'anon', session: null });
      return;
    }
    this.set({ status: 'signedIn', session: held });
  }

  /** FR-201: run now if signed in; else park the action and open the sheet. */
  gate(action: () => void): void {
    if (this.state.status === 'signedIn') {
      action();
      return;
    }
    this.pending = action;
    this.set({ sheetOpen: true });
  }

  /** Sheet dismissed without signing in — the parked action is dropped. */
  dismissSheet(): void {
    this.pending = null;
    this.set({ sheetOpen: false });
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
    if (run) run(); // exactly once, after the state is signed-in
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
      const next = await refreshSession(this.opts.cfg, s.refreshToken, {
        ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
        ...(this.opts.now ? { now: this.opts.now } : {}),
      });
      await this.opts.store.save(next);
      this.set({ session: next });
      return next.accessToken;
    } catch {
      await this.opts.store.clear();
      this.set({ status: 'anon', session: null });
      return null;
    }
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
