import { describe, expect, it } from 'vitest';

import { RateLimiter } from '../lib/rate_limit';
import { buildServer } from '../server';

import { MAX_BRIEF_CHARS } from './plan';

/**
 * R25-U16c — POST /parse: the browse-class rules parse the quick-fill chips
 * light up from. Deterministic, LLM-free, its own limiter; absent deps ⇒ 404
 * (the honest off state, /discover precedent).
 */

describe('POST /parse (R25-U16c)', () => {
  it('parses a brief with the RULES parser — deterministic, no LLM anywhere', async () => {
    const app = buildServer({ parse: {} });
    const res = await app.inject({
      method: 'POST',
      url: '/parse',
      payload: { brief: '90 minute loop from Hamilton, no highways, with a coffee stop' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      parser: string;
      constraints: {
        duration_target_s: number | null;
        shape: string;
        avoid: { highways: boolean };
        stops: Array<{ type: string }>;
      };
    };
    expect(body.parser).toBe('rules');
    expect(body.constraints.duration_target_s).toBe(5400);
    expect(body.constraints.shape).toBe('loop');
    expect(body.constraints.avoid.highways).toBe(true);
    expect(body.constraints.stops.some((s) => s.type === 'coffee')).toBe(true);
    // identical input → identical output (the chips can trust it while typing)
    const again = await app.inject({
      method: 'POST',
      url: '/parse',
      payload: { brief: '90 minute loop from Hamilton, no highways, with a coffee stop' },
    });
    expect(again.body).toBe(res.body);
  });

  it('bounds the brief (Hard rule K) and 404s when unwired', async () => {
    const app = buildServer({ parse: {} });
    const res = await app.inject({
      method: 'POST',
      url: '/parse',
      payload: { brief: 'x'.repeat(MAX_BRIEF_CHARS + 1) },
    });
    expect(res.statusCode).toBe(400);
    const bare = buildServer({});
    const off = await bare.inject({ method: 'POST', url: '/parse', payload: { brief: 'x' } });
    expect(off.statusCode).toBe(404); // absent deps = honest off state
  });

  it('rate-limits per IP with Retry-After (its own looser budget)', async () => {
    const app = buildServer({
      parse: { rateLimiter: new RateLimiter({ perIp: [{ limit: 2, windowMs: 60_000 }] }) },
    });
    const ok1 = await app.inject({ method: 'POST', url: '/parse', payload: { brief: 'a' } });
    const ok2 = await app.inject({ method: 'POST', url: '/parse', payload: { brief: 'b' } });
    const blocked = await app.inject({ method: 'POST', url: '/parse', payload: { brief: 'c' } });
    expect(ok1.statusCode).toBe(200);
    expect(ok2.statusCode).toBe(200);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
