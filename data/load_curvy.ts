/**
 * M2-T06 — load `curvy_segments` into the real data tier.
 *
 * Reads data/curvature/curvy_segments.tsv (built by `pnpm -C data curvature:build`
 * from the canonical manifest'd extract) and loads it into the Postgres/PostGIS
 * pointed at by DATABASE_URL (default: the Supabase LOCAL stack). The 0001 migration
 * owns the schema (table + GiST index + find_curvy_roads); this loader owns ROWS —
 * idempotent via truncate-and-reload.
 *
 * Run: pnpm -C data curvature:load-db          (supabase local must be running)
 *      DATABASE_URL=... pnpm -C data curvature:load-db
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const TSV = join(HERE, 'curvature', 'curvy_segments.tsv');
const MANIFEST = join(HERE, 'extract-manifest.json');
// Supabase local db (well-known local-only credentials — not secrets).
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BATCH = 500;

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? DEFAULT_URL;
  const db = new Client({ connectionString: url });
  await db.connect();

  // Provenance: tie the load to the manifest'd extract when present.
  let provenance = '(no extract-manifest.json found)';
  try {
    const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
      extract_date: string;
      outputs: { filtered: { md5: string; ways: number } };
    };
    provenance = `extract ${manifest.extract_date} (filtered md5 ${manifest.outputs.filtered.md5}, ${manifest.outputs.filtered.ways} ways)`;
  } catch {
    // manifest is optional context, not a hard requirement
  }

  const tsv = await readFile(TSV, 'utf8');
  const lines = tsv.split('\n').filter((l) => l.length > 0);

  await db.query('begin');
  try {
    await db.query('truncate curvy_segments restart identity');
    for (let i = 0; i < lines.length; i += BATCH) {
      const slice = lines.slice(i, i + BATCH);
      const values: string[] = [];
      const params: (string | number)[] = [];
      slice.forEach((line, j) => {
        const [osmId, name, highway, lenM, c2, c7, turns, wkt] = line.split('\t');
        const b = j * 8;
        values.push(
          `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},st_geomfromtext($${b + 8},4326))`,
        );
        params.push(
          osmId!,
          name!,
          highway!,
          Number(lenM),
          Number(c2),
          Number(c7),
          Number(turns),
          wkt!,
        );
      });
      await db.query(
        `insert into curvy_segments
         (osm_way_id,name,highway,length_m,heading_change_per_km,circum_curvature_per_km,significant_turns_per_km,geom)
         values ${values.join(',')}`,
        params,
      );
    }
    await db.query('commit');
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
  await db.query('analyze curvy_segments');

  const count = await db.query<{ n: string }>('select count(*)::text as n from curvy_segments');
  const size = await db.query<{ s: string }>(
    `select pg_size_pretty(pg_total_relation_size('curvy_segments')) as s`,
  );
  console.log('=== curvy_segments load (M2-T06) ===');
  console.log(`target:     ${url.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`provenance: ${provenance}`);
  console.log(`rows:       ${count.rows[0]!.n}`);
  console.log(`table size: ${size.rows[0]!.s} (total incl. indexes)`);
  await db.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
