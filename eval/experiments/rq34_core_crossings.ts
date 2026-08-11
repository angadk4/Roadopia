/**
 * BD-165 suspicion — are the STORED r34 loop cores themselves bowties?
 * `judgeCore` never measured self-crossings (a figure-eight shares ~zero
 * overlap cells with itself: SELF_OVERLAP, spurs, microloops all blind).
 * If crossed cores exist, Discover serves them UNGATED and Plan wastes
 * candidates on them — and no amount of serving-side gating (BD-161..164)
 * or R35 join optimization fixes the material.
 *
 * Run: npx tsx eval/experiments/rq34_core_crossings.ts
 */
import { Client } from 'pg';

import { selfIntersections, summarizeCrossings } from '../../backend/src/planner/crossings';
import type { LineString } from '../../shared/src/types';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const q = await db.query<{
    id: string;
    name: string;
    kind: string;
    geometry: LineString;
    duration_s: number;
  }>(
    `select id, name, kind, geometry, duration_s from drive_cores
     where generator_version = 'r34-rib' and kind = 'loop'`,
  );
  let crossed = 0;
  const examples: string[] = [];
  for (const row of q.rows) {
    const hits = selfIntersections(row.geometry, undefined, 0, 500);
    const sum = summarizeCrossings(hits);
    const total = sum.knots + sum.pierces;
    if (total > 0) {
      crossed++;
      if (examples.length < 12) {
        examples.push(
          `${row.name.slice(0, 30).padEnd(30)} ${Math.round(row.duration_s / 60)}min — ${total} crossing(s) [${row.id.slice(0, 40)}]`,
        );
      }
    }
  }
  console.log(`r34 loop cores: ${q.rows.length} · SELF-CROSSED: ${crossed}`);
  for (const e of examples) console.log(`  ${e}`);
  await db.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
