/**
 * RQ33 — HOLDOUT acceptance arms (Recovery §4.3/§17.4; BD-156 stage 2).
 *
 * Runs ONE arm over the NEVER-TUNE holdout fixtures so the blind review sheet
 * can be built (incumbent vs the rule-qualifying challenger). This is the
 * holdout's SANCTIONED use — acceptance judgment of an already-chosen
 * challenger. Nothing here feeds tuning.
 *
 * One arm per process (module-load flags):
 *   loops: DRIVE_FIRST=off [PROFILE_EXPERIMENT=Pn] SURFACE=loops npx tsx …
 *   atob:  [PROFILE_EXPERIMENT=Pn] SURFACE=atob npx tsx …
 * Artifacts: eval/reports/rq33/holdout-<surface>-<arm>.json
 * Then: python eval/make_blind_pairs.py holdout-<s>-P0_incumbent.json holdout-<s>-<arm>.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { Client } from 'pg';

import { continuityOf } from '../../backend/src/planner/continuity';
import { EXPERIMENT_PROFILES } from '../../backend/src/planner/costing';
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
import { routeThrough } from '../../backend/src/valhalla/route';
import { traceRoadClasses } from '../../backend/src/valhalla/trace';
import type { LatLng } from '../../shared/src/types';
import { buildManifest, manifestLine } from '../manifest';
import { ATOB_HOLDOUT_V1, LOOPS_HOLDOUT_V1 } from '../suites/holdout_v1';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const LOOP_ASKS = [60, 90];

async function main(): Promise<void> {
  const surface = process.env['SURFACE'] ?? 'atob';
  const exp = process.env['PROFILE_EXPERIMENT'];
  const arm = exp !== undefined && exp !== '' ? exp : 'P0_incumbent';
  if (exp !== undefined && exp !== '' && !EXPERIMENT_PROFILES[exp]) {
    throw new Error(`unknown PROFILE_EXPERIMENT ${exp}`);
  }
  if (surface === 'loops' && (process.env['DRIVE_FIRST'] ?? 'on') !== 'off') {
    throw new Error('loops holdout requires DRIVE_FIRST=off (the legacy surface is under test)');
  }
  const manifest = await buildManifest({ suite: `rq33-holdout-${surface}-${arm}` });
  console.log(manifestLine(manifest));

  const db = new Client({ connectionString: DB });
  await db.connect();
  const rows: Array<Record<string, unknown>> = [];

  const measure = async (
    res: Awaited<ReturnType<typeof runPlanner>>,
    origin: LatLng,
    targetMin: number | null,
    directM: number | null,
    kind: string,
    label: string,
    brief: string,
  ): Promise<void> => {
    if (!res.route) {
      rows.push({ kind, label, brief, status: res.status, durationMin: null, coords: [] });
      return;
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
    rows.push({
      kind,
      label,
      brief,
      status: res.status,
      durationMin: Math.round(mins),
      targetMin,
      distanceKm: +(res.route.distance_m / 1000).toFixed(1),
      backroadPct: mix ? Math.round(mix.backroadShare * 100) : null,
      mainPct: mix ? Math.round(mix.mainShare * 100) : null,
      hoodPct: mix ? Math.round(mix.hoodShare * 100) : null,
      turnsPer10min: mins > 0 ? +((res.route.maneuvers.length / mins) * 10).toFixed(1) : null,
      oabLongestM: Math.round(outAndBack(geo).longestM),
      spurs: spurPositions(geo, origin, 500, SPUR_WINDOW_WIDE_STEPS).length,
      microloops: microloopPositions(geo, origin, 500).length,
      uturns: uturnCount(res.route),
      continuityMeanRunM: cont?.meanRunM ?? null,
      nameHopsPer10min: cont?.nameHopsPer10min ?? null,
      detourRatio:
        directM !== null && directM > 0 ? +(res.route.distance_m / directM).toFixed(2) : null,
      coords: (geo.coordinates as Array<[number, number]>).map(
        ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)] as [number, number],
      ),
    });
  };

  if (surface === 'loops') {
    for (const f of LOOPS_HOLDOUT_V1) {
      for (const min of LOOP_ASKS) {
        const brief = `${min} minute backroads loop`;
        const parsed = parseRules(`${brief} from ${f.label}`);
        const constraints = {
          ...parsed,
          origin: f.at,
          shape: 'loop' as const,
          destination: null,
          missing: parsed.missing.filter((m) => m !== 'origin'),
          clarification: { needed: false, question: null },
        };
        try {
          const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
          await measure(res, f.at, min, null, 'loop', f.label, brief);
          console.log(`  loop ${f.label} ${min}m ${res.status}`);
        } catch (err) {
          console.log(`  loop ${f.id} ${min}m ERROR ${String(err).slice(0, 50)}`);
        }
      }
    }
  } else {
    for (const f of ATOB_HOLDOUT_V1) {
      const parsed = parseRules(`backroads drive from A to B`);
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
        const direct = await routeThrough(VALHALLA, {
          waypoints: [
            [f.a.lng, f.a.lat],
            [f.b.lng, f.b.lat],
          ],
        });
        await measure(res, f.a, null, direct.distance_m, 'atob', f.label, 'backroads drive');
        console.log(`  atob ${f.label} ${res.status}`);
      } catch (err) {
        console.log(`  atob ${f.id} ERROR ${String(err).slice(0, 50)}`);
      }
    }
  }

  await db.end();
  mkdirSync('eval/reports/rq33', { recursive: true });
  const out = `eval/reports/rq33/holdout-${surface}-${arm}.json`;
  writeFileSync(out, JSON.stringify({ manifest, routes: rows }, null, 1));
  console.log(`wrote ${out} (${rows.length} rows)`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
