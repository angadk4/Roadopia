import { describe, expect, it } from 'vitest';

import {
  BudgetExceededError,
  computeCostUsd,
  CostGuard,
  DEFAULT_BUDGET_USD,
  MAX_OUTPUT_TOKENS,
} from './client';

/** Hard rule F — the guard is the uncapped-call firewall; test it standalone. */
describe('CostGuard (Hard rule F)', () => {
  it('prices Haiku correctly, with cache reads at ~0.1×', () => {
    expect(computeCostUsd('claude-haiku-4-5', 1_000_000, 0)).toBeCloseTo(1, 6);
    expect(computeCostUsd('claude-haiku-4-5', 0, 1_000_000)).toBeCloseTo(5, 6);
    expect(computeCostUsd('claude-haiku-4-5', 0, 0, 1_000_000)).toBeCloseTo(0.1, 6);
    expect(() => computeCostUsd('claude-opus-4-8', 1, 1)).toThrow(/no price/);
  });

  it('rejects models off the allowlist and over-cap output requests', () => {
    const guard = new CostGuard();
    expect(() => guard.assertCallAllowed('claude-opus-4-8', 100)).toThrow(/allowlist/);
    expect(() => guard.assertCallAllowed('claude-haiku-4-5', MAX_OUTPUT_TOKENS + 1)).toThrow(
      /per-call cap/,
    );
    expect(() => guard.assertCallAllowed('claude-haiku-4-5', 500)).not.toThrow();
  });

  it('throws BEFORE a call once the projected worst case cannot fit', () => {
    const guard = new CostGuard(0.01); // one cent
    // worst case per call: 6000 in + 1500 out ≈ $0.0135 > budget
    expect(() => guard.assertCallAllowed('claude-haiku-4-5', 1500)).toThrow(BudgetExceededError);
  });

  it('accumulates a real ledger and stops at the budget', () => {
    const guard = new CostGuard(DEFAULT_BUDGET_USD);
    guard.record('claude-haiku-4-5', 2500, 700);
    guard.record('claude-haiku-4-5', 2500, 700);
    expect(guard.ledger.calls).toBe(2);
    expect(guard.ledger.costUsd).toBeCloseTo(2 * (2500 / 1e6 + (700 * 5) / 1e6), 8);

    const tiny = new CostGuard(0.02);
    tiny.record('claude-haiku-4-5', 6000, 1500); // ≈ $0.0135 spent
    expect(() => tiny.assertCallAllowed('claude-haiku-4-5', 1500)).toThrow(BudgetExceededError);
  });
});
