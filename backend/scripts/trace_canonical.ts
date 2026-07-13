/** Diagnose: timestamped event trace of the canonical e2e brief. */
import { Client } from 'pg';

import { parseRules } from '../src/planner/parse_rules';
import { runPlanner } from '../src/planner/run';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA_URL = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const constraints = parseRules(
    '90 minute twisty loop from Hamilton with a coffee stop, no highways',
  );
  const t0 = performance.now();
  const result = await runPlanner(constraints, {
    db,
    valhallaUrl: VALHALLA_URL,
    onEvent: (e) => {
      const t = Math.round(performance.now() - t0);
      if (e.type === 'step') console.log(`${t}ms  ${e.step} ${e.status} ${e.detail ?? ''}`);
      else console.log(`${t}ms  [${e.type}]`);
    },
  });
  console.log(`TOTAL ${Math.round(performance.now() - t0)}ms status=${result.status}`);
  await db.end();
}
main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
