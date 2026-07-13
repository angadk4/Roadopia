/**
 * Runtime-AI cost ledger (M5-T07; Spec §38.1, FR-263: "Per-generation cost
 * MUST be recorded").
 *
 * Every LLM call lands here with its REAL token usage, model, prompt id +
 * version (§22 reproducibility) and cost. The in-memory sink is the M5
 * default; the `ai_generation_requests` DB persistence (FR-049) wires in at
 * M6 with the /plan endpoint — the LedgerSink interface is the seam.
 * Entries carry NO secrets, NO prompt text, NO user coordinates (Hard rule H
 * / Build Contract logging rule).
 */

export interface LedgerEntry {
  /** ISO timestamp — injected by the caller for testability. */
  at: string;
  model: string;
  promptId: string;
  promptVersion: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
}

export interface LedgerSink {
  append(entry: LedgerEntry): void;
  /** Total spend in the UTC month of `now`. */
  monthUsd(now: Date): number;
  /** All entries (diagnostics/tests). */
  entries(): readonly LedgerEntry[];
}

export class MemoryLedger implements LedgerSink {
  private readonly rows: LedgerEntry[] = [];

  append(entry: LedgerEntry): void {
    this.rows.push(entry);
  }

  monthUsd(now: Date): number {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    let sum = 0;
    for (const r of this.rows) {
      const d = new Date(r.at);
      if (d.getUTCFullYear() === y && d.getUTCMonth() === m) sum += r.costUsd;
    }
    return sum;
  }

  entries(): readonly LedgerEntry[] {
    return this.rows;
  }
}
