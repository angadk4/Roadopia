/**
 * R25-U0 — road-class truth, first-class (audit-v11 made these numbers in a
 * scratchpad; this module makes them deterministic planner outputs).
 *
 * Buckets a traced edge into the vocabulary the owner actually cares about:
 *   highway  = motorway/trunk (+ links, ramps, turn channels) — never wanted
 *   main     = primary/secondary — fine as a CONNECTOR, not as the drive
 *   backroad = tertiary/unclassified — what a fun drive is MADE of
 *   hood     = residential/service-grade — neighbourhood streets
 *
 * The bucket function is byte-for-byte the audit-v11 convention (ramp/turn_
 * channel → highway regardless of parent) so the R25 baseline reproduces the
 * audit table; if these numbers and the audit's diverge by more than ~2 pp,
 * the bucketing is wrong — that is U0's falsification test.
 *
 * NOTE Valhalla trace vocabulary: `road_class` is one of motorway|trunk|
 * primary|secondary|tertiary|unclassified|residential|service_other;
 * living_street/driveway/alley arrive as `use`, not class. The sets below
 * carry both spellings defensively (unknown members simply never match).
 */

import type { RouteThroughOutput } from '@shared/types';

import type { TraceEdge } from '../valhalla/trace';

export type RoadBucket = 'highway' | 'main' | 'backroad' | 'hood' | 'other';

export const HIGHWAY_CLASSES: ReadonlySet<string> = new Set([
  'motorway',
  'trunk',
  'motorway_link',
  'trunk_link',
]);
export const MAIN_CLASSES: ReadonlySet<string> = new Set([
  'primary',
  'secondary',
  'primary_link',
  'secondary_link',
]);
export const BACKROAD_CLASSES: ReadonlySet<string> = new Set([
  'tertiary',
  'unclassified',
  'tertiary_link',
  'residential_link',
]);
export const HOOD_CLASSES: ReadonlySet<string> = new Set([
  'residential',
  'service',
  'service_other',
  'living_street',
  'driveway',
  'alley',
  'parking_aisle',
]);

/** Neighbourhood-grade `use` values (Valhalla emits living_street/driveway/
 *  alley through `use`, not `road_class` — the R24 gate never saw them). */
export const HOOD_USES: ReadonlySet<string> = new Set([
  'living_street',
  'alley',
  'driveway',
  'parking_aisle',
  'culdesac',
  'drive_through',
]);

/** R25-U5a — the WIDE neighbourhood predicate: residential/service road
 *  classes OR neighbourhood-grade uses. The legacy gate matched only
 *  `roadClass === 'residential'`, so service/living-street metres inflated
 *  the CLEAN denominator. */
export function isHoodEdge(e: TraceEdge): boolean {
  return HOOD_CLASSES.has(e.roadClass) || (e.use !== undefined && HOOD_USES.has(e.use));
}

/** Audit-v11 bucket convention: ramps/turn channels count as highway. */
export function bucketOf(e: TraceEdge): RoadBucket {
  if (e.use === 'ramp' || e.use === 'turn_channel') return 'highway';
  if (HIGHWAY_CLASSES.has(e.roadClass)) return 'highway';
  if (MAIN_CLASSES.has(e.roadClass)) return 'main';
  if (BACKROAD_CLASSES.has(e.roadClass)) return 'backroad';
  if (HOOD_CLASSES.has(e.roadClass)) return 'hood';
  return 'other';
}

/**
 * R25-U4 — `route.has_highway` must come from the TRACE, not Valhalla's trip
 * summary: probed 2026-07-26, the summary reported `has_highway: false` on a
 * route the trace measured at 33 % `trunk` (in Ontario, Hwy 10/26/89 are
 * trunk — highways to any driver; only the 400-series are motorway). The
 * identical pattern already exists for has_unpaved (R16-2). `off` restores
 * the summary value byte-identically.
 */
export const TRACE_HIGHWAY_TRUTH_ON = process.env['TRACE_HIGHWAY_TRUTH'] !== 'off';
/**
 * The DEFINITION of "the drive includes highway": traced highway metres over
 * this floor. 600 was chosen by the U3v2 A/B sweep (2026-07-26), not guessed:
 *   floor 200 → AC 20→18 (Waterdown pushed onto 10 % residential; Collingwood
 *     curv 0.74→0.00) because a ~300-600 m trunk hop linking two backroad
 *     sections was treated like a 30 km motorway run;
 *   floor 600 → AC 20 (=baseline), hwy mean 1.6→0.3 %, defects 2.08→1.90,
 *     durErr p80 18→16 %, hash 83e23648d271b639.
 * Known cost, recorded honestly: Belfountain + Orangeville twisty briefs stay
 * flattened (their twisty pools carry >600 m of Hwy 10 trunk) — a GENERATION
 * gap for U19/U20, not a reason to let multi-km highway runs back in.
 * Anything over the floor still rejects; a sub-600 m hop is ≤1 % of a typical
 * loop and is not "riding the highway".
 */
export const TRACE_HIGHWAY_FLOOR_M = Number(process.env['TRACE_HIGHWAY_FLOOR'] ?? 600);

/** Traced highway metres (motorway/trunk/links/ramps/turn channels). */
export function tracedHighwayM(edges: readonly TraceEdge[]): number {
  let m = 0;
  for (const e of edges) if (bucketOf(e) === 'highway') m += e.lengthM;
  return m;
}

/** Length-weighted shares in [0,1]; sums to ~1. Null on an empty trace —
 *  unknown is never reported as "0% highway" (arterialShareOf precedent). */
export interface ClassMix {
  highwayShare: number;
  mainShare: number;
  backroadShare: number;
  hoodShare: number;
  otherShare: number;
}

export function classMixOf(edges: readonly TraceEdge[]): ClassMix | null {
  let total = 0;
  const m: Record<RoadBucket, number> = { highway: 0, main: 0, backroad: 0, hood: 0, other: 0 };
  for (const e of edges) {
    total += e.lengthM;
    m[bucketOf(e)] += e.lengthM;
  }
  if (total <= 0) return null;
  return {
    highwayShare: m.highway / total,
    mainShare: m.main / total,
    backroadShare: m.backroad / total,
    hoodShare: m.hood / total,
    otherShare: m.other / total,
  };
}

/** Total instruction density: maneuvers per 10 driving minutes (audit-v11's
 *  turnsPer10min — TOTAL maneuvers, the honest "how often am I doing
 *  something" number). Null when the route carries no duration. */
export function turnsPer10minOf(route: RouteThroughOutput): number | null {
  if (route.duration_s <= 0) return null;
  return route.maneuvers.length / (route.duration_s / 600);
}

/**
 * The audit's composite clean-drive verdict — frozen R25 definition. A route
 * is clean iff EVERY bar holds; each miss contributes one named defect, so
 * `defects.length` reproduces the audit's defects-per-route.
 */
export interface CleanDriveInput {
  mix: ClassMix | null;
  hoodRunM: number | null;
  turnsPer10min: number | null;
  loopiness: number | null; // null for A→B (not judged)
  durErrAbs: number | null; // |signed err| as a fraction, null = no target
  uturns: number;
  spursWide: number;
  microloops: number;
  retraceRunM: number;
  traced: boolean;
}

export interface CleanDriveVerdict {
  clean: boolean;
  defects: string[];
}

export function cleanDriveVerdict(i: CleanDriveInput): CleanDriveVerdict {
  const defects: string[] = [];
  if (!i.traced || i.mix === null) {
    defects.push('unmeasured');
  } else {
    if (i.mix.highwayShare > 0.005) defects.push('highway');
    if (i.mix.mainShare >= i.mix.backroadShare) defects.push('main_majority');
    if (i.mix.hoodShare > 0.05 || (i.hoodRunM ?? 0) > 500) defects.push('hood');
  }
  if ((i.turnsPer10min ?? 0) > 5.0) defects.push('turns');
  if (i.loopiness !== null && i.loopiness < 0.15) defects.push('shape');
  if (i.durErrAbs !== null && i.durErrAbs > 0.25) defects.push('timing');
  if (i.uturns > 0 || i.spursWide > 0 || i.microloops > 0 || i.retraceRunM > 1200) {
    defects.push('offence');
  }
  return { clean: defects.length === 0, defects };
}
