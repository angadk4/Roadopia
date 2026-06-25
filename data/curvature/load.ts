/**
 * SPK-10 — load curvy_segments into PostGIS and measure footprint + latency.
 *
 * Applies the extension + 0001 migration, bulk-loads curvy_segments.tsv (built by
 * build-table.ts), then reports the on-disk table+index size and the find_curvy_roads
 * query latency over random points in the region. This is the evidence for the SPK-10
 * AC "table low-MB" and "find_curvy_roads < 1 s".
 *
 * Connects via DATABASE_URL (a standalone postgis container for the spike, or the
 * Supabase local db — same PostGIS engine, same migration). Run via run-db.sh.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const TSV = join(HERE, 'curvy_segments.tsv');
const MIG = join(REPO, 'db', 'supabase', 'migrations');

// Region bbox (data/region.poly) — random test points for the latency probe.
const BBOX = { minLon: -80.45, maxLon: -78.9, minLat: 42.8, maxLat: 43.55 };
const BATCH = 500;

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(p * (s.length - 1)));
  return s[i] ?? 0;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL not set');
  const db = new Client({ connectionString: url });
  await db.connect();

  // schema: extensions (from 0000) + curvy_segments (0001)
  await db.query('create extension if not exists postgis');
  await db.query('create extension if not exists pg_trgm');
  await db.query('drop table if exists curvy_segments cascade');
  await db.query(await readFile(join(MIG, '0001_curvy_segments.sql'), 'utf8'));

  // bulk load via batched parameterized inserts (geom from WKT)
  const tsv = await readFile(TSV, 'utf8');
  const lines = tsv.split('\n').filter((l) => l.length > 0);
  let loaded = 0;
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
      params.push(osmId!, name!, highway!, Number(lenM), Number(c2), Number(c7), Number(turns), wkt!);
    });
    await db.query(
      `insert into curvy_segments
       (osm_way_id,name,highway,length_m,heading_change_per_km,circum_curvature_per_km,significant_turns_per_km,geom)
       values ${values.join(',')}`,
      params,
    );
    loaded += slice.length;
  }
  await db.query('analyze curvy_segments');

  // footprint
  const sz = await db.query<{ rows_n: string; total: string; table: string; indexes: string }>(
    `select count(*)::text as rows_n,
            pg_size_pretty(pg_total_relation_size('curvy_segments')) as total,
            pg_size_pretty(pg_relation_size('curvy_segments')) as table,
            pg_size_pretty(pg_indexes_size('curvy_segments')) as indexes
     from curvy_segments`,
  );
  const totalBytes = await db.query<{ b: string }>(
    `select pg_total_relation_size('curvy_segments')::text as b`,
  );

  // latency: find_curvy_roads at random region points, 5 km radius, θ=0.6
  const N = 60;
  const lat: number[] = [];
  let hitRows = 0;
  for (let i = 0; i < N; i++) {
    const lon = BBOX.minLon + Math.random() * (BBOX.maxLon - BBOX.minLon);
    const la = BBOX.minLat + Math.random() * (BBOX.maxLat - BBOX.minLat);
    const t0 = process.hrtime.bigint();
    const r = await db.query('select * from find_curvy_roads($1,$2,$3,$4)', [lon, la, 5000, 0.6]);
    const t1 = process.hrtime.bigint();
    lat.push(Number(t1 - t0) / 1e6);
    hitRows += r.rowCount ?? 0;
  }

  const row = sz.rows[0]!;
  const mb = (Number(totalBytes.rows[0]!.b) / 1e6).toFixed(1);
  console.log('=== SPK-10 PostGIS load + measurement ===');
  console.log(`loaded rows:         ${loaded}`);
  console.log(`curvy_segments rows: ${row.rows_n}`);
  console.log(`size — total ${row.total} (${mb} MB) | table ${row.table} | indexes ${row.indexes}`);
  console.log(
    `find_curvy_roads (5 km, θ=0.6) over ${N} random points: ` +
      `p50 ${percentile(lat, 0.5).toFixed(1)} ms | p90 ${percentile(lat, 0.9).toFixed(1)} ms | ` +
      `max ${Math.max(...lat).toFixed(1)} ms | avg rows ${(hitRows / N).toFixed(0)}`,
  );
  console.log('\n-- AC check (SPK-10) --');
  console.log(`table low-MB (< 50 MB): ${Number(mb) < 50 ? 'PASS' : 'FAIL'} (${mb} MB)`);
  console.log(`find_curvy_roads < 1 s: ${percentile(lat, 0.9) < 1000 ? 'PASS' : 'FAIL'} (p90 ${percentile(lat, 0.9).toFixed(1)} ms)`);

  await db.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
