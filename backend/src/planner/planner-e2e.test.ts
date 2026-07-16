import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseRules } from './parse_rules';
import { runPlanner, WALL_CLOCK_BUDGET_MS } from './run';

/**
 * M3-T13 — deterministic planner END-TO-END on the real stack (Supabase local
 * data tier + pinned local Valhalla + elevation). Self-skips when either is down;
 * `pnpm -C backend test planner-e2e` locally is the Verify gate. FEEDS SPK-15.
 */

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

let db: Client | null = null;
let engineUp = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${VALHALLA}/status`, { signal: AbortSignal.timeout(2_000) });
    engineUp = res.ok;
  } catch {
    engineUp = false;
  }
  const candidate = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await candidate.connect();
    db = candidate;
  } catch {
    db = null;
  }
  return async () => {
    await db?.end();
  };
});

const ready = () => db !== null && engineUp;

describe('runPlanner e2e (M3-T13)', () => {
  it('the canonical brief returns a feasible twisty loop within budget (AC)', async (ctx) => {
    if (!ready()) return ctx.skip();
    const constraints = parseRules(
      '90 minute twisty loop from Hamilton with a coffee stop, no highways',
    );
    const t0 = performance.now();
    const result = await runPlanner(constraints, { db: db!, valhallaUrl: VALHALLA });
    const elapsed = performance.now() - t0;

    expect(['ok', 'relaxed']).toContain(result.status);
    expect(result.route).not.toBeNull();
    expect(elapsed).toBeLessThan(WALL_CLOCK_BUDGET_MS);

    // loop closure + no-highway honoured (result-scan, not request trust)
    const v = result.validation!;
    expect(v.feasible).toBe(true);
    expect(v.results.find((r) => r.constraint === 'loop_closure')!.status).toBe('satisfied');
    const hw = v.results.find((r) => r.constraint === 'avoid_highway')!;
    expect(['satisfied', 'relaxed']).toContain(hw.status);
    expect(result.route!.has_highway).toBe(hw.status === 'relaxed');

    // the loop is a real drive: >20 min, measurable curviness, real geometry
    expect(result.route!.duration_s).toBeGreaterThan(1_200);
    expect(result.curviness).toBeGreaterThan(0);
    expect(result.route!.geometry.coordinates.length).toBeGreaterThan(100);

    // R16-3: the coffee stop is a REAL grounded spot with a MEASURED arrival
    expect(result.stops).toHaveLength(1);
    const stop = result.stops[0]!;
    expect(stop.requested_type).toBe('coffee');
    expect(stop.type).toBe('coffee');
    expect(stop.name.length).toBeGreaterThan(0);
    expect(stop.arrival_s).not.toBeNull();
    expect(stop.arrival_s!).toBeGreaterThan(0);
    expect(stop.arrival_s!).toBeLessThan(result.route!.duration_s);
    // marker location = the stop's own waypoint
    expect(result.waypoints[stop.waypoint_index]).toEqual(stop.location);
    // per-type Tier-2 gate present
    expect(v.results.some((r) => r.constraint === 'stop_coffee')).toBe(true);
  }, 60_000);

  it('emits ordered stage events with a terminal done (AC)', async (ctx) => {
    if (!ready()) return ctx.skip();
    const constraints = parseRules('1 hour loop from Dundas');
    const result = await runPlanner(constraints, { db: db!, valhallaUrl: VALHALLA });

    const steps = result.events
      .filter((e): e is Extract<typeof e, { type: 'step' }> => e.type === 'step')
      .filter((e) => e.status === 'started')
      .map((e) => e.step);
    // pipeline order: constraints → scope → retrieve → generate → route → score → …
    const expectedOrder = [
      'validate_constraints',
      'scope',
      'retrieve',
      'generate_candidates',
      'route_candidates',
      'score_rank',
      'diversify',
      'validate_route',
    ];
    const positions = expectedOrder.map((s) => steps.indexOf(s as (typeof steps)[number]));
    expect(positions.every((p) => p >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
    expect(result.events[result.events.length - 1]!.type).toBe('done');
    // Hard rule I: no event carries model reasoning — only steps/tools/results
    expect(
      result.events.every((e) =>
        ['step', 'tool_call', 'tool_result', 'route', 'explanation', 'error', 'done'].includes(
          e.type,
        ),
      ),
    ).toBe(true);
  }, 60_000);

  it('A→B brief routes to the destination with corridor character', async (ctx) => {
    if (!ready()) return ctx.skip();
    const constraints = parseRules('Scenic drive to Niagara Falls from St. Catharines');
    const result = await runPlanner(constraints, { db: db!, valhallaUrl: VALHALLA });
    expect(['ok', 'relaxed']).toContain(result.status);
    const end = result.route!.geometry.coordinates.at(-1)!;
    // ends near Niagara Falls (gazetteer coords)
    expect(Math.abs(end[1] - 43.0896)).toBeLessThan(0.05);
    expect(Math.abs(end[0] - -79.0849)).toBeLessThan(0.05);
  }, 60_000);

  it('unsafe and out-of-region briefs terminate honestly without routes', async (ctx) => {
    if (!ready()) return ctx.skip();
    const unsafe = await runPlanner(parseRules('street race from Hamilton, fastest possible run'), {
      db: db!,
      valhallaUrl: VALHALLA,
    });
    expect(unsafe.status).toBe('refused');
    expect(unsafe.route).toBeNull();

    // Toronto moved IN with BD-19; London moved IN with BD-38 v5 — Sarnia is
    // the canonical still-outside western city now.
    const oor = await runPlanner(parseRules('a drive from Sarnia'), {
      db: db!,
      valhallaUrl: VALHALLA,
    });
    expect(oor.status).toBe('redirect');
    expect(oor.route).toBeNull();
  }, 30_000);

  it('elevation enrichment lands (real Tilezen data on this stack)', async (ctx) => {
    if (!ready()) return ctx.skip();
    const result = await runPlanner(parseRules('45 minute loop from Ancaster'), {
      db: db!,
      valhallaUrl: VALHALLA,
    });
    expect(result.elevation).not.toBeNull();
    expect(result.elevation!.climb_m).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
