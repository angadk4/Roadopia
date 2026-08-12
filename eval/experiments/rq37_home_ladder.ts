/**
 * RQ37c — the HOME LADDER, version-pinned (BD-173 bars). Replays the owner's
 * device asks at his home origin through runPlanner with the index pinned by
 * env, measuring what BD-172 was about: served curviness. One arm per process:
 *   DRIVE_CORES_VERSION=r35-rib npx tsx eval/experiments/rq37_home_ladder.ts
 *   DRIVE_CORES_VERSION=r36-rib npx tsx eval/experiments/rq37_home_ladder.ts
 * Writes eval/reports/rq37/home-<arm>.json (rq33 row shape + servedCurv extras)
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { Client } from 'pg';

import { continuityOf } from '../../backend/src/planner/continuity';
import { measureCurvature } from '../../backend/src/planner/curvature';
import { DRIVE_CORES_VERSION } from '../../backend/src/planner/discover_cores';
import { outAndBack } from '../../backend/src/planner/outandback';
import {
  microloopPositions,
  spurPositions,
  SPUR_WINDOW_WIDE_STEPS,
} from '../../backend/src/planner/overlap';
import { parseRules } from '../../backend/src/planner/parse_rules';
import { classMixOf } from '../../backend/src/planner/roadclass';
import { runPlanner } from '../../backend/src/planner/run';
import { uturnCount } from '../../backend/src/planner/score';
import { traceRoadClasses } from '../../backend/src/valhalla/trace';
import { buildManifest, manifestLine } from '../manifest';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const HOME = { lat: 43.7565, lng: -79.8335 };
const ASKS: Array<{ brief: string; targetMin: number }> = [
  { brief: '45 minute backroads loop', targetMin: 45 },
  { brief: '1 hour backroads loop', targetMin: 60 },
  { brief: '90 minute backroads loop', targetMin: 90 },
  { brief: '2 hour backroads loop', targetMin: 120 },
  { brief: '1 hour twisty loop', targetMin: 60 },
  { brief: '60 minute backroads loop', targetMin: 60 },
];

async function main(): Promise<void> {
  const arm = DRIVE_CORES_VERSION;
  const manifest = await buildManifest({ suite: `rq37-home-${arm}` });
  console.log(manifestLine(manifest));
  const db = new Client({ connectionString: DB });
  await db.connect();
  const rows: Array<Record<string, unknown>> = [];
  const servedCores = new Set<string>();
  for (const a of ASKS) {
    const parsed = parseRules(`${a.brief} from home`);
    const constraints = {
      ...parsed,
      origin: HOME,
      shape: 'loop' as const,
      destination: null,
      missing: parsed.missing.filter((m) => m !== 'origin'),
      clarification: { needed: false, question: null },
    };
    try {
      const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
      let coreId: string | null = null;
      for (const e of res.events) {
        const m = /served (?:exact|alternate) (\S+)/.exec((e as { detail?: string }).detail ?? '');
        if (m) coreId = m[1] ?? null;
      }
      if (coreId !== null) servedCores.add(coreId);
      if (!res.route) {
        rows.push({
          kind: 'loop',
          label: 'Home',
          brief: a.brief,
          status: res.status,
          durationMin: null,
          coords: [],
        });
        console.log(`  ${a.brief.padEnd(26)} ${res.status} (no route)`);
        continue;
      }
      const geo = res.route.geometry;
      let mix: ReturnType<typeof classMixOf> = null;
      try {
        mix = classMixOf((await traceRoadClasses(VALHALLA, geo)).edges);
      } catch {
        mix = null;
      }
      const cont = continuityOf(res.route.maneuvers, res.route.duration_s);
      const mins = res.route.duration_s / 60;
      const servedCurv = measureCurvature(geo); // BD-172: closed loops now measure
      rows.push({
        kind: 'loop',
        label: 'Home',
        brief: a.brief,
        status: res.status,
        durationMin: Math.round(mins),
        targetMin: a.targetMin,
        distanceKm: +(res.route.distance_m / 1000).toFixed(1),
        backroadPct: mix ? Math.round(mix.backroadShare * 100) : null,
        mainPct: mix ? Math.round(mix.mainShare * 100) : null,
        hoodPct: mix ? Math.round(mix.hoodShare * 100) : null,
        turnsPer10min: mins > 0 ? +((res.route.maneuvers.length / mins) * 10).toFixed(1) : null,
        oabLongestM: Math.round(outAndBack(geo).longestM),
        spurs: spurPositions(geo, HOME, 500, SPUR_WINDOW_WIDE_STEPS).length,
        microloops: microloopPositions(geo, HOME, 500).length,
        uturns: uturnCount(res.route),
        continuityMeanRunM: cont?.meanRunM ?? null,
        nameHopsPer10min: cont?.nameHopsPer10min ?? null,
        detourRatio: null,
        servedCurv: +servedCurv.curviness.toFixed(2),
        coreId,
        coords: (geo.coordinates as Array<[number, number]>).map(
          ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)] as [number, number],
        ),
      });
      console.log(
        `  ${a.brief.padEnd(26)} ${res.status.padEnd(11)} ${Math.round(mins)} min · servedCurv ${servedCurv.curviness.toFixed(2)} · core ${coreId ?? 'legacy'}`,
      );
    } catch (err) {
      console.log(`  ${a.brief} ERROR ${String(err).slice(0, 60)}`);
    }
  }
  await db.end();
  console.log(`distinct cores served across the ladder: ${servedCores.size}`);
  mkdirSync('eval/reports/rq37', { recursive: true });
  writeFileSync(
    `eval/reports/rq37/home-${arm}.json`,
    JSON.stringify({ manifest, routes: rows }, null, 1),
  );
  console.log(`wrote eval/reports/rq37/home-${arm}.json`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
