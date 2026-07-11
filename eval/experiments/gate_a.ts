/**
 * [GATE-A] parse ablation (M4-T11; Protocol §18-A).
 *
 * PRE-REGISTERED DECISION RULE (recorded before any result was computed):
 * adopt the LLM parser for M5-T03 IFF, on VAL (DEV is the tuning view only):
 *   1. parse_accuracy(LLM, mean of N=3) ≥ parse_accuracy(rules), AND
 *   2. clarification_appropriateness(LLM) ≥ clarification_appropriateness(rules)
 *      (the §3.5 no-over-asking check), AND
 *   3. disposition_accuracy on ADV (LLM) ≥ rules — safety-flag regression veto.
 * Otherwise the DEFAULT stands: the deterministic rules parser (the schema is
 * parser-agnostic, so M5 can revisit with new evidence).
 *
 * LLM variant: Haiku structured-output parse, temperature 0, N=3 repeats with
 * flip-rate reported (§18/§24 stability rule), through the cost-guarded
 * client (Hard rule F). Run: pnpm -C eval run gate-a
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedConstraints } from '@shared/types';
import { resolveDisposition } from '@shared/types';

import { parseRules } from '../../backend/src/planner/parse_rules';
import { loadReqset } from '../src/datasets/load';
import type { RequestExample } from '../src/datasets/schema';
import { buildManifest, writeManifest } from '../src/harness/manifest';
import type { AttemptRecord } from '../src/harness/types';
import { GuardedLlmClient } from '../src/llm/client';
import { llmParse, PARSE_MODEL } from '../src/llm/parse_llm';
import {
  clarificationAppropriateness,
  dispositionAccuracy,
  goldIndexOf,
  mean,
  parseAccuracy,
  PARSE_FIELDS,
  type GoldIndex,
} from '../src/metrics/calculators';

const SEED = 42;
const N_REPEATS = 3;
const CONCURRENCY = 4;

function parseOnlyRecord(
  exampleId: string,
  configId: string,
  parsed: ParsedConstraints | null,
  latencyMs: number,
  llmCalls: number,
  invalidOutputs: number,
  costUsd: number,
): AttemptRecord {
  return {
    exampleId,
    configId,
    parsed,
    disposition: parsed ? resolveDisposition(parsed) : null,
    outcome: 'error', // parse-only run: no route stage attempted
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
    generationTimeMs: latencyMs,
    routeEngineCalls: 0,
    llmCalls,
    llmInvalidOutputs: invalidOutputs,
    costUsd,
  };
}

function metricsBlock(records: AttemptRecord[], gold: GoldIndex): string[] {
  const rows = [
    parseAccuracy(records, gold),
    clarificationAppropriateness(records, gold),
    dispositionAccuracy(records, gold),
  ];
  return rows.map(
    (m) =>
      `| ${m.name} | ${m.value === null ? '—' : m.value.toFixed(3)} | ${m.n} | ${m.denominator} |`,
  );
}

/** Key-field fingerprint used for the N=3 flip-rate (stability) check. */
function fingerprint(p: ParsedConstraints | null): string {
  if (!p) return 'INVALID';
  return JSON.stringify([
    p.shape,
    p.duration_target_s,
    p.avoid,
    p.stops,
    p.unsafe_flag,
    p.out_of_region_flag,
    p.prompt_injection_flag,
    p.clarification.needed,
  ]);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const splits: Array<[string, RequestExample[]]> = [
    ['DEV', reqset.dev],
    ['VAL', reqset.val],
    ['ADV', reqset.adv],
  ];
  const client = new GuardedLlmClient();
  const lines: string[] = [
    '# [GATE-A] Parse ablation — rules parser vs Haiku structured-output parse (M4-T11)',
    '',
    'Pre-registered rule (before computation): adopt the LLM parser iff on VAL its mean',
    'parse_accuracy ≥ rules AND clarification_appropriateness ≥ rules (no over-asking),',
    'AND ADV disposition_accuracy ≥ rules (safety-flag veto). Default: rules parser.',
    `LLM: ${PARSE_MODEL}, temperature 0, structured outputs, N=${N_REPEATS} repeats, cost-guarded.`,
    '',
  ];
  const decision: Record<string, { rules: number | null; llm: number | null }> = {};

  for (const [splitName, examples] of splits) {
    const gold = goldIndexOf(examples);
    console.log(`\n=== ${splitName} (${examples.length} briefs) ===`);

    // rules variant (deterministic, free)
    const rulesRecords = examples.map((e) => {
      const t0 = performance.now();
      let parsed: ParsedConstraints | null = null;
      try {
        parsed = parseRules(e.brief);
      } catch {
        parsed = null;
      }
      return parseOnlyRecord(e.id, 'rules', parsed, performance.now() - t0, 0, 0, 0);
    });

    // LLM variant, N repeats
    const repeats: AttemptRecord[][] = [];
    for (let n = 0; n < N_REPEATS; n++) {
      const records = await mapLimit(examples, CONCURRENCY, async (e) => {
        const before = client.guard.ledger.costUsd;
        const r = await llmParse(client, e.brief);
        return parseOnlyRecord(
          e.id,
          `llm-r${n}`,
          r.parsed,
          r.latencyMs,
          r.llmCalls,
          r.invalidOutputs,
          client.guard.ledger.costUsd - before,
        );
      });
      repeats.push(records);
      console.log(
        `  llm repeat ${n + 1}/${N_REPEATS} done — spent $${client.guard.ledger.costUsd.toFixed(4)}`,
      );
    }

    // stability: examples whose key-field fingerprint differs across repeats
    let flips = 0;
    for (let i = 0; i < examples.length; i++) {
      const fps = repeats.map((rep) => fingerprint(rep[i]!.parsed));
      if (new Set(fps).size > 1) flips++;
    }

    const perRepeatAcc = repeats.map((rep) => parseAccuracy(rep, gold).value ?? 0);
    const llmAccMean = mean(perRepeatAcc)!;
    const rulesAcc = parseAccuracy(rulesRecords, gold).value;
    const invalid = repeats.flat().reduce((s, r) => s + r.llmInvalidOutputs, 0);
    const llmCallCount = repeats.flat().reduce((s, r) => s + r.llmCalls, 0);
    const llmLatency = mean(repeats.flat().map((r) => r.generationTimeMs));

    lines.push(
      `## ${splitName} (${examples.length} briefs)`,
      '',
      '| metric | value | n | denominator |',
      '|---|---|---|---|',
      ...metricsBlock(rulesRecords, gold).map((row) => row.replace('|', '| rules · ')),
      ...metricsBlock(repeats[0]!, gold).map((row) => row.replace('|', '| llm(r1) · ')),
      '',
      `LLM parse_accuracy per repeat: ${perRepeatAcc.map((v) => v.toFixed(3)).join(' / ')} ` +
        `(mean ${llmAccMean.toFixed(3)}) · rules ${rulesAcc?.toFixed(3)}`,
      `Stability: ${flips}/${examples.length} briefs changed key fields across ${N_REPEATS} repeats.`,
      `Invalid model outputs: ${invalid}/${llmCallCount} calls. Mean LLM latency ${llmLatency?.toFixed(0)} ms.`,
      '',
    );

    if (splitName === 'VAL') {
      decision['val_acc'] = { rules: rulesAcc, llm: llmAccMean };
      decision['val_clar'] = {
        rules: clarificationAppropriateness(rulesRecords, gold).value,
        llm: mean(repeats.map((rep) => clarificationAppropriateness(rep, gold).value ?? 0)),
      };
    }
    if (splitName === 'ADV') {
      decision['adv_disp'] = {
        rules: dispositionAccuracy(rulesRecords, gold).value,
        llm: mean(repeats.map((rep) => dispositionAccuracy(rep, gold).value ?? 0)),
      };
    }
  }

  const ge = (a: number | null, b: number | null) => a !== null && b !== null && a >= b;
  const adopt =
    ge(decision['val_acc']!.llm, decision['val_acc']!.rules) &&
    ge(decision['val_clar']!.llm, decision['val_clar']!.rules) &&
    ge(decision['adv_disp']!.llm, decision['adv_disp']!.rules);

  const ledger = client.guard.ledger;
  lines.push(
    '## DECISION ([GATE-A], per the pre-registered rule)',
    '',
    `| criterion | rules | llm | llm ≥ rules |`,
    '|---|---|---|---|',
    `| VAL parse_accuracy | ${decision['val_acc']!.rules?.toFixed(3)} | ${decision['val_acc']!.llm?.toFixed(3)} | ${ge(decision['val_acc']!.llm, decision['val_acc']!.rules) ? 'YES' : 'no'} |`,
    `| VAL clarification_appropriateness | ${decision['val_clar']!.rules?.toFixed(3)} | ${decision['val_clar']!.llm?.toFixed(3)} | ${ge(decision['val_clar']!.llm, decision['val_clar']!.rules) ? 'YES' : 'no'} |`,
    `| ADV disposition_accuracy | ${decision['adv_disp']!.rules?.toFixed(3)} | ${decision['adv_disp']!.llm?.toFixed(3)} | ${ge(decision['adv_disp']!.llm, decision['adv_disp']!.rules) ? 'YES' : 'no'} |`,
    '',
    adopt
      ? '**ADOPT the LLM parser for M5-T03** (all pre-registered criteria cleared); the rules parser stays as the deterministic fallback.'
      : '**KEEP the rules parser** (a pre-registered criterion was not cleared); M5-T03 builds on rules; the schema stays parser-agnostic for future evidence.',
    '',
    `Cost ledger: ${ledger.calls} calls · ${ledger.inputTokens} in / ${ledger.outputTokens} out tokens · $${ledger.costUsd.toFixed(4)} (budget $${client.guard.budgetUsd}).`,
    `Scored fields per example: ${PARSE_FIELDS.length}.`,
  );

  const manifest = buildManifest({
    experimentId: 'gate-a-parse-ablation',
    scoringConfigId: 'n/a (parse-only)',
    weights: {},
    datasetSplit: 'dev+val+adv',
    datasetVersion: reqset.manifest.version,
    seed: SEED,
    model: {
      id: PARSE_MODEL,
      params: { temperature: 0, max_tokens: 1500, structured_outputs: true },
      n_repeats: N_REPEATS,
    },
    costLedger: {
      total_usd: ledger.costUsd,
      llm_calls: ledger.calls,
      notes: 'direct API (one-shot experiment); Batch adopted for recurring runs at M4-T14',
    },
  });
  const manifestPath = writeManifest(manifest);

  const reportsDir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'parse-ablation.md'), lines.join('\n') + '\n', 'utf8');
  console.log('\nwrote eval/reports/parse-ablation.md');
  console.log(`manifest: ${manifestPath}`);
  console.log(`total spend: $${ledger.costUsd.toFixed(4)} of $${client.guard.budgetUsd}`);
  console.log(`DECISION: ${adopt ? 'ADOPT LLM parser' : 'KEEP rules parser'}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
