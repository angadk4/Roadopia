/**
 * RQ30b — WHY does every candidate die at the as-driven gates?
 *
 * rq30 after BD-146: served 0/36 (was 36/36 on the broken ruler). The gates
 * are the owner's words, so they stay; this probe names the binding gate per
 * candidate so the CONSTRUCTION can be fixed (better home-ladder, exclusion
 * zones), not the bars.
 *
 * Run: TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx eval/experiments/rq30_reject_reasons.ts
 */
import { Client } from 'pg';

import { driveFirstTrip } from '../../backend/src/planner/drive_first_trip';
import type { LatLng } from '../../shared/src/types';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

const SOUTHFIELDS: LatLng = { lat: 43.7565, lng: -79.8335 };
const BRAMPTON: LatLng = { lat: 43.7315, lng: -79.7624 };

function jit(i: number, spread: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 2 * spread;
}

const ORIGINS: Array<{ label: string; at: LatLng }> = [];
for (let i = 0; i < 6; i++) {
  ORIGINS.push({
    label: `Southfields ${i + 1}`,
    at: {
      lat: +(SOUTHFIELDS.lat + jit(i + 1, 0.012)).toFixed(5),
      lng: +(SOUTHFIELDS.lng + jit(i + 41, 0.012)).toFixed(5),
    },
  });
  ORIGINS.push({
    label: `Brampton ${i + 1}`,
    at: {
      lat: +(BRAMPTON.lat + jit(i + 81, 0.03)).toFixed(5),
      lng: +(BRAMPTON.lng + jit(i + 121, 0.03)).toFixed(5),
    },
  });
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const hist = new Map<string, number>();
  let candidates = 0;
  let noCandidates = 0;
  let served = 0;

  for (const o of ORIGINS) {
    for (const min of [60, 90, 120]) {
      const outcome = await driveFirstTrip(db, VALHALLA, o.at, min * 60);
      if (outcome.trip) {
        served++;
        console.log(
          `${o.label.padEnd(14)} ${String(min).padStart(3)}min SERVED ${outcome.trip.core.name} ` +
            `(all-in ${Math.round(outcome.trip.durationS / 60)}min, loopy ${outcome.trip.metrics.loopiness?.toFixed(2)}, ` +
            `commute ${Math.round(outcome.trip.metrics.commuteShare * 100)}%)`,
        );
      }
      if (outcome.rejected.length === 0 && !outcome.trip) noCandidates++;
      for (const r of outcome.rejected) {
        candidates++;
        for (const f of r.failures) hist.set(f, (hist.get(f) ?? 0) + 1);
        console.log(
          `${o.label.padEnd(14)} ${String(min).padStart(3)}min reject ${r.id.slice(0, 34).padEnd(34)} ${r.failures.join('+')}`,
        );
      }
    }
  }
  await db.end();

  console.log(`\n=== gate histogram over ${candidates} rejected candidates ===`);
  for (const [k, v] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }
  console.log(`asks with NO candidate in reach at all: ${noCandidates}/36`);
  console.log(`served: ${served}/36`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
