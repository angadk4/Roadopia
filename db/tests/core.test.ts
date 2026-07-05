import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M2-T07 integration tests — core schema round-trip against the LOCAL Supabase
 * stack (after `supabase db reset`). Self-skip when no database is reachable
 * (CI has no stack); `pnpm -C db test core` locally is the Verify gate.
 */

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client | null = null;
const userId = randomUUID();

beforeAll(async () => {
  const candidate = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await candidate.connect();
    db = candidate;
    // profiles is 1:1 with auth.users — create the auth user first (local stack).
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)
       on conflict (id) do nothing`,
      [userId, `m2t07-${userId.slice(0, 8)}@test.local`],
    );
  } catch {
    db = null;
  }
});

afterAll(async () => {
  if (db) {
    await db.query('delete from auth.users where id = $1', [userId]); // cascades profile → routes/spots
    await db.end();
  }
});

describe('core schema (M2-T07)', () => {
  it('round-trips profile → route → spot → route_spots with PostGIS geometry', async (ctx) => {
    if (!db) return ctx.skip();

    await db.query(
      `insert into profiles (id, display_name) values ($1, 'M2-T07 Tester')
       on conflict (id) do nothing`,
      [userId],
    );

    const route = await db.query<{ id: string }>(
      `insert into routes (owner_id, name, geometry, is_loop, distance_m, duration_s, origin_type, visibility)
       values ($1, 'Escarpment loop test',
               st_geomfromtext('LINESTRING(-79.95 43.20, -79.90 43.24, -79.87 43.25, -79.95 43.20)', 4326),
               true, 18500, 1500, 'manual', 'public')
       returning id`,
      [userId],
    );
    const routeId = route.rows[0]!.id;

    const spot = await db.query<{ id: string }>(
      `insert into spots (owner_id, type, name, location)
       values ($1, 'viewpoint', 'Brow lookout test', st_geomfromtext('POINT(-79.9577 43.2385)', 4326))
       returning id`,
      [userId],
    );
    const spotId = spot.rows[0]!.id;

    await db.query(`insert into route_spots (route_id, spot_id, position) values ($1, $2, 1)`, [
      routeId,
      spotId,
    ]);

    const back = await db.query<{
      name: string;
      is_loop: boolean;
      npoints: number;
      visibility: string;
      spot_name: string;
      lon: number;
    }>(
      `select r.name, r.is_loop, st_npoints(r.geometry)::int as npoints, r.visibility,
              s.name as spot_name, st_x(s.location)::float8 as lon
       from routes r
       join route_spots rs on rs.route_id = r.id
       join spots s on s.id = rs.spot_id
       where r.id = $1`,
      [routeId],
    );
    expect(back.rowCount).toBe(1);
    const row = back.rows[0]!;
    expect(row.name).toBe('Escarpment loop test');
    expect(row.is_loop).toBe(true);
    expect(row.npoints).toBe(4);
    expect(row.visibility).toBe('public');
    expect(row.spot_name).toBe('Brow lookout test');
    expect(row.lon).toBeCloseTo(-79.9577, 4);
  });

  it('enforces enum CHECKs (bad intensity rejected)', async (ctx) => {
    if (!db) return ctx.skip();
    await expect(
      db.query(
        `insert into routes (owner_id, geometry, distance_m, duration_s, origin_type, intensity)
         values ($1, st_geomfromtext('LINESTRING(-79.9 43.2, -79.8 43.25)', 4326), 1000, 100, 'manual', 'fast')`,
        [userId],
      ),
    ).rejects.toThrow(/check|constraint/i);
  });

  it('cascades route deletion to route_spots (FR-085 shape)', async (ctx) => {
    if (!db) return ctx.skip();
    const r = await db.query<{ id: string }>(
      `insert into routes (owner_id, geometry, distance_m, duration_s, origin_type)
       values ($1, st_geomfromtext('LINESTRING(-79.9 43.2, -79.8 43.25)', 4326), 1000, 100, 'manual')
       returning id`,
      [userId],
    );
    const s = await db.query<{ id: string }>(
      `insert into spots (owner_id, type, location)
       values ($1, 'coffee', st_geomfromtext('POINT(-79.85 43.22)', 4326)) returning id`,
      [userId],
    );
    await db.query('insert into route_spots (route_id, spot_id) values ($1, $2)', [
      r.rows[0]!.id,
      s.rows[0]!.id,
    ]);
    await db.query('delete from routes where id = $1', [r.rows[0]!.id]);
    const orphans = await db.query('select 1 from route_spots where route_id = $1', [
      r.rows[0]!.id,
    ]);
    expect(orphans.rowCount).toBe(0);
  });

  it('RLS is enabled on all four tables (deny-by-default until M8 policies)', async (ctx) => {
    if (!db) return ctx.skip();
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('profiles', 'routes', 'spots', 'route_spots')`,
    );
    expect(r.rowCount).toBe(4);
    expect(r.rows.every((row) => row.relrowsecurity)).toBe(true);
  });
});
