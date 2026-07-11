/**
 * Load the [GATE-S] scenic feature layers (M4-T07) into the local data tier.
 *
 * Input: data/scenic-layers.geojsonl — osmium export of the region-clipped
 * extract filtered to natural=water|wood|coastline, landuse=forest,
 * waterway=river, scenic=yes (see BUILD_LOG 2026-07-11). Features stream in
 * line-by-line, classify to kind ∈ {scenic_tag, water, forest}, and land in
 * `scenic_features` simplified to ~30 m (proximity checks run at 150–300 m,
 * so 30 m simplification is harmless and keeps the table small).
 *
 * Experiment-scoped: if [GATE-S] adopts a numeric scenic signal this becomes
 * a real pipeline stage (new config id); if not, the table stays a local
 * experiment artifact.
 *
 * Run: pnpm -C data exec tsx load_scenic.ts   (Supabase local must be up)
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const INPUT = fileURLToPath(new URL('./scenic-layers.geojsonl', import.meta.url));
const BATCH = 500;

interface Feature {
  geometry: { type: string } | null;
  properties: Record<string, string>;
}

function kindOf(props: Record<string, string>): string | null {
  if (props['scenic'] === 'yes') return 'scenic_tag';
  if (
    props['natural'] === 'water' ||
    props['natural'] === 'coastline' ||
    props['waterway'] === 'river'
  ) {
    return 'water';
  }
  if (props['landuse'] === 'forest' || props['natural'] === 'wood') return 'forest';
  return null;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(`
    create table if not exists scenic_features (
      id bigserial primary key,
      kind text not null,
      geom geometry(Geometry, 4326) not null
    )`);
  await db.query('truncate scenic_features');
  await db.query('drop index if exists scenic_features_geom_idx');

  const rl = createInterface({ input: createReadStream(INPUT), crlfDelay: Infinity });
  let batch: Array<{ kind: string; geojson: string }> = [];
  let loaded = 0;
  let skipped = 0;
  const counts = new Map<string, number>();

  const flush = async () => {
    if (batch.length === 0) return;
    const values: string[] = [];
    const params: string[] = [];
    batch.forEach((row, i) => {
      values.push(
        `($${i * 2 + 1}, ST_SimplifyPreserveTopology(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($${i * 2 + 2}), 4326)), 0.0003))`,
      );
      params.push(row.kind, row.geojson);
    });
    await db.query(
      `insert into scenic_features (kind, geom) values ${values.join(',')}`,
      params,
    );
    loaded += batch.length;
    if (loaded % 25_000 < BATCH) console.log(`  ${loaded} loaded…`);
    batch = [];
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    // geojsonseq lines may carry a leading RS (0x1e) control character
    const clean = line.charCodeAt(0) === 0x1e ? line.slice(1) : line;
    let f: Feature;
    try {
      f = JSON.parse(clean) as Feature;
    } catch {
      skipped++;
      continue;
    }
    if (!f.geometry) {
      skipped++;
      continue;
    }
    const kind = kindOf(f.properties ?? {});
    if (!kind) {
      skipped++;
      continue;
    }
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    batch.push({ kind, geojson: JSON.stringify(f.geometry) });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  console.log('indexing…');
  await db.query('create index scenic_features_geom_idx on scenic_features using gist (geom)');
  await db.query('analyze scenic_features');
  await db.end();

  console.log(`loaded ${loaded} features (${skipped} skipped):`);
  for (const [k, n] of counts) console.log(`  ${k}: ${n}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
