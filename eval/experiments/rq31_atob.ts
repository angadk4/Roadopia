/**
 * RQ31 — A→B drive-first (BD-151), on vs off, through the REAL runPlanner.
 * The audit's own 20 corridors. Bars (pre-registered in the BD-139 family):
 * backroad ≥ +8 pp mean · routed not down · doubling not up · detour ≤ the
 * standing cap (structural). Adopt-or-refuse.
 *
 * Run: TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx eval/experiments/rq31_atob.ts
 */
import { Client } from 'pg';

import { outAndBack } from '../../backend/src/planner/outandback';
import { parseRules } from '../../backend/src/planner/parse_rules';
import { classMixOf } from '../../backend/src/planner/roadclass';
import { runPlanner } from '../../backend/src/planner/run';
import { routeThrough } from '../../backend/src/valhalla/route';
import { traceRoadClasses } from '../../backend/src/valhalla/trace';
import type { LatLng } from '../../shared/src/types';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

const PAIRS: Array<[string, LatLng, string, LatLng]> = [
  ['Hamilton', { lat: 43.2557, lng: -79.8711 }, 'Guelph', { lat: 43.5448, lng: -80.2482 }],
  ['Brampton', { lat: 43.7315, lng: -79.7624 }, 'Belfountain', { lat: 43.7935, lng: -80.0088 }],
  ['Southfields', { lat: 43.7565, lng: -79.8335 }, 'Hockley', { lat: 44.0378, lng: -79.9089 }],
  ['Guelph', { lat: 43.5448, lng: -80.2482 }, 'Erin', { lat: 43.7736, lng: -80.0714 }],
  ['Barrie', { lat: 44.3894, lng: -79.6903 }, 'Collingwood', { lat: 44.5001, lng: -80.2169 }],
  ['Cobourg', { lat: 43.9593, lng: -78.1677 }, 'Uxbridge', { lat: 44.1091, lng: -79.1204 }],
  ['Stratford', { lat: 43.3701, lng: -80.9822 }, 'Woodstock', { lat: 43.1315, lng: -80.757 }],
  ['Orangeville', { lat: 43.9199, lng: -80.0943 }, 'Creemore', { lat: 44.3236, lng: -80.1044 }],
  ['London', { lat: 42.9849, lng: -81.2453 }, 'Grand Bend', { lat: 43.3167, lng: -81.7539 }],
  ['Owen Sound', { lat: 44.569, lng: -80.9406 }, 'Collingwood', { lat: 44.5001, lng: -80.2169 }],
];

async function runArm(db: Client, on: boolean): Promise<void> {
  process.env['ATOB_DRIVE_FIRST'] = on ? 'on' : 'off';
  // the flag is read at import time — re-import per arm is impossible in one
  // process, so the arm is passed via env BEFORE first import in each run.
}

async function main(): Promise<void> {
  const on = (process.env['ATOB_DRIVE_FIRST'] ?? 'on') !== 'off';
  const db = new Client({ connectionString: DB });
  await db.connect();
  let routed = 0;
  let served = 0;
  const backs: number[] = [];
  const oabs: number[] = [];
  const detours: number[] = [];
  for (const [an, a, bn, b] of PAIRS) {
    const parsed = parseRules(`backroads drive from ${an} to ${bn}`);
    const constraints = {
      ...parsed,
      origin: a,
      destination: b,
      shape: 'a_to_b' as const,
      missing: parsed.missing.filter((m) => m !== 'origin' && m !== 'destination'),
      clarification: { needed: false, question: null },
    };
    try {
      const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
      if (!res.route) {
        console.log(`${an}→${bn}: NO ROUTE (${res.status})`);
        continue;
      }
      routed++;
      const isServed = res.disclosures.some((d) => d.includes('on the way'));
      if (isServed) served++;
      let back: number | null = null;
      try {
        const t = await traceRoadClasses(VALHALLA, res.route.geometry);
        const mix = classMixOf(t.edges);
        back = mix ? mix.backroadShare * 100 : null;
      } catch {
        back = null;
      }
      if (back !== null) backs.push(back);
      oabs.push(outAndBack(res.route.geometry).longestM);
      // R32-U3: CANONICAL detour denominator = the ROUTED direct distance
      // (crow-flies inflated ratios — the 1.92× "cap violation" was this bug).
      const directRoute = await routeThrough(VALHALLA, {
        waypoints: [
          [a.lng, a.lat],
          [b.lng, b.lat],
        ],
      });
      detours.push(res.route.distance_m / Math.max(1, directRoute.distance_m));
      console.log(
        `${an}→${bn}: ${isServed ? 'SERVED' : 'legacy'} back=${back?.toFixed(0) ?? '—'}% ` +
          `oab=${Math.round(outAndBack(res.route.geometry).longestM)}m detour=${detours[detours.length - 1]!.toFixed(2)}×`,
      );
    } catch (err) {
      console.log(`${an}→${bn}: ERROR ${String(err).slice(0, 60)}`);
    }
  }
  await db.end();
  console.log(`\n=== ARM ATOB_DRIVE_FIRST=${on ? 'on' : 'off'} ===`);
  console.log(`routed ${routed}/${PAIRS.length} · served ${served}`);
  console.log(
    `backroad mean ${(backs.reduce((x, y) => x + y, 0) / Math.max(1, backs.length)).toFixed(1)}%`,
  );
  console.log(
    `oab>1200m on ${oabs.filter((x) => x > 1200).length} · detour worst ${Math.max(...detours).toFixed(2)}×`,
  );
  void runArm;
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
