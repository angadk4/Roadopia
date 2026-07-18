/**
 * Load the R19 land-use CONTEXT layers (owner directive 2026-07-18: "main
 * roads are fine when surrounded by fields/forest; curvy roads INSIDE
 * neighbourhoods are not backroads") into the data tier.
 *
 * Inputs (osmium exports of the region-clipped extract):
 *   data/landuse-built.geojsonl — landuse=residential|industrial|commercial|
 *       retail polygons → kind 'built' (the neighbourhood/urban detector)
 *   data/landuse-rural.geojsonl — landuse=farmland|meadow|orchard|vineyard|
 *       farmyard polygons → kind 'rural' (loaded now for [GATE-S]-class
 *       follow-ups; R19 consumes ONLY 'built')
 *
 * Table `landuse_zones` is created by migration 0011 (this script loads it;
 * `create if not exists` kept so the script also works standalone-local).
 * Simplification 0.0002° (~20 m) — subdivision boundaries drive the measure,
 * so finer than scenic's 30 m.
 *
 * After loading, run compute_urban_share.sql (same directory) to fill
 * curvy_segments.urban_share — the offline per-segment context measure.
 *
 * Run: pnpm -C data exec tsx load_landuse.ts   (Supabase local must be up)
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BATCH = 400;

const INPUTS: Array<{ file: string; kind: 'built' | 'rural' }> = [
  { file: fileURLToPath(new URL('./landuse-built.geojsonl', import.meta.url)), kind: 'built' },
  { file: fileURLToPath(new URL('./landuse-rural.geojsonl', import.meta.url)), kind: 'rural' },
];

interface Feature {
  geometry: { type: string } | null;
  properties?: Record<string, string>;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  await db.query(`
    create table if not exists landuse_zones (
      id bigserial primary key,
      kind text not null,
      geom geometry(Geometry, 4326) not null
    )`);
  await db.query('truncate landuse_zones');
  await db.query('drop index if exists landuse_zones_geom_idx');

  let loaded = 0;
  let skipped = 0;
  const counts = new Map<string, number>();

  for (const input of INPUTS) {
    const rl = createInterface({ input: createReadStream(input.file), crlfDelay: Infinity });
    let batch: string[] = [];

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      const values: string[] = [];
      const params: string[] = [];
      batch.forEach((geojson, i) => {
        values.push(
          `($${i * 2 + 1}, ST_SimplifyPreserveTopology(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($${i * 2 + 2}), 4326)), 0.0002))`,
        );
        params.push(input.kind, geojson);
      });
      await db.query(`insert into landuse_zones (kind, geom) values ${values.join(',')}`, params);
      loaded += batch.length;
      if (loaded % 20_000 < BATCH) console.log(`  ${loaded} loaded…`);
      batch = [];
    };

    for await (const line of rl) {
      if (!line.trim()) continue;
      const clean = line.charCodeAt(0) === 0x1e ? line.slice(1) : line;
      let f: Feature;
      try {
        f = JSON.parse(clean) as Feature;
      } catch {
        skipped++;
        continue;
      }
      if (!f.geometry || !/Polygon/i.test(f.geometry.type)) {
        skipped++;
        continue;
      }
      counts.set(input.kind, (counts.get(input.kind) ?? 0) + 1);
      batch.push(JSON.stringify(f.geometry));
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    console.log(`${input.kind}: done (${counts.get(input.kind) ?? 0})`);
  }

  console.log('creating GiST index…');
  await db.query('create index landuse_zones_geom_idx on landuse_zones using gist (geom)');
  await db.query('analyze landuse_zones');
  const area = await db.query(
    `select kind, count(*) n, round(sum(st_area(geom::geography))/1e6) km2
     from landuse_zones group by kind order by kind`,
  );
  console.table(area.rows);
  console.log(`loaded ${loaded}, skipped ${skipped}`);
  await db.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
