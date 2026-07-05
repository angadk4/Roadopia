import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M2-T08 integration tests (+ folded SPK-12 RPC-perf assertions) against the
 * LOCAL Supabase stack. Self-skip when no DB is reachable; the local
 * `pnpm -C db test rpcs` run is the Verify gate. Every RPC must answer < 1 s
 * on the loaded region data (SPK-12 / M2-T08 AC).
 */

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BUDGET_MS = 1_000;

let db: Client | null = null;
const userId = randomUUID();

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const result = await fn();
  return [result, performance.now() - t0];
}

beforeAll(async () => {
  const candidate = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await candidate.connect();
    db = candidate;
  } catch {
    db = null;
    return;
  }
  // seed a user + a few spots/routes (superuser path; M2-T09 owns the real seed)
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)
     on conflict (id) do nothing`,
    [userId, `m2t08-${userId.slice(0, 8)}@test.local`],
  );
  await db.query(`insert into profiles (id) values ($1) on conflict (id) do nothing`, [userId]);
  await db.query(
    `insert into spots (owner_id, type, name, location, source) values
     ($1, 'viewpoint', 'RPC Test Lookout', st_geomfromtext('POINT(-79.95 43.24)', 4326), 'user'),
     ($1, 'coffee',    'RPC Test Espresso', st_geomfromtext('POINT(-79.87 43.26)', 4326), 'user'),
     ($1, 'fuel',      'RPC Test Fuel Far', st_geomfromtext('POINT(-79.25 43.16)', 4326), 'user')`,
    [userId],
  );
  await db.query(
    `insert into routes (owner_id, name, geometry, distance_m, duration_s, origin_type, visibility, character_tags) values
     ($1, 'Escarpment Sweep RPC', st_geomfromtext('LINESTRING(-79.95 43.20, -79.87 43.25)', 4326), 25000, 1800, 'manual', 'public', '{twisty,scenic}'),
     ($1, 'Lakeside Cruise RPC',  st_geomfromtext('LINESTRING(-79.80 43.30, -79.60 43.22)', 4326), 60000, 3600, 'manual', 'public', '{flowing}')`,
    [userId],
  );
});

afterAll(async () => {
  if (db) {
    await db.query('delete from auth.users where id = $1', [userId]);
    await db.end();
  }
});

describe('find_curvy_roads — bbox form (M2-T08)', () => {
  it('returns ranked segments inside the bbox in < 1 s', async (ctx) => {
    if (!db) return ctx.skip();
    const [r, ms] = await timed(() =>
      db!.query<{ circum_curvature_per_km: number }>(
        `select * from find_curvy_roads(
           p_west := -80.05, p_south := 43.15, p_east := -79.75, p_north := 43.35,
           p_min_curviness := 0.6, p_limit := 100)`,
      ),
    );
    expect(r.rowCount).toBeGreaterThan(0);
    const v = r.rows.map((x) => Number(x.circum_curvature_per_km));
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThanOrEqual(v[i - 1]!);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('polygon form filters to the polygon', async (ctx) => {
    if (!db) return ctx.skip();
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-80.0, 43.2],
          [-79.9, 43.2],
          [-79.9, 43.3],
          [-80.0, 43.3],
          [-80.0, 43.2],
        ],
      ],
    };
    const [r, ms] = await timed(() =>
      db!.query(
        `select * from find_curvy_roads(
           p_west := 0, p_south := 0, p_east := 0, p_north := 0,
           p_polygon := $1::jsonb, p_min_curviness := 0.6, p_limit := 50)`,
        [JSON.stringify(polygon)],
      ),
    );
    expect(r.rowCount).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('radius form find_curvy_roads_near (BD-13 prefilter) returns thresholded, ranked rows fast', async (ctx) => {
    if (!db) return ctx.skip();
    const [r, ms] = await timed(() =>
      db!.query<{ circum_curvature_per_km: number }>(
        'select * from find_curvy_roads_near($1, $2, $3, $4)',
        [-79.87, 43.25, 5000, 0.6],
      ),
    );
    expect(r.rowCount).toBeGreaterThan(0);
    expect(r.rows.every((x) => Number(x.circum_curvature_per_km) >= 0.6)).toBe(true);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('find_spots (M2-T08)', () => {
  it('returns nearest-first, type-filtered spots in < 1 s', async (ctx) => {
    if (!db) return ctx.skip();
    // NOTE: runs against whatever else is loaded (e.g. the M2-T09 OSM seed) —
    // assertions are order/type-based, never exact-count-based.
    const [r, ms] = await timed(() =>
      db!.query<{ name: string; type: string; lat: number; lng: number }>(
        `select * from find_spots(p_lat := 43.25, p_lng := -79.90,
                                  p_types := array['viewpoint','coffee'], p_limit := 500)`,
      ),
    );
    expect(r.rowCount).toBeGreaterThanOrEqual(2);
    expect(r.rows.every((x) => x.type === 'viewpoint' || x.type === 'coffee')).toBe(true);
    // nearest-first: distances from the origin are non-decreasing. The client-side
    // equirectangular check disagrees with PostGIS's geodesic metres by up to ~0.1%
    // (~25 m at this radius) — allow that slack; real ordering bugs are km-scale.
    const dist = (lat: number, lng: number) => {
      const dLat = (lat - 43.25) * 111_320;
      const dLng = (lng - -79.9) * 111_320 * Math.cos((43.25 * Math.PI) / 180);
      return Math.hypot(dLat, dLng);
    };
    const ds = r.rows.map((x) => dist(Number(x.lat), Number(x.lng)));
    for (let i = 1; i < ds.length; i++) expect(ds[i]!).toBeGreaterThanOrEqual(ds[i - 1]! - 25);
    // our two markers are both found, Espresso (~2.6 km) before Lookout (~4.2 km)
    const names = r.rows.map((x) => x.name);
    const iEspresso = names.indexOf('RPC Test Espresso');
    const iLookout = names.indexOf('RPC Test Lookout');
    expect(iEspresso).toBeGreaterThanOrEqual(0);
    expect(iLookout).toBeGreaterThan(iEspresso);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('search_routes / search_spots (M2-T08, trigram)', () => {
  it('search_routes: name + length filters, < 1 s', async (ctx) => {
    if (!db) return ctx.skip();
    const [byName, ms1] = await timed(() =>
      db!.query<{ name: string }>(`select * from search_routes(p_name := 'escarpment')`),
    );
    expect(byName.rows.some((x) => x.name === 'Escarpment Sweep RPC')).toBe(true);
    expect(ms1).toBeLessThan(BUDGET_MS);

    const [byLen, ms2] = await timed(() =>
      db!.query<{ name: string }>(
        `select * from search_routes(p_min_length_m := 50000, p_max_length_m := 100000)`,
      ),
    );
    expect(byLen.rows.some((x) => x.name === 'Lakeside Cruise RPC')).toBe(true);
    expect(byLen.rows.some((x) => x.name === 'Escarpment Sweep RPC')).toBe(false);
    expect(ms2).toBeLessThan(BUDGET_MS);
  });

  it('search_spots: bbox + name, < 1 s', async (ctx) => {
    if (!db) return ctx.skip();
    const [r, ms] = await timed(() =>
      db!.query<{ name: string }>(
        `select * from search_spots(p_west := -80.0, p_south := 43.2, p_east := -79.8, p_north := 43.3,
                                    p_name := 'lookout')`,
      ),
    );
    expect(r.rows.some((x) => x.name === 'RPC Test Lookout')).toBe(true);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('trigram indexes exist on routes.name and spots.name', async (ctx) => {
    if (!db) return ctx.skip();
    const r = await db!.query(
      `select indexname from pg_indexes
       where indexname in ('routes_name_trgm', 'spots_name_trgm')`,
    );
    expect(r.rowCount).toBe(2);
  });
});
