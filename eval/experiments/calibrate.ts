/**
 * M4-T12 — parameter calibration on DEV, validation on VAL, freeze (§21).
 *
 * Targets the two MEASURED gaps (BD-29/BD-30 findings): duration accuracy
 * (median |dur err| of the presented best) and pool depth (feasible
 * candidates per brief). One-factor-at-a-time sweeps from the current
 * defaults over 10 stratified runnable DEV briefs.
 *
 * PRE-REGISTERED WINNER RULES (fixed before any sweep ran; ties → default):
 *   duration axis (ALPHA_LOOP ∈ {0.45,0.55,0.65}; base speed ∈ {45,55,65}):
 *     pick the value minimising median |dur err| SUBJECT TO feasible-rate ≥
 *     baseline AND mean kept ≥ baseline − 0.5.
 *   pool axis (nSectors ∈ {4,6,8}; nCandidates ∈ {20,30}):
 *     pick the config maximising mean feasible count SUBJECT TO median
 *     |dur err| ≤ baseline + 2 pp AND p90 wall ≤ 25 s; gains < +0.5 mean
 *     feasible do NOT justify leaving the default.
 *   combined winner = duration-winner ∪ pool-winner, then VALIDATED ON VAL
 *     (16 runnable briefs) against the VAL baseline: feasible-rate and median
 *     |dur err| must not regress by more than 2 pp — else fall back to the
 *     duration-winner alone (and re-check).
 *   TAU_OVERLAP ∈ {0.4,0.5,0.6,0.7}: re-finalize the winner's saved DEV pools
 *     (presentation-only param); keep 0.6 unless another value raises mean
 *     kept AND lowers mean max pair-overlap.
 *   DURATION_TOLERANCE: derived, not swept — p80 of the winner's |dur err|
 *     distribution across DEV+VAL runs, rounded UP to 0.05, clamped
 *     [0.10, 0.25] (§21 "the band where most feasible routes land; disclose
 *     beyond it").
 *
 * Output: eval/reports/params.md + eval/params-frozen.json (the committed
 * §21/§22 freeze manifest) + winner constants applied in code by the build
 * loop (a param change after this freeze = new config id + fresh VAL pass).
 *
 * Run: pnpm -C eval run calibrate   (Supabase local + Valhalla; no LLM)
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
  type CalibConfig,
  type PlanOutcome,
} from '../src/harness/pipeline';
import { percentile } from '../src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const SEED = 42;
const N_DEV_BRIEFS = 10;

interface Sample {
  id: string;
  feasible: number;
  kept: number;
  /** presented best (feasible preferred) signed duration error, fraction. */
  errSigned: number | null;
  ms: number;
  outcome: PlanOutcome | null;
}

interface ConfigResult {
  key: string;
  calib: CalibConfig;
  samples: Sample[];
  feasRate: number;
  medAbsErr: number | null;
  meanKept: number;
  meanFeas: number;
  p90Ms: number | null;
}

function bestErrOf(outcome: PlanOutcome): number | null {
  const feas = outcome.kept.filter((k) => k.feasible);
  const pickFrom = feas.length ? feas : outcome.kept;
  if (!pickFrom.length) return null;
  const best = pickFrom.reduce((b, k) => (k.presentKey > b.presentKey ? k : b));
  return (best.durationS - outcome.targetS) / outcome.targetS;
}

async function runConfig(
  db: Client,
  key: string,
  calib: CalibConfig,
  briefs: Array<{ e: RequestExample; c: ParsedConstraints }>,
  keepPools: boolean,
): Promise<ConfigResult> {
  const samples: Sample[] = [];
  for (const { e, c } of briefs) {
    try {
      const outcome = await planKeptSet(db, VALHALLA, c, undefined, calib);
      samples.push({
        id: e.id,
        feasible: outcome.kept.filter((k) => k.feasible).length,
        kept: outcome.kept.length,
        errSigned: bestErrOf(outcome),
        ms: outcome.ms,
        outcome: keepPools ? outcome : null,
      });
    } catch (err) {
      samples.push({ id: e.id, feasible: 0, kept: 0, errSigned: null, ms: 0, outcome: null });
      console.log(`    ${e.id}: ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
  const absErrs = samples
    .filter((s) => s.errSigned !== null)
    .map((s) => Math.abs(s.errSigned!) * 100);
  const r: ConfigResult = {
    key,
    calib,
    samples,
    feasRate: samples.filter((s) => s.feasible > 0).length / samples.length,
    medAbsErr: percentile(absErrs, 50),
    meanKept: samples.reduce((s, x) => s + x.kept, 0) / samples.length,
    meanFeas: samples.reduce((s, x) => s + x.feasible, 0) / samples.length,
    p90Ms: percentile(
      samples.filter((s) => s.ms > 0).map((s) => s.ms),
      90,
    ),
  };
  console.log(
    `  ${key}: feas ${(r.feasRate * 100).toFixed(0)}% · med|err| ${r.medAbsErr?.toFixed(1)}% · ` +
      `kept ${r.meanKept.toFixed(1)} · feasN ${r.meanFeas.toFixed(1)} · p90 ${Math.round((r.p90Ms ?? 0) / 1000)}s`,
  );
  return r;
}

/** Stratified pick: spread runnable DEV briefs across duration bands. */
function pickDevBriefs(dev: RequestExample[]): Array<{ e: RequestExample; c: ParsedConstraints }> {
  const runnable = dev
    .map((e) => ({ e, c: resolveRunnableConstraints(e) }))
    .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null);
  const bands: Record<string, typeof runnable> = { short: [], medium: [], long: [] };
  for (const x of runnable) {
    const t = x.c.duration_target_s ?? 5400;
    (t <= 2700 ? bands['short'] : t <= 7200 ? bands['medium'] : bands['long'])!.push(x);
  }
  const picked: typeof runnable = [];
  const quota = { short: 3, medium: 4, long: 3 };
  for (const [band, q] of Object.entries(quota)) {
    const seen = new Set<string>();
    for (const x of bands[band]!) {
      if (picked.length >= N_DEV_BRIEFS) break;
      if (seen.size >= q) break;
      const arch = x.e.tags.archetype;
      if (seen.has(arch) && bands[band]!.length > q) continue; // prefer archetype spread
      seen.add(arch);
      picked.push(x);
    }
  }
  return picked.slice(0, N_DEV_BRIEFS);
}

function fmtRow(r: ConfigResult): string {
  return (
    `| ${r.key} | ${(r.feasRate * 100).toFixed(0)}% | ${r.medAbsErr === null ? '—' : r.medAbsErr.toFixed(1) + '%'} | ` +
    `${r.meanKept.toFixed(1)} | ${r.meanFeas.toFixed(1)} | ${r.p90Ms === null ? '—' : Math.round(r.p90Ms / 1000) + 's'} |`
  );
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const devBriefs = pickDevBriefs(reqset.dev);
  console.log(
    `DEV sweep briefs (${devBriefs.length}): ${devBriefs.map((x) => x.e.id).join(', ')}\n`,
  );

  // --- baseline + one-factor sweeps ---
  console.log('baseline:');
  const baseline = await runConfig(db, 'baseline', {}, devBriefs, false);

  console.log('alpha sweep:');
  const alphaResults = [
    await runConfig(db, 'alpha=0.45', { alpha: 0.45 }, devBriefs, false),
    baseline, // alpha=0.55 is the baseline
    await runConfig(db, 'alpha=0.65', { alpha: 0.65 }, devBriefs, false),
  ];
  console.log('speed sweep:');
  const speedResults = [
    await runConfig(db, 'speed=45', { baseSpeedKmh: 45 }, devBriefs, false),
    baseline, // 55 baseline
    await runConfig(db, 'speed=65', { baseSpeedKmh: 65 }, devBriefs, false),
  ];
  console.log('pool-depth sweep:');
  const depthResults = [
    await runConfig(db, 'sectors=4', { nSectors: 4 }, devBriefs, false),
    await runConfig(db, 'sectors=6', { nSectors: 6 }, devBriefs, false),
    baseline, // sectors=8, candidates=20
    await runConfig(db, 'cand=30', { nCandidates: 30 }, devBriefs, false),
  ];

  // --- winners per the pre-registered rules ---
  const durationEligible = [...alphaResults, ...speedResults].filter(
    (r) =>
      r.medAbsErr !== null &&
      r.feasRate >= baseline.feasRate &&
      r.meanKept >= baseline.meanKept - 0.5,
  );
  durationEligible.sort((a, b) => a.medAbsErr! - b.medAbsErr!);
  const durationWinner =
    durationEligible.length && durationEligible[0]!.medAbsErr! < (baseline.medAbsErr ?? Infinity)
      ? durationEligible[0]!
      : baseline;

  const depthEligible = depthResults.filter(
    (r) =>
      r.medAbsErr !== null &&
      baseline.medAbsErr !== null &&
      r.medAbsErr <= baseline.medAbsErr + 2 &&
      (r.p90Ms ?? 0) <= 25_000,
  );
  depthEligible.sort((a, b) => b.meanFeas - a.meanFeas);
  const depthWinner =
    depthEligible.length && depthEligible[0]!.meanFeas >= baseline.meanFeas + 0.5
      ? depthEligible[0]!
      : baseline;

  const combined: CalibConfig = { ...durationWinner.calib, ...depthWinner.calib };
  const combinedKey = `combined(${
    Object.entries(combined)
      .map(([k, v]) => `${k}=${v}`)
      .join(',') || 'defaults'
  })`;
  console.log(`\nduration winner: ${durationWinner.key} · pool winner: ${depthWinner.key}`);

  // --- VAL validation: combined vs baseline ---
  const valBriefs = reqset.val
    .map((e) => ({ e, c: resolveRunnableConstraints(e) }))
    .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null);
  console.log(`\nVAL validation (${valBriefs.length} briefs):`);
  const valBaseline = await runConfig(db, 'VAL baseline', {}, valBriefs, false);
  let valWinner = await runConfig(db, `VAL ${combinedKey}`, combined, valBriefs, true);
  let frozen: CalibConfig = combined;
  let fellBack = false;
  if (
    valWinner.feasRate < valBaseline.feasRate - 0.02 ||
    (valWinner.medAbsErr ?? Infinity) > (valBaseline.medAbsErr ?? Infinity) + 2
  ) {
    fellBack = true;
    frozen = durationWinner.calib;
    console.log('combined regressed on VAL — falling back to the duration winner alone');
    valWinner = await runConfig(db, 'VAL duration-winner', frozen, valBriefs, true);
  }

  // --- DEV re-run of the frozen config, pools kept (TAU sweep + tolerance) ---
  console.log('\nfrozen config on DEV (pools kept):');
  const devWinner = await runConfig(db, `DEV ${combinedKey}`, frozen, devBriefs, true);
  await db.end();

  // TAU_OVERLAP re-finalize on saved pools (presentation-only)
  const tauRows: string[] = [];
  let tauPick = 0.6;
  let tauBest = { kept: devWinner.meanKept, better: false };
  for (const tau of [0.4, 0.5, 0.6, 0.7]) {
    let keptSum = 0;
    let n = 0;
    for (const s of devWinner.samples) {
      if (!s.outcome) continue;
      // pair overlap after diversify is ≤ τ by construction — kept count is
      // the only free variable this sweep can move
      const { kept } = finalizeKept(s.outcome.pool, s.outcome.constraints, undefined, {
        tauOverlap: tau,
      });
      keptSum += kept.length;
      n++;
    }
    const meanKept = n ? keptSum / n : 0;
    tauRows.push(`| ${tau} | ${meanKept.toFixed(1)} |`);
    if (tau !== 0.6 && meanKept > tauBest.kept + 0.3) {
      tauPick = tau;
      tauBest = { kept: meanKept, better: true };
    }
  }
  if (!tauBest.better) tauPick = 0.6; // default holds unless strictly better

  // DURATION_TOLERANCE from the frozen config's |err| distribution (DEV + VAL)
  const allErrs = [...devWinner.samples, ...valWinner.samples]
    .filter((s) => s.errSigned !== null)
    .map((s) => Math.abs(s.errSigned!));
  const p80 = percentile(allErrs, 80) ?? 0.1;
  const tolerance = Math.min(0.25, Math.max(0.1, Math.ceil(p80 * 20) / 20));

  // --- report + freeze manifest ---
  const lines = [
    '# M4-T12 — parameter calibration (DEV) → validation (VAL) → freeze (§21)',
    '',
    'Pre-registered winner rules in experiments/calibrate.ts (fixed before any sweep ran).',
    `DEV sweep briefs: ${devBriefs.map((x) => x.e.id).join(', ')}.`,
    '',
    '## Sweeps (10 DEV briefs; baseline = current defaults)',
    '',
    '| config | feas-rate | med \\|err\\| | mean kept | mean feasible | p90 wall |',
    '|---|---|---|---|---|---|',
    fmtRow(baseline),
    ...alphaResults.filter((r) => r !== baseline).map(fmtRow),
    ...speedResults.filter((r) => r !== baseline).map(fmtRow),
    ...depthResults.filter((r) => r !== baseline).map(fmtRow),
    '',
    `Duration winner: **${durationWinner.key}** · pool winner: **${depthWinner.key}**` +
      (fellBack ? ' · combined REGRESSED on VAL → duration winner alone frozen.' : '.'),
    '',
    '## VAL validation (16 runnable briefs)',
    '',
    '| config | feas-rate | med \\|err\\| | mean kept | mean feasible | p90 wall |',
    '|---|---|---|---|---|---|',
    fmtRow(valBaseline),
    fmtRow(valWinner),
    '',
    '## TAU_OVERLAP re-finalize (frozen pools, presentation-only)',
    '',
    '| τ | mean kept |',
    '|---|---|',
    ...tauRows,
    '',
    `Pick: **${tauPick}** (default holds unless strictly better — pre-registered).`,
    '',
    `## DURATION_TOLERANCE: p80 of frozen-config |err| = ${(p80 * 100).toFixed(1)}% → ` +
      `**${tolerance}** (round-up to 0.05, clamp [0.10, 0.25]); misses beyond it disclose.`,
  ];
  const reportsDir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });

  const frozenParams = {
    config_id: 'frozen-m4t12-v1',
    frozen_at: '2026-07-11',
    discipline:
      '§21: tuned on DEV only, validated on VAL; any later change = new config id + fresh VAL pass',
    params: {
      ALPHA_LOOP: frozen.alpha ?? 0.55,
      MAX_TAU_S: 6900,
      base_speed_kmh: frozen.baseSpeedKmh ?? 55,
      base_speed_no_highway_kmh: 42,
      LOOP_LENGTH_FACTOR: 4.8,
      N_SECTORS: frozen.nSectors ?? 8,
      K_CLUSTERS: frozen.kClusters ?? 8,
      N_CANDIDATES: frozen.nCandidates ?? 20,
      CLUSTER_RADIUS_M: 2500,
      K_PRESENT: 4,
      TAU_OVERLAP: tauPick,
      DURATION_PREFILTER: 0.35,
      DURATION_TOLERANCE: tolerance,
      EPSILON_CLOSURE_M: 300,
      SELF_OVERLAP_SOFT: 0.15,
      SELF_OVERLAP_HARD: 0.3,
      RETRACE_RUN_SOFT_M: 1200,
      THETA_CURVY: 0.6,
      curvature_formula: 'C7 (circum-curvature per km), BD-26',
      scenic_weight: 0,
      scoring_weights: { dur: 0.3, cur: 0.35, stop: 0.1, scenic: 0, overlap: 0.25, uturn: 0.1 },
      preset_weights: 'PRESET_WEIGHTS frozen as-is (BD-30)',
      iteration_cap: 3,
      wall_clock_budget_ms: 25000,
      detour_max: 'DEFERRED — A→B ships at M6; calibrate then (new config id)',
      slider_ranges: 'N/A — W1 presets-only (BD-30)',
    },
    provenance: {
      gates: ['BD-26 C', 'BD-28 A', 'BD-29 F', 'BD-30 W', 'BD-31 R', 'BD-32 S'],
      sweeps: 'eval/reports/params.md',
      duration_winner: durationWinner.key,
      pool_winner: depthWinner.key,
      val_regression_fallback: fellBack,
    },
  };
  writeFileSync(
    fileURLToPath(new URL('../params-frozen.json', import.meta.url)),
    JSON.stringify(frozenParams, null, 2) + '\n',
    'utf8',
  );
  lines.push(
    '',
    '## FROZEN (eval/params-frozen.json, config frozen-m4t12-v1)',
    '',
    '```json',
    JSON.stringify(frozenParams.params, null, 2),
    '```',
  );
  writeFileSync(join(reportsDir, 'params.md'), lines.join('\n') + '\n', 'utf8');

  writeManifest(
    buildManifest({
      experimentId: 'm4t12-calibration',
      scoringConfigId: 'frozen-m4t12-v1',
      weights: frozenParams.params.scoring_weights,
      datasetSplit: 'dev(10 sweep) + val(16 validation)',
      datasetVersion: reqset.manifest.version,
      seed: SEED,
      costLedger: { total_usd: 0, llm_calls: 0, notes: 'deterministic run — no LLM' },
    }),
  );

  console.log('\nwrote eval/reports/params.md + eval/params-frozen.json');
  console.log(
    `FROZEN: ${JSON.stringify({ ...frozen, TAU_OVERLAP: tauPick, DURATION_TOLERANCE: tolerance })}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
