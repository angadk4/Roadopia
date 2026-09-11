import { Client } from 'pg';

import { sweepTrip } from '../../backend/src/planner/loop_sweep';
import { computeOriginStem } from '../../backend/src/planner/origin_stem';
const VALHALLA = 'http://127.0.0.1:8002';
async function main() {
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();
  const cases: Array<[string, number, number, number]> = [
    ['home', 43.5312, -79.8827, 60],
    ['home', 43.5312, -79.8827, 90],
    ['home', 43.5312, -79.8827, 120],
    ['home-twisty', 43.5312, -79.8827, 90],
    ['newmarket', 44.0592, -79.4613, 90],
    ['southfields', 43.7565, -79.8335, 60],
    ['southfields', 43.7565, -79.8335, 90],
    ['southfields', 43.7565, -79.8335, 120],
  ];
  const only = process.env['SMOKE_ONLY'];
  for (const [name, lat, lng, mins] of cases) {
    if (only && !name.startsWith(only)) continue;
    const origin = { lat, lng };
    const stemM = await computeOriginStem(VALHALLA, origin, {});
    const t0 = performance.now();
    const reachM = Math.max(12_000, mins * 60 * 0.3 * (55_000 / 3600));
    const out = await sweepTrip(db, VALHALLA, origin, mins * 60, {
      reachM,
      stemM,
      costingOptions: { use_highways: 0.2, use_living_streets: 0 },
      deadlineMs: Date.now() + 12_000,
      ...(name.endsWith('twisty') ? { character: ['twisty'] } : {}),
    });
    const ms = Math.round(performance.now() - t0);
    const t = out.trip;
    console.log(
      `${name} ${mins}m: pieces ${out.pieces}, plans ${out.plans}, calls ${out.calls}, ${ms} ms → ` +
        (t
          ? `${t.tier} ${Math.round(t.durationS / 60)} min / ${(t.distanceM / 1000).toFixed(1)} km via ${t.pieceNames?.join(' → ')} ` +
            `(loop ${t.metrics.loopiness?.toFixed(2)}, commute ${(t.metrics.commuteShare * 100).toFixed(0)}%, fid ${t.fidelity.toFixed(2)}, alts ${out.alternates.length})`
          : 'NONE'),
    );
    for (const r of out.rejected as Array<{
      id: string;
      failures: string[];
      legs?: Array<{ kind: string; durationS: number; distanceM: number; uturns: number }>;
    }>) {
      console.log(
        `    - ${r.id}: ${r.failures.join('+')}` +
          (r.legs
            ? ` [${r.legs.map((l) => `${l.kind[0]}${Math.round(l.durationS / 60)}m${l.uturns ? '/u' + l.uturns : ''}`).join(' ')}]`
            : ''),
      );
    }
  }
  await db.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
