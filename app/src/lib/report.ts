/**
 * Content reporting (M10-T06; FR-300/304). Anyone — including anonymous
 * users — can report a route, spot or photo (§55: insert-only; no read
 * policy, so the app can honestly promise "someone will look at it" and
 * nothing more; moderation reads happen service-role-side only).
 */

import type { FetchLike } from './api';
import { DataError, type SupabaseConfig } from './data';

export const REPORT_REASON_MAX = 500;
export type ReportTarget = 'route' | 'spot' | 'photo';

export async function submitReport(
  cfg: SupabaseConfig,
  accessToken: string | null,
  report: { target_type: ReportTarget; target_id: string; reason: string },
  fetchImpl?: FetchLike,
): Promise<void> {
  const reason = report.reason.trim().slice(0, REPORT_REASON_MAX);
  if (reason.length === 0) throw new DataError('Say briefly what the problem is.', null);
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    // No `returning` on purpose: anon has INSERT but no SELECT (§55) — asking
    // for the row back would 403 a legitimate report.
    res = await f(`${cfg.url}/rest/v1/reports`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        authorization: `Bearer ${accessToken ?? cfg.anonKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({
        target_type: report.target_type,
        target_id: report.target_id,
        reason,
      }),
    });
  } catch (err) {
    throw new DataError('Could not reach the data service — check your connection.', null, {
      cause: err,
    });
  }
  if (!res.ok) throw new DataError('Could not send the report right now.', res.status);
}
