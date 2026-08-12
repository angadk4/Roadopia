/**
 * RQ37b — TWISTY_TRIP_RANK adopt-or-refuse (BD-171, rule frozen pre-run).
 *
 * One arm per process (module-load flag):
 *   TWISTY_TRIP_RANK=off npx tsx eval/experiments/rq37_twisty_ab.ts
 *   TWISTY_TRIP_RANK=on  npx tsx eval/experiments/rq37_twisty_ab.ts
 * Writes eval/reports/rq37/twisty-<arm>.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { Client } from 'pg';

import { TWISTY_TRIP_RANK_ON } from '../../backend/src/planner/drive_first_trip';
import { parseRules } from '../../backend/src/planner/parse_rules';
import { runPlanner } from '../../backend/src/planner/run';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

const ORIGINS = [
  { label: 'Home', at: { lat: 43.7565, lng: -79.8335 } },
  { label: 'Bolton', at: { lat: 43.8747, lng: -79.7376 } },
  { label: 'Creemore', at: { lat: 44.3273, lng: -80.1057 } },
  { label: 'Fergus', at: { lat: 43.7054, lng: -80.3799 } },
  { label: 'Uxbridge', at: { lat: 44.108, lng: -79.121 } },
  { label: 'Port Perry', at: { lat: 44.1006, lng: -78.9429 } },
];
const BRIEFS = [
  '60 minute backroads loop',
  '60 minute twisty loop',
  '90 minute backroads loop',
  '90 minute twisty loop',
];

async function main(): Promise<void> {
  const arm = TWISTY_TRIP_RANK_ON ? 'on' : 'off';
  console.log(`arm TWISTY_TRIP_RANK=${arm}`);
  const db = new Client({ connectionString: DB });
  await db.connect();
  const rows: Array<Record<string, unknown>> = [];
  for (const o of ORIGINS) {
    for (const brief of BRIEFS) {
      const parsed = parseRules(`${brief} from ${o.label}`);
      const constraints = {
        ...parsed,
        origin: o.at,
        shape: 'loop' as const,
        destination: null,
        missing: parsed.missing.filter((m) => m !== 'origin'),
        clarification: { needed: false, question: null },
      };
      try {
        const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
        // served core id from the forensic step line (null on legacy/no serve)
        let coreId: string | null = null;
        for (const e of res.events) {
          const d = (e as { detail?: string }).detail ?? '';
          const m = /served (?:exact|alternate) (\S+)/.exec(d);
          if (m) coreId = m[1] ?? null;
        }
        let coreCurv: number | null = null;
        if (coreId !== null) {
          const q = await db.query<{ curviness: number }>(
            'select curviness from drive_cores where id = $1',
            [coreId],
          );
          coreCurv = q.rows[0]?.curviness ?? null;
        }
        rows.push({
          label: o.label,
          brief,
          twistyAsk: brief.includes('twisty'),
          status: res.status,
          durationMin: res.route ? Math.round(res.route.duration_s / 60) : null,
          coreId,
          coreCurv,
          coordsHash: res.route
            ? JSON.stringify(res.route.geometry.coordinates.slice(0, 40))
            : null,
        });
        console.log(
          `  ${o.label.padEnd(10)} ${brief.padEnd(26)} ${res.status.padEnd(12)} core ${coreId ?? 'legacy/none'} curv ${coreCurv ?? '—'}`,
        );
      } catch (err) {
        console.log(`  ${o.label} ${brief} ERROR ${String(err).slice(0, 60)}`);
      }
    }
  }
  await db.end();
  mkdirSync('eval/reports/rq37', { recursive: true });
  writeFileSync(`eval/reports/rq37/twisty-${arm}.json`, JSON.stringify(rows, null, 1));
  console.log(`wrote eval/reports/rq37/twisty-${arm}.json`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
