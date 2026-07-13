/**
 * Production cost guard (M5-T07, from the SPK-20 design + the eval CostGuard;
 * Spec §38.1/§65, FR-260..262; Hard rule F: every model call goes through a
 * cost-guarded client, never an uncapped call).
 *
 * Order of checks BEFORE any request leaves the process:
 *   KILL SWITCH (FR-262, instant off) → HARD CAP (worst-case projection of
 *   the next call must fit under the effective monthly cap) → allow.
 * Degradation is the CALLER's job (FR-261): an AiDisabledError means "use the
 * deterministic fallback" (rules parser / template explanation / template
 * title) — browsing and the deterministic planner keep working.
 *
 * The app-side ledger is the fast brake; the TRUE maximum is the [HUMAN]
 * account-side backstop (prepaid credits + workspace spend limit) which the
 * owner sets before public traffic — recorded as an open [HUMAN] item.
 */

import type { LedgerSink } from './ledger';

/** USD per MTok. Haiku is pinned by DATED id for reproducibility (Spec §5/§25);
 *  the alias maps to the same price. Sonnet uses the alias per the same pin. */
export const PRICES: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  'claude-haiku-4-5-20251001': { inPerMTok: 1, outPerMTok: 5 },
  'claude-haiku-4-5': { inPerMTok: 1, outPerMTok: 5 },
  'claude-sonnet-4-6': { inPerMTok: 3, outPerMTok: 15 },
};
export const MODEL_ALLOWLIST = Object.keys(PRICES);

/** §65 spend policy (env-overridable at deploy; these are the spec defaults). */
export const SOFT_CAP_USD = 20;
export const HARD_CAP_USD = 30;
export const TESTING_OVERRIDE_USD = 40;

/** Worst-case input assumption for the pre-call projection (tokens). */
const PROJECTED_MAX_INPUT_TOKENS = 8_000;
export const MAX_OUTPUT_TOKENS = 1_500;

export type DisabledReason = 'kill_switch' | 'hard_cap';

export class AiDisabledError extends Error {
  constructor(
    public readonly reason: DisabledReason,
    detail: string,
  ) {
    super(`runtime AI disabled (${reason}): ${detail} — degrade to the deterministic fallback`);
    this.name = 'AiDisabledError';
  }
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

export interface CostGuardOptions {
  ledger: LedgerSink;
  /** Live kill-switch probe (env/flag/admin) — checked on EVERY call. */
  killSwitch?: () => boolean;
  hardCapUsd?: number;
  /** $40 testing/demo override (§65) — explicit, never ambient. */
  testingOverride?: boolean;
  /** Injectable clock (tests). */
  now?: () => Date;
}

export class CostGuard {
  private readonly ledger: LedgerSink;
  private readonly killSwitch: () => boolean;
  private readonly hardCapUsd: number;
  private readonly now: () => Date;

  constructor(opts: CostGuardOptions) {
    this.ledger = opts.ledger;
    this.killSwitch = opts.killSwitch ?? (() => false);
    this.hardCapUsd = opts.testingOverride
      ? TESTING_OVERRIDE_USD
      : (opts.hardCapUsd ?? HARD_CAP_USD);
    this.now = opts.now ?? (() => new Date());
  }

  /** Spend so far this UTC month. */
  monthUsd(): number {
    return this.ledger.monthUsd(this.now());
  }

  /** FR-260 soft warning ($20): callers may log/banner — never blocks. */
  softWarning(): boolean {
    return this.monthUsd() >= SOFT_CAP_USD;
  }

  /** Throws BEFORE any request when the call must not happen. */
  assertCallAllowed(model: string, maxOutputTokens: number): void {
    if (this.killSwitch()) {
      throw new AiDisabledError('kill_switch', 'admin kill switch is ON');
    }
    if (!MODEL_ALLOWLIST.includes(model)) {
      throw new Error(`model '${model}' is not on the allowlist [${MODEL_ALLOWLIST.join(', ')}]`);
    }
    if (maxOutputTokens > MAX_OUTPUT_TOKENS) {
      throw new Error(
        `max_tokens ${maxOutputTokens} exceeds the per-call cap ${MAX_OUTPUT_TOKENS}`,
      );
    }
    const worstCase = computeCostUsd(model, PROJECTED_MAX_INPUT_TOKENS, maxOutputTokens);
    const spent = this.monthUsd();
    if (spent + worstCase > this.hardCapUsd) {
      throw new AiDisabledError(
        'hard_cap',
        `$${spent.toFixed(2)} spent of $${this.hardCapUsd.toFixed(2)} monthly cap`,
      );
    }
  }

  /** Record REAL usage after a call (both successes and failed validations). */
  record(entry: {
    model: string;
    promptId: string;
    promptVersion: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    latencyMs: number;
    ok: boolean;
  }): number {
    const costUsd = computeCostUsd(
      entry.model,
      entry.inputTokens,
      entry.outputTokens,
      entry.cacheReadTokens ?? 0,
    );
    this.ledger.append({
      at: this.now().toISOString(),
      model: entry.model,
      promptId: entry.promptId,
      promptVersion: entry.promptVersion,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens ?? 0,
      costUsd,
      latencyMs: entry.latencyMs,
      ok: entry.ok,
    });
    return costUsd;
  }
}
