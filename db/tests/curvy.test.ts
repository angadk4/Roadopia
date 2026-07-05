import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * M2-T06 integration tests — run against the LOCAL Supabase stack after:
 *   pnpm dlx supabase start --workdir db
 *   pnpm dlx supabase db reset --workdir db     (applies 0000 + 0001 migrations)
 *   pnpm -C data curvature:load-db              (loads curvy_segments rows)
 *
 * They SELF-SKIP when no database is reachable (e.g. CI has no Supabase stack) —
 * the local `pnpm -C db test curvy` run is the Verify gate, per Backlog M2-T06.
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
    db = null; // stack not running → tests skip loudly below
  }
  return async () => {
    await db?.end();
  };
});

describe('curvy_segments (M2-T06)', () => {
  it('is populated for the region (row count > 0)', async (ctx) => {
    if (!db) return ctx.skip();
    const r = await db.query<{ n: string }>('select count(*)::text as n from curvy_segments');
    expect(Number(r.rows[0]!.n)).toBeGreaterThan(20_000); // ~29.5k on the canonical extract
  });

  it('has the GiST index and a bbox query actually uses it (EXPLAIN)', async (ctx) => {
    if (!db) return ctx.skip();
    const idx = await db.query(
      `select indexname from pg_indexes
       where tablename = 'curvy_segments' and indexname = 'curvy_segments_geom_gist'`,
    );
    expect(idx.rowCount).toBe(1);

    // sample spatial query: segments intersecting a Hamilton-area bbox
    const explain = await db.query<{ 'QUERY PLAN': string }>(
      `explain select id from curvy_segments
       where geom && st_makeenvelope(-79.95, 43.20, -79.75, 43.30, 4326)`,
    );
    const plan = explain.rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).toContain('curvy_segments_geom_gist');
  });

  it('find_curvy_roads_near returns curvature-ordered rows near Hamilton', async (ctx) => {
    if (!db) return ctx.skip();
    const r = await db.query<{ circum_curvature_per_km: number }>(
      'select * from find_curvy_roads_near($1, $2, $3, $4)',
      [-79.87, 43.25, 5000, 0.6],
    );
    expect(r.rowCount).toBeGreaterThan(0);
    const values = r.rows.map((row) => Number(row.circum_curvature_per_km));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeLessThanOrEqual(values[i - 1]!);
    }
    expect(values.every((v) => v >= 0.6)).toBe(true);
  });
});
