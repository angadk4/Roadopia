/**
 * R36-U12 (BD-168) — the SUPPLY COVERAGE MAP (Recovery §12.3/§12.4).
 *
 * Per ~10 km cell: distinct clean loops, duration-band coverage, dup ratio,
 * strict/layered split — JOINED against the raw curvy-material density so a
 * cell is classified honestly:
 *   healthy          — supply matches its material;
 *   weak_generation  — material exists, rings don't → the sweep's fault →
 *                      TARGET for an adaptive top-up (emits the CELLS env);
 *   true_desert      — no material to begin with (Cobourg-class) → honest
 *                      fallback territory, never re-swept blindly.
 *
 * Run: npx tsx eval/coverage_map.ts [version=r34-rib]
 * Writes eval/reports/coverage-map.json + a console table + a CELLS= line.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'reports');

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CELL_KM = 10;

async function main(): Promise<void> {
  const version = process.argv[2] ?? 'r34-rib';
  const db = new Client({ connectionString: DB });
  await db.connect();

  // supply per cell (grid by entry point)
  const supply = await db.query<{
    cx: string;
    cy: string;
    loops: string;
    names: string;
    strict: string;
    small: string;
    mid: string;
    big: string;
  }>(
    `select
       floor(((entry->>'lng')::float + 180) * 111.32 * cos(radians(43.8)) / $2)::text cx,
       floor(((entry->>'lat')::float + 90) * 111.32 / $2)::text cy,
       count(*) loops,
       count(distinct name) names,
       count(*) filter (where bar_profile='strict') strict,
       count(*) filter (where duration_s <= 4200) small,
       count(*) filter (where duration_s > 4200 and duration_s <= 6600) mid,
       count(*) filter (where duration_s > 6600) big
     from drive_cores
     where generator_version = $1 and kind = 'loop'
     group by 1, 2`,
    [version, CELL_KM],
  );

  // raw material per cell (curvy corpus density)
  const material = await db.query<{ cx: string; cy: string; segs: string; km: string }>(
    `select
       floor((st_x(st_centroid(geom::geometry)) + 180) * 111.32 * cos(radians(43.8)) / $1)::text cx,
       floor((st_y(st_centroid(geom::geometry)) + 90) * 111.32 / $1)::text cy,
       count(*) segs,
       round((sum(length_m) / 1000)::numeric, 0)::text km
     from curvy_segments
     group by 1, 2`,
    [CELL_KM],
  );
  await db.end();

  const cellKey = (cx: string, cy: string): string => `${cx}:${cy}`;
  const supplyMap = new Map(supply.rows.map((r) => [cellKey(r.cx, r.cy), r]));
  const matMap = new Map(material.rows.map((r) => [cellKey(r.cx, r.cy), r]));

  const cells: Array<Record<string, unknown>> = [];
  let healthy = 0;
  let weak = 0;
  let desert = 0;
  const targets: Array<{ lng: number; lat: number; km: number }> = [];
  for (const [key, mat] of matMap) {
    const segs = Number(mat.segs);
    const sup = supplyMap.get(key);
    const names = sup ? Number(sup.names) : 0;
    const loops = sup ? Number(sup.loops) : 0;
    // material bar: enough curvy km to plausibly form rings
    const hasMaterial = segs >= 25;
    let cls: string;
    if (!hasMaterial) {
      cls = 'true_desert';
      desert++;
    } else if (names >= 2) {
      cls = 'healthy';
      healthy++;
    } else {
      cls = 'weak_generation';
      weak++;
      // cell centre back to lng/lat for the targeted sweep
      const [cx, cy] = key.split(':').map(Number);
      targets.push({
        lng: ((cx! + 0.5) * CELL_KM) / (111.32 * Math.cos((43.8 * Math.PI) / 180)) - 180,
        lat: ((cy! + 0.5) * CELL_KM) / 111.32 - 90,
        km: Number(mat.km),
      });
    }
    cells.push({
      key,
      cls,
      materialSegs: segs,
      materialKm: Number(mat.km),
      loops,
      distinctNames: names,
      strict: sup ? Number(sup.strict) : 0,
      dupRatio: names > 0 ? +(loops / names).toFixed(1) : null,
      bands: sup ? { small: Number(sup.small), mid: Number(sup.mid), big: Number(sup.big) } : null,
    });
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    join(REPORT_DIR, `coverage-map-${version}.json`),
    JSON.stringify(
      { version, cellKm: CELL_KM, generatedAt: new Date().toISOString(), cells },
      null,
      1,
    ),
  );
  console.log(`coverage map (${version}): ${matMap.size} material cells`);
  console.log(`  healthy ${healthy} · weak_generation ${weak} · true_desert ${desert}`);
  const dupTotal = cells.reduce((t, c) => t + (Number(c['loops']) || 0), 0);
  const nameTotal = cells.reduce((t, c) => t + (Number(c['distinctNames']) || 0), 0);
  console.log(
    `  loops ${dupTotal} / distinct ${nameTotal} (dup ratio ${(dupTotal / Math.max(1, nameTotal)).toFixed(1)})`,
  );
  if (targets.length > 0) {
    // richest material first — a top-up's budget goes where rings are likeliest
    const cellsEnv = targets
      .sort((a, b) => b.km - a.km)
      .slice(0, 40)
      .map((t) => `${t.lng.toFixed(3)},${t.lat.toFixed(3)}`)
      .join(';');
    console.log(`\nTARGETED TOP-UP (weak_generation cells, ready for the sweep):`);
    console.log(`CELLS="${cellsEnv}"`);
  }
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
