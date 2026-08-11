/**
 * RQ33-U5 — THE `shortest` BAKE-OFF (BD-156, pre-registered; Recovery §5.2).
 *
 * Incumbent: BACKROADS-`shortest` (adopted R18-1 — but it never faced tuned
 * `auto`). Challengers: the FROZEN EXPERIMENT_PROFILES grid (costing.ts).
 * Every arm runs through the REAL runPlanner via PROFILE_EXPERIMENT — same
 * wall budget, same gates, same everything.
 *
 * Surfaces (profiles are shape-dependent — BD-111):
 *   LOOPS: legacy generation (DRIVE_FIRST=off) on the gold funnel/grid/
 *          desert/city-edge subset — the fallback material the profile shapes.
 *   A→B:   the full 25-corridor gold suite.
 *
 * ══ PRE-REGISTERED ADOPTION RULES (frozen before any arm ran) ══
 * A challenger beats the incumbent on a surface only if ALL hold on the GOLD
 * suite (holdout stays untouched until acceptance):
 *   1. structural defects (stubs+crescents+uturns+doubling>1.2km) NOT up;
 *   2. backroad mean +5 pp OR (flat backroad AND continuity meanRun +25 %);
 *   3. duration accuracy: |err| p80 not worse by >3 pp;
 *   4. latency: mean wall not up >20 %;
 *   5. turn density (turnsPer10min mean) not up >10 %.
 * Then the BLIND HOLDOUT review (owner) must prefer it (Recovery §17.4) —
 * no adoption on metrics alone. Refusals recorded per arm.
 *
 * ONE ARM PER PROCESS (flags like DRIVE_FIRST are module-load constants —
 * in-process switching would contaminate arms). The caller orchestrates:
 *   loops:  DRIVE_FIRST=off PROFILE_EXPERIMENT=P3_d30 SURFACE=loops npx tsx …
 *   atob:   PROFILE_EXPERIMENT=P3_d30 SURFACE=atob npx tsx …
 *   incumbent: omit PROFILE_EXPERIMENT (ARM_LABEL=P0_incumbent names the file).
 * Artifacts: eval/reports/rq33/<surface>-<arm>.json (audit-shaped, blind-pair ready)
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
import { ATOB_GOLD_V1 } from '../suites/atob_gold_v1';
import { LOOPS_GOLD_V1 } from '../suites/loops_gold_v1';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

/** Loop subset: the classes the LEGACY fallback actually serves (the profile's
 *  loop surface). Curvy/core-rich classes serve from the index regardless. */
const LOOP_CLASSES = new Set([
  'funnel_subdivision',
  'dense_grid',
  'city_edge',
  'lakeshore_flat',
  'sparse_rural',
  'supply_desert',
  'near_highway',
  'single_arterial_escape',
]);
const LOOP_ASKS = [60, 90];

interface Row {
  kind: 'loop' | 'atob';
  label: string;
  brief: string;
  status: string;
  durationMin: number | null;
  targetMin: number | null;
  distanceKm: number | null;
  backroadPct: number | null;
  mainPct: number | null;
  hoodPct: number | null;
  turnsPer10min: number | null;
  oabLongestM: number | null;
  spurs: number | null;
  microloops: number | null;
  uturns: number | null;
  continuityMeanRunM: number | null;
  nameHopsPer10min: number | null;
  detourRatio: number | null;
  wallMs: number;
  coords: Array<[number, number]>;
}

async function measure(
  res: Awaited<ReturnType<typeof runPlanner>>,
  origin: LatLng,
  targetMin: number | null,
  directM: number | null,
  wallMs: number,
  kind: 'loop' | 'atob',
  label: string,
  brief: string,
): Promise<Row> {
  if (!res.route) {
    return {
      kind,
      label,
      brief,
      status: res.status,
      durationMin: null,
      targetMin,
      distanceKm: null,
      backroadPct: null,
      mainPct: null,
      hoodPct: null,
      turnsPer10min: null,
      oabLongestM: null,
      spurs: null,
      microloops: null,
      uturns: null,
      continuityMeanRunM: null,
      nameHopsPer10min: null,
      detourRatio: null,
      wallMs,
      coords: [],
    };
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
  return {
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
    wallMs: Math.round(wallMs),
    coords: (geo.coordinates as Array<[number, number]>).map(
      ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)] as [number, number],
    ),
  };
}

async function runArm(arm: string, surface: string): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const rows: Row[] = [];

  if (surface === 'loops' || surface === 'both') {
    // the LEGACY surface is under test — the CALLER must set DRIVE_FIRST=off
    if ((process.env['DRIVE_FIRST'] ?? 'on') !== 'off') {
      throw new Error('loops surface requires DRIVE_FIRST=off in the environment');
    }
    for (const f of LOOPS_GOLD_V1.filter((f) => LOOP_CLASSES.has(f.cls))) {
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
        const t0 = performance.now();
        try {
          const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
          rows.push(
            await measure(res, f.at, min, null, performance.now() - t0, 'loop', f.label, brief),
          );
        } catch (err) {
          console.log(`  loop ${f.id} ${min}m ERROR ${String(err).slice(0, 50)}`);
        }
      }
    }
  }

  if (surface === 'atob' || surface === 'both') {
    for (const f of ATOB_GOLD_V1) {
      const brief = `backroads drive`;
      const parsed = parseRules(`backroads drive from A to B`);
      const constraints = {
        ...parsed,
        origin: f.a,
        destination: f.b,
        shape: 'a_to_b' as const,
        missing: parsed.missing.filter((m) => m !== 'origin' && m !== 'destination'),
        clarification: { needed: false, question: null },
      };
      const t0 = performance.now();
      try {
        const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
        const direct = await routeThrough(VALHALLA, {
          waypoints: [
            [f.a.lng, f.a.lat],
            [f.b.lng, f.b.lat],
          ],
        });
        rows.push(
          await measure(
            res,
            f.a,
            null,
            direct.distance_m,
            performance.now() - t0,
            'atob',
            f.label,
            brief,
          ),
        );
      } catch (err) {
        console.log(`  atob ${f.id} ERROR ${String(err).slice(0, 50)}`);
      }
    }
  }

  await db.end();

  const manifest = await buildManifest({ suite: `rq33-${surface}-${arm}` });
  mkdirSync('eval/reports/rq33', { recursive: true });
  const out = `eval/reports/rq33/${surface}-${arm}.json`;
  writeFileSync(out, JSON.stringify({ manifest, routes: rows }, null, 1));

  const ok = rows.filter((r) => r.durationMin !== null);
  const mean = (f: (r: Row) => number | null): string => {
    const v = ok.map(f).filter((x): x is number => x !== null);
    return v.length > 0 ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—';
  };
  const structural = ok.reduce(
    (t, r) =>
      t +
      (r.spurs ?? 0) +
      (r.microloops ?? 0) +
      (r.uturns ?? 0) +
      ((r.oabLongestM ?? 0) > 1200 ? 1 : 0),
    0,
  );
  console.log(
    `${arm.padEnd(18)} ${surface.padEnd(5)} routed ${ok.length}/${rows.length} · back ${mean(
      (r) => r.backroadPct,
    )}% · cont ${mean((r) => r.continuityMeanRunM)}m · hops ${mean(
      (r) => r.nameHopsPer10min,
    )}/10m · turns ${mean((r) => r.turnsPer10min)} · structural ${structural} · wall ${mean(
      (r) => r.wallMs,
    )}ms`,
  );
}

async function main(): Promise<void> {
  const manifest = await buildManifest({ suite: 'rq33-header' });
  console.log(manifestLine(manifest));
  const surface = process.env['SURFACE'] ?? 'atob';
  if (surface === 'both') throw new Error('one surface per process (see header)');
  const exp = process.env['PROFILE_EXPERIMENT'];
  const arm = exp !== undefined && exp !== '' ? exp : (process.env['ARM_LABEL'] ?? 'P0_incumbent');
  if (exp !== undefined && exp !== '' && !EXPERIMENT_PROFILES[exp]) {
    throw new Error(`unknown PROFILE_EXPERIMENT ${exp}`);
  }
  await runArm(arm, surface);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
