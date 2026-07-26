/**
 * R25-U13 — THE drive-core rulebook (ACP-001). One module judges a candidate
 * core everywhere: the offline sweep accepts rows with it, the live /discover
 * path re-asserts it inside the SECURITY DEFINER filter's contract, and eval
 * prints its failures — so the two rulebooks can never drift (the U11 gate's
 * bars are re-exported product constants, not invented twins).
 *
 * The bar is HARD and MEASURED (the reject+repair+tier lesson: every defect
 * class with a real gate sits near zero; every class without one sits at
 * 52-53/60). A core that fails is not "ranked lower" — it is not a core.
 *
 * Ribbons are never judged on loopiness (overlap.ts: invalid on open
 * geometry); they gate on corridor-doubling, endpoint separation and
 * self-overlap instead. The pre-registered kill condition (ACP-001 §3) allows
 * a per-cell relaxed profile — that RELAXATION is data (`bar_profile`), never
 * a change to these constants.
 */

import { TRACE_HIGHWAY_FLOOR_M, type ClassMix } from './roadclass';

export type CoreKind = 'loop' | 'ribbon';

// --- the strict bar (ACP-001 §3; audit-v11 clean-drive vocabulary) ----------
export const CORE_BACKROAD_SHARE_MIN = 0.55;
export const CORE_MAIN_SHARE_MAX = 0.3;
/** Highway: ZERO — but measured against the same snap-noise floor as the
 *  planner (a couple of matched ramp metres at a crossing is not "highway"). */
export const CORE_HIGHWAY_FLOOR_M = TRACE_HIGHWAY_FLOOR_M;
export const CORE_HOOD_SHARE_MAX = 0.05;
export const CORE_TURNS_PER_10MIN_MAX = 5.0;
export const CORE_LOOPINESS_MIN = 0.25; // loops only
export const CORE_RIBBON_CORRIDOR_DOUBLING_MAX = 0.1;
export const CORE_RIBBON_ENDPOINT_MIN_M = 8000;
export const CORE_RIBBON_SELF_OVERLAP_MAX = 0.05;

export interface CoreMetrics {
  kind: CoreKind;
  mix: ClassMix | null; // null = untraced — an untraced core NEVER passes
  highwayM: number;
  turnsPer10min: number | null;
  uturns: number;
  spursWide: number;
  microloops: number;
  /** Loops only; ignored for ribbons. */
  loopiness: number | null;
  /** Ribbons only; ignored for loops. */
  corridorDoubling: number | null;
  endpointSeparationM: number | null;
  selfOverlap: number | null;
}

export interface CoreVerdict {
  pass: boolean;
  /** Named failures — the sweep's per-bar rejection histogram (the ACP-001
   *  kill condition reads THIS, so the binding constraint is named, not
   *  guessed). */
  failures: string[];
}

export function judgeCore(m: CoreMetrics): CoreVerdict {
  const failures: string[] = [];
  if (m.mix === null) {
    failures.push('untraced');
  } else {
    if (m.mix.backroadShare < CORE_BACKROAD_SHARE_MIN) failures.push('backroad_share');
    if (m.mix.mainShare > CORE_MAIN_SHARE_MAX) failures.push('main_share');
    if (m.mix.hoodShare > CORE_HOOD_SHARE_MAX) failures.push('hood_share');
  }
  if (m.highwayM > CORE_HIGHWAY_FLOOR_M) failures.push('highway');
  if (m.turnsPer10min === null || m.turnsPer10min > CORE_TURNS_PER_10MIN_MAX) {
    failures.push('turns');
  }
  if (m.uturns > 0) failures.push('uturns');
  if (m.spursWide > 0) failures.push('spurs');
  if (m.microloops > 0) failures.push('microloops');
  if (m.kind === 'loop') {
    if (m.loopiness === null || m.loopiness < CORE_LOOPINESS_MIN) failures.push('loopiness');
  } else {
    if (m.corridorDoubling === null || m.corridorDoubling > CORE_RIBBON_CORRIDOR_DOUBLING_MAX) {
      failures.push('corridor_doubling');
    }
    if (m.endpointSeparationM === null || m.endpointSeparationM < CORE_RIBBON_ENDPOINT_MIN_M) {
      failures.push('endpoint_separation');
    }
    if (m.selfOverlap === null || m.selfOverlap > CORE_RIBBON_SELF_OVERLAP_MAX) {
      failures.push('self_overlap');
    }
  }
  return { pass: failures.length === 0, failures };
}
