/**
 * RQ36 follow-up — WHY did the r35 index serve 97 min for Uxbridge's 60-min
 * ask when the 66-min strict Mast Road ring exists in both versions? One
 * fixture, full forensic steps, one arm per process:
 *   DRIVE_CORES_VERSION=r34-rib npx tsx eval/experiments/rq36_uxbridge_trace.ts
 *   DRIVE_CORES_VERSION=r35-rib npx tsx eval/experiments/rq36_uxbridge_trace.ts
 */
import { Client } from 'pg';

import { DRIVE_CORES_VERSION } from '../../backend/src/planner/discover_cores';
import { parseRules } from '../../backend/src/planner/parse_rules';
import { runPlanner } from '../../backend/src/planner/run';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const UXBRIDGE = { lat: 44.108, lng: -79.121 };

async function main(): Promise<void> {
  console.log(`arm ${DRIVE_CORES_VERSION}`);
  const db = new Client({ connectionString: DB });
  await db.connect();
  const parsed = parseRules('60 minute backroads loop from Uxbridge');
  const constraints = {
    ...parsed,
    origin: UXBRIDGE,
    shape: 'loop' as const,
    destination: null,
    missing: parsed.missing.filter((m) => m !== 'origin'),
    clarification: { needed: false, question: null },
  };
  const res = await runPlanner(constraints, {
    db,
    valhallaUrl: VALHALLA,
    onEvent: (e) => {
      const x = e as unknown as { type?: string; label?: string; detail?: string; status?: string };
      if (x.detail !== undefined && x.detail !== '') {
        console.log(
          `  [${x.type ?? '?'}${x.label !== undefined ? ` ${x.label}` : ''}] ${x.detail}`,
        );
      }
    },
  });
  console.log(
    `status ${res.status} · duration ${res.route ? Math.round(res.route.duration_s / 60) : '—'} min`,
  );
  const words = (res as unknown as { summary?: string }).summary;
  if (words !== undefined) console.log(`words: ${words.slice(0, 260)}`);
  await db.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
