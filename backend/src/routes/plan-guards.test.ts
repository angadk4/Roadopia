import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { CostGuard } from '../ai/cost_guard';
import { MemoryLedger } from '../ai/ledger';
import { RateLimiter } from '../lib/rate_limit';
import { parsePoly } from '../lib/region';
import { buildServer } from '../server';

import { okPlannerResult } from './sse_test_util';

/** M6-T05 AC: abusive bursts limited; cap-hit degrades; kill switch disables.
 *  These runs are ALSO the SPK-14 evidence: "abusive bursts blocked; normal
 *  use unaffected" (Dependency Verification §21). */

const POLY = `p\n1\n  -81.85 44.95\n  -77.60 44.95\n  -77.60 42.55\n  -81.85 42.55\n  -81.85 44.95\nEND\nEND\n`;
const region = parsePoly(POLY, 'south-central-ontario');

function appWith(overrides: Record<string, unknown>) {
  let planCalls = 0;
  const app = buildServer({
    plan: {
      db: {} as unknown as Client,
      valhallaUrl: 'http://127.0.0.1:8002',
      region,
      aiClient: null,
      guard: null,
      ledger: new MemoryLedger(),
      logFn: async () => null,
      planFn: async () => {
        planCalls++;
        return okPlannerResult();
      },
      ...overrides,
    } as never,
  });
  return { app, planCalls: () => planCalls };
}

const BODY = { brief: 'twisty loop', origin: { lat: 43.2557, lng: -79.8711 } };

describe('/plan guards (M6-T05 + SPK-14)', () => {
  it('SPK-14 burst: 6/min per IP pass, the 7th is 429 with Retry-After', async () => {
    let now = 1_000_000;
    const { app } = appWith({
      rateLimiter: new RateLimiter({ now: () => now }),
    });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      now += 1000; // 1s apart — an abusive burst
      const res = await app.inject({ method: 'POST', url: '/plan', payload: BODY });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    const seventh = await app.inject({ method: 'POST', url: '/plan', payload: BODY });
    expect(seventh.statusCode).toBe(429);
    expect(Number(seventh.headers['retry-after'])).toBeGreaterThan(0);
    expect((seventh.json() as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('SPK-14 normal use: demo cadence (one plan every ~90s) is never limited', async () => {
    let now = 1_000_000;
    const { app } = appWith({ rateLimiter: new RateLimiter({ now: () => now }) });
    for (let i = 0; i < 12; i++) {
      now += 90_000;
      const res = await app.inject({ method: 'POST', url: '/plan', payload: BODY });
      expect(res.statusCode).toBe(200);
    }
  });

  it('per-session limit binds tighter than per-IP (3/min on one session)', async () => {
    let now = 2_000_000;
    const { app } = appWith({ rateLimiter: new RateLimiter({ now: () => now }) });
    const post = (session: string) =>
      app.inject({
        method: 'POST',
        url: '/plan',
        payload: BODY,
        headers: { 'x-session-id': session },
      });
    for (let i = 0; i < 3; i++) {
      now += 1000;
      expect((await post('sess-a')).statusCode).toBe(200);
    }
    now += 1000;
    expect((await post('sess-a')).statusCode).toBe(429); // 4th on the session
    expect((await post('sess-b')).statusCode).toBe(200); // same IP, new session, IP still under 6/min
  });

  it('kill switch → 503 planner_disabled; the planner is NEVER invoked (FR-262)', async () => {
    const { app, planCalls } = appWith({ killSwitch: () => true });
    const res = await app.inject({ method: 'POST', url: '/plan', payload: BODY });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('planner_disabled');
    expect(body.error.message).toContain('still work'); // rest-of-app honesty (§18)
    expect(planCalls()).toBe(0);
  });

  it('hard-cap hit → 503 spend_cap_reached; zero further spend (FR-260/261)', async () => {
    const ledger = new MemoryLedger();
    ledger.append({
      at: new Date().toISOString(),
      model: 'claude-sonnet-4-6',
      promptId: 'explain',
      promptVersion: 1,
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      costUsd: 31, // month spend already past the $30 hard cap
      latencyMs: 1,
      ok: true,
    });
    const guard = new CostGuard({ ledger });
    const { app, planCalls } = appWith({ guard, ledger });
    const res = await app.inject({ method: 'POST', url: '/plan', payload: BODY });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('spend_cap_reached');
    expect(planCalls()).toBe(0);
  });
});
