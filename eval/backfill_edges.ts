/**
 * R37-U13 (BD-178) — backfill DIRECTED EDGE IDENTITY for stored loop cores.
 * Traces each row's full-res geometry via /trace_attributes (way ids +
 * direction + GraphIds), stores `edges` + `edge_sig`, and stamps rows whose
 * tileset_id is missing (pre-0021 loads) with the CURRENT tileset — honest
 * because the trace itself runs on that tileset. Idempotent: rows with an
 * edge_sig already traced on the current tileset are skipped.
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx backfill_edges.ts r35-rib
 */
import { Client } from 'pg';

import { edgeSignature, traceEdgeIds } from '../backend/src/valhalla/trace';
import type { LineString } from '../shared/src/types';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

async function main(): Promise<void> {
  const version = process.argv[2] ?? 'r35-rib';
  const status = await fetch(`${VALHALLA}/status`).then(
    (r) => r.json() as Promise<{ tileset_last_modified?: number }>,
  );
  const tileset = String(status.tileset_last_modified ?? '');
  if (tileset === '') throw new Error('engine has no tileset identity — refusing to stamp');

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const rows = await db.query<{
    id: string;
    geometry: LineString | null;
    geom_simplified: LineString;
    tileset_id: string | null;
    edge_sig: string | null;
  }>(
    `select id, geometry, geom_simplified, tileset_id, edge_sig from drive_cores
     where generator_version = $1 and kind = 'loop'`,
    [version],
  );
  let traced = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of rows.rows) {
    if (r.edge_sig !== null && r.tileset_id === tileset) {
      skipped++;
      continue;
    }
    const geo = r.geometry ?? r.geom_simplified;
    try {
      const edges = await traceEdgeIds(VALHALLA, geo);
      const sig = edgeSignature(edges);
      if (sig === '') {
        failed++;
        continue;
      }
      await db.query(
        `update drive_cores set edges = $2, edge_sig = $3, tileset_id = $4 where id = $1`,
        [r.id, JSON.stringify(edges), sig, tileset],
      );
      traced++;
    } catch {
      failed++;
    }
  }
  const check = await db.query<{ n: string; roads: string }>(
    `select count(*) filter (where edge_sig is not null)::text n,
            round(avg(array_length(string_to_array(edge_sig, ','), 1)))::text roads
     from drive_cores where generator_version = $1 and kind = 'loop'`,
    [version],
  );
  console.log(
    `${version}: traced ${traced} · skipped(current) ${skipped} · failed ${failed} — ` +
      `${check.rows[0]!.n}/${rows.rows.length} rows carry edge_sig (mean ${check.rows[0]!.roads} directed-road runs) — tileset ${tileset}`,
  );
  await db.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
