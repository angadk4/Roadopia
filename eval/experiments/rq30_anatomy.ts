/**
 * RQ30c — full anatomy of ONE failing trip build: every candidate's metrics,
 * where the doubling runs sit (which leg), where the spurs sit. Stops the
 * guess-and-retry loop; the numbers say which mechanism binds.
 *
 * Run: TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx eval/experiments/rq30_anatomy.ts
 */
import { Client } from 'pg';

import { LEGACY } from '../../backend/src/planner/costing';
import { DRIVE_CORES_VERSION, readDriveCores } from '../../backend/src/planner/discover_cores';
import { driveFirstTrip, ringArc } from '../../backend/src/planner/drive_first_trip';
import { outAndBack } from '../../backend/src/planner/outandback';
import {
  edgeOverlapRatio,
  microloopPositions,
  spurPositions,
  SPUR_WINDOW_WIDE_STEPS,
  loopiness,
} from '../../backend/src/planner/overlap';
import { routeThrough } from '../../backend/src/valhalla/route';
import type { LatLng, LineString } from '../../shared/src/types';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

const ORIGIN: LatLng = { lat: 43.7565, lng: -79.8335 }; // Southfields exact
const ASK_MIN = 90;

function hav(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function whereAlong(coords: Array<[number, number]>, breaks: number[], atM: number): string {
  // breaks = cumulative metres at [end-of-out, end-of-arc]
  if (atM <= breaks[0]!) return 'OUT';
  if (atM <= breaks[1]!) return 'ARC';
  return 'HOME';
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();

  const half = 25_000 / 111_320;
  const rows = await readDriveCores(
    db,
    [ORIGIN.lng - half, ORIGIN.lat - half, ORIGIN.lng + half, ORIGIN.lat + half],
    DRIVE_CORES_VERSION,
    50,
    'loop',
  );
  console.log(`cores in reach: ${rows.length}`);

  // replicate the builder's candidate order by calling driveFirstTrip once
  const outcome = await driveFirstTrip(db, VALHALLA, ORIGIN, ASK_MIN * 60);
  console.log(
    `builder verdict: ${outcome.trip ? 'SERVED ' + outcome.trip.core.name : 'nothing passed'}`,
  );
  for (const r of outcome.rejected) console.log(`  rejected ${r.id}: ${r.failures.join('+')}`);

  // now hand-build the FIRST rejected candidate and dissect it
  const target = rows.find((r) => r.id === outcome.rejected[0]?.id) ?? rows[0]!;
  console.log(`\n=== dissecting ${target.id} (${target.name}) ===`);
  console.log(
    `ring: ${(target.distance_m / 1000).toFixed(1)} km, ${Math.round(target.duration_s / 60)} min, backroad ${Math.round(
      target.backroad_share * 100,
    )}%`,
  );

  const commutePredS = (2 * hav(ORIGIN, target.entry) * 1.3) / (55_000 / 3600);
  const arc = ringArc(
    target,
    ORIGIN,
    ((ASK_MIN * 60 - commutePredS) / Math.max(1, target.duration_s)) * target.distance_m,
  )!;
  console.log(
    `arc: frac ${arc.frac.toFixed(2)}, ${(arc.distanceM / 1000).toFixed(1)} km, ${Math.round(
      arc.durationS / 60,
    )} min; J1→J2 sep ${Math.round(hav(arc.entry, arc.exit))} m; origin→J1 ${
      Math.round(hav(ORIGIN, arc.entry) / 100) / 10
    } km`,
  );

  const costingOptions = { ...LEGACY.options };
  const out = await routeThrough(VALHALLA, {
    waypoints: [
      [ORIGIN.lng, ORIGIN.lat],
      [arc.entry.lng, arc.entry.lat],
    ],
    costingOptions,
  });
  const home = await routeThrough(VALHALLA, {
    waypoints: [
      [arc.exit.lng, arc.exit.lat],
      [ORIGIN.lng, ORIGIN.lat],
    ],
    costingOptions,
  });
  console.log(
    `out : ${(out.distance_m / 1000).toFixed(1)} km ${Math.round(out.duration_s / 60)} min`,
  );
  console.log(
    `home: ${(home.distance_m / 1000).toFixed(1)} km ${Math.round(home.duration_s / 60)} min (direct, no ladder)`,
  );
  console.log(`out↔home overlap: ${edgeOverlapRatio(home.geometry, out.geometry).toFixed(2)}`);

  const outC = out.geometry.coordinates as Array<[number, number]>;
  const arcC = arc.geometry.coordinates as Array<[number, number]>;
  const homeC = home.geometry.coordinates as Array<[number, number]>;
  const coords = [...outC, ...arcC.slice(1), ...homeC.slice(1)];
  const geometry: LineString = { type: 'LineString', coordinates: coords };

  // cumulative metres to locate defects per leg
  const latM = 111_320;
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    cum.push(
      cum[i - 1]! +
        Math.hypot((b[1] - a[1]) * latM, (b[0] - a[0]) * latM * Math.cos((a[1] * Math.PI) / 180)),
    );
  }
  const outEndM = cum[outC.length - 1]!;
  const arcEndM = cum[outC.length - 1 + arcC.length - 1]!;

  const lp = loopiness(geometry);
  console.log(`\ntrip loopiness: ${lp?.toFixed(3)} (bar 0.25)`);

  const oab = outAndBack(geometry);
  console.log(`oab runs (${oab.runs.length}), floor 250 m:`);
  for (const r of oab.runs.slice(0, 8)) {
    console.log(
      `  at ${(r.atM / 1000).toFixed(1)} km [${whereAlong(coords, [outEndM, arcEndM], r.atM)}] length ${Math.round(
        r.lengthM,
      )} m`,
    );
  }

  const spurs = spurPositions(geometry, ORIGIN, 500, SPUR_WINDOW_WIDE_STEPS);
  console.log(`spurs (grace 500): ${spurs.length}`);
  for (const p of spurs.slice(0, 8)) {
    // locate along route
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = Math.hypot(
        (coords[i]![1] - p[1]) * latM,
        (coords[i]![0] - p[0]) * latM * Math.cos((p[1] * Math.PI) / 180),
      );
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    console.log(
      `  near ${(cum[bestI]! / 1000).toFixed(1)} km [${whereAlong(coords, [outEndM, arcEndM], cum[bestI]!)}] (${p[1].toFixed(4)},${p[0].toFixed(4)})`,
    );
  }
  const micro = microloopPositions(geometry, ORIGIN, 500);
  console.log(`microloops (grace 500): ${micro.length}`);

  await db.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
