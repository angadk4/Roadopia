/**
 * [GATE-F] correction experiment — deterministic F1∪F2∪F5 vs F4 LLM-mapped
 * repair (M4-T09; Protocol §16 / §18-C / §27).
 *
 * PRE-REGISTERED DECISION RULE (fixed before any result was computed; §27 row:
 * "LLM (F3/F4) beats F1∪F2 on self_correction_efficacy by ≥ τ_fix AND no rise
 * in new_violation_rate AND within latency"; margins set here):
 * adopt F4 (LLM repair) for M5-T08 IFF ALL of:
 *   1. self_correction_efficacy(F4, mean of N=3) ≥ efficacy(D) + 10 pp
 *      (τ_fix = 10 pp), where D = the deterministic F1∪F2∪F5 script.
 *   2. new_violation_rate(F4) ≤ new_violation_rate(D).
 *   3. Latency: every arm run within the 25 s wall budget AND mean F4 arm
 *      latency ≤ 1.5× mean D arm latency.
 * Otherwise the DEFAULT stands: deterministic repair (F1) + generate-more (F2)
 * + relaxation/best-so-far (F5) — M5-T08 LLM correction is NOT built.
 *
 * Design (§16 "Seed first-pass failures (borderline/impossible cases from
 * DEV) and measure each strategy's recovery", cap 3 moves / 25 s):
 * - Seeds: DEV runnable loop briefs whose FIRST search pass yields zero
 *   feasible candidates at the default validation tolerance.
 * - Move set (both arms share the executor — the arms differ ONLY in who
 *   picks the move): resize_speed (F1: speed rescaled to the observed miss),
 *   widen_search (F2: τ×1.3 + θ 0.4 pass, merged), relax_duration (F5:
 *   tolerance ×1.5, DISCLOSED).
 * - D arm picks by the production script (resize when a median exists and
 *   misses by >25 %, else widen, relax last). F4 lets Haiku map the numeric
 *   failure summary to a move (no geography); invalid output falls back to
 *   the script's choice. N=3 repeats for F4; pass results are memoised per
 *   (seed, move-sequence) so repeats re-use identical deterministic work.
 *
 * Run: pnpm -C eval run gate-f   (Supabase local + Valhalla + ANTHROPIC_API_KEY)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedConstraints } from '@shared/types';
import { Client } from 'pg';

import { resizedSpeed } from '../../backend/src/planner/candidates';
import { DURATION_TOLERANCE_DEFAULT } from '../../backend/src/planner/validate';
import { loadReqset } from '../src/datasets/load';
import type { RequestExample } from '../src/datasets/schema';
import { buildManifest, writeManifest } from '../src/harness/manifest';
import {
  acceptedOf,
  baseSpeedOf,
  finalizeKept,
  medianDurationOf,
  mergePass,
  newPool,
  resolveRunnableConstraints,
  runSearchPass,
  type KeptCandidate,
  type PoolState,
} from '../src/harness/pipeline';
import { GuardedLlmClient } from '../src/llm/client';
import {
  CORRECT_MODEL,
  llmPickMove,
  type CorrectionMove,
  type FailureFacts,
} from '../src/llm/correct_llm';
import { mean, percentile } from '../src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const SEED = 42;
const N_REPEATS = 3;
const MOVE_CAP = 3; // §16 / Master Spec §33: iteration cap
const WALL_BUDGET_MS = 25_000; // §16: wall-clock budget bounds all variants
const MAX_SEEDS = 12;
const TAU_FIX_PP = 0.1; // pre-registered τ_fix

interface ArmState {
  pool: PoolState;
  sizingV: number;
  tolerance: number;
  relaxed: string[];
  movesTried: CorrectionMove[];
  engineCallsAtStart: number;
}

interface SeedCase {
  example: RequestExample;
  constraints: ParsedConstraints;
  targetS: number;
  /** First-pass pool (cloned per arm run). */
  firstPool: PoolState;
  /** Best (max presentKey) first-pass kept — the pre-repair reference. */
  seedBest: KeptCandidate | null;
}

interface ArmRun {
  repaired: boolean;
  moves: CorrectionMove[];
  wallMs: number;
  engineCalls: number;
  newViolation: boolean | null; // null = not measurable (no pre-repair kept)
  llmCalls: number;
  llmInvalid: number;
  llmFallbacks: number;
}

function clonePool(p: PoolState): PoolState {
  return {
    candidateIds: new Set(p.candidateIds),
    attempts: [...p.attempts],
    engineCalls: p.engineCalls,
  };
}

function feasibleOf(state: ArmState, constraints: ParsedConstraints): KeptCandidate[] {
  const { kept } = finalizeKept(state.pool, constraints, undefined, {
    durationTolerance: state.tolerance,
  });
  return kept.filter((k) => k.feasible);
}

function bestOf(kept: KeptCandidate[]): KeptCandidate | null {
  return kept.length ? kept.reduce((b, k) => (k.presentKey > b.presentKey ? k : b)) : null;
}

/** Undisclosed constraint that was fine pre-repair but violated in the repair. */
function introducedViolation(
  seedBest: KeptCandidate | null,
  repaired: KeptCandidate,
  relaxed: string[],
): boolean | null {
  if (!seedBest) return null;
  const beforeViolated = new Set(
    seedBest.verdict.results.filter((r) => r.status === 'violated').map((r) => r.constraint),
  );
  return repaired.verdict.results.some(
    (r) =>
      r.status === 'violated' &&
      !beforeViolated.has(r.constraint) &&
      !relaxed.includes(r.constraint),
  );
}

function factsOf(state: ArmState, targetS: number, constraints: ParsedConstraints): FailureFacts {
  const kept = finalizeKept(state.pool, constraints, undefined, {
    durationTolerance: state.tolerance,
  }).kept;
  const median = medianDurationOf(state.pool);
  const best = bestOf(kept);
  return {
    target_min: Math.round(targetS / 60),
    pool_assembled: acceptedOf(state.pool).length,
    feasible_count: kept.filter((k) => k.feasible).length,
    median_duration_min: median === null ? null : Math.round(median / 60),
    duration_miss_pct: median === null ? null : Math.round(((median - targetS) / targetS) * 100),
    distinct_corridors: kept.length,
    stops_requested: constraints.stops.reduce((s, x) => s + x.count, 0),
    stops_included_best: best ? best.stopsIncluded : 0,
    moves_already_tried: [...state.movesTried],
  };
}

/** The production-shaped deterministic policy (F1∪F2∪F5 order). */
function scriptedMove(state: ArmState, targetS: number): CorrectionMove {
  const median = medianDurationOf(state.pool);
  const resizeCount = state.movesTried.filter((m) => m === 'resize_speed').length;
  if (
    median !== null &&
    Math.abs(median - targetS) / targetS > 0.25 &&
    resizeCount < 2 // production allows two resize attempts
  ) {
    return 'resize_speed';
  }
  if (!state.movesTried.includes('widen_search')) return 'widen_search';
  if (!state.movesTried.includes('relax_duration')) return 'relax_duration';
  return 'widen_search'; // nothing left — cap will end the loop
}

async function executeMove(
  db: Client,
  state: ArmState,
  move: CorrectionMove,
  constraints: ParsedConstraints,
  targetS: number,
  step: number,
): Promise<void> {
  if (move === 'resize_speed') {
    const median = medianDurationOf(state.pool);
    if (median === null) {
      // resize is undefined with nothing assembled — substitute the F2 move
      await executeMove(db, state, 'widen_search', constraints, targetS, step);
      return;
    }
    state.sizingV = resizedSpeed(state.sizingV, targetS, median);
    mergePass(
      state.pool,
      await runSearchPass(db, VALHALLA, constraints, targetS, {
        tauMult: 1,
        avgSpeedKmh: state.sizingV,
        idPrefix: `rz${step}-`,
      }),
    );
  } else if (move === 'widen_search') {
    // no idPrefix: ids colliding with the first pass dedup away, as in production
    mergePass(
      state.pool,
      await runSearchPass(db, VALHALLA, constraints, targetS, { tauMult: 1.3, theta: 0.4 }),
    );
  } else {
    state.tolerance = state.tolerance * 1.5; // F5: disclosed soft-target relaxation
    if (!state.relaxed.includes('duration')) state.relaxed.push('duration');
  }
  state.movesTried.push(move);
}

async function runArm(
  db: Client,
  seed: SeedCase,
  pickMove: (state: ArmState) => Promise<{
    move: CorrectionMove;
    llmCalls: number;
    llmInvalid: number;
    fallback: boolean;
  }>,
): Promise<ArmRun> {
  const t0 = performance.now();
  const state: ArmState = {
    pool: clonePool(seed.firstPool),
    sizingV: baseSpeedOf(seed.constraints),
    tolerance: DURATION_TOLERANCE_DEFAULT,
    relaxed: [],
    movesTried: [],
    engineCallsAtStart: seed.firstPool.engineCalls,
  };
  let llmCalls = 0;
  let llmInvalid = 0;
  let llmFallbacks = 0;

  for (let step = 1; step <= MOVE_CAP; step++) {
    if (performance.now() - t0 > WALL_BUDGET_MS) break;
    const picked = await pickMove(state);
    llmCalls += picked.llmCalls;
    llmInvalid += picked.llmInvalid;
    if (picked.fallback) llmFallbacks++;
    await executeMove(db, state, picked.move, seed.constraints, seed.targetS, step);
    const feas = feasibleOf(state, seed.constraints);
    if (feas.length > 0) {
      const repairedBest = bestOf(feas)!;
      return {
        repaired: true,
        moves: state.movesTried,
        wallMs: performance.now() - t0,
        engineCalls: state.pool.engineCalls - state.engineCallsAtStart,
        newViolation: introducedViolation(seed.seedBest, repairedBest, state.relaxed),
        llmCalls,
        llmInvalid,
        llmFallbacks,
      };
    }
  }
  return {
    repaired: false,
    moves: state.movesTried,
    wallMs: performance.now() - t0,
    engineCalls: state.pool.engineCalls - state.engineCallsAtStart,
    newViolation: null,
    llmCalls,
    llmInvalid,
    llmFallbacks,
  };
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const client = new GuardedLlmClient();

  // --- seed first-pass failures from DEV (§16) ---
  const runnable = reqset.dev
    .map((e) => ({ e, c: resolveRunnableConstraints(e) }))
    .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null);
  console.log(`Seeding: first pass over ${runnable.length} runnable DEV briefs…`);
  const seeds: SeedCase[] = [];
  for (const { e, c } of runnable) {
    if (seeds.length >= MAX_SEEDS) break;
    try {
      const targetS = c.duration_target_s ?? 5400;
      const pool = newPool();
      mergePass(pool, await runSearchPass(db, VALHALLA, c, targetS, { tauMult: 1 }));
      const { kept } = finalizeKept(pool, c);
      const feasible = kept.filter((k) => k.feasible);
      if (feasible.length === 0) {
        seeds.push({
          example: e,
          constraints: c,
          targetS,
          firstPool: pool,
          seedBest: bestOf(kept),
        });
        console.log(`  seed ${seeds.length}: ${e.id} (${kept.length} kept, 0 feasible)`);
      }
    } catch (err) {
      console.log(`  ${e.id}: ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
  if (seeds.length === 0) {
    console.log('No first-pass failures found — nothing to correct; [GATE-F] defaults stand.');
    await db.end();
    return;
  }
  console.log(`${seeds.length} seeded failures.\n`);

  // --- D arm: deterministic F1∪F2∪F5 script ---
  console.log('D arm (deterministic F1∪F2∪F5)…');
  const dRuns: ArmRun[] = [];
  for (const seed of seeds) {
    const run = await runArm(db, seed, (state) =>
      Promise.resolve({
        move: scriptedMove(state, seed.targetS),
        llmCalls: 0,
        llmInvalid: 0,
        fallback: false,
      }),
    );
    dRuns.push(run);
    console.log(
      `  ${seed.example.id}: ${run.repaired ? 'REPAIRED' : 'not repaired'} via [${run.moves.join(',')}] ${Math.round(run.wallMs)} ms`,
    );
  }

  // --- F4 arm: Haiku maps failure → move, N=3 repeats ---
  console.log(`\nF4 arm (${CORRECT_MODEL} picks the move), N=${N_REPEATS}…`);
  const lRepeats: ArmRun[][] = [];
  for (let n = 0; n < N_REPEATS; n++) {
    const runs: ArmRun[] = [];
    for (const seed of seeds) {
      const run = await runArm(db, seed, async (state) => {
        const res = await llmPickMove(
          client,
          seed.example.brief,
          factsOf(state, seed.targetS, seed.constraints),
        );
        if (res.move !== null) {
          return {
            move: res.move,
            llmCalls: res.llmCalls,
            llmInvalid: res.invalidOutputs,
            fallback: false,
          };
        }
        return {
          move: scriptedMove(state, seed.targetS), // §50 fallback to deterministic
          llmCalls: res.llmCalls,
          llmInvalid: res.invalidOutputs,
          fallback: true,
        };
      });
      runs.push(run);
    }
    lRepeats.push(runs);
    console.log(
      `  repeat ${n + 1}: ${runs.filter((r) => r.repaired).length}/${seeds.length} repaired — $${client.guard.ledger.costUsd.toFixed(4)}`,
    );
  }

  // --- metrics ---
  const dEff = dRuns.filter((r) => r.repaired).length / seeds.length;
  const lEffPer = lRepeats.map((runs) => runs.filter((r) => r.repaired).length / seeds.length);
  const lEff = mean(lEffPer)!;
  const violRate = (runs: ArmRun[]) => {
    const measurable = runs.filter((r) => r.repaired && r.newViolation !== null);
    return measurable.length
      ? measurable.filter((r) => r.newViolation).length / measurable.length
      : 0;
  };
  const dViol = violRate(dRuns);
  const lViol = mean(lRepeats.map(violRate))!;
  const dLat = mean(dRuns.map((r) => r.wallMs))!;
  const lLat = mean(lRepeats.flat().map((r) => r.wallMs))!;
  const allWall = [...dRuns, ...lRepeats.flat()].map((r) => r.wallMs);
  const wallP90 = percentile(allWall, 90)!;
  const lCalls = lRepeats.flat().reduce((s, r) => s + r.llmCalls, 0);
  const lInvalid = lRepeats.flat().reduce((s, r) => s + r.llmInvalid, 0);
  const lFallbacks = lRepeats.flat().reduce((s, r) => s + r.llmFallbacks, 0);
  // stability: seeds whose move SEQUENCE differs across repeats
  let seqFlips = 0;
  for (let i = 0; i < seeds.length; i++) {
    const seqs = lRepeats.map((runs) => runs[i]!.moves.join(','));
    if (new Set(seqs).size > 1) seqFlips++;
  }

  const effCleared = lEff >= dEff + TAU_FIX_PP;
  const violCleared = lViol <= dViol;
  const latCleared = wallP90 <= WALL_BUDGET_MS && lLat <= 1.5 * dLat;
  const adopt = effCleared && violCleared && latCleared;

  const ledger = client.guard.ledger;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const lines = [
    '# [GATE-F] Correction — deterministic F1∪F2∪F5 vs F4 LLM-mapped repair (M4-T09)',
    '',
    'Pre-registered rule (fixed before results; see experiments/gate_f.ts header): adopt F4 iff',
    `efficacy ≥ deterministic + ${TAU_FIX_PP * 100} pp AND new_violation_rate ≤ deterministic AND within`,
    'latency (all runs ≤ 25 s, mean ≤ 1.5× deterministic). Default: F1 + F2 + F5.',
    '',
    `Seeds: ${seeds.length} first-pass failures from DEV (${runnable.length} runnable briefs scanned): ` +
      seeds.map((s) => s.example.id).join(', '),
    '',
    '| metric | D (F1∪F2∪F5) | F4 (LLM, mean of 3) |',
    '|---|---|---|',
    `| self_correction_efficacy | ${pct(dEff)} | ${pct(lEff)} (per repeat: ${lEffPer.map(pct).join(' / ')}) |`,
    `| new_violation_rate (repaired) | ${pct(dViol)} | ${pct(lViol)} |`,
    `| mean arm latency | ${Math.round(dLat)} ms | ${Math.round(lLat)} ms |`,
    '',
    `Wall p90 (all runs): ${Math.round(wallP90)} ms (budget ${WALL_BUDGET_MS}). ` +
      `Move-sequence flips across repeats: ${seqFlips}/${seeds.length}. ` +
      `Invalid outputs ${lInvalid}/${lCalls} calls; deterministic fallbacks ${lFallbacks}.`,
    '',
    '## DECISION ([GATE-F], per the pre-registered rule)',
    '',
    `| criterion | value | cleared |`,
    '|---|---|---|',
    `| efficacy(F4) ≥ efficacy(D) + ${TAU_FIX_PP * 100} pp | ${pct(lEff)} vs ${pct(dEff)} | ${effCleared ? 'YES' : 'no'} |`,
    `| new_violation_rate(F4) ≤ D | ${pct(lViol)} vs ${pct(dViol)} | ${violCleared ? 'YES' : 'no'} |`,
    `| latency within budget | p90 ${Math.round(wallP90)} ms; ${Math.round(lLat)} vs ${Math.round(dLat)} ms | ${latCleared ? 'YES' : 'no'} |`,
    '',
    adopt
      ? '**ADOPT F4 (LLM-mapped repair) for M5-T08** — all pre-registered criteria cleared; deterministic script stays as the fallback.'
      : '**KEEP the deterministic correction stack (F1 deterministic repair + F2 generate-more + F5 relaxation/best-so-far)** — a pre-registered criterion was not cleared; M5-T08 LLM correction is NOT built.',
    '',
    `Cost ledger: ${ledger.calls} calls · $${ledger.costUsd.toFixed(4)} (budget $${client.guard.budgetUsd}).`,
  ];

  const reportsDir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'correction.md'), lines.join('\n') + '\n', 'utf8');

  writeManifest(
    buildManifest({
      experimentId: 'gate-f-correction',
      scoringConfigId: 'default-weights-v1',
      weights: {},
      datasetSplit: 'dev (seeded failures, §16)',
      datasetVersion: reqset.manifest.version,
      seed: SEED,
      model: {
        id: CORRECT_MODEL,
        params: { temperature: 0, max_tokens: 200, structured_outputs: true },
        n_repeats: N_REPEATS,
      },
      costLedger: {
        total_usd: ledger.costUsd,
        llm_calls: ledger.calls,
        notes: 'direct API (one-shot experiment)',
      },
    }),
  );

  await db.end();
  console.log('\nwrote eval/reports/correction.md');
  console.log(`total spend: $${ledger.costUsd.toFixed(4)}`);
  console.log(`DECISION: ${adopt ? 'ADOPT F4 (LLM repair)' : 'KEEP deterministic F1+F2+F5'}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
