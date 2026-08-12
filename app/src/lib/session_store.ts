/**
 * Persisted-session contract (M8-T01) — PURE module (node-testable).
 * The SecureStore-backed implementation lives in session_store_secure.ts
 * (the only file that imports expo-secure-store — runtime.ts isolation
 * pattern); tests and the engine use this interface.
 */

import type { AuthSession } from './auth';

export interface SessionStore {
  load(): Promise<AuthSession | null>;
  save(session: AuthSession): Promise<void>;
  clear(): Promise<void>;
}

export function isSession(v: unknown): v is AuthSession {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  const user = s['user'] as Record<string, unknown> | undefined;
  return (
    typeof s['accessToken'] === 'string' &&
    typeof s['refreshToken'] === 'string' &&
    typeof s['expiresAt'] === 'number' &&
    !!user &&
    typeof user['id'] === 'string'
  );
}

/** In-memory store for tests / node. */
export function memorySessionStore(initial: AuthSession | null = null): SessionStore {
  let held: AuthSession | null = initial;
  return {
    load: () => Promise.resolve(held),
    save: (s) => {
      held = s;
      return Promise.resolve();
    },
    clear: () => {
      held = null;
      return Promise.resolve();
    },
  };
}
