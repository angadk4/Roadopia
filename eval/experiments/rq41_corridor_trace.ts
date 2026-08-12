/** RQ41 — full trace of one A→B corridor's serve/fallback path.
 *  Run: ATOB_STRUCTURAL_LAW=on BRIDGE_AWARE_FALLBACK=on npx tsx eval/experiments/rq41_corridor_trace.ts <label-substring> */
import { Client } from 'pg';

import { parseRules } from '../../backend/src/planner/parse_rules';
import { runPlanner } from '../../backend/src/planner/run';
import { ATOB_GOLD_V1 } from '../suites/atob_gold_v1';

async function main(): Promise<void> {
  const want = process.argv[2] ?? 'Milton';
  const f = ATOB_GOLD_V1.find((x) => x.label.includes(want));
  if (!f) throw new Error(`no corridor matching ${want}`);
  console.log(`corridor: ${f.label}`);
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();
  const parsed = parseRules('backroads drive from A to B');
  const res = await runPlanner(
    {
      ...parsed,
      origin: f.a,
      destination: f.b,
      shape: 'a_to_b' as const,
      missing: parsed.missing.filter((m) => m !== 'origin' && m !== 'destination'),
      clarification: { needed: false, question: null },
    },
    { db, valhallaUrl: 'http://127.0.0.1:8002' },
  );
  for (const e of res.events) {
    const d = (e as { detail?: string }).detail ?? '';
    if (d !== '' && /judge|fallback|exempt|served|FINAL/i.test(d)) {
      console.log(`  [${(e as { type?: string }).type ?? '?'}] ${d.slice(0, 240)}`);
    }
  }
  console.log('status', res.status);
  await db.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
