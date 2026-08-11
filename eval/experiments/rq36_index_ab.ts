/**
 * RQ36 — the r34-vs-r35 INDEX A/B on the NEVER-TUNE holdout (BD-167 gate).
 *
 * Same planner, same flags, same law — the ONLY difference between arms is
 * which drive-core index serves (`DRIVE_CORES_VERSION`, a module-load pin, so
 * strictly one arm per process). This is the holdout's sanctioned use:
 * acceptance judgment of an already-frozen challenger index, feeding the
 * owner's blind sheet. Nothing here feeds tuning.
 *
 * One arm per process (run from the repo root; backend NOT involved):
 *   DRIVE_CORES_VERSION=r34-rib npx tsx eval/experiments/rq36_index_ab.ts
 *   DRIVE_CORES_VERSION=r35-rib npx tsx eval/experiments/rq36_index_ab.ts
 * Prereq for the r35 arm: artifact loaded via load_drive_cores_v2 --merge,
 * ribbons carried (carry_ribbons r34-rib r35-rib), dedup applied.
 * Then: python eval/make_blind_pairs.py eval/reports/rq36/holdout-loops-r34-rib.json \
 *         eval/reports/rq36/holdout-loops-r35-rib.json
 *
 * Row shape is IDENTICAL to rq33_holdout so make_blind_pairs.py and
 * score_blind.py ingest it unchanged.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { Client } from 'pg';

import { continuityOf } from '../../backend/src/planner/continuity';
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
import type { LatLng } from '../../shared/src/types';
import { buildManifest, manifestLine } from '../manifest';
import { LOOPS_HOLDOUT_V1 } from '../suites/holdout_v1';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const LOOP_ASKS = [60, 90];

async function main(): Promise<void> {
  const arm = DRIVE_CORES_VERSION; // the pinned index IS the arm
  if ((process.env['DRIVE_FIRST'] ?? 'on') === 'off') {
    throw new Error('rq36 judges the PRODUCTION surface — DRIVE_FIRST must stay on');
  }
  const manifest = await buildManifest({ suite: `rq36-index-ab-${arm}` });
  console.log(manifestLine(manifest));

  const db = new Client({ connectionString: DB });
  await db.connect();
  const have = await db.query<{ n: string }>(
    `select count(*)::text n from drive_cores where generator_version=$1 and kind='loop'`,
    [arm],
  );
  if (Number(have.rows[0]!.n) === 0)
    throw new Error(`index ${arm} has ZERO loop rows — load first`);
  console.log(`arm ${arm}: ${have.rows[0]!.n} loop rows in index`);

  const rows: Array<Record<string, unknown>> = [];
  const measure = async (
    res: Awaited<ReturnType<typeof runPlanner>>,
    origin: LatLng,
    targetMin: number,
    label: string,
    brief: string,
  ): Promise<void> => {
    if (!res.route) {
      rows.push({ kind: 'loop', label, brief, status: res.status, durationMin: null, coords: [] });
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
      kind: 'loop',
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
      detourRatio: null,
      coords: (geo.coordinates as Array<[number, number]>).map(
        ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)] as [number, number],
      ),
    });
  };

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
        await measure(res, f.at, min, f.label, brief);
        console.log(`  loop ${f.label} ${min}m ${res.status}`);
      } catch (err) {
        console.log(`  loop ${f.id} ${min}m ERROR ${String(err).slice(0, 50)}`);
      }
    }
  }

  await db.end();
  mkdirSync('eval/reports/rq36', { recursive: true });
  const out = `eval/reports/rq36/holdout-loops-${arm}.json`;
  writeFileSync(out, JSON.stringify({ manifest, routes: rows }, null, 1));
  console.log(`wrote ${out} (${rows.length} rows)`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
