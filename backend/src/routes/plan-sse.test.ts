import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { AiClient, type Transport } from '../ai/client';
import { CostGuard } from '../ai/cost_guard';
import { MemoryLedger } from '../ai/ledger';
import { parsePoly } from '../lib/region';
import type { PlannerDeps } from '../planner/run';
import { buildServer } from '../server';

import { listen, okPlannerResult, postPlan, ROUTE_FIXTURE } from './sse_test_util';

/** M6-T04 AC: streams ordered events + returns a feasible route for the
 *  canonical brief; cancel halts spend. Every frame is schema-validated
 *  (sse_test_util) — an off-schema payload fails the suite (Hard rule I). */

const POLY = `p\n1\n  -81.85 44.95\n  -77.60 44.95\n  -77.60 42.55\n  -81.85 42.55\n  -81.85 44.95\nEND\nEND\n`;
const region = parsePoly(POLY, 'south-central-ontario');
const VALHALLA_URL = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const DUMMY_DB = {} as unknown as Client;

function baseDeps(overrides: Record<string, unknown> = {}) {
  const ledger = new MemoryLedger();
  return {
    ledger,
    deps: {
      db: DUMMY_DB,
      valhallaUrl: VALHALLA_URL,
      region,
      aiClient: null,
      guard: null,
      ledger,
      logFn: async () => '7f4640a2-93a4-4f04-9631-2f9e4c7ad001',
      ...overrides,
    },
  };
}

describe('POST /plan SSE (M6-T04)', () => {
  it('streams parse → planner events → route → explanation → done, in order', async () => {
    const { deps } = baseDeps({
      planFn: async (_c: unknown, d: PlannerDeps) => {
        d.onEvent?.({ type: 'step', step: 'scope', status: 'started' });
        d.onEvent?.({ type: 'tool_call', tool: 'get_isochrone' });
        d.onEvent?.({ type: 'step', step: 'scope', status: 'completed' });
        return okPlannerResult();
      },
    });
    const app = buildServer({ plan: deps as never });
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, {
        brief: '90 minute twisty loop',
        origin: { lat: 43.2557, lng: -79.8711 },
      });
      expect(run.status).toBe(200);

      const types = run.events.map((e) =>
        e.type === 'step' ? `${e.type}:${e.step}:${e.status}` : e.type,
      );
      const idx = (t: string) => types.findIndex((x) => x.startsWith(t));
      expect(idx('step:parse:started')).toBe(0);
      expect(idx('step:parse:completed')).toBeGreaterThan(idx('step:parse:started'));
      expect(idx('step:scope:started')).toBeGreaterThan(idx('step:parse:completed'));
      expect(idx('step:explain:started')).toBeGreaterThan(idx('step:scope:completed'));
      expect(idx('route')).toBeGreaterThan(idx('step:explain:completed'));
      expect(idx('explanation')).toBeGreaterThan(idx('route'));
      expect(types[types.length - 1]).toBe('done');

      const routeEvent = run.events.find((e) => e.type === 'route');
      expect(routeEvent && routeEvent.type === 'route' && routeEvent.route.distance_m).toBe(
        ROUTE_FIXTURE.distance_m,
      );
      const done = run.events[run.events.length - 1];
      expect(done?.type === 'done' && done.status).toBe('ok');
    } finally {
      await close();
    }
  });

  it('client cancel mid-run: the loop observes the abort and NO model spend follows', async () => {
    let sawAbort = false;
    let explainCalls = 0;
    const { deps } = baseDeps({
      planFn: async (_c: unknown, d: PlannerDeps) => {
        d.onEvent?.({ type: 'step', step: 'scope', status: 'started' });
        // simulate a long run: wait until the disconnect propagates
        for (let i = 0; i < 100 && !d.signal?.aborted; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        sawAbort = d.signal?.aborted ?? false;
        return okPlannerResult();
      },
      explainFn: async () => {
        explainCalls++;
        return { text: 'x', satisfied: [], relaxed: [], source: 'template' as const };
      },
    });
    const app = buildServer({ plan: deps as never });
    const { port, close } = await listen(app);
    try {
      // abort as soon as the first frames arrive
      await postPlan(
        port,
        { brief: 'looping', origin: { lat: 43.2557, lng: -79.8711 } },
        { abortAfterEvents: 2 },
      );
      // give the server loop a beat to observe the closed socket
      await new Promise((r) => setTimeout(r, 400));
      expect(sawAbort).toBe(true); // the planner loop stopped early
      expect(explainCalls).toBe(0); // zero explanation spend after cancel
    } finally {
      await close();
    }
  });
});

describe('canonical brief end-to-end (real db + Valhalla; AI transport canned — $0)', () => {
  const db = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  let dbUp = false;
  afterAll(async () => {
    if (dbUp) {
      await db.query(`delete from ai_generation_requests where brief like 'M6T04 canonical%'`);
      await db.end();
    }
  });

  it(
    'streams a real generation: parse(llm) → …deterministic pipeline… → feasible route + FR-049 row',
    { timeout: 120_000 },
    async (ctx) => {
      try {
        const ping = await fetch(`${VALHALLA_URL}/status`, { signal: AbortSignal.timeout(1500) });
        if (!ping.ok) return ctx.skip();
        await db.connect();
        dbUp = true;
      } catch {
        return ctx.skip();
      }

      // canned Haiku output — real prompt path, zero live spend
      const parsed = {
        origin: 'Hamilton',
        destination: null,
        shape: 'loop',
        duration_target_s: 5400,
        distance_target_m: null,
        stops: [{ type: 'coffee', count: 1, importance: 'nice_to_have' }],
        avoid: { highways: true, tolls: false, ferries: false, unpaved: false },
        surface_pref: 'any',
        character: ['twisty'],
        scenic_pref: null,
        twistiness_pref: 0.7,
        intensity: null,
        preset: null,
        location_constraints: [],
        ambiguous_terms: [],
        missing: [],
        contradictions: [],
        confidence_overall: 0.92,
        clarification: { needed: false, question: null },
        unsafe_flag: false,
        out_of_region_flag: false,
        prompt_injection_flag: false,
      };
      const transport: Transport = async (req) => ({
        // parse gets valid constraints; the explain call gets the same text,
        // fails its schema → deterministic template fallback (still honest)
        text: JSON.stringify(parsed),
        inputTokens: 500,
        outputTokens: 150,
        cacheReadTokens: 0,
        ...(req ? {} : {}),
      });
      const ledger = new MemoryLedger();
      const guard = new CostGuard({ ledger });
      const aiClient = new AiClient({ guard, transport });

      const app = buildServer({
        plan: { db, valhallaUrl: VALHALLA_URL, region, aiClient, guard, ledger },
      });
      const { port, close } = await listen(app);
      try {
        const run = await postPlan(port, {
          brief:
            'M6T04 canonical: 90 minute twisty loop from Hamilton with a coffee stop, no highways',
        });
        expect(run.status).toBe(200);

        const types = run.events.map((e) => e.type);
        expect(types).toContain('route');
        expect(types).toContain('explanation');
        const stepNames = run.events
          .filter((e) => e.type === 'step')
          .map((e) => (e.type === 'step' ? e.step : ''));
        for (const s of ['parse', 'scope', 'retrieve', 'generate_candidates', 'route_candidates']) {
          expect(stepNames).toContain(s);
        }
        const parseDone = run.events.find(
          (e) => e.type === 'step' && e.step === 'parse' && e.status === 'completed',
        );
        expect(parseDone?.type === 'step' && parseDone.detail).toBe('parser=llm');

        const routeEvent = run.events.find((e) => e.type === 'route');
        expect(routeEvent?.type === 'route' && routeEvent.route.distance_m).toBeGreaterThan(10_000);
        expect(routeEvent?.type === 'route' && routeEvent.route.highway_flag).toBe(false);

        const done = run.events[run.events.length - 1];
        expect(done?.type === 'done' && ['ok', 'relaxed', 'best_so_far']).toContain(
          done?.type === 'done' ? done.status : '',
        );

        // FR-049: the generation row landed with real cost + status
        const rows = await db.query<{ status: string; token_cost_usd: number; iterations: number }>(
          `select status, token_cost_usd, iterations from ai_generation_requests
           where brief like 'M6T04 canonical%' order by created_at desc limit 1`,
        );
        expect(rows.rowCount).toBe(1);
        expect(['ok', 'relaxed']).toContain(rows.rows[0]!.status);
        expect(Number(rows.rows[0]!.token_cost_usd)).toBeGreaterThan(0);
        expect(rows.rows[0]!.iterations).toBeGreaterThanOrEqual(1);
      } finally {
        await close();
      }
    },
  );
});
