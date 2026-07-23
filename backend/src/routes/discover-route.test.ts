import type { DiscoverResult } from '@shared/types';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { RateLimiter } from '../lib/rate_limit';
import { parsePoly } from '../lib/region';
import { buildServer } from '../server';

/** R23-U5 — the POST /discover endpoint (region-guarded; off ⇒ 404). */

const POLY = `p\n1\n  -81.85 44.95\n  -77.60 44.95\n  -77.60 42.55\n  -81.85 42.55\n  -81.85 44.95\nEND\nEND\n`;
const region = parsePoly(POLY, 'south-central-ontario');

const FAKE: DiscoverResult = {
  drives: [
    {
      segmentId: 'x',
      name: 'Test Road',
      entry: { lat: 43.5, lng: -80.0 },
      exit: { lat: 43.51, lng: -80.01 },
      curviness: 1.5,
      length_m: 3000,
      class: 'tertiary',
      urbanShare: 0,
      driveTimeToStartS: 1200,
      driveTimeToStartM: 20000,
      roadTraverseS: 284,
      suggestedDurationS: 4000,
      score: 4500,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-80.0, 43.5],
          [-80.01, 43.51],
        ],
      },
    },
  ],
  reachMinutes: 60,
  disclosures: [],
};

function appWith(overrides: Record<string, unknown> = {}) {
  return buildServer({
    discover: {
      db: {} as unknown as Client,
      valhallaUrl: 'http://127.0.0.1:8002',
      region,
      discoverFn: async () => FAKE,
      ...overrides,
    } as never,
  });
}

const ORIGIN = { lat: 43.5, lng: -80.0 };

describe('POST /discover (R23-U5)', () => {
  it('in-region origin → 200 with the DiscoverResult menu', async () => {
    const app = appWith();
    const res = await app.inject({ method: 'POST', url: '/discover', payload: { origin: ORIGIN } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DiscoverResult;
    expect(body.reachMinutes).toBe(60);
    expect(body.drives).toHaveLength(1);
    expect(body.drives[0]!.name).toBe('Test Road');
  });

  it('out-of-region origin → 400 out_of_region', async () => {
    const app = appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/discover',
      payload: { origin: { lat: 40, lng: -100 } },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('out_of_region');
  });

  it('malformed body → 400 (Fastify schema)', async () => {
    const app = appWith();
    const res = await app.inject({ method: 'POST', url: '/discover', payload: { foo: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it('pipeline failure → 503 discover_unavailable (friendly, never a stack)', async () => {
    const app = appWith({
      discoverFn: async () => {
        throw new Error('valhalla down: secret 127.0.0.1');
      },
    });
    const res = await app.inject({ method: 'POST', url: '/discover', payload: { origin: ORIGIN } });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('discover_unavailable');
    expect(body.error.message).not.toContain('secret'); // never internals
  });

  it('NOT registered when deps absent → 404 (byte-identical off)', async () => {
    const app = buildServer({}); // no discover deps
    const res = await app.inject({ method: 'POST', url: '/discover', payload: { origin: ORIGIN } });
    expect(res.statusCode).toBe(404);
  });

  it('reuses the rate limiter: a burst is 429', async () => {
    let now = 1_000_000;
    const app = appWith({ rateLimiter: new RateLimiter({ now: () => now }) });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      now += 1000;
      const res = await app.inject({
        method: 'POST',
        url: '/discover',
        payload: { origin: ORIGIN },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    expect(codes[6]).toBe(429);
  });
});
