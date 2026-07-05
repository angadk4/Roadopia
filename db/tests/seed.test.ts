import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * M2-T09 integration tests — the never-empty-map floor (Spec §10 SC), after:
 *   pnpm -C db run seed
 * Self-skip when no DB is reachable; `pnpm -C db test seed` locally is the gate.
 */

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client | null = null;

beforeAll(async () => {
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

describe('seed (M2-T09)', () => {
  it('provides ≥5 public seed routes with real routed geometry', async (ctx) => {
    if (!db) return ctx.skip();
    const r = await db.query<{ n: string }>(
      `select count(*)::text as n from routes
       where 'seed' = any (free_tags) and visibility = 'public'
         and st_npoints(geometry) > 10 and distance_m > 1000`,
    );
    expect(Number(r.rows[0]!.n)).toBeGreaterThanOrEqual(5);
  });

  it('computes simplified geometry + bbox for every seed route', async (ctx) => {
    if (!db) return ctx.skip();
    const r = await db.query<{ raw: number; simple: number }>(
      `select st_npoints(geometry)::int as raw, st_npoints(geometry_simplified)::int as simple
       from routes where 'seed' = any (free_tags)`,
    );
    expect(r.rowCount).toBeGreaterThanOrEqual(5);
    for (const row of r.rows) {
      expect(row.simple).toBeGreaterThan(1);
      expect(row.simple).toBeLessThanOrEqual(row.raw);
    }
    const bbox = await db.query<{ n: string }>(
      `select count(*)::text as n from routes where 'seed' = any (free_tags) and bbox is null`,
    );
    expect(Number(bbox.rows[0]!.n)).toBe(0);
  });

  it('seeds OSM spots of every required type (coffee / fuel / viewpoint)', async (ctx) => {
    if (!db) return ctx.skip();
    const r = await db.query<{ type: string; n: string }>(
      `select type, count(*)::text as n from spots
       where source = 'osm' and owner_id is null group by type`,
    );
    const byType = Object.fromEntries(r.rows.map((row) => [row.type, Number(row.n)]));
    expect(byType['coffee'] ?? 0).toBeGreaterThan(0);
    expect(byType['fuel'] ?? 0).toBeGreaterThan(0);
    expect(byType['viewpoint'] ?? 0).toBeGreaterThan(0);
  });

  it('seeded data is visible through the M2-T08 RPCs', async (ctx) => {
    if (!db) return ctx.skip();
    const spots = await db.query<{ source: string }>(
      `select * from find_spots(p_lat := 43.2557, p_lng := -79.8711, p_radius_m := 15000)`,
    );
    expect(spots.rows.some((s) => s.source === 'osm')).toBe(true);

    const routes = await db.query<{ name: string }>(
      `select * from search_routes(p_name := 'snake road')`,
    );
    expect(routes.rows.some((r) => r.name === 'Snake Road Sweep')).toBe(true);
  });
});
