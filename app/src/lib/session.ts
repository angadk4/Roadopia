/**
 * Anonymous session identity (M7-T01).
 *
 * The backend's per-session rate limit keys on the `x-session-id` header
 * (backend/src/lib/rate_limit.ts — 3 plans/min per session). The id is a
 * PER-LAUNCH random UUID kept in memory:
 *   - not persisted (no storage dependency; anonymous sessions hold state
 *     client-side only, Spec §34/§51),
 *   - not security-sensitive (rate limiting is additionally per-IP server-side,
 *     so a client minting fresh ids gains nothing — the IP windows still bind),
 *   - Math.random is therefore acceptable here; this is NOT an auth token.
 */

function uuid4(): string {
  // RFC-4122 v4 shape from Math.random — adequate for a rate-limit key only.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Stable for the lifetime of this JS runtime (one app launch). */
export const sessionId: string = uuid4();

/** Exposed for tests (format checks) — production code uses `sessionId`. */
export { uuid4 as _uuid4ForTests };
