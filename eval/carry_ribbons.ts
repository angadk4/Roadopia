/**
 * R36-U12 (BD-168) — carry ribbons from one generator_version to another.
 *
 * Loop sweeps run with RIBBONS_PER_CELL=0 (ribbons haven't changed; resweeping
 * them wastes hours), so a new loop version needs the incumbent's ribbon rows
 * copied under its own version. The r34 carry did this by hand-renaming
 * `:ribbon:`→`:r34ribbon:` inside the id — which silently broke
 * ribbon_chain's physical-road dedup (see ribbonRoadKey + BD-168). v2 keeps
 * the id intact and namespaces with the version prefix, same as the loader:
 * `<to>:<original id>` — collision-proof and road-key-safe.
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx carry_ribbons.ts r34-rib r35-rib [kind]
 * `kind` defaults to 'ribbon'; pass 'loop' to union loop supply across sweep
 * generations (BD-173: the r36 curvature-aware sweep traded coverage for
 * curviness — the union restores coverage and lets dedup keep the best of
 * any physical duplicate).
 */
import { Client } from 'pg';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function main(): Promise<void> {
  const from = process.argv[2];
  const to = process.argv[3];
  const kind = process.argv[4] ?? 'ribbon';
  if (!from || !to || from === to || (kind !== 'ribbon' && kind !== 'loop')) {
    throw new Error('usage: carry_ribbons.ts <from-version> <to-version> [ribbon|loop]');
  }
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query('begin');
    // strip any existing version namespace so a chain of carries never stacks
    // prefixes: the physical id is everything after the source-version prefix.
    const res = await db.query(
      `insert into drive_cores (
         id, kind, name, cell, generator_version, bar_profile,
         geometry, geom_simplified, bbox, entry, exit,
         distance_m, duration_s, curviness, backroad_share, main_share,
         highway_share, hood_share, turns_per_10min, loopiness,
         sweep_run_id, config_stamp, tileset_id
       )
       select
         $2 || ':' || (case when id like $1 || ':%' then substr(id, length($1) + 2) else id end),
         kind, name, cell, $2, bar_profile,
         geometry, geom_simplified, bbox, entry, exit,
         distance_m, duration_s, curviness, backroad_share, main_share,
         highway_share, hood_share, turns_per_10min, loopiness,
         'carried:' || $1, config_stamp, tileset_id
       from drive_cores
       where generator_version = $1 and kind = $3
       on conflict (id) do nothing`,
      [from, to, kind],
    );
    await db.query('commit');
    const check = await db.query<{ n: string }>(
      `select count(*)::text n from drive_cores where generator_version=$1 and kind=$2`,
      [to, kind],
    );
    console.log(
      `carried ${res.rowCount ?? 0} ${kind}s ${from} → ${to}; ${to} ${kind}s now ${check.rows[0]!.n} — verified.`,
    );
  } catch (err) {
    await db.query('rollback');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
