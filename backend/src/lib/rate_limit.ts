/**
 * Anonymous rate limiting (SPK-14 + M6-T05; FR-204 "Anonymous /plan calls
 * MUST be rate-limited (per-IP + per-session)"; §38/§49.3/§57).
 *
 * In-house sliding-window limiter — no new dependency (Build Contract §5).
 * In-memory is correct for the single-instance VPS deployment (§45); if the
 * backend is ever replicated (§64), this needs a shared store — recorded
 * limitation, not an accident.
 *
 * Numbers are "measured" tunables per §91 (no spec defaults). Initial
 * values, sized so the hero demo flows and a burst can't burn budget
 * (SPK-14 measure): per-IP 6/min + 30/hour; per-session 3/min. At worst
 * (~3¢/generation, SPK-19 envelope) one IP ≤ $0.90/h ≪ the $30 cap.
 */

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the earliest blocked window frees up (429 Retry-After). */
  retryAfterS: number;
}

export const PER_IP_RULES: RateLimitRule[] = [
  { limit: 6, windowMs: 60_000 },
  { limit: 30, windowMs: 3_600_000 },
];
export const PER_SESSION_RULES: RateLimitRule[] = [{ limit: 3, windowMs: 60_000 }];

/** Cap on tracked keys — an abuse guard must not become a memory leak. */
const MAX_KEYS = 10_000;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly opts: {
      perIp?: RateLimitRule[];
      perSession?: RateLimitRule[];
      now?: () => number;
    } = {},
  ) {}

  private judge(key: string, rules: RateLimitRule[], now: number): RateLimitDecision {
    const maxWindow = Math.max(...rules.map((r) => r.windowMs));
    const kept = (this.hits.get(key) ?? []).filter((t) => now - t < maxWindow);

    let retryAfterS = 0;
    for (const rule of rules) {
      const inWindow = kept.filter((t) => now - t < rule.windowMs);
      if (inWindow.length >= rule.limit) {
        const oldest = Math.min(...inWindow);
        retryAfterS = Math.max(retryAfterS, Math.ceil((rule.windowMs - (now - oldest)) / 1000));
      }
    }
    if (retryAfterS > 0) {
      this.hits.set(key, kept); // pruned, NOT counting the rejected attempt
      return { allowed: false, retryAfterS };
    }

    kept.push(now);
    if (this.hits.size >= MAX_KEYS && !this.hits.has(key)) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
    this.hits.set(key, kept);
    return { allowed: true, retryAfterS: 0 };
  }

  /** Both limits must pass; the tighter Retry-After wins on rejection. */
  check(ip: string, sessionId: string | null): RateLimitDecision {
    const now = this.opts.now ? this.opts.now() : Date.now();
    const ipDecision = this.judge(`ip:${ip}`, this.opts.perIp ?? PER_IP_RULES, now);
    if (!ipDecision.allowed) return ipDecision;
    if (sessionId) {
      const s = this.judge(`session:${sessionId}`, this.opts.perSession ?? PER_SESSION_RULES, now);
      if (!s.allowed) return s;
    }
    return { allowed: true, retryAfterS: 0 };
  }
}
