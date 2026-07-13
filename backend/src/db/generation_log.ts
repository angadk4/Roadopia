/**
 * Generation logging + persistent month-spend ledger (M6-T04/T05; FR-049,
 * FR-260/263; §47.1).
 *
 *   logGeneration — one row per /plan run into `ai_generation_requests`
 *     (status is the §47.1 3-value enum; the precise planner status +
 *     per-constraint outcomes + tool stats ride in `metrics`).
 *
 *   DbMonthLedger — the production LedgerSink: per-call entries accumulate
 *     in memory (the cost guard's projection math needs sync reads) on top
 *     of a month base primed from the DB at boot, so the $20/$30 caps keep
 *     counting across restarts. Per-generation cost persists via the
 *     FR-049 row; per-call granularity is in-memory only (recorded in
 *     BD-45 — the guard needs sums, not call rows).
 */

import type { ParsedConstraints } from '@shared/types';
import type { Client } from 'pg';

import type { LedgerEntry, LedgerSink } from '../ai/ledger';

export type GenerationDbStatus = 'ok' | 'relaxed' | 'failed';

/** Map the planner's honest 7-status to the §47.1 3-value column. */
export function toDbStatus(plannerStatus: string): GenerationDbStatus {
  if (plannerStatus === 'ok') return 'ok';
  if (plannerStatus === 'relaxed' || plannerStatus === 'best_so_far') return 'relaxed';
  return 'failed';
}

export interface GenerationLogRow {
  userId: string | null;
  brief: string;
  parsedConstraints: ParsedConstraints | null;
  status: GenerationDbStatus;
  iterations: number;
  latencyMs: number;
  tokenCostUsd: number;
  metrics: Record<string, unknown>;
}

export async function logGeneration(db: Client, row: GenerationLogRow): Promise<string | null> {
  try {
    const res = await db.query<{ id: string }>(
      `insert into ai_generation_requests
         (user_id, brief, parsed_constraints, status, iterations, latency_ms, token_cost_usd, metrics)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb)
       returning id`,
      [
        row.userId,
        row.brief,
        row.parsedConstraints === null ? null : JSON.stringify(row.parsedConstraints),
        row.status,
        row.iterations,
        row.latencyMs,
        row.tokenCostUsd,
        JSON.stringify(row.metrics),
      ],
    );
    return res.rows[0]?.id ?? null;
  } catch {
    // logging must never take the planner down; the miss is visible in ops logs
    return null;
  }
}

const monthKey = (d: Date | string): string => {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
};

/** LedgerSink over the FR-049 table: DB month base + in-memory session tail. */
export class DbMonthLedger implements LedgerSink {
  private baseUsd = 0;
  private baseMonth = '';
  private readonly memory: LedgerEntry[] = [];

  constructor(private readonly db: Client) {}

  /** Prime the month base from ai_generation_requests (call once at boot). */
  async prime(now: Date = new Date()): Promise<void> {
    const res = await this.db.query<{ sum: string | null }>(
      `select sum(token_cost_usd)::text as sum
       from ai_generation_requests
       where created_at >= date_trunc('month', $1::timestamptz)`,
      [now.toISOString()],
    );
    this.baseUsd = Number(res.rows[0]?.sum ?? 0) || 0;
    this.baseMonth = monthKey(now);
  }

  append(entry: LedgerEntry): void {
    this.memory.push(entry);
  }

  monthUsd(now: Date): number {
    const key = monthKey(now);
    const memorySum = this.memory
      .filter((e) => monthKey(e.at) === key)
      .reduce((s, e) => s + e.costUsd, 0);
    return (this.baseMonth === key ? this.baseUsd : 0) + memorySum;
  }

  entries(): readonly LedgerEntry[] {
    return this.memory;
  }
}
