import { describe, expect, it } from 'vitest';

import { AiClient, type Transport } from './client';
import {
  AiDisabledError,
  computeCostUsd,
  CostGuard,
  HARD_CAP_USD,
  SOFT_CAP_USD,
} from './cost_guard';
import { MemoryLedger } from './ledger';
import { PARSE_PROMPT } from './prompts/parse';

/** M5-T01 + M5-T07 — fully mocked: no network, no key, deterministic clock. */

const fakeTransport =
  (text: string, tokens = { in: 1000, out: 200, cache: 0 }): Transport =>
  async () => ({
    text,
    inputTokens: tokens.in,
    outputTokens: tokens.out,
    cacheReadTokens: tokens.cache,
  });

function guardWith(opts: Partial<ConstructorParameters<typeof CostGuard>[0]> = {}): {
  guard: CostGuard;
  ledger: MemoryLedger;
} {
  const ledger = new MemoryLedger();
  const guard = new CostGuard({
    ledger,
    now: () => new Date('2026-07-13T12:00:00Z'),
    ...opts,
  });
  return { guard, ledger };
}

describe('AiClient (M5-T01, mocked transport)', () => {
  it('returns structured output and records prompt id + version in the ledger', async () => {
    const { guard, ledger } = guardWith();
    const client = new AiClient({
      guard,
      transport: fakeTransport('{"shape":"loop"}'),
    });
    const res = await client.call(PARSE_PROMPT, 'Brief: a loop from Guelph');
    expect(JSON.parse(res.text)).toEqual({ shape: 'loop' });
    expect(res.promptId).toBe('parse');
    expect(res.promptVersion).toBe(PARSE_PROMPT.version); // tracks the prompt, not a pin
    const entry = ledger.entries()[0]!;
    expect(entry.promptId).toBe('parse');
    expect(entry.promptVersion).toBe(PARSE_PROMPT.version);
    expect(entry.model).toBe(PARSE_PROMPT.model);
    expect(entry.costUsd).toBeCloseTo(computeCostUsd(PARSE_PROMPT.model, 1000, 200), 10);
    expect(entry.ok).toBe(true);
  });

  it('kill switch blocks BEFORE any transport call (FR-262)', async () => {
    const { guard } = guardWith({ killSwitch: () => true });
    let transportCalled = false;
    const client = new AiClient({
      guard,
      transport: async () => {
        transportCalled = true;
        return { text: '', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
      },
    });
    await expect(client.call(PARSE_PROMPT, 'x')).rejects.toThrow(AiDisabledError);
    expect(transportCalled).toBe(false);
  });

  it('hard cap blocks the next call once the month is spent (FR-260/261)', async () => {
    const { guard } = guardWith();
    // burn the month to just under the cap — the worst-case projection of the
    // next call must push it over
    guard.record({
      model: 'claude-haiku-4-5',
      promptId: 'parse',
      promptVersion: 1,
      inputTokens: 0,
      outputTokens: (HARD_CAP_USD / 5) * 1_000_000 - 1000, // ≈ cap in output tokens
      latencyMs: 1,
      ok: true,
    });
    const client = new AiClient({ guard, transport: fakeTransport('{}') });
    await expect(client.call(PARSE_PROMPT, 'x')).rejects.toThrow(AiDisabledError);
  });

  it('soft warning trips at $20 without blocking (FR-260)', () => {
    const { guard } = guardWith();
    guard.record({
      model: 'claude-haiku-4-5',
      promptId: 'parse',
      promptVersion: 1,
      inputTokens: 0,
      outputTokens: (SOFT_CAP_USD / 5) * 1_000_000,
      latencyMs: 1,
      ok: true,
    });
    expect(guard.softWarning()).toBe(true);
    expect(() => guard.assertCallAllowed('claude-haiku-4-5', 500)).not.toThrow();
  });

  it('cache reads bill at ~0.1× input', () => {
    expect(computeCostUsd('claude-haiku-4-5', 0, 0, 1_000_000)).toBeCloseTo(0.1, 6);
  });

  it('ledger monthUsd only sums the current UTC month', () => {
    const ledger = new MemoryLedger();
    ledger.append({
      at: '2026-06-30T23:59:00Z',
      model: 'claude-haiku-4-5',
      promptId: 'parse',
      promptVersion: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 5,
      latencyMs: 1,
      ok: true,
    });
    ledger.append({
      at: '2026-07-13T10:00:00Z',
      model: 'claude-haiku-4-5',
      promptId: 'parse',
      promptVersion: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 2,
      latencyMs: 1,
      ok: true,
    });
    expect(ledger.monthUsd(new Date('2026-07-13T12:00:00Z'))).toBe(2);
  });
});
