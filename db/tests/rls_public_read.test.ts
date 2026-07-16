import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Migration 0007 — the public-visibility read floor + map_routes (M7-T02).
 *
 * The anonymous map home (FR-010) reads through the sanctioned direct-Supabase
 * path (§49.1). These tests run AS THE `anon` ROLE against the local stack and
 * assert BOTH directions of the floor:
 *   - public seed routes + OSM spots flow (the never-empty map works);
 *   - private/user rows never appear through ANY of the read paths
 *     (SPK-13 invariant: zero private leakage);
 *   - anon still cannot WRITE (no insert/update/delete policies).
 * Self-skips when no local stack is reachable (CI has no stack).
 */

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client | null = null;
const userId = randomUUID();
let privateRouteId = '';
let userSpotId = '';

beforeAll(async () => {
  const candidate = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await candidate.connect();
    db = candidate;
  } catch {
    db = null;
    return;
  }
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)
     on conflict (id) do nothing`,
    [userId, `m7t02-${userId.slice(0, 8)}@test.local`],
  );
  await db.query(`insert into profiles (id, display_name) values ($1, 'M7-T02 Tester')`, [userId]);
  const route = await db.query<{ id: string }>(
    `insert into routes (owner_id, name, geometry, geometry_simplified, is_loop,
                         distance_m, duration_s, origin_type, visibility)
     values ($1, 'PRIVATE m7t02 route',
             st_geomfromtext('LINESTRING(-79.90 43.30, -79.89 43.31)', 4326),
             st_geomfromtext('LINESTRING(-79.90 43.30, -79.89 43.31)', 4326),
             false, 1500, 120, 'manual', 'private')
     returning id`,
    [userId],
  );
  privateRouteId = route.rows[0]!.id;
  const spot = await db.query<{ id: string }>(
    `insert into spots (owner_id, type, name, location, source)
     values ($1, 'coffee', 'PRIVATE m7t02 cafe', st_setsrid(st_makepoint(-79.9, 43.3), 4326), 'user')
     returning id`,
    [userId],
  );
  userSpotId = spot.rows[0]!.id;
});

afterAll(async () => {
  if (db) {
    await db.query('reset role');
    await db.query('delete from auth.users where id = $1', [userId]); // cascades route+spot
    await db.end();
  }
});

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

describe('0007 public read floor (M7-T02)', () => {
  it('map_routes serves public seed routes with GeoJSON geometry to anon', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await asAnon<{
      id: string;
      name: string;
      visibility: string;
      geometry: { type: string; coordinates: unknown[] };
      distance_m: number;
      duration_s: number;
      is_loop: boolean;
    }>(`select * from map_routes(p_limit := 50)`);
    expect(rows.length).toBeGreaterThan(0); // the never-empty map (FR-010)
    expect(rows.every((r) => r.visibility === 'public')).toBe(true);
    expect(rows.some((r) => r.id === privateRouteId)).toBe(false);
    for (const r of rows) {
      expect(r.geometry.type).toBe('LineString'); // renderable, not WKB hex
      expect(Array.isArray(r.geometry.coordinates)).toBe(true);
      expect(r.distance_m).toBeGreaterThan(0);
    }
  });

  it('search_routes (§49.1 client surface) now flows for anon — public rows only', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await asAnon<{ id: string; visibility: string }>(
      `select id, visibility from search_routes(p_page_size := 50)`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.visibility === 'public')).toBe(true);
    expect(rows.some((r) => r.id === privateRouteId)).toBe(false);
  });

  it('search_spots returns OSM spots only — the user spot stays invisible', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await asAnon<{ id: string; source: string }>(
      `select id, source from search_spots(p_types := array['coffee'], p_page_size := 50)`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === 'osm')).toBe(true);
    expect(rows.some((r) => r.id === userSpotId)).toBe(false);
  });

  it('anon still cannot write routes (no insert policy)', async (ctx) => {
    if (!db) return ctx.skip();
    await expect(
      asAnon(
        `insert into routes (name, geometry, distance_m, duration_s, origin_type)
         values ('anon-write-attempt', st_geomfromtext('LINESTRING(0 0, 1 1)', 4326), 1, 1, 'manual')`,
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it('anon cannot update or delete public routes (read-only floor)', async (ctx) => {
    if (!db) return ctx.skip();
    // anon holds no table-level UPDATE/DELETE grant at all (0002 granted writes
    // to `authenticated` only) → Postgres rejects before RLS is even consulted.
    await expect(
      asAnon(`update routes set name = 'hacked' where visibility = 'public'`),
    ).rejects.toThrow(/permission denied/i);
    await expect(asAnon(`delete from routes where visibility = 'public'`)).rejects.toThrow(
      /permission denied/i,
    );
    const count = await asAnon<{ n: string }>(`select count(*)::text as n from routes`);
    expect(Number(count[0]!.n)).toBeGreaterThan(0); // rows intact + still readable
  });
});
