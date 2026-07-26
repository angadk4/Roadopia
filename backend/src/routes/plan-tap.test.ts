import type { ParsedConstraints } from '@shared/types';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { MemoryLedger } from '../ai/ledger';
import { parsePoly } from '../lib/region';
import { buildServer } from '../server';

import { okPlannerResult } from './sse_test_util';

/**
 * R23-U0 — the discovery TAP contract on POST /plan. A tapped drive is an
 * ordinary /plan loop request carrying a structured 'through <road>' pin (with
 * a near_point disambiguation hint) + the computed loop budget. This proves the
 * body accepts + validates + merges those two fields, and that omitting them is
 * byte-identical to a normal Plan request (BD-40).
 */

const POLY = `p\n1\n  -81.85 44.95\n  -77.60 44.95\n  -77.60 42.55\n  -81.85 42.55\n  -81.85 44.95\nEND\nEND\n`;
const region = parsePoly(POLY, 'south-central-ontario');

/** A server whose stubs capture the constraints / out-and-back spec handed in. */
function appCapturing() {
  let seen: ParsedConstraints | null = null;
  let seenOab: { entry: unknown; exit: unknown; name: string } | null = null;
  const app = buildServer({
    plan: {
      db: {} as unknown as Client,
      valhallaUrl: 'http://127.0.0.1:8002',
      region,
      aiClient: null, // → deterministic rules parser
      guard: null,
      ledger: new MemoryLedger(),
      logFn: async () => null,
      planFn: async (constraints: ParsedConstraints) => {
        seen = constraints;
        return okPlannerResult();
      },
      outAndBackFn: async (_origin: unknown, spec: typeof seenOab) => {
        seenOab = spec;
        return okPlannerResult();
      },
    } as never,
  });
  return { app, seen: () => seen, seenOab: () => seenOab };
}

const ORIGIN = { lat: 43.25, lng: -79.87 }; // Hamilton area, in region
const NEAR = { lat: 43.73, lng: -79.94 }; // Forks of the Credit area, in region

describe('/plan discovery tap contract (R23-U0)', () => {
  it('accepts a through-pin + near_point + duration_target_s and merges them (buttons win)', async () => {
    const { app, seen } = appCapturing();
    const res = await app.inject({
      method: 'POST',
      url: '/plan',
      payload: {
        brief: 'Loop through Forks of the Credit',
        origin: ORIGIN,
        shape: 'loop',
        preset: 'backroads',
        location_constraints: [{ kind: 'through', text: 'Forks of the Credit', near_point: NEAR }],
        duration_target_s: 7000,
      },
    });
    expect(res.statusCode).toBe(200);
    const c = seen()!;
    // the structured pin REPLACES whatever the brief parsed, carrying near_point
    expect(c.location_constraints).toEqual([
      { kind: 'through', text: 'Forks of the Credit', near_point: NEAR },
    ]);
    // the computed budget overrides the parsed/brief duration
    expect(c.duration_target_s).toBe(7000);
  });

  it('rejects a duration_target_s outside the tap clamp [2700, 9000] (Hard rule K)', async () => {
    const { app } = appCapturing();
    for (const bad of [100, 20_000]) {
      const res = await app.inject({
        method: 'POST',
        url: '/plan',
        payload: { brief: 'x', origin: ORIGIN, duration_target_s: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('rejects a non-through kind in the structured pins (tap pins by traversal only)', async () => {
    const { app } = appCapturing();
    const res = await app.inject({
      method: 'POST',
      url: '/plan',
      payload: {
        brief: 'x',
        origin: ORIGIN,
        location_constraints: [{ kind: 'near', text: 'Elora' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('region-checks a near_point (Hard rule K — coords arriving in the body)', async () => {
    const { app } = appCapturing();
    const res = await app.inject({
      method: 'POST',
      url: '/plan',
      payload: {
        brief: 'x',
        origin: ORIGIN,
        location_constraints: [
          { kind: 'through', text: 'Somewhere', near_point: { lat: 40, lng: -100 } },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('out_of_region');
  });

  it('an out_and_back tap builds a direct out-and-back (far-drive shape), not a plan run', async () => {
    const { app, seen, seenOab } = appCapturing();
    const res = await app.inject({
      method: 'POST',
      url: '/plan',
      payload: {
        brief: 'Out and back to Hockley Road',
        origin: ORIGIN,
        out_and_back: { entry: NEAR, exit: { lat: 43.74, lng: -79.95 }, name: 'Hockley Road' },
      },
    });
    expect(res.statusCode).toBe(200);
    // the out-and-back builder ran; the loop planner did NOT
    expect(seenOab()?.name).toBe('Hockley Road');
    expect(seen()).toBeNull();
  });

  it('R25-U11: an out_and_back tap NEVER spends an LLM call on its synthetic brief', async () => {
    // audit-v11: every Discover tap paid a Haiku parse whose output the
    // out-and-back branch discarded whole. Pin the fix: with a live aiClient,
    // the tap's PARSE must not touch it (parse LLM calls counted before the
    // planner runs; the explain path after the route is separate, legitimate
    // narration spend and not what this pins).
    let parsePhase = true;
    let parseLlmCalls = 0;
    const app = buildServer({
      plan: {
        db: {} as unknown as Client,
        valhallaUrl: 'http://127.0.0.1:8002',
        region,
        aiClient: {
          call: async () => {
            if (parsePhase) parseLlmCalls++;
            return { text: '{}' };
          },
        },
        guard: null,
        ledger: new MemoryLedger(),
        logFn: async () => null,
        planFn: async () => okPlannerResult(),
        outAndBackFn: async () => {
          parsePhase = false; // anything after this is explain spend, not parse
          return okPlannerResult();
        },
      } as never,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/plan',
      payload: {
        brief: 'Out and back to Hockley Road',
        origin: ORIGIN,
        out_and_back: { entry: NEAR, exit: { lat: 43.74, lng: -79.95 }, name: 'Hockley Road' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(parseLlmCalls).toBe(0);
    // the honest breadcrumb is on the wire too
    expect(res.body).toContain('oab: no LLM spend');
  });

  it('region-checks the out_and_back endpoints (Hard rule K)', async () => {
    const { app } = appCapturing();
    const res = await app.inject({
      method: 'POST',
      url: '/plan',
      payload: {
        brief: 'x',
        origin: ORIGIN,
        out_and_back: { entry: { lat: 40, lng: -100 }, exit: NEAR, name: 'Somewhere' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('out_of_region');
  });

  it('omitting the tap fields leaves parsed constraints untouched (BD-40 byte-identical)', async () => {
    const { app, seen } = appCapturing();
    const res = await app.inject({
      method: 'POST',
      url: '/plan',
      payload: { brief: '90 minute loop', origin: ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    const c = seen()!;
    // no through-pin injected, and the duration stays the brief-parsed number
    expect(c.location_constraints).toEqual([]);
    expect(typeof c.duration_target_s).toBe('number');
    expect(c.duration_target_s).not.toBe(7000);
  });
});

describe('buttons-win precedence (R23 AI-minimal)', () => {
  it('a button preset overrides the brief-parsed preset', async () => {
    const { app, seen } = appCapturing();
    // the brief alone parses preset 'backroads'; the button sends 'simple'
    const res = await app.inject({
      method: 'POST',
      url: '/plan',
      payload: { brief: 'a backroads loop', origin: ORIGIN, preset: 'simple' },
    });
    expect(res.statusCode).toBe(200);
    expect(seen()?.preset).toBe('simple'); // button beats the prompt
  });

  it('an untouched avoid toggle never clears a brief-parsed avoid (per-key merge)', async () => {
    const { app, seen } = appCapturing();
    const res = await app.inject({
      method: 'POST',
      url: '/plan',
      payload: { brief: 'a loop with no highways', origin: ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    expect(seen()?.avoid.highways).toBe(true); // the prompt fills a gap the buttons didn't set
  });
});
