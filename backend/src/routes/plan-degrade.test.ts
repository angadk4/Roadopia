import { validateParsedConstraints } from '@shared/types';
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

  it('client preset chip reaches the planner as constraints.preset (M7-T03 additive field)', async () => {
    let seen: { preset?: string | null; weights?: Record<string, number> | null } | null = null;
    const app = appWith({
      planFn: async (constraints: {
        preset?: string | null;
        weights?: Record<string, number> | null;
      }) => {
        seen = constraints;
        return okPlannerResult();
      },
    });
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, { ...BODY, preset: 'twisty', weights: { cur: 0.9 } });
      expect(run.status).toBe(200);
      expect(seen).not.toBeNull();
      expect(seen!.preset).toBe('twisty'); // chip overrides the parsed guess
      expect(seen!.weights).toEqual({ cur: 0.9 }); // explicit weights still win key-by-key
    } finally {
      await close();
    }
  });

  it('an unknown preset value is rejected by schema validation (400, never the planner)', async () => {
    const app = appWith();
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, { ...BODY, preset: 'fastest' } as never);
      expect(run.status).toBe(400);
      expect(run.rawText).toContain('bad_request');
    } finally {
      await close();
    }
  });

  it('refine round-trip: follow-up merges deterministically, planner gets c-prime, stream shows refine-merge + constraints event (M7-T07)', async () => {
    const previous = validateParsedConstraints({
      origin: { lat: 43.2557, lng: -79.8711 },
      destination: null,
      shape: 'loop',
      duration_target_s: 5400,
      distance_target_m: null,
      stops: [{ type: 'coffee', count: 1, importance: 'required' }],
      avoid: { highways: true, tolls: false, ferries: false, unpaved: false },
      surface_pref: 'paved',
      character: ['twisty'],
      scenic_pref: null,
      twistiness_pref: 0.7,
      intensity: null,
      preset: null,
      weights: null,
      location_constraints: [],
      ambiguous_terms: [],
      missing: [],
      contradictions: [],
      confidence: { overall: 0.9, fields: {} },
      clarification: { needed: false, question: null },
      unsafe_flag: false,
      out_of_region_flag: false,
      prompt_injection_flag: false,
    });
    let seen: { duration_target_s?: number | null; avoid?: { highways?: boolean } } | null = null;
    const app = appWith({
      planFn: async (constraints: typeof seen) => {
        seen = constraints;
        return okPlannerResult();
      },
    });
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, {
        brief: 'make it longer',
        constraints: previous,
        followUp: 'make it longer',
      } as never);
      expect(run.status).toBe(200);
      expect(seen!.duration_target_s).toBe(5400 + 1080); // RF6: +20% step
      expect(seen!.avoid?.highways).toBe(true); // hard constraints persist (§34)
      const parseDone = run.events.find(
        (e) => e.type === 'step' && e.step === 'parse' && e.status === 'completed',
      );
      expect(parseDone?.type === 'step' && parseDone.detail).toBe('refine-merge'); // zero LLM spend
      const cEvent = run.events.find((e) => e.type === 'constraints');
      expect(cEvent?.type === 'constraints' && cEvent.constraints.duration_target_s).toBe(6480);
      // the wire c the client re-sends next turn must keep hard constraints (§34)
      expect(cEvent?.type === 'constraints' && cEvent.constraints.avoid.highways).toBe(true);
      expect(
        cEvent?.type === 'constraints' &&
          cEvent.constraints.stops.some((st) => st.importance === 'required'),
      ).toBe(true);
    } finally {
      await close();
    }
  });

  it('an unrecognizable follow-up is an honest no-op: error + done unavailable, planner never runs', async () => {
    const previous = validateParsedConstraints({
      origin: { lat: 43.2557, lng: -79.8711 },
      destination: null,
      shape: 'loop',
      duration_target_s: 5400,
      distance_target_m: null,
      stops: [],
      avoid: { highways: false, tolls: false, ferries: false, unpaved: false },
      surface_pref: 'any',
      character: [],
      scenic_pref: null,
      twistiness_pref: null,
      intensity: null,
      preset: null,
      weights: null,
      location_constraints: [],
      ambiguous_terms: [],
      missing: [],
      contradictions: [],
      confidence: { overall: 0.9, fields: {} },
      clarification: { needed: false, question: null },
      unsafe_flag: false,
      out_of_region_flag: false,
      prompt_injection_flag: false,
    });
    let plannerRan = false;
    const app = appWith({
      planFn: async () => {
        plannerRan = true;
        return okPlannerResult();
      },
    });
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, {
        brief: 'x',
        constraints: previous,
        followUp: 'purple monkey dishwasher',
      } as never);
      expect(run.status).toBe(200);
      expect(plannerRan).toBe(false);
      const err = run.events.find((e) => e.type === 'error');
      expect(err?.type === 'error' && err.message).toContain("couldn't apply that follow-up");
      const done = run.events[run.events.length - 1];
      expect(done?.type === 'done' && done.status).toBe('unavailable');
    } finally {
      await close();
    }
  });

  it('refine constraints carrying OUT-OF-REGION coordinates are rejected 400 (Hard rule K — review 2026-07-16)', async () => {
    const paris = validateParsedConstraints({
      origin: { lat: 48.8566, lng: 2.3522 }, // Paris — schema-valid, region-invalid
      destination: null,
      shape: 'loop',
      duration_target_s: 5400,
      distance_target_m: null,
      stops: [],
      avoid: { highways: false, tolls: false, ferries: false, unpaved: false },
      surface_pref: 'any',
      character: [],
      scenic_pref: null,
      twistiness_pref: null,
      intensity: null,
      preset: null,
      weights: null,
      location_constraints: [],
      ambiguous_terms: [],
      missing: [],
      contradictions: [],
      confidence: { overall: 0.9, fields: {} },
      clarification: { needed: false, question: null },
      unsafe_flag: false,
      out_of_region_flag: false, // attacker-controlled boolean — must NOT be trusted
      prompt_injection_flag: false,
    });
    let plannerRan = false;
    const app = appWith({
      planFn: async () => {
        plannerRan = true;
        return okPlannerResult();
      },
    });
    const { port, close } = await listen(app);
    try {
      const run = await postPlan(port, {
        brief: 'make it longer',
        constraints: paris,
        followUp: 'make it longer',
      } as never);
      expect(run.status).toBe(400);
      expect(run.rawText).toContain('out_of_region');
      expect(plannerRan).toBe(false); // no spend, no isochrone, nothing
    } finally {
      await close();
    }
  });

  it('followUp without constraints (or garbage constraints) is a 400, never a stream', async () => {
    const app = appWith();
    const { port, close } = await listen(app);
    try {
      const xor = await postPlan(port, { ...BODY, followUp: 'longer' } as never);
      expect(xor.status).toBe(400);
      expect(xor.rawText).toContain('bad_request');
      const garbage = await postPlan(port, {
        ...BODY,
        constraints: { nonsense: true },
        followUp: 'longer',
      } as never);
      expect(garbage.status).toBe(400);
      expect(garbage.rawText).toContain('not recognizable');
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
