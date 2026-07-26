/**
 * RQ25 — single-brief presentation-key decomposition (the U6a `onScored` hook
 * as a hand tool). Prints the final iteration's scored pool sorted by
 * presentKey with every term named, so "why did THIS route win?" is a lookup,
 * not a guess. Used first for the U5ab iterate (St. Jacobs winner inversion).
 *
 * Run (from eval/):
 *   BRIEF="1 hour backroads loop from St. Jacobs" HOOD_MEASURE_V2=on \
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx experiments/rq25_brief_decomp.ts
 */

import { Client } from 'pg';

import { parseRules } from '../../backend/src/planner/parse_rules';
import { runPlanner, type ScoredDebugRow } from '../../backend/src/planner/run';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const brief = process.env['BRIEF'] ?? '1 hour backroads loop from St. Jacobs';
  const constraints = parseRules(brief);
  const iters: ScoredDebugRow[][] = [];
  const res = await runPlanner(constraints, {
    db,
    valhallaUrl: VALHALLA,
    onScored: (rows) => iters.push(rows),
  });
  await db.end();
  const pool = iters.at(-1) ?? [];
  const byKey = [...pool].sort((a, b) => b.presentKey - a.presentKey || (a.id < b.id ? -1 : 1));
  console.log(
    `brief: ${brief}\nstatus ${res.status}; iterations ${iters.length}; final pool ${pool.length}; ` +
      `presented ${res.route ? `${Math.round(res.route.duration_s / 60)} min, curv ${res.curviness?.toFixed(2) ?? '—'}` : '—'}`,
  );
  for (const s of byKey.slice(0, 15)) {
    const mix = s.classMix
      ? `m${Math.round(s.classMix.mainShare * 100)}/b${Math.round(s.classMix.backroadShare * 100)}/h${Math.round(s.classMix.hoodShare * 100)}`
      : 'untraced';
    console.log(
      `${s.id.padEnd(12)} key ${s.presentKey.toFixed(2).padStart(8)} score ${s.score.toFixed(2)} ` +
        `${mix.padEnd(12)} curv ${s.curviness.toFixed(2)} ${String(Math.round(s.durationS / 60)).padStart(3)}min ` +
        `res ${s.residentialShare === null ? ' null' : ((s.residentialShare * 100).toFixed(1) + '%').padStart(5)}/` +
        `${s.residentialRunM === null ? 'null' : Math.round(s.residentialRunM) + 'm'} ` +
        `${s.dirty ? `DIRTY[${s.dirtyClauses.join(',')}] u=${s.units}` : 'clean'}` +
        `${s.durOff ? ' durOff' : ''}${s.contextHeavy ? ' ctx' : ''}${s.traceNull ? ' TRACE_NULL' : ''}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
