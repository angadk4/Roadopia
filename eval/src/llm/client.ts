/**
 * Cost-guarded eval LLM client (Hard rule F: every model call goes through a
 * cost-guarded client; never an uncapped call).
 *
 * Guards, in order: model ALLOWLIST (eval experiments are Haiku-routed per the
 * protocol's §18-A design and Hard rule F routing) → per-call output cap →
 * HARD BUDGET (projected worst-case cost of the next call must fit under the
 * remaining budget, else BudgetExceededError BEFORE any request) → ledger
 * (real usage recorded after every call; feeds the §22 cost ledger).
 *
 * Experiment spend is tracked separately from the $30 production cap (§26);
 * the default budget here is deliberately tiny. Batch API is skipped for
 * one-shot experiments (~$1.5); recurring eval runs adopt Batch at M4-T14.
 * NOTE: Haiku 4.5's minimum cacheable prefix is 4096 tokens — our parse
 * prompt sits below it, so no cache savings are assumed in projections.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';

/**
 * USD per MTok (claude-api reference, cached 2026-06). Exactly the two models
 * the docs pin (Master Spec §25 / Dep Verification §5): Haiku 4.5 for
 * parse/correct, Sonnet 4.6 for select/explain — Hard rule F routing.
 */
export const PRICES: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  'claude-haiku-4-5': { inPerMTok: 1, outPerMTok: 5 },
  // dated pin used by the production prompt registry (M5-T09 single source)
  'claude-haiku-4-5-20251001': { inPerMTok: 1, outPerMTok: 5 },
  'claude-sonnet-4-6': { inPerMTok: 3, outPerMTok: 15 },
};
export const MODEL_ALLOWLIST = Object.keys(PRICES);
export const DEFAULT_BUDGET_USD = 2;
export const MAX_OUTPUT_TOKENS = 1500;
/** Worst-case input assumption for pre-call projection (tokens). */
const PROJECTED_MAX_INPUT_TOKENS = 6000;

export class BudgetExceededError extends Error {
  constructor(spent: number, budget: number) {
    super(
      `eval LLM budget exhausted: spent $${spent.toFixed(4)} of $${budget.toFixed(2)} — ` +
        'no further calls will be made (Hard rule F)',
    );
    this.name = 'BudgetExceededError';
  }
}

export interface Ledger {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model ${model}`);
  // cache reads bill ~0.1× input; uncached input at 1×
  return (
    (inputTokens * p.inPerMTok + cacheReadTokens * p.inPerMTok * 0.1) / 1_000_000 +
    (outputTokens * p.outPerMTok) / 1_000_000
  );
}

/** Pure budget/ledger core — unit-testable without any network. */
export class CostGuard {
  readonly budgetUsd: number;
  readonly ledger: Ledger = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  };

  constructor(budgetUsd: number = DEFAULT_BUDGET_USD) {
    this.budgetUsd = budgetUsd;
  }

  /** Throws BEFORE a call when the worst-case next call cannot fit. */
  assertCallAllowed(model: string, maxOutputTokens: number): void {
    if (!MODEL_ALLOWLIST.includes(model)) {
      throw new Error(`model '${model}' is not on the eval allowlist [${MODEL_ALLOWLIST}]`);
    }
    if (maxOutputTokens > MAX_OUTPUT_TOKENS) {
      throw new Error(
        `max_tokens ${maxOutputTokens} exceeds the per-call cap ${MAX_OUTPUT_TOKENS}`,
      );
    }
    const worstCase = computeCostUsd(model, PROJECTED_MAX_INPUT_TOKENS, maxOutputTokens);
    if (this.ledger.costUsd + worstCase > this.budgetUsd) {
      throw new BudgetExceededError(this.ledger.costUsd, this.budgetUsd);
    }
  }

  record(model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0): void {
    this.ledger.calls++;
    this.ledger.inputTokens += inputTokens;
    this.ledger.outputTokens += outputTokens;
    this.ledger.cacheReadTokens += cacheReadTokens;
    this.ledger.costUsd += computeCostUsd(model, inputTokens, outputTokens, cacheReadTokens);
  }
}

/** Load ANTHROPIC_API_KEY from env or the repo .env (never logged — rule H). */
export function loadApiKey(): string {
  const fromEnv = process.env['ANTHROPIC_API_KEY'];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const envPath = join(fileURLToPath(new URL('../../..', import.meta.url)), '.env');
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('ANTHROPIC_API_KEY='));
  if (!line) throw new Error('ANTHROPIC_API_KEY not found in env or .env');
  return line.slice('ANTHROPIC_API_KEY='.length).trim();
}

export interface GuardedResult {
  text: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

/** The one entry point for eval LLM calls — allowlisted, capped, ledgered. */
export class GuardedLlmClient {
  readonly guard: CostGuard;
  private readonly anthropic: Anthropic;

  constructor(budgetUsd: number = DEFAULT_BUDGET_USD) {
    this.guard = new CostGuard(budgetUsd);
    this.anthropic = new Anthropic({ apiKey: loadApiKey() });
  }

  async complete(options: {
    model: string;
    system: string;
    user: string;
    maxTokens?: number;
    jsonSchema?: Record<string, unknown>;
  }): Promise<GuardedResult> {
    const maxTokens = options.maxTokens ?? MAX_OUTPUT_TOKENS;
    this.guard.assertCallAllowed(options.model, maxTokens);
    const t0 = performance.now();
    const response = await this.anthropic.messages.create({
      model: options.model,
      max_tokens: maxTokens,
      temperature: 0,
      system: [
        {
          type: 'text',
          text: options.system,
          // below Haiku's 4096-token cache minimum today — harmless, and it
          // engages automatically if the prompt ever grows past the threshold
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: options.user }],
      ...(options.jsonSchema
        ? {
            output_config: {
              format: {
                type: 'json_schema' as const,
                schema: options.jsonSchema,
              },
            },
          }
        : {}),
    });
    const latencyMs = performance.now() - t0;
    const usage = response.usage;
    this.guard.record(
      options.model,
      usage.input_tokens,
      usage.output_tokens,
      usage.cache_read_input_tokens ?? 0,
    );
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      latencyMs,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    };
  }
}
