/** RQ37d — full trace of the DEAD 2-hour ask at the owner's home (one-off).
 *  Run: DRIVE_CORES_VERSION=r36-rib npx tsx eval/experiments/rq37_home_2h_trace.ts */
import { Client } from 'pg';

import { parseRules } from '../../backend/src/planner/parse_rules';
import { runPlanner } from '../../backend/src/planner/run';

async function main(): Promise<void> {
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();
  const parsed = parseRules('2 hour backroads loop from home');
  const res = await runPlanner(
    {
      ...parsed,
      origin: { lat: 43.7565, lng: -79.8335 },
      shape: 'loop' as const,
      destination: null,
      missing: parsed.missing.filter((m) => m !== 'origin'),
      clarification: { needed: false, question: null },
    },
    { db, valhallaUrl: 'http://127.0.0.1:8002' },
  );
  for (const e of res.events) {
    const d = (e as { detail?: string }).detail ?? '';
    if (d !== '') console.log(`[${(e as { type?: string }).type ?? '?'}] ${d.slice(0, 1200)}`);
  }
  console.log('status', res.status);
  await db.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
