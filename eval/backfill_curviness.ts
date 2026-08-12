/**
 * BD-172 — backfill loop curviness. Every loop row in every index version
 * carried curviness 0: the corpus builder's closed-ring skip (cul-de-sac
 * poison, 3bf5403) also zeroed loop ROUTES inside measureCurvature, so no
 * ranker could tell a concession-road square from a river ring. The measure
 * fix landed (allowClosedRing at route level); this recomputes stored rows
 * from their FULL-RES geometry in place. Idempotent; loops only.
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx backfill_curviness.ts r35-rib
 */
import { Client } from 'pg';

import { measureCurvature } from '../backend/src/planner/curvature';
import type { LineString } from '../shared/src/types';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function main(): Promise<void> {
  const version = process.argv[2] ?? 'r35-rib';
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const rows = await db.query<{
    id: string;
    geometry: LineString | null;
    geom_simplified: LineString;
  }>(
    `select id, geometry, geom_simplified from drive_cores
     where generator_version = $1 and kind = 'loop'`,
    [version],
  );
  let updated = 0;
  let skippedDegenerate = 0;
  const dist: number[] = [];
  await db.query('begin');
  for (const r of rows.rows) {
    const geo = r.geometry ?? r.geom_simplified; // full-res when present (0020)
    const m = measureCurvature(geo);
    if (m.skipped) {
      skippedDegenerate++;
      continue;
    }
    await db.query('update drive_cores set curviness = $2 where id = $1', [r.id, m.curviness]);
    dist.push(m.curviness);
    updated++;
  }
  await db.query('commit');
  dist.sort((a, b) => a - b);
  const q = (p: number): number => dist[Math.floor(p * (dist.length - 1))] ?? 0;
  console.log(
    `${version}: backfilled ${updated}/${rows.rows.length} loops (degenerate ${skippedDegenerate}) — ` +
      `curviness p10 ${q(0.1).toFixed(2)} · median ${q(0.5).toFixed(2)} · p90 ${q(0.9).toFixed(2)} · max ${q(1).toFixed(2)}`,
  );
  await db.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
