/**
 * RQ39 — the A→B STRUCTURAL LAW arms (BD-179, rule frozen pre-run).
 * One arm per process (module-load flag):
 *   ATOB_STRUCTURAL_LAW=off npx tsx eval/experiments/rq39_atob_law.ts
 *   ATOB_STRUCTURAL_LAW=on  npx tsx eval/experiments/rq39_atob_law.ts
 * Writes eval/reports/rq39/atob-<arm>.json (rq33 row shape, blind-sheet ready).
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { Client } from 'pg';

import { continuityOf } from '../../backend/src/planner/continuity';
import { selfIntersections, summarizeCrossings } from '../../backend/src/planner/crossings';
import {
  microloopPositions,
  spurPositions,
  SPUR_WINDOW_WIDE_STEPS,
} from '../../backend/src/planner/overlap';
import { parseRules } from '../../backend/src/planner/parse_rules';
import { classMixOf } from '../../backend/src/planner/roadclass';
import { ATOB_STRUCTURAL_LAW_ON, runPlanner } from '../../backend/src/planner/run';
import { uturnCount } from '../../backend/src/planner/score';
import { routeThrough } from '../../backend/src/valhalla/route';
import { traceRoadClasses } from '../../backend/src/valhalla/trace';
import { buildManifest, manifestLine } from '../manifest';
import { ATOB_GOLD_V1 } from '../suites/atob_gold_v1';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

async function main(): Promise<void> {
  const arm = ATOB_STRUCTURAL_LAW_ON ? 'on' : 'off';
  const manifest = await buildManifest({ suite: `rq39-atob-law-${arm}` });
  console.log(manifestLine(manifest));
  const db = new Client({ connectionString: DB });
  await db.connect();
  const rows: Array<Record<string, unknown>> = [];
  for (const f of ATOB_GOLD_V1) {
    const parsed = parseRules('backroads drive from A to B');
    const constraints = {
      ...parsed,
      origin: f.a,
      destination: f.b,
      shape: 'a_to_b' as const,
      missing: parsed.missing.filter((m) => m !== 'origin' && m !== 'destination'),
      clarification: { needed: false, question: null },
    };
    try {
      const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
      if (!res.route) {
        rows.push({
          kind: 'atob',
          label: f.label,
          brief: 'backroads drive',
          status: res.status,
          durationMin: null,
          honestWords: res.disclosures[0] ?? null,
          coords: [],
        });
        console.log(
          `  ${f.label.padEnd(26)} ${res.status} — ${(res.disclosures[0] ?? '').slice(0, 80)}`,
        );
        continue;
      }
      const geo = res.route.geometry;
      const direct = await routeThrough(VALHALLA, {
        waypoints: [
          [f.a.lng, f.a.lat],
          [f.b.lng, f.b.lat],
        ],
      });
      let mix: ReturnType<typeof classMixOf> = null;
      try {
        mix = classMixOf((await traceRoadClasses(VALHALLA, geo)).edges);
      } catch {
        mix = null;
      }
      const cont = continuityOf(res.route.maneuvers, res.route.duration_s);
      const x = summarizeCrossings(selfIntersections(geo, f.a));
      const spurs = spurPositions(geo, f.a, 500, SPUR_WINDOW_WIDE_STEPS).length;
      const crescents = microloopPositions(geo, f.a, 500).length;
      const ut = uturnCount(res.route);
      rows.push({
        kind: 'atob',
        label: f.label,
        brief: 'backroads drive',
        status: res.status,
        durationMin: Math.round(res.route.duration_s / 60),
        targetMin: null,
        distanceKm: +(res.route.distance_m / 1000).toFixed(1),
        backroadPct: mix ? Math.round(mix.backroadShare * 100) : null,
        mainPct: mix ? Math.round(mix.mainShare * 100) : null,
        hoodPct: mix ? Math.round(mix.hoodShare * 100) : null,
        turnsPer10min: null,
        oabLongestM: null,
        spurs,
        microloops: crescents,
        uturns: ut,
        crossings: x.knots + x.pierces,
        continuityMeanRunM: cont?.meanRunM ?? null,
        nameHopsPer10min: cont?.nameHopsPer10min ?? null,
        detourRatio:
          direct.distance_m > 0 ? +(res.route.distance_m / direct.distance_m).toFixed(2) : null,
        coords: (geo.coordinates as Array<[number, number]>).map(
          ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)] as [number, number],
        ),
      });
      const defects = [
        spurs > 0 ? `stubs${spurs}` : '',
        crescents > 0 ? `cres${crescents}` : '',
        ut > 0 ? `ut${ut}` : '',
        x.knots + x.pierces > 0 ? `x${x.knots + x.pierces}` : '',
      ]
        .filter(Boolean)
        .join('+');
      console.log(
        `  ${f.label.padEnd(26)} ${res.status.padEnd(11)} ${Math.round(res.route.duration_s / 60)}min · det ${(res.route.distance_m / direct.distance_m).toFixed(2)}× · back ${mix ? Math.round(mix.backroadShare * 100) : '—'}%${defects ? ` · DEFECTS ${defects}` : ''}`,
      );
    } catch (err) {
      console.log(`  ${f.label} ERROR ${String(err).slice(0, 60)}`);
    }
  }
  await db.end();
  mkdirSync('eval/reports/rq39', { recursive: true });
  writeFileSync(
    `eval/reports/rq39/atob-${arm}.json`,
    JSON.stringify({ manifest, routes: rows }, null, 1),
  );
  console.log(`wrote eval/reports/rq39/atob-${arm}.json`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
