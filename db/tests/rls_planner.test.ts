import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * SPK-13 — least-privilege planner read path (Master Spec §55/§37; frozen
 * decision 27; gates M6-T02).
 *
 * Threat model: the /plan endpoint is ANONYMOUS and the backend may hold
 * privileged DB credentials — a leak path from planner reads to private rows
 * would exfiltrate user data to anyone. These tests run AS THE `anon` ROLE
 * (`set role anon` — exactly what PostgREST does for anonymous calls) against
 * the local Supabase stack and assert:
 *
 *   1. direct table reads return ONLY public rows (routes.visibility='public' /
 *      spots.source='osm' — the 0007 public-read floor, BD-48) — never a private row;
 *   2. the INVOKER RPCs return zero private rows for anon;
 *   3. the SECURITY DEFINER planner functions return public/OSM rows but
 *      NEVER a private row — the §55 "cannot select private routes/spots";
 *   4. public data still flows (the anonymous hero demo works).
 *
 * Pass criterion (Dependency Verification §21 SPK-13): zero private leakage.
 * Self-skips when no local stack is reachable (CI has no stack).
 */

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client | null = null;
const userId = randomUUID();
let privateSpotId = '';
let osmSpotId = '';
let privateRouteId = '';

/** A location far from any seeded OSM spot so proximity queries would find it. */
const PRIVATE_LAT = 43.9377;
const PRIVATE_LNG = -80.7397;

beforeAll(async () => {
  const candidate = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await candidate.connect();
    db = candidate;
  } catch {
    db = null;
    return;
  }

  // seed AS SUPERUSER: one user, one PRIVATE user spot, one private route,
  // one OSM spot at the same location (the honest positive control).
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)
     on conflict (id) do nothing`,
    [userId, `spk13-${userId.slice(0, 8)}@test.local`],
  );
  await db.query(
    `insert into profiles (id, display_name) values ($1, 'SPK-13 Tester') on conflict (id) do nothing`,
    [userId],
  );
  const spot = await db.query<{ id: string }>(
    `insert into spots (owner_id, type, name, location, source)
     values ($1, 'viewpoint', 'PRIVATE driveway lookout', st_setsrid(st_makepoint($2, $3), 4326), 'user')
     returning id`,
    [userId, PRIVATE_LNG, PRIVATE_LAT],
  );
  privateSpotId = spot.rows[0]!.id;
  const osm = await db.query<{ id: string }>(
    `insert into spots (owner_id, type, name, location, source)
     values (null, 'viewpoint', 'SPK13 public lookout', st_setsrid(st_makepoint($1, $2), 4326), 'osm')
     returning id`,
    [PRIVATE_LNG + 0.001, PRIVATE_LAT + 0.001],
  );
  osmSpotId = osm.rows[0]!.id;
  const route = await db.query<{ id: string }>(
    `insert into routes (owner_id, name, geometry, is_loop, distance_m, duration_s, origin_type, visibility)
     values ($1, 'PRIVATE test route',
             st_geomfromtext('LINESTRING(-80.74 43.93, -80.73 43.94)', 4326),
             false, 1500, 120, 'manual', 'private')
     returning id`,
    [userId],
  );
  privateRouteId = route.rows[0]!.id;
});

afterAll(async () => {
  if (db) {
    await db.query('reset role');
    await db.query('delete from spots where id = any($1::uuid[])', [[privateSpotId, osmSpotId]]);
    await db.query('delete from auth.users where id = $1', [userId]); // cascades route
    await db.end();
  }
});

/** Run a query AS THE anon ROLE (what PostgREST does for anonymous requests). */
async function asAnon<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!db) throw new Error('no db');
  await db.query('set role anon');
  try {
    const res = await db.query<T>(sql, params);
    return res.rows;
  } finally {
    await db.query('reset role');
  }
}

describe('SPK-13 least-privilege planner read path', () => {
  // NOTE (M7-T02, migration 0007): the original posture here was deny-by-default
  // ("zero rows until M8"). The M8 PUBLIC-read slice landed early to serve
  // FR-010 (anonymous map renders public seeds), so the SPK-13 invariant these
  // tests protect is now asserted directly: anon sees ONLY public/OSM rows —
  // never a private one. Recorded in docs/decision-log.md (BD-48).
  it('anon direct table reads: ONLY public routes / OSM spots (0007 read floor)', async (ctx) => {
    if (!db) return ctx.skip();
    const routes = await asAnon<{ id: string; visibility: string }>(
      'select id, visibility from routes',
    );
    const spots = await asAnon<{ id: string; source: string }>('select id, source from spots');
    expect(routes.every((r) => r.visibility === 'public')).toBe(true);
    expect(routes.some((r) => r.id === privateRouteId)).toBe(false);
    expect(spots.every((s) => s.source === 'osm')).toBe(true);
    expect(spots.some((s) => s.id === privateSpotId)).toBe(false);
  });

  it('anon INVOKER RPC (find_spots) returns OSM spots only — RLS binds the caller', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await asAnon<{ id: string; source: string }>(
      `select * from find_spots(p_lat := $1, p_lng := $2, p_radius_m := 50000)`,
      [PRIVATE_LAT, PRIVATE_LNG],
    );
    expect(rows.every((r) => r.source === 'osm')).toBe(true);
    expect(rows.some((r) => r.id === privateSpotId)).toBe(false);
  });

  it('anon planner_find_spots returns the OSM spot but NEVER the private one (the SPK-13 measure)', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await asAnon<{ id: string; source: string; name: string }>(
      `select * from planner_find_spots(p_lat := $1, p_lng := $2, p_radius_m := 50000, p_limit := 500)`,
      [PRIVATE_LAT, PRIVATE_LNG],
    );
    expect(rows.length).toBeGreaterThan(0); // public data flows — demo works
    expect(rows.some((r) => r.id === osmSpotId)).toBe(true);
    expect(rows.every((r) => r.source === 'osm')).toBe(true); // zero private leakage
    expect(rows.some((r) => r.id === privateSpotId)).toBe(false);
    expect(rows.some((r) => r.name.includes('PRIVATE'))).toBe(false);
  });

  it('anon planner_find_curvy_roads serves the public corpus (positive control)', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await asAnon<{ id: string }>(
      `select id from planner_find_curvy_roads(p_west := -81.9, p_south := 42.5, p_east := -77.5, p_north := 45.0, p_limit := 10)`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('private route stays invisible to anon through every path', async (ctx) => {
    if (!db) return ctx.skip();
    const direct = await asAnon('select id from routes where id = $1', [privateRouteId]);
    const search = await asAnon(
      `select * from search_routes(p_west := -81.9, p_south := 42.5, p_east := -77.5, p_north := 45.0)`,
    );
    expect(direct).toHaveLength(0);
    expect((search as Array<{ id?: string }>).some((r) => r.id === privateRouteId)).toBe(false);
  });
});
