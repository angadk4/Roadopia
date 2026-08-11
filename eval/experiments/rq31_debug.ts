import { Client } from 'pg';

import { atobDriveFirst } from '../../backend/src/planner/drive_first_atob';
import { parseRules } from '../../backend/src/planner/parse_rules';
import { runPlanner } from '../../backend/src/planner/run';

async function main(): Promise<void> {
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();
  for (const [an, a, bn, b] of [
    ['Southfields', { lat: 43.7565, lng: -79.8335 }, 'Hockley', { lat: 44.0378, lng: -79.9089 }],
    ['Brampton', { lat: 43.7315, lng: -79.7624 }, 'Belfountain', { lat: 43.7935, lng: -80.0088 }],
    ['Barrie', { lat: 44.3894, lng: -79.6903 }, 'Collingwood', { lat: 44.5001, lng: -80.2169 }],
  ] as const) {
    const o = await atobDriveFirst(db, 'http://127.0.0.1:8002', a, b, { avoidHighways: true });
    console.log(
      `${an}->${bn} DIRECT: ${o.trip ? 'SERVED ' + o.trip.ribbon.name : 'null ' + o.rejected.map((r) => r.failures.join('+')).join(',')}`,
    );
    const parsed = parseRules(`backroads drive from ${an} to ${bn}`);
    const constraints = {
      ...parsed,
      origin: a,
      destination: b,
      shape: 'a_to_b' as const,
      missing: parsed.missing.filter((m) => m !== 'origin' && m !== 'destination'),
      clarification: { needed: false, question: null },
    };
    const res = await runPlanner(constraints, {
      db,
      valhallaUrl: 'http://127.0.0.1:8002',
      emit: (e: { type: string; step?: string; detail?: string }) => {
        if (e.type === 'step' && e.step === 'drive_first_trip')
          console.log('   STEP:', (e.detail ?? '').slice(0, 120));
      },
    } as never);
    console.log(
      `   via runPlanner: ${res.disclosures.find((d) => d.includes('on the way')) ?? 'legacy'}`,
    );
  }
  await db.end();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
