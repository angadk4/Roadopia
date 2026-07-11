/**
 * [GATE-R] ranking experiment — R1 deterministic top-1 vs R4 LLM selection
 * (M4-T08; Protocol §14 / §18-B / §20 / §27).
 *
 * PRE-REGISTERED DECISION RULE (fixed before any result was computed; §27 row:
 * "LLM (R4) wins blind preference over R1 by ≥ τ_sel pp at CI AND
 * ≥ gold-satisfaction AND within latency", defaults + margins set here):
 * adopt R4 (LLM selection) for M5-T08 IFF ALL of:
 *   1. BLIND PREFERENCE (owner, §20.1: randomized A/B, provenance hidden, on
 *      the VAL briefs where R4's modal pick ≠ R1's pick): R4 preferred in
 *      ≥ 60% of non-tie judgments (τ_sel = 10 pp over even) AND the Wilson
 *      95% CI lower bound is > 50%.
 *   2. gold_constraint_satisfaction(R4) ≥ gold_constraint_satisfaction(R1) on VAL.
 *   3. Within budget: mean added selection latency ≤ 3000 ms AND mean cost
 *      ≤ $0.03/selection (envelope §4.7: p50 <15 s, ~1–3¢/gen).
 *   4. Practical-value floor (§24 "practical > statistical"; §27 ties →
 *      simpler): if R4 agrees with R1 on ≥ 90% of briefs, the disagreement
 *      sample cannot demonstrate practical value → default R1 regardless.
 * Otherwise the DEFAULT stands: R1 + R6 (deterministic top-1, LLM explanation
 * only), and M5-T08 (LLM selection) is NOT built.
 *
 * Same candidate pool both ways (§14): the deterministic pipeline generates,
 * scores and validates; R1 takes argmax presentKey among feasible kept; R4
 * lets Sonnet pick from the SAME feasible kept shortlist via numeric fact
 * sheets (no geography). N=3 repeats (§22/§24), modal pick, flips reported;
 * a null/invalid selection falls back to R1's pick (§50).
 *
 * Two-phase Verify (single command, `pnpm -C eval run ranking`):
 *   - No pairwise sheet on disk → runs the full experiment, writes the
 *     automated metrics + the BLIND pairwise sheet for the owner + a sealed
 *     pairing key (eval/runs/gate-r-ranking/pairing-key.json — do NOT open
 *     before judging).
 *   - Sheet exists → re-uses it (pairs are NOT regenerated; LLM
 *     nondeterminism would desync verdicts); if verdicts are filled in,
 *     unseals the key and completes the decision.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LineString, ParsedConstraints } from '@shared/types';
import { Client } from 'pg';

import { lookupInRegion } from '../../backend/src/planner/gazetteer';
import { loadReqset } from '../src/datasets/load';
import type { RequestExample } from '../src/datasets/schema';
import { buildManifest, writeManifest } from '../src/harness/manifest';
import { planKeptSet, type KeptCandidate } from '../src/harness/pipeline';
import type { AttemptRecord, RouteStats } from '../src/harness/types';
import { GuardedLlmClient } from '../src/llm/client';
import { llmSelect, SELECT_MODEL, type CandidateFacts } from '../src/llm/select_llm';
import {
  durationError,
  goldConstraintSatisfaction,
  goldIndexOf,
  mean,
} from '../src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const SEED = 42;
const N_REPEATS = 3;
const DEV_SMOKE_N = 3; // plumbing check on DEV before the VAL run (tune-on-DEV discipline)

const REPORTS = fileURLToPath(new URL('../reports', import.meta.url));
const PAIRS_DIR = fileURLToPath(new URL('../gate-r-pairs', import.meta.url));
const RUN_DIR = fileURLToPath(new URL('../runs/gate-r-ranking', import.meta.url));
const SHEET_PATH = join(REPORTS, 'ranking-pairwise-sheet.md');
const KEY_PATH = join(RUN_DIR, 'pairing-key.json');

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Wilson 95% CI lower bound for k successes of n. */
function wilsonLower(k: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre - spread) / denom;
}

function factsOf(c: KeptCandidate): CandidateFacts {
  return {
    id: c.id,
    duration_min: Math.round(c.durationS / 60),
    distance_km: Math.round(c.distanceM / 100) / 10,
    curviness: Math.round(c.curviness * 100) / 100,
    self_overlap_pct: Math.round(c.selfOverlap * 100),
    uturns: c.uturns,
    spurs: c.spursWide,
    longest_retrace_m: Math.round(c.retraceRunM),
    stops_included: c.stopsIncluded,
    deterministic_score: Math.round(c.score * 1000) / 1000,
  };
}

/** Map a pick's verdict onto the calculator's gold hard-constraint names. */
function attemptRecordOf(
  example: RequestExample,
  configId: string,
  pick: KeptCandidate,
  llm: { calls: number; invalid: number; cost: number; latency: number },
): AttemptRecord {
  const gold = example.gold!;
  const violations: AttemptRecord['violations'] = [];
  for (const res of pick.verdict.results) {
    if (res.status !== 'violated') continue;
    if (res.constraint === 'loop_closure')
      violations.push({ tier: 2, name: 'shape', disclosed: false });
    if (res.constraint === 'stops') {
      for (const s of gold.constraints.stops) {
        if (s.importance === 'required') {
          violations.push({ tier: 2, name: `stop_${s.type}`, disclosed: false });
        }
      }
    }
  }
  const route: RouteStats = {
    duration_s: pick.durationS,
    distance_m: pick.distanceM,
    closureM: pick.closureM,
    isLoop: true,
    selfOverlap: pick.selfOverlap,
    curvature: pick.curviness,
    connected: true,
    requiredStopsRequested: gold.constraints.stops
      .filter((s) => s.importance === 'required')
      .reduce((n, s) => n + s.count, 0),
    requiredStopsPresent: pick.stopsIncluded,
  };
  return {
    exampleId: example.id,
    configId,
    parsed: gold.constraints,
    disposition: 'proceed',
    outcome: 'feasible',
    route,
    feasible: pick.feasible,
    presented: 1,
    diversityPairwise: null,
    relaxations: [],
    violations,
    firstPassFeasible: true,
    correctionsApplied: 0,
    correctionIntroducedViolation: false,
    repairedToFeasible: false,
    generationTimeMs: llm.latency,
    routeEngineCalls: null,
    llmCalls: llm.calls,
    llmInvalidOutputs: llm.invalid,
    costUsd: llm.cost,
  };
}

interface BriefRun {
  example: RequestExample;
  shortlist: KeptCandidate[];
  r1: KeptCandidate;
  r4: KeptCandidate;
  agreed: boolean;
  flips: boolean;
  fallbacks: number;
  invalid: number;
  calls: number;
  latencyMs: number;
  costUsd: number;
  note: string;
}

function resolvedConstraints(example: RequestExample): ParsedConstraints | null {
  const gold = example.gold;
  if (!gold || gold.expected_disposition !== 'proceed') return null;
  if (gold.constraints.shape !== 'loop') return null; // M3 planner is loops-only
  const c = gold.constraints;
  if (c.origin && typeof c.origin === 'object') return c;
  if (typeof c.origin === 'string' && c.origin !== 'current') {
    const hit = lookupInRegion(c.origin);
    if (hit) return { ...c, origin: { lat: hit.lat, lng: hit.lng } };
  }
  return null; // 'current' / null / unresolvable — not runnable in offline eval
}

async function runBrief(
  db: Client,
  client: GuardedLlmClient,
  example: RequestExample,
  constraints: ParsedConstraints,
  briefIndex: number,
): Promise<BriefRun | { example: RequestExample; note: string }> {
  const outcome = await planKeptSet(db, VALHALLA, constraints);
  const shortlist = outcome.kept.filter((k) => k.feasible);
  if (shortlist.length === 0) return { example, note: 'no feasible candidate (pool excluded)' };
  const r1 = shortlist.reduce((b, k) => (k.presentKey > b.presentKey ? k : b));
  if (shortlist.length === 1) {
    return {
      example,
      shortlist,
      r1,
      r4: r1,
      agreed: true,
      flips: false,
      fallbacks: 0,
      invalid: 0,
      calls: 0,
      latencyMs: 0,
      costUsd: 0,
      note: 'single feasible candidate — no selection choice',
    };
  }

  const picks: string[] = [];
  let fallbacks = 0;
  let invalid = 0;
  let calls = 0;
  let latencyMs = 0;
  let costUsd = 0;
  for (let n = 0; n < N_REPEATS; n++) {
    const rng = mulberry32(SEED + n * 1000 + briefIndex);
    const facts = shuffled(shortlist.map(factsOf), rng);
    const sel = await llmSelect(client, example.brief, facts);
    calls += sel.llmCalls;
    invalid += sel.invalidOutputs;
    latencyMs += sel.latencyMs;
    costUsd += sel.costUsd;
    if (sel.chosenId === null) {
      fallbacks++;
      picks.push(r1.id); // §50: fall back to deterministic
    } else {
      picks.push(sel.chosenId);
    }
  }
  const counts = new Map<string, number>();
  for (const p of picks) counts.set(p, (counts.get(p) ?? 0) + 1);
  let modalId = picks[0]!;
  let bestCount = 0;
  for (const [id, n] of counts) {
    // tie-break toward R1's pick (the simpler default), then stable order
    if (n > bestCount || (n === bestCount && id === r1.id)) {
      modalId = id;
      bestCount = n;
    }
  }
  const r4 = shortlist.find((k) => k.id === modalId)!;
  return {
    example,
    shortlist,
    r1,
    r4,
    agreed: r4.id === r1.id,
    flips: new Set(picks).size > 1,
    fallbacks,
    invalid,
    calls,
    latencyMs,
    costUsd,
    note: '',
  };
}

interface PairEntry {
  pair: string;
  exampleId: string;
  brief: string;
  /** Which of A/B is R4 (sealed — never printed in the sheet). */
  aIs: 'R1' | 'R4';
}

function writePair(pair: string, brief: string, a: KeptCandidate, b: KeptCandidate): void {
  const feature = (label: 'A' | 'B', c: KeptCandidate, color: string) => ({
    type: 'Feature',
    properties: {
      name: `${pair} route ${label} — ${Math.round(c.durationS / 60)} min / ${Math.round(c.distanceM / 100) / 10} km`,
      route: label,
      stroke: color,
      'stroke-width': 3,
      'stroke-opacity': 0.85,
    },
    geometry: c.geometry as LineString,
  });
  const fc = {
    type: 'FeatureCollection',
    features: [feature('A', a, '#3366cc'), feature('B', b, '#e08214')],
  };
  writeFileSync(join(PAIRS_DIR, `${pair}.geojson`), JSON.stringify(fc), 'utf8');
}

function parseFilledSheet(): Map<string, 'A' | 'B' | 'tie'> | null {
  if (!existsSync(SHEET_PATH)) return null;
  const verdicts = new Map<string, 'A' | 'B' | 'tie'>();
  for (const line of readFileSync(SHEET_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^\|\s*(pair-\d+)\s*\|.*\|\s*(A|B|a|b|tie|TIE|Tie)\s*\|\s*$/.exec(line);
    if (m) {
      const v = m[2]!.toLowerCase();
      verdicts.set(m[1]!, v === 'tie' ? 'tie' : (v.toUpperCase() as 'A' | 'B'));
    }
  }
  return verdicts.size > 0 ? verdicts : null;
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const gold = goldIndexOf([...reqset.dev, ...reqset.val]);

  // --- judge phase: sheet already filled → decide without re-running LLMs ---
  const filled = parseFilledSheet();
  if (filled && existsSync(KEY_PATH)) {
    const key = JSON.parse(readFileSync(KEY_PATH, 'utf8')) as {
      pairs: PairEntry[];
      automated: Record<string, number | null>;
    };
    let r4Wins = 0;
    let ties = 0;
    let judged = 0;
    for (const p of key.pairs) {
      const v = filled.get(p.pair);
      if (!v) continue;
      judged++;
      if (v === 'tie') ties++;
      else if ((v === 'A') === (p.aIs === 'R4')) r4Wins++;
    }
    const nonTie = judged - ties;
    const rate = nonTie > 0 ? r4Wins / nonTie : null;
    const lower = wilsonLower(r4Wins, Math.max(nonTie, 1));
    const auto = key.automated;
    const prefCleared = rate !== null && rate >= 0.6 && lower > 0.5;
    const goldCleared = (auto['r4_gold'] ?? 0) >= (auto['r1_gold'] ?? 0);
    const budgetCleared = (auto['latency_ms'] ?? 1e9) <= 3000 && (auto['cost_usd'] ?? 1) <= 0.03;
    const floorCleared = (auto['agreement'] ?? 1) < 0.9;
    const adopt = prefCleared && goldCleared && budgetCleared && floorCleared;
    const lines = [
      '',
      '## DECISION ([GATE-R], judged sheet unsealed)',
      '',
      `Blind pairwise: ${judged} judged (${ties} ties) — R4 preferred ${r4Wins}/${nonTie} non-tie ` +
        `(${rate === null ? '—' : (rate * 100).toFixed(0) + '%'}, Wilson 95% lower ${(lower * 100).toFixed(0)}%). ` +
        `Criterion (≥60% and lower >50%): ${prefCleared ? 'CLEARED' : 'not cleared'}.`,
      `Gold satisfaction R4 ≥ R1: ${goldCleared ? 'CLEARED' : 'not cleared'} · ` +
        `budget: ${budgetCleared ? 'CLEARED' : 'not cleared'} · ` +
        `practical-value floor (<90% agreement): ${floorCleared ? 'CLEARED' : 'not cleared'}.`,
      '',
      adopt
        ? '**ADOPT R4 (LLM selection) for M5-T08** — all pre-registered criteria cleared.'
        : '**KEEP R1 + R6 (deterministic top-1, LLM explanation only)** — a pre-registered criterion was not cleared; M5-T08 LLM selection is NOT built.',
    ];
    writeFileSync(
      join(REPORTS, 'ranking.md'),
      readFileSync(join(REPORTS, 'ranking.md'), 'utf8') + lines.join('\n') + '\n',
      'utf8',
    );
    console.log(lines.join('\n'));
    return;
  }
  if (existsSync(SHEET_PATH)) {
    console.log(
      'Pairwise sheet exists but has no verdicts yet — fill the last column (A / B / tie), then re-run.',
    );
    return;
  }

  // --- experiment phase ---
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const client = new GuardedLlmClient();

  // DEV smoke: plumbing only (never used for the decision)
  const devUsable = reqset.dev
    .map((e) => ({ e, c: resolvedConstraints(e) }))
    .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null)
    .slice(0, DEV_SMOKE_N);
  console.log(`DEV smoke (${devUsable.length} briefs, plumbing only)…`);
  for (let i = 0; i < devUsable.length; i++) {
    try {
      const r = await runBrief(db, client, devUsable[i]!.e, devUsable[i]!.c, 1000 + i);
      console.log(
        `  ${devUsable[i]!.e.id}: ${'r1' in r ? `${r.shortlist.length} feasible, R4 ${r.agreed ? 'agrees' : 'DISAGREES'}` : r.note}`,
      );
    } catch (err) {
      console.log(`  ${devUsable[i]!.e.id}: ERROR ${err instanceof Error ? err.message : err}`);
    }
  }

  const valUsable = reqset.val
    .map((e) => ({ e, c: resolvedConstraints(e) }))
    .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null);
  const skipped = reqset.val.length - valUsable.length;
  console.log(
    `\nVAL run: ${valUsable.length} usable loop briefs (${skipped} skipped: a_to_b/clarify/current-origin)…`,
  );

  const runs: BriefRun[] = [];
  const excluded: Array<{ id: string; note: string }> = [];
  for (let i = 0; i < valUsable.length; i++) {
    const { e, c } = valUsable[i]!;
    try {
      const r = await runBrief(db, client, e, c, i);
      if ('r1' in r) {
        runs.push(r);
        console.log(
          `  [${i + 1}/${valUsable.length}] ${e.id}: ${r.shortlist.length} feasible — R1=${r.r1.id} R4=${r.r4.id}` +
            `${r.agreed ? '' : '  ← DISAGREE'}${r.flips ? ' (flips)' : ''} $${client.guard.ledger.costUsd.toFixed(3)}`,
        );
      } else {
        excluded.push({ id: e.id, note: r.note });
        console.log(`  [${i + 1}/${valUsable.length}] ${e.id}: EXCLUDED — ${r.note}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      excluded.push({ id: e.id, note: `ERROR ${msg}` });
      console.log(`  [${i + 1}/${valUsable.length}] ${e.id}: ERROR ${msg}`);
    }
  }
  await db.end();

  // automated metrics
  const r1Records = runs.map((r) =>
    attemptRecordOf(r.example, 'R1', r.r1, { calls: 0, invalid: 0, cost: 0, latency: 0 }),
  );
  const r4Records = runs.map((r) =>
    attemptRecordOf(r.example, 'R4', r.r4, {
      calls: r.calls,
      invalid: r.invalid,
      cost: r.costUsd,
      latency: r.latencyMs / Math.max(1, N_REPEATS),
    }),
  );
  const r1Gold = goldConstraintSatisfaction(r1Records, gold)[0]!;
  const r4Gold = goldConstraintSatisfaction(r4Records, gold)[0]!;
  const r1Dur = durationError(r1Records, gold)[0]!;
  const r4Dur = durationError(r4Records, gold)[0]!;
  const withChoice = runs.filter((r) => r.shortlist.length > 1);
  const agreement = withChoice.length
    ? withChoice.filter((r) => r.agreed).length / withChoice.length
    : 1;
  const flipRate = withChoice.length
    ? withChoice.filter((r) => r.flips).length / withChoice.length
    : 0;
  const meanLatency = mean(withChoice.map((r) => r.latencyMs / N_REPEATS));
  const meanCost = mean(withChoice.map((r) => r.costUsd / N_REPEATS));
  const totalInvalid = runs.reduce((s, r) => s + r.invalid, 0);
  const totalCalls = runs.reduce((s, r) => s + r.calls, 0);
  const totalFallbacks = runs.reduce((s, r) => s + r.fallbacks, 0);

  // disagreement pairs → blind sheet + sealed key
  const disagreements = runs.filter((r) => !r.agreed);
  mkdirSync(PAIRS_DIR, { recursive: true });
  mkdirSync(RUN_DIR, { recursive: true });
  const rng = mulberry32(SEED);
  const pairs: PairEntry[] = [];
  disagreements.forEach((r, idx) => {
    const pair = `pair-${String(idx + 1).padStart(2, '0')}`;
    const r4First = rng() < 0.5;
    const a = r4First ? r.r4 : r.r1;
    const b = r4First ? r.r1 : r.r4;
    writePair(pair, r.example.brief, a, b);
    pairs.push({
      pair,
      exampleId: r.example.id,
      brief: r.example.brief,
      aIs: r4First ? 'R4' : 'R1',
    });
  });

  const automated: Record<string, number | null> = {
    r1_gold: r1Gold.value,
    r4_gold: r4Gold.value,
    agreement,
    latency_ms: meanLatency,
    cost_usd: meanCost,
  };
  writeFileSync(KEY_PATH, JSON.stringify({ pairs, automated }, null, 2), 'utf8');

  if (pairs.length > 0) {
    const sheet = [
      '# [GATE-R] blind pairwise sheet — which route would you rather drive?',
      '',
      'For each pair: open `eval/gate-r-pairs/<pair>.geojson` at geojson.io. Route A is BLUE,',
      'route B is ORANGE. Re-read the brief, then put **A**, **B**, or **tie** in the last',
      'column — purely "which would I rather drive for this request". Provenance is hidden',
      '(§20.1): do NOT open `eval/runs/gate-r-ranking/pairing-key.json` until the sheet is',
      'filled. When done, re-run `pnpm -C eval run ranking` — it unseals the key and decides.',
      '',
      '| pair | brief | file | your pick (A/B/tie) |',
      '|---|---|---|---|',
      ...pairs.map((p) => `| ${p.pair} | ${p.brief} | gate-r-pairs/${p.pair}.geojson |  |`),
      '',
    ];
    writeFileSync(SHEET_PATH, sheet.join('\n'), 'utf8');
  }

  const fmt = (v: number | null, d = 3) => (v === null ? '—' : v.toFixed(d));
  const report = [
    '# [GATE-R] Ranking — R1 deterministic top-1 vs R4 LLM selection (M4-T08)',
    '',
    'Pre-registered rule (fixed before results; see experiments/ranking.ts header): adopt R4',
    'iff blind preference ≥60% of non-tie judgments with Wilson 95% lower bound >50%, AND',
    'gold satisfaction ≥ R1, AND ≤3 s / ≤$0.03 per selection, AND <90% agreement (practical-',
    'value floor). Default: R1 + R6 (LLM explanation only). Same pool both ways; shortlist =',
    `feasible kept (K≤4); ${SELECT_MODEL}, temperature 0, N=${N_REPEATS}, fact sheets carry no geography.`,
    '',
    `## Automated metrics (VAL, ${runs.length} briefs run, ${excluded.length} excluded)`,
    '',
    '| metric | R1 | R4 |',
    '|---|---|---|',
    `| gold_constraint_satisfaction (P) | ${fmt(r1Gold.value)} (n=${r1Gold.n}) | ${fmt(r4Gold.value)} (n=${r4Gold.n}) |`,
    `| duration_pct_error_median | ${fmt(r1Dur.value, 1)} | ${fmt(r4Dur.value, 1)} |`,
    '',
    `Agreement (R4 modal = R1) on briefs with a real choice: ${(agreement * 100).toFixed(0)}% of ${withChoice.length}.`,
    `Stability: flip rate ${(flipRate * 100).toFixed(0)}% of ${withChoice.length} (any pick change across ${N_REPEATS} repeats).`,
    `Invalid model outputs: ${totalInvalid}/${totalCalls} calls; deterministic fallbacks: ${totalFallbacks}.`,
    `Mean selection latency ${meanLatency === null ? '—' : Math.round(meanLatency)} ms · mean cost $${fmt(meanCost, 4)}/selection.`,
    excluded.length
      ? `Excluded: ${excluded.map((e) => `${e.id} (${e.note})`).join('; ')}.`
      : 'Excluded: none.',
    '',
    pairs.length > 0
      ? `## DECISION: PENDING owner blind pairwise — ${pairs.length} disagreement pair(s) in reports/ranking-pairwise-sheet.md`
      : '## DECISION: no disagreements — R4 never picked differently from R1; by the practical-value floor (criterion 4) the DEFAULT R1 + R6 stands. [GATE-R]: LLM selection NOT adopted.',
    '',
    `Cost ledger: ${client.guard.ledger.calls} calls · $${client.guard.ledger.costUsd.toFixed(4)} (budget $${client.guard.budgetUsd}).`,
  ];
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(join(REPORTS, 'ranking.md'), report.join('\n') + '\n', 'utf8');

  const manifest = buildManifest({
    experimentId: 'gate-r-ranking',
    scoringConfigId: 'default-weights-v1',
    weights: {},
    datasetSplit: 'val',
    datasetVersion: reqset.manifest.version,
    seed: SEED,
    model: {
      id: SELECT_MODEL,
      params: { temperature: 0, max_tokens: 300, structured_outputs: true },
      n_repeats: N_REPEATS,
    },
    costLedger: {
      total_usd: client.guard.ledger.costUsd,
      llm_calls: client.guard.ledger.calls,
      notes: 'direct API (one-shot experiment); DEV smoke included in ledger',
    },
  });
  writeManifest(manifest);

  console.log('\nwrote eval/reports/ranking.md');
  console.log(
    pairs.length > 0
      ? `BLIND SHEET: eval/reports/ranking-pairwise-sheet.md (${pairs.length} pairs) — owner judges, then re-run.`
      : 'No disagreement pairs — gate decided by the practical-value floor (default R1 + R6).',
  );
  console.log(`total spend: $${client.guard.ledger.costUsd.toFixed(4)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
