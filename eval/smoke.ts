/**
 * Eval smoke gate (M4-T14) — the PER-PUSH slice of the CI-vs-scheduled eval
 * split (Protocol §26: "run the full eval set on merges/nightly (a smoke
 * subset per push)").
 *
 * Three checks, exit non-zero on any failure:
 *  1. DATASET INTEGRITY — validateReqset(requireGold) must report 0 errors
 *     (leakage, id/count/origin integrity, §6.4).
 *  2. RULES-PARSER FLOOR — parseRules over every DEV+VAL gold brief must hold
 *     parse_accuracy ≥ 0.85 (frozen floor; measured 0.872 combined at
 *     [GATE-A], BD-28 — a drop below the floor is a code regression, not noise).
 *  3. PROMPT GATE (LLM; runs only when ANTHROPIC_API_KEY is present) — the
 *     adopted Haiku parser (BD-28) over 6 PINNED briefs, budget-capped at
 *     $0.10/run (Hard rule F): mean parse_accuracy ≥ 0.80 AND zero unrecovered
 *     invalid outputs. This is the "gate fails on degraded prompt" check —
 *     a bad edit to PARSE_SYSTEM_PROMPT / PARSE_JSON_SCHEMA turns CI red.
 *     Since M5-T09 the prompt/schema/model are IMPORTED from the production
 *     registry (backend/src/ai/prompts/parse.ts) — this gate tests what ships.
 *  4. FACTUALITY GATE (LLM; key-gated, M5-T09) — explanation + title/summary/
 *     tags over a pinned RouteFacts fixture through the PRODUCTION AiClient +
 *     grounding validator. PASS requires both outputs to survive checkGrounded
 *     as 'llm' (a degraded EXPLAIN/TST prompt makes the model invent places →
 *     grounding rejects twice → template fallback → gate red). ~$0.01/run.
 *
 * The FULL runs (planner-in-the-loop: baselines, loop-quality, gate-r/f/w)
 * need live Valhalla + Supabase and stay scheduled/local — see
 * .github/workflows/eval-nightly.yml. Batch API (50 % off) is adopted when a
 * hosted eval runner exists (§26); at 6 briefs/run the smoke is cents-scale.
 *
 * Run: pnpm -C eval run smoke
 */

import { resolveDisposition, type ParsedConstraints } from '@shared/types';

import { AiClient, anthropicTransport } from '../backend/src/ai/client';
import { CostGuard as ProductionCostGuard } from '../backend/src/ai/cost_guard';
import { explainRoute, titleSummaryTags, type RouteFacts } from '../backend/src/ai/explain';
import { MemoryLedger } from '../backend/src/ai/ledger';
import { parseRules } from '../backend/src/planner/parse_rules';

import { loadReqset, validateReqset } from './src/datasets/load';
import type { AttemptRecord } from './src/harness/types';
import { GuardedLlmClient, loadApiKey } from './src/llm/client';
import { llmParse } from './src/llm/parse_llm';
import { goldIndexOf, parseAccuracy } from './src/metrics/calculators';

const RULES_FLOOR = 0.85;
const LLM_FLOOR = 0.8;
const LLM_BUDGET_USD = 0.1;
const FACTUALITY_BUDGET_USD = 0.1;
const PINNED_BRIEFS = ['dev-003', 'dev-010', 'dev-020', 'val-001', 'val-011', 'val-016'];

/** Pinned real-world facts for the factuality gate (Forks-of-the-Credit area —
 *  names the models "know", so an ungrounded prompt WOULD embellish them). */
const PINNED_FACTS: RouteFacts = {
  originName: 'Belfountain',
  durationMin: 87,
  distanceKm: 94,
  targetMin: 90,
  curviness: 2.1,
  roadNames: ['Forks of the Credit Road', 'Mississauga Road', 'The Grange Sideroad'],
  stops: [{ name: 'Higher Ground Café', type: 'coffee' }],
  satisfied: ['duration', 'coffee stop'],
  relaxed: [],
  viewpointCount: 2,
};

function parseOnlyRecord(
  exampleId: string,
  configId: string,
  parsed: ParsedConstraints | null,
  llmCalls = 0,
  llmInvalidOutputs = 0,
): AttemptRecord {
  return {
    exampleId,
    configId,
    parsed,
    disposition: parsed ? resolveDisposition(parsed) : null,
    outcome: 'error',
    route: null,
    feasible: false,
    presented: 0,
    diversityPairwise: null,
    relaxations: [],
    violations: [],
    firstPassFeasible: false,
    correctionsApplied: 0,
    correctionIntroducedViolation: false,
    repairedToFeasible: false,
    generationTimeMs: 0,
    routeEngineCalls: 0,
    llmCalls,
    llmInvalidOutputs,
    costUsd: 0,
  };
}

/** True when a key exists in the repo .env (dev machines) — never logs it. */
function safeLoadKey(): boolean {
  try {
    return loadApiKey().length > 0;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let failed = false;
  const reqset = loadReqset();

  // 1. dataset integrity
  const validation = validateReqset(reqset, { requireGold: true });
  if (validation.errors.length > 0) {
    failed = true;
    console.log(`✗ dataset: ${validation.errors.length} error(s)`);
    for (const e of validation.errors.slice(0, 10)) console.log(`    ${e}`);
  } else {
    console.log(`✓ dataset: 0 errors (${validation.warnings.length} warnings)`);
  }

  // 2. rules-parser floor over all DEV+VAL gold briefs
  const examples = [...reqset.dev, ...reqset.val].filter((e) => e.gold);
  const gold = goldIndexOf(examples);
  const records = examples.map((e) => {
    let parsed: ParsedConstraints | null = null;
    try {
      parsed = parseRules(e.brief);
    } catch {
      parsed = null;
    }
    return parseOnlyRecord(e.id, 'rules', parsed);
  });
  const rulesAcc = parseAccuracy(records, gold).value ?? 0;
  if (rulesAcc < RULES_FLOOR) {
    failed = true;
    console.log(
      `✗ rules parser: accuracy ${rulesAcc.toFixed(3)} < floor ${RULES_FLOOR} (${examples.length} briefs)`,
    );
  } else {
    console.log(
      `✓ rules parser: accuracy ${rulesAcc.toFixed(3)} ≥ ${RULES_FLOOR} (${examples.length} briefs)`,
    );
  }

  // 3. prompt gate (only with a key — CI without the secret skips it honestly)
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.log('- prompt gate: SKIPPED (no ANTHROPIC_API_KEY in environment)');
  } else {
    const client = new GuardedLlmClient(LLM_BUDGET_USD);
    const pinned = examples.filter((e) => PINNED_BRIEFS.includes(e.id));
    const llmRecords: AttemptRecord[] = [];
    let unrecovered = 0;
    for (const e of pinned) {
      const r = await llmParse(client, e.brief);
      if (r.parsed === null) unrecovered++;
      llmRecords.push(parseOnlyRecord(e.id, 'llm-smoke', r.parsed, r.llmCalls, r.invalidOutputs));
    }
    const llmAcc = parseAccuracy(llmRecords, gold).value ?? 0;
    const ok = llmAcc >= LLM_FLOOR && unrecovered === 0;
    if (!ok) failed = true;
    console.log(
      `${ok ? '✓' : '✗'} prompt gate: accuracy ${llmAcc.toFixed(3)} (floor ${LLM_FLOOR}), ` +
        `unrecovered invalid ${unrecovered}/${pinned.length}, spend $${client.guard.ledger.costUsd.toFixed(4)} (cap $${LLM_BUDGET_USD})`,
    );
  }

  // 4. factuality gate: explanation + title/summary/tags via the PRODUCTION client
  if (!process.env['ANTHROPIC_API_KEY'] && !safeLoadKey()) {
    console.log('- factuality gate: SKIPPED (no ANTHROPIC_API_KEY in environment)');
  } else {
    const ledger = new MemoryLedger();
    const aiClient = new AiClient({
      guard: new ProductionCostGuard({ ledger }),
      transport: anthropicTransport(process.env['ANTHROPIC_API_KEY'] ?? loadApiKey()),
    });
    const explanation = await explainRoute(PINNED_FACTS, { client: aiClient });
    const tst = await titleSummaryTags(PINNED_FACTS, { client: aiClient });
    const spend = ledger.monthUsd(new Date());
    // 'template' here means the LIVE model failed grounding twice → degraded prompt
    const ok =
      explanation.source === 'llm' && tst.source === 'llm' && spend <= FACTUALITY_BUDGET_USD;
    if (!ok) failed = true;
    console.log(
      `${ok ? '✓' : '✗'} factuality gate: explanation=${explanation.source}, ` +
        `title/summary/tags=${tst.source} (tags: ${tst.tags.join(',') || 'none'}), ` +
        `spend $${spend.toFixed(4)} (cap $${FACTUALITY_BUDGET_USD})`,
    );
  }

  if (failed) {
    console.log('\nSMOKE: FAIL');
    process.exitCode = 1;
  } else {
    console.log('\nSMOKE: PASS');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
