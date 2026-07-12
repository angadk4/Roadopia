/**
 * Round 11 — countryness scoring weight sweep (owner: "prioritize fun back
 * roads whenever possible") → config frozen-m4t12-v6.
 *
 * Baseline measured 2026-07-12 on the 48-brief corpus: mean best countryScore
 * 0.51, ZERO majority-backroad bests — waypoint material is country (BD-21)
 * but Valhalla's connectors ride arterials (its only class knob touches
 * motorway/trunk; verified round 7), and nothing in scoring rewarded taking
 * the small road. The new `country` term (length-weighted BD-26 class factor
 * over the WHOLE traced route) fixes the blind spot; this sweep sets its
 * weight.
 *
 * PRE-REGISTERED WINNER RULE (fixed before any run; §21 discipline —
 * tune-on-DEV, validate-on-VAL): adopt the LARGEST w_country ∈
 * {0.1, 0.2, 0.3, 0.4} that, vs w=0 on the SAME pools (pool-reuse — weights
 * touch scoring only):
 *   (a) raises mean best countryScore by ≥ +0.03 (real movement),
 *   (b) keeps median |dur err| within +2 pp,
 *   (c) keeps mean best curviness ≥ 95 % of baseline (country must not buy
 *       straight concession grids at the twisties' expense), and
 *   (d) keeps mean kept within −0.3 (no pool collapse via diversify shifts).
 * VAL validation: winner vs 0 on fresh VAL pools — (a)–(d) must hold
 * directionally (countryScore up, guards intact) or fall back to the next
 * smaller clearing weight (then 0).
 *
 * Run: pnpm -C eval run rq11   (Supabase local + Valhalla; no LLM)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedConstraints } from '@shared/types';
import { Client } from 'pg';

import { loadReqset } from '../src/datasets/load';
import type { RequestExample } from '../src/datasets/schema';
import { buildManifest, writeManifest } from '../src/harness/manifest';
import {
  finalizeKept,
  planKeptSet,
  resolveRunnableConstraints,
  type KeptCandidate,
  type PlanOutcome,
} from '../src/harness/pipeline';
import { mean, percentile } from '../src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const SWEEP = [0, 0.1, 0.2, 0.3, 0.4];
const N_DEV = 10;

interface Point {
  w: number;
  meanCountry: number | null;
  medAbsErr: number | null;
  meanCurv: number | null;
  meanKept: number;
}

function bestOf(kept: KeptCandidate[]): KeptCandidate | null {
  const feas = kept.filter((k) => k.feasible);
  const from = feas.length ? feas : kept;
  return from.length ? from.reduce((b, k) => (k.presentKey > b.presentKey ? k : b)) : null;
}

function evaluate(pools: PlanOutcome[], w: number): Point {
  const countries: number[] = [];
  const errs: number[] = [];
  const curvs: number[] = [];
  let keptSum = 0;
  for (const pool of pools) {
    const { kept } = finalizeKept(pool.pool, pool.constraints, { country: w });
    keptSum += kept.length;
    const best = bestOf(kept);
    if (!best) continue;
    if (best.countryScore !== null) countries.push(best.countryScore);
    errs.push(Math.abs((best.durationS - pool.targetS) / pool.targetS) * 100);
    curvs.push(best.curviness);
  }
  return {
    w,
    meanCountry: mean(countries),
    medAbsErr: percentile(errs, 50),
    meanCurv: mean(curvs),
    meanKept: keptSum / pools.length,
  };
}

function pickWinner(points: Point[]): number {
  const base = points.find((p) => p.w === 0)!;
  const clearing = points.filter(
    (p) =>
      p.w > 0 &&
      p.meanCountry !== null &&
      base.meanCountry !== null &&
      p.meanCountry >= base.meanCountry + 0.03 &&
      p.medAbsErr !== null &&
      base.medAbsErr !== null &&
      p.medAbsErr <= base.medAbsErr + 2 &&
      p.meanCurv !== null &&
      base.meanCurv !== null &&
      p.meanCurv >= base.meanCurv * 0.95 &&
      p.meanKept >= base.meanKept - 0.3,
  );
  clearing.sort((a, b) => b.w - a.w);
  return clearing.length ? clearing[0]!.w : 0;
}

const row = (p: Point) =>
  `| ${p.w} | ${p.meanCountry === null ? '—' : p.meanCountry.toFixed(3)} | ${p.medAbsErr === null ? '—' : p.medAbsErr.toFixed(1) + '%'} | ${p.meanCurv === null ? '—' : p.meanCurv.toFixed(2)} | ${p.meanKept.toFixed(1)} |`;

async function buildPools(
  db: Client,
  briefs: Array<{ e: RequestExample; c: ParsedConstraints }>,
  label: string,
): Promise<PlanOutcome[]> {
  const pools: PlanOutcome[] = [];
  for (const { e, c } of briefs) {
    try {
      pools.push(await planKeptSet(db, VALHALLA, c));
      console.log(`  ${label} pool ${e.id}: kept ${pools[pools.length - 1]!.kept.length}`);
    } catch (err) {
      console.log(`  ${label} ${e.id}: ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
  return pools;
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const runnable = (split: RequestExample[]) =>
    split
      .map((e) => ({ e, c: resolveRunnableConstraints(e) }))
      .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null);

  console.log('DEV pools:');
  const devPools = await buildPools(db, runnable(reqset.dev).slice(0, N_DEV), 'DEV');
  const devPoints = SWEEP.map((w) => evaluate(devPools, w));
  for (const p of devPoints)
    console.log(
      `  w=${p.w}: country μ ${p.meanCountry?.toFixed(3)} · med|err| ${p.medAbsErr?.toFixed(1)}% · curv μ ${p.meanCurv?.toFixed(2)} · kept ${p.meanKept.toFixed(1)}`,
    );
  let winner = pickWinner(devPoints);
  console.log(`DEV winner: w_country=${winner}`);

  let valPoints: Point[] = [];
  if (winner > 0) {
    console.log('VAL pools:');
    const valPools = await buildPools(db, runnable(reqset.val), 'VAL');
    valPoints = [evaluate(valPools, 0), evaluate(valPools, winner)];
    const [v0, vw] = valPoints as [Point, Point];
    const ok =
      vw.meanCountry !== null &&
      v0.meanCountry !== null &&
      vw.meanCountry > v0.meanCountry &&
      (vw.medAbsErr ?? Infinity) <= (v0.medAbsErr ?? Infinity) + 2 &&
      (vw.meanCurv ?? 0) >= (v0.meanCurv ?? 0) * 0.95 &&
      vw.meanKept >= v0.meanKept - 0.3;
    if (!ok) {
      console.log('VAL regression — falling back to 0 (no adoption)');
      winner = 0;
    }
  }
  await db.end();

  const lines = [
    '# Round 11 — countryness weight sweep (backroads priority)',
    '',
    'Pre-registered rule in experiments/rq11_backroads.ts (fixed before any run). Baseline',
    'finding: mean best countryScore 0.51, ZERO majority-backroad bests in 48 — connectors',
    'ride arterials because no Valhalla class knob exists below motorway/trunk (round-7',
    'recon) and scoring never rewarded small roads. The `country` term (length-weighted',
    'BD-26 class factor over the traced route) closes the loop; pools re-finalized per',
    'weight (weights touch scoring only).',
    '',
    '## DEV sweep (10 pools)',
    '',
    '| w_country | mean best country | med \\|err\\| | mean best curv | mean kept |',
    '|---|---|---|---|---|',
    ...devPoints.map(row),
    '',
    `Winner: **w_country = ${winner}**${winner === 0 ? ' (no weight cleared the guards — term stays off)' : ''}.`,
    ...(valPoints.length
      ? [
          '',
          '## VAL validation',
          '',
          '| w_country | mean best country | med \\|err\\| | mean best curv | mean kept |',
          '|---|---|---|---|---|',
          ...valPoints.map(row),
        ]
      : []),
    '',
    `Config frozen-m4t12-v6: DEFAULT_WEIGHTS.country = ${winner}; preset vectors receive the`,
    'same uniform term (additive — preserves the GATE-W-validated relative character).',
  ];
  const reportsDir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'backroads.md'), lines.join('\n') + '\n', 'utf8');

  writeManifest(
    buildManifest({
      experimentId: 'rq11-backroads',
      scoringConfigId: 'frozen-m4t12-v6',
      weights: { country: winner },
      datasetSplit: `dev(${N_DEV}) + val`,
      datasetVersion: reqset.manifest.version,
      seed: 42,
      costLedger: { total_usd: 0, llm_calls: 0, notes: 'deterministic run — no LLM' },
    }),
  );
  console.log(`\nwrote eval/reports/backroads.md · WINNER w_country=${winner}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
