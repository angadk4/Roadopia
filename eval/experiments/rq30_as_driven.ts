/**
 * RQ30 — measure the trip AS DRIVEN, not as judged.
 *
 * The owner's report (2026-08-08, device, adopted R29 config): "The drives dont
 * look like loops. Theres so many random turns. Theres so many occurences where
 * it goes into a random street or random neighbourhood for no reason makes us do
 * a u turn or go around a crescent, then continue on the same road." And: "I
 * have no clue how you arent finding this out yourself through the audits."
 *
 * He is right that the audits cannot see it, and this probe exists to prove
 * where the blindness is. Four structural gaps, all in the instrument:
 *
 *   1. `defectsOf` (audit v13/v16/v17) has NO row for spurs, microloops or
 *      u-turns. Its only doubling detector is `outAndBack`, whose floor is
 *      OAB_MIN_RUN_M = 250 m — a crescent or an in-and-out street stub is
 *      80-250 m and is therefore invisible BY CONSTRUCTION.
 *   2. Every spur/microloop detector takes `graceRadiusM = ORIGIN_GRACE_RADIUS_M
 *      = 2500`, which suppresses defects within 2.5 km of the origin. The owner
 *      starts INSIDE a subdivision (Southfields), so the exact stretch he is
 *      complaining about is the stretch the detectors are told to ignore.
 *   3. `judgeCore` hard-rejects cores on u-turns/spurs/microloops — but the
 *      drive-first trip is core + TWO CONNECTORS, and the connectors are built
 *      by `routeThrough` with BACKROADS costing and are NEVER judged by
 *      anything. They are ~half the driven minutes.
 *   4. `loopiness` is measured on the CORE only. The shape the driver actually
 *      sees is out-connector + core + home-connector, which nothing measures.
 *
 * So: same production entry (`runPlanner` — the judge-through-runPlanner rule),
 * but every detector run at a LOW floor, with grace radius 0, PER LEG and on the
 * WHOLE trip. Run with OAB_MIN_RUN_M=60 to drop the doubling floor too.
 *
 * Run from repo root:
 *   TSX_TSCONFIG_PATH=backend/tsconfig.json OAB_MIN_RUN_M=60 \
 *     npx tsx eval/experiments/rq30_as_driven.ts
 */
import { writeFileSync } from 'node:fs';

import { Client } from 'pg';

import { driveGeometry, splitLoopLegs } from '../../backend/src/planner/legs';
import { outAndBack } from '../../backend/src/planner/outandback';
import {
  loopiness,
  microloopPositions,
  spurPositions,
  SPUR_WINDOW_WIDE_STEPS,
} from '../../backend/src/planner/overlap';
import { parseRules } from '../../backend/src/planner/parse_rules';
import { classMixOf } from '../../backend/src/planner/roadclass';
import { runPlanner } from '../../backend/src/planner/run';
import { uturnCount } from '../../backend/src/planner/score';
import { traceRoadClasses } from '../../backend/src/valhalla/trace';
import type { LatLng, LineString } from '../../shared/src/types';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

/** The owner's own two areas, exactly as audit_v13 seeds them. */
const SOUTHFIELDS: LatLng = { lat: 43.7565, lng: -79.8335 };
const BRAMPTON: LatLng = { lat: 43.7315, lng: -79.7624 };

/** Deterministic jitter (no Math.random — reproducible probe). */
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
}
for (let i = 0; i < 6; i++) {
  ORIGINS.push({
    label: `Brampton ${i + 1}`,
    at: {
      lat: +(BRAMPTON.lat + jit(i + 81, 0.03)).toFixed(5),
      lng: +(BRAMPTON.lng + jit(i + 121, 0.03)).toFixed(5),
    },
  });
}

const BRIEFS = ['90 minute backroads loop', '1 hour backroads loop', '2 hour twisty loop'];

interface LegMetrics {
  name: string;
  km: number;
  /** Spurs with NO origin grace — the "into a street, u-turn, back out" defect. */
  spurs: number;
  /** Same detector at the SHIPPED grace radius, to size the blind spot. */
  spursGraced: number;
  /** Crescents / "random box at the top". */
  microloops: number;
  microloopsGraced: number;
  /** Doubling at whatever OAB_MIN_RUN_M is set to (run this probe at 60). */
  oabRuns: number;
  oabLongestM: number;
  hoodPct: number | null;
  backroadPct: number | null;
  mainPct: number | null;
}

async function measureLeg(name: string, geo: LineString): Promise<LegMetrics> {
  const coords = geo.coordinates as Array<[number, number]>;
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const dLat = (b[1] - a[1]) * 111_320;
    const dLng = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
    km += Math.hypot(dLat, dLng);
  }
  km /= 1000;

  let mix: { hoodShare: number; backroadShare: number; mainShare: number } | null = null;
  try {
    const t = await traceRoadClasses(VALHALLA, geo);
    mix = classMixOf(t.edges);
  } catch {
    mix = null;
  }

  const oab = outAndBack(geo);
  return {
    name,
    km: +km.toFixed(1),
    // graceRadiusM = 0 → the near-origin stretch is NOT hidden
    spurs: spurPositions(geo, undefined, 0, SPUR_WINDOW_WIDE_STEPS).length,
    spursGraced: spurPositions(geo, coordOf(coords[0]), 2500, SPUR_WINDOW_WIDE_STEPS).length,
    microloops: microloopPositions(geo, undefined, 0).length,
    microloopsGraced: microloopPositions(geo, coordOf(coords[0]), 2500).length,
    oabRuns: oab.runs.length,
    oabLongestM: Math.round(oab.longestM),
    hoodPct: mix ? +(mix.hoodShare * 100).toFixed(1) : null,
    backroadPct: mix ? +(mix.backroadShare * 100).toFixed(1) : null,
    mainPct: mix ? +(mix.mainShare * 100).toFixed(1) : null,
  };
}

function coordOf(c: [number, number] | undefined): LatLng | undefined {
  return c ? { lat: c[1], lng: c[0] } : undefined;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const rows: Array<Record<string, unknown>> = [];

  console.log(
    `RQ30 — the trip AS DRIVEN. OAB floor = ${process.env['OAB_MIN_RUN_M'] ?? '250 (DEFAULT — pass 60)'}\n`,
  );

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
        if (!res.route) {
          console.log(`${o.label.padEnd(16)} ${brief.padEnd(24)} ${res.status} — NO ROUTE`);
          continue;
        }
        const geo = res.route.geometry;
        const served = res.disclosures.some((d) => d.includes('measured drive fit'));
        const split = splitLoopLegs(geo, res.waypoints ?? []);

        const legs: LegMetrics[] = [await measureLeg('WHOLE', geo)];
        if (split) {
          const coords = geo.coordinates as Array<[number, number]>;
          legs.push(
            await measureLeg('there', {
              type: 'LineString',
              coordinates: coords.slice(0, split.driveStartIdx + 1),
            }),
            await measureLeg('drive', driveGeometry(geo, split)),
            await measureLeg('home', {
              type: 'LineString',
              coordinates: coords.slice(split.driveEndIdx),
            }),
          );
        }

        const whole = legs[0]!;
        const row = {
          label: o.label,
          brief,
          served,
          status: res.status,
          km: whole.km,
          min: Math.round(res.route.duration_s / 60),
          uturns: uturnCount(res.route),
          maneuvers: res.route.maneuvers.length,
          tripLoopiness: loopiness(geo),
          coreLoopiness: res.loopiness ?? null,
          legs,
        };
        rows.push(row);

        console.log(
          `${o.label.padEnd(16)} ${brief.padEnd(24)} ${served ? 'SERVED' : 'legacy'} ` +
            `${String(whole.km).padStart(5)}km ${String(row.min).padStart(3)}min  ` +
            `loopiness=${row.tripLoopiness === null ? '—' : row.tripLoopiness.toFixed(2)}  ` +
            `uturns=${row.uturns}`,
        );
        for (const l of legs) {
          console.log(
            `    ${l.name.padEnd(6)} ${String(l.km).padStart(5)}km  ` +
              `spurs=${String(l.spurs).padStart(2)} (graced ${l.spursGraced})  ` +
              `micro=${String(l.microloops).padStart(2)} (graced ${l.microloopsGraced})  ` +
              `oab=${l.oabRuns}/${l.oabLongestM}m  ` +
              `hood=${l.hoodPct ?? '—'}% back=${l.backroadPct ?? '—'}%`,
          );
        }
      } catch (err) {
        console.log(`${o.label.padEnd(16)} ${brief.padEnd(24)} ERROR ${String(err).slice(0, 60)}`);
      }
    }
  }
  await db.end();

  // ---- aggregates: what the shipped audit would have said vs what is there
  const n = rows.length;
  const legOf = (r: Record<string, unknown>, name: string): LegMetrics | undefined =>
    (r['legs'] as LegMetrics[]).find((l) => l.name === name);
  const sum = (f: (r: Record<string, unknown>) => number): number =>
    rows.reduce((t, r) => t + f(r), 0);

  console.log(`\n=== RQ30 SUMMARY (${n} routes, the owner's own two areas) ===`);
  console.log(`served by the measured index : ${rows.filter((r) => r['served']).length}/${n}`);

  for (const legName of ['WHOLE', 'there', 'drive', 'home']) {
    const ls = rows.map((r) => legOf(r, legName)).filter((l): l is LegMetrics => l !== undefined);
    if (ls.length === 0) continue;
    const tot = (f: (l: LegMetrics) => number): number => ls.reduce((t, l) => t + f(l), 0);
    console.log(
      `\n${legName}  (n=${ls.length})` +
        `\n  spurs        : ${tot((l) => l.spurs)} total · ${ls.filter((l) => l.spurs > 0).length}/${ls.length} routes affected` +
        `\n    …but at the SHIPPED grace radius the audit would see only ${tot((l) => l.spursGraced)}` +
        `\n  microloops   : ${tot((l) => l.microloops)} total · ${ls.filter((l) => l.microloops > 0).length}/${ls.length} routes` +
        `\n    …shipped grace radius would see ${tot((l) => l.microloopsGraced)}` +
        `\n  doubling runs: ${tot((l) => l.oabRuns)} · longest ${Math.max(...ls.map((l) => l.oabLongestM))} m` +
        `\n  hood share   : mean ${(tot((l) => l.hoodPct ?? 0) / ls.length).toFixed(1)} %  ` +
        `(worst ${Math.max(...ls.map((l) => l.hoodPct ?? 0)).toFixed(1)} %)` +
        `\n  backroad     : mean ${(tot((l) => l.backroadPct ?? 0) / ls.length).toFixed(1)} %`,
    );
  }

  const loopy = rows
    .map((r) => r['tripLoopiness'] as number | null)
    .filter((x): x is number => x !== null);
  console.log(
    `\nWHOLE-TRIP loopiness (does it LOOK like a loop?)` +
      `\n  mean ${(loopy.reduce((a, b) => a + b, 0) / Math.max(1, loopy.length)).toFixed(2)}  ` +
      `min ${Math.min(...loopy).toFixed(2)}  ` +
      `below the 0.25 core bar: ${loopy.filter((x) => x < 0.25).length}/${loopy.length}` +
      `\n  (the core bar CORE_LOOPINESS_MIN=0.25 is applied to the core only — never to this)`,
  );
  console.log(`\nu-turns total: ${sum((r) => r['uturns'] as number)}`);

  writeFileSync('eval/reports/rq30-as-driven.json', JSON.stringify({ rows }, null, 1));
  console.log('\nwrote eval/reports/rq30-as-driven.json');
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
