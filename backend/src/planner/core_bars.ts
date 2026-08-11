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
/**
 * R28 (BD-128): minimum length of the single merged road a ribbon is built
 * from. At 8 km this yielded 24 ribbons across 1 177 cells — the binding
 * constraint on the index, NOT RIBBONS_PER_CELL. Ribbons are the shape that
 * works for door-to-door loops (12/24 accepted at 95 % backroad vs loop cores
 * 1/15 at 49 %), so the supply matters.
 */
export const CORE_RIBBON_ENDPOINT_MIN_M = Number(process.env['CORE_RIBBON_ENDPOINT_MIN_M'] ?? 8000);
/**
 * R28 (BD-130) — how much ROAD a ribbon must be built from, as distinct from
 * how far apart its two ENDS are.
 *
 * These were ONE constant, doing two unrelated jobs: `build_drive_cores`
 * filtered merged roads by `lengthM >= CORE_RIBBON_ENDPOINT_MIN_M` while
 * `core_bars` rejected on `endpointSeparationM < CORE_RIBBON_ENDPOINT_MIN_M`.
 * So lowering it to admit shorter roads ALSO admitted winding roads whose ends
 * are barely apart — which then failed the separation bar: 1 242
 * `endpoint_separation` rejections, the single largest ribbon killer in the
 * r30 sweep. Length and separation are different properties and now have
 * different knobs.
 */
export const CORE_RIBBON_MIN_LENGTH_M = Number(process.env['CORE_RIBBON_MIN_M'] ?? 8000);
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
  /** BD-165: transversal self-crossings (crossings.ts detector). Optional so
   *  pre-existing callers/tests remain valid; sweep supplies it. */
  selfCrossings?: number;
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

/** BD-167 (R36-U12b) — LAYERED judging: structural rejects are absolute,
 *  quality floors are catastrophic-only, and everything else is a RANKING
 *  score so a 54.9 %-backroad ring competes instead of vanishing. Rows that
 *  also pass the STRICT bars keep bar_profile='strict' and always outrank
 *  layered rows at serve time (the RPC orders strict-first). */
export interface LayeredVerdict {
  structural: string[];
  floors: string[];
  /** Deterministic quality for cell-keep ranking (higher = better). */
  quality: number;
}

export const FLOOR_BACKROAD_MIN = 0.4;
export const FLOOR_MAIN_MAX = 0.45;
export const FLOOR_HOOD_MAX = 0.1;
export const FLOOR_TURNS_MAX = 8;
export const FLOOR_LOOPINESS_MIN = 0.18;

export function judgeCoreLayered(m: CoreMetrics): LayeredVerdict {
  const structural: string[] = [];
  if (m.mix === null) structural.push('untraced');
  if (m.uturns > 0) structural.push('uturns');
  if (m.spursWide > 0) structural.push('spurs');
  if (m.microloops > 0) structural.push('microloops');
  if ((m.selfCrossings ?? 0) > 0) structural.push('self_crossing');
  if (m.highwayM > CORE_HIGHWAY_FLOOR_M) structural.push('highway');
  if (m.kind !== 'loop') {
    if (m.corridorDoubling === null || m.corridorDoubling > CORE_RIBBON_CORRIDOR_DOUBLING_MAX) {
      structural.push('corridor_doubling');
    }
    if (m.endpointSeparationM === null || m.endpointSeparationM < CORE_RIBBON_ENDPOINT_MIN_M) {
      structural.push('endpoint_separation');
    }
    if (m.selfOverlap === null || m.selfOverlap > CORE_RIBBON_SELF_OVERLAP_MAX) {
      structural.push('self_overlap');
    }
  }
  const floors: string[] = [];
  if (m.mix !== null) {
    if (m.mix.backroadShare < FLOOR_BACKROAD_MIN) floors.push('backroad_floor');
    if (m.mix.mainShare > FLOOR_MAIN_MAX) floors.push('main_floor');
    if (m.mix.hoodShare > FLOOR_HOOD_MAX) floors.push('hood_floor');
  }
  if (m.turnsPer10min === null || m.turnsPer10min > FLOOR_TURNS_MAX) floors.push('turns_floor');
  if (m.kind === 'loop' && (m.loopiness === null || m.loopiness < FLOOR_LOOPINESS_MIN)) {
    floors.push('loopiness_floor');
  }
  const back = m.mix?.backroadShare ?? 0;
  const hood = m.mix?.hoodShare ?? 1;
  const turns = m.turnsPer10min ?? 10;
  const curv = 0; // curviness arrives at the row level in the sweep; score there adds it
  const quality =
    back + (0.25 * Math.min(curv, 3)) / 3 - 0.5 * hood - (0.15 * Math.max(0, turns - 5)) / 5;
  return { structural, floors, quality };
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
  // BD-165: a loop is a SIMPLE CLOSED CURVE — the sweep never measured
  // self-crossings and stored 71 bowties in r34 (18 % of the index), which
  // Discover served ungated. Zero tolerance at the source.
  if ((m.selfCrossings ?? 0) > 0) failures.push('self_crossing');
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
