import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { AiClient } from '../ai/client';
import { CostGuard } from '../ai/cost_guard';
import { MemoryLedger } from '../ai/ledger';
import { parsePoly } from '../lib/region';
import { buildServer } from '../server';

import { listen, okPlannerResult, postPlan } from './sse_test_util';

/** M6-T06 AC: simulated Valhalla/Anthropic outages yield an HONEST degraded
 *  response — never a 500, never a raw error, never a fake route (§40/§18). */

const POLY = `p\n1\n  -81.85 44.95\n  -77.60 44.95\n  -77.60 42.55\n  -81.85 42.55\n  -81.85 44.95\nEND\nEND\n`;
const region = parsePoly(POLY, 'south-central-ontario');
const DEAD_VALHALLA = 'http://127.0.0.1:19999'; // nothing listens here

const BODY = { brief: '90 minute twisty loop', origin: { lat: 43.2557, lng: -79.8711 } };

function appWith(overrides: Record<string, unknown> = {}) {
  return buildServer({
    plan: {
      db: {} as unknown as Client,
      valhallaUrl: DEAD_VALHALLA,
      region,
      aiClient: null,
      guard: null,
      ledger: new MemoryLedger(),
      logFn: async () => null,
      ...overrides,
    } as never,
  });
}

describe('/plan degradation ladder (M6-T06)', () => {
  it('Valhalla outage → honest unavailable done-event over HTTP 200; no raw error, no fake route', async () => {
    // REAL runPlanner against a dead engine — the first isochrone call fails
    const app = appWith();
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, BODY);
      expect(run.status).toBe(200); // the stream itself, never a 500
      const types = run.events.map((e) => e.type);
      expect(types).toContain('error');
      expect(types).not.toContain('route'); // no fake route, ever
      const done = run.events[run.events.length - 1];
      expect(done?.type === 'done' && done.status).toBe('unavailable');
      const err = run.events.find((e) => e.type === 'error');
      const message = err?.type === 'error' ? err.message : '';
      expect(message).toContain('temporarily unavailable');
      expect(message).not.toMatch(/fetch|ECONN|stack|Error:/); // no internals
      expect(run.rawText).not.toContain('    at '); // no stack frames anywhere
    } finally {
      await close();
    }
  });

  it('Anthropic outage → rules parse + template explanation, route still delivered', async () => {
    const guard = new CostGuard({ ledger: new MemoryLedger() });
    const aiClient = new AiClient({
      guard,
      transport: async () => {
        throw new Error('ANTHROPIC DOWN (simulated)');
      },
    });
    const app = appWith({
      aiClient,
      planFn: async () => okPlannerResult(),
    });
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, BODY);
      const parseDone = run.events.find(
        (e) => e.type === 'step' && e.step === 'parse' && e.status === 'completed',
      );
      expect(parseDone?.type === 'step' && parseDone.detail).toBe('parser=rules'); // honest fallback
      const explainDone = run.events.find(
        (e) => e.type === 'step' && e.step === 'explain' && e.status === 'completed',
      );
      expect(explainDone?.type === 'step' && explainDone.detail).toBe('source=template');
      expect(run.events.some((e) => e.type === 'route')).toBe(true); // planner unaffected
      expect(run.rawText).not.toContain('ANTHROPIC DOWN'); // outage detail never leaks
    } finally {
      await close();
    }
  });

  it('unsafe (racing-framed) brief → refusal message + done unavailable; nothing routed', async () => {
    const app = appWith(); // real planner; refusal short-circuits before any engine call
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, {
        brief: 'plan me a route to beat my lap time record',
        origin: { lat: 43.2557, lng: -79.8711 },
      });
      const types = run.events.map((e) => e.type);
      expect(types).toContain('error');
      expect(types).not.toContain('route');
      const done = run.events[run.events.length - 1];
      expect(done?.type === 'done' && done.status).toBe('unavailable');
    } finally {
      await close();
    }
  });

  it('an unexpected planner crash still ends as a friendly stream, not a 500', async () => {
    const app = appWith({
      planFn: async () => {
        throw new Error('secret stack detail: db password in trace');
      },
    });
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, BODY);
      expect(run.status).toBe(200);
      const done = run.events[run.events.length - 1];
      expect(done?.type === 'done' && done.status).toBe('unavailable');
      expect(run.rawText).not.toContain('secret stack detail');
    } finally {
      await close();
    }
  });

  it('out-of-region origin never starts a stream: 400 JSON with the friendly redirect', async () => {
    const app = appWith();
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, {
        brief: 'loop please',
        origin: { lat: 45.4215, lng: -75.6972 }, // Ottawa
      });
      expect(run.status).toBe(400);
      expect(run.rawText).toContain('out_of_region');
      expect(run.rawText).toContain('south-central Ontario');
    } finally {
      await close();
    }
  });
});
