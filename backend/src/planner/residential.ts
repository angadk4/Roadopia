/**
 * Residential exposure of a route (owner round 7: "driving inside a small
 * neighbourhood with just houses shouldn't be there at all").
 *
 * Pure math over the trace_attributes edge list: the share of route length on
 * `residential`-class edges, EXEMPTING the origin grace zone — a user whose
 * start point sits on a residential street must legally drive their own
 * street out and back, exactly the convention the spur/overlap checks use
 * (ORIGIN_GRACE_RADIUS_M). Edge positions are recovered by walking the route
 * geometry proportionally to cumulative matched length (trace edges follow
 * the shape in order).
 */

import type { LatLng, LineString } from '@shared/types';

import type { TraceEdge } from '../valhalla/trace';

import { countryClassFactor } from './candidates';
import { ORIGIN_GRACE_RADIUS_M } from './overlap';
import { isHoodEdge } from './roadclass';

const R = 6_371_000;
function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la = (a[1] * Math.PI) / 180;
  const lb = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Point at cumulative distance d along the line (clamped). */
export function pointAt(
  coords: Array<[number, number]>,
  cum: number[],
  d: number,
): [number, number] {
  if (d <= 0) return coords[0]!;
  const total = cum[cum.length - 1]!;
  if (d >= total) return coords[coords.length - 1]!;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi]! - cum[lo]!;
  const t = segLen > 0 ? (d - cum[lo]!) / segLen : 0;
  const a = coords[lo]!;
  const b = coords[hi]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** R18-3: A→B measurement needs grace at BOTH endpoints — accept one point
 *  (the loop call sites, unchanged) or a set of grace points. */
export type GracePoints = LatLng | readonly LatLng[];

const graceLngLats = (g: GracePoints): Array<[number, number]> =>
  (Array.isArray(g) ? (g as readonly LatLng[]) : [g as LatLng]).map((p) => [p.lng, p.lat]);

/**
 * Share of matched route length on residential edges, outside the grace
 * radius of every grace point. Returns 0 when everything sits inside grace.
 */
export function residentialShareOf(
  edges: TraceEdge[],
  geometry: LineString,
  origin: GracePoints,
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): number {
  const coords = geometry.coordinates as Array<[number, number]>;
  if (coords.length < 2 || edges.length === 0) return 0;
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1]! + haversineM(coords[i - 1]!, coords[i]!));
  }
  const geomLen = cum[cum.length - 1]!;
  const traceLen = edges.reduce((s, e) => s + e.lengthM, 0);
  if (geomLen === 0 || traceLen === 0) return 0;
  // trace edges follow the shape in order; scale trace positions onto the
  // geometry so midpoints can be located even when lengths drift slightly
  const scale = geomLen / traceLen;
  const grace = graceLngLats(origin);

  let outsideTotal = 0;
  let outsideResidential = 0;
  let pos = 0;
  for (const e of edges) {
    const mid = pointAt(coords, cum, (pos + e.lengthM / 2) * scale);
    pos += e.lengthM;
    if (grace.some((g) => haversineM(mid, g) <= graceRadiusM)) continue;
    outsideTotal += e.lengthM;
    if (residentialMatch(e)) outsideResidential += e.lengthM; // R25-U5a predicate
  }
  return outsideTotal > 0 ? outsideResidential / outsideTotal : 0;
}

/** Non-residential gap (m) that does NOT end a residential run — a short
 *  connector inside a subdivision never "leaves the neighbourhood". */
export const RESIDENTIAL_RUN_BRIDGE_M = 250;

/**
 * R25-U5a/b — the neighbourhood gate's two measurement blind spots, fixed
 * behind ONE flag (they must be JUDGED together: separately each looks like a
 * pure regression, because measured hood exposure goes UP when you stop being
 * blind):
 *   (a) class set: the legacy gate matched only roadClass === 'residential' —
 *       service/service_other/living_street metres were invisible AND
 *       inflated the clean denominator;
 *   (b) grace: 2,500 m exempts an entire small town — audit-v11 measured 36 %
 *       of neighbourhood metres STARTING inside the grace ring. ~700 m is
 *       "your own street and the way out of it", the stated intent.
 * OFF = byte-identical legacy. The ARTERIAL run walker keeps the 2,500 m
 * grace either way (loop.ts passes the default — do not move it).
 */
export const HOOD_MEASURE_V2_ON = process.env['HOOD_MEASURE_V2'] !== 'off'; // R25-U5 ADOPTED (BD-86)
export const RESIDENTIAL_GRACE_RADIUS_M = HOOD_MEASURE_V2_ON
  ? Number(process.env['RESIDENTIAL_GRACE_M'] ?? 700)
  : ORIGIN_GRACE_RADIUS_M;
/** The gate's edge predicate — wide (isHoodEdge) under V2, legacy otherwise. */
export const residentialMatch = (e: TraceEdge): boolean =>
  HOOD_MEASURE_V2_ON ? isHoodEdge(e) : e.roadClass === 'residential';

/**
 * Longest CONTIGUOUS residential run in metres, outside the origin grace
 * (owner round 8b, Bolton: 1.3 km of subdivision weaving hid at 4 % share on
 * a 101 km route — the SHARE scales with route length, the offence does not;
 * exactly the round-6 ratio-vs-run lesson, applied to road class). Runs
 * bridge non-residential gaps ≤ RESIDENTIAL_RUN_BRIDGE_M.
 */
export interface ResidentialRunInfo {
  runM: number;
  /** Midpoint [lng, lat] of the longest run — the repair pass (round 9)
   *  drops the waypoint nearest it. Null when no run exists. */
  mid: [number, number] | null;
}

/**
 * Generalized longest-contiguous-run walker over an arbitrary CLASS SET —
 * residential runs (round 8b) and arterial runs (round 11b: the boring-
 * connector detector) share the identical mechanics: origin grace, and
 * off-set gaps ≤ RESIDENTIAL_RUN_BRIDGE_M bridge the run.
 */
/** One contiguous class run (R25-U0): its bridged length and its end position
 *  along the trace (metres, trace scale). */
export interface ClassRun {
  runM: number;
  endPos: number;
}

/**
 * ALL contiguous runs of `classes` along the route (R25-U0 generalization of
 * the longest-run walker; identical grace/bridge semantics — a graced edge
 * resets the run, off-class gaps ≤ RESIDENTIAL_RUN_BRIDGE_M bridge it).
 * `maxClassRunInfo` delegates here, so the two can never drift.
 */
export function classRunsOf(
  edges: TraceEdge[],
  geometry: LineString,
  classes: ReadonlySet<string> | ((e: TraceEdge) => boolean),
  origin: GracePoints,
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): { runs: ClassRun[]; coords: Array<[number, number]>; cum: number[]; scale: number } | null {
  const coords = geometry.coordinates as Array<[number, number]>;
  if (coords.length < 2 || edges.length === 0) return null;
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1]! + haversineM(coords[i - 1]!, coords[i]!));
  }
  const geomLen = cum[cum.length - 1]!;
  const traceLen = edges.reduce((s, e) => s + e.lengthM, 0);
  if (geomLen === 0 || traceLen === 0) return null;
  const scale = geomLen / traceLen;
  const grace = graceLngLats(origin);
  const match =
    typeof classes === 'function' ? classes : (e: TraceEdge): boolean => classes.has(e.roadClass);

  const runs: ClassRun[] = [];
  let run = 0;
  let runEndPos = 0;
  let gap = 0;
  let pos = 0;
  const flush = (): void => {
    if (run > 0) runs.push({ runM: run, endPos: runEndPos });
    run = 0;
    gap = 0;
  };
  for (const e of edges) {
    const startPos = pos;
    const mid = pointAt(coords, cum, (startPos + e.lengthM / 2) * scale);
    pos += e.lengthM;
    const graced = grace.some((g) => haversineM(mid, g) <= graceRadiusM);
    if (!graced && match(e)) {
      run += gap + e.lengthM; // bridge the swallowed gap
      gap = 0;
      runEndPos = pos;
    } else if (run > 0 && !graced && gap + e.lengthM <= RESIDENTIAL_RUN_BRIDGE_M) {
      gap += e.lengthM; // short connector — run may continue
    } else {
      flush();
    }
  }
  flush();
  return { runs, coords, cum, scale };
}

/** Longest/mean/count over the runs of a class set (R25-U0 continuity stats). */
export function classRunStatsOf(
  edges: TraceEdge[],
  geometry: LineString,
  classes: ReadonlySet<string> | ((e: TraceEdge) => boolean),
  origin: GracePoints,
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): { longestM: number; meanM: number; count: number } {
  const walked = classRunsOf(edges, geometry, classes, origin, graceRadiusM);
  if (!walked || walked.runs.length === 0) return { longestM: 0, meanM: 0, count: 0 };
  const lens = walked.runs.map((r) => r.runM);
  return {
    longestM: Math.max(...lens),
    meanM: lens.reduce((a, b) => a + b, 0) / lens.length,
    count: lens.length,
  };
}

export function maxClassRunInfo(
  edges: TraceEdge[],
  geometry: LineString,
  classes: ReadonlySet<string> | ((e: TraceEdge) => boolean),
  origin: GracePoints,
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): ResidentialRunInfo {
  const walked = classRunsOf(edges, geometry, classes, origin, graceRadiusM);
  if (!walked || walked.runs.length === 0) return { runM: 0, mid: null };
  let best = walked.runs[0]!;
  for (const r of walked.runs) if (r.runM > best.runM) best = r;
  return {
    runM: best.runM,
    mid: pointAt(walked.coords, walked.cum, (best.endPos - best.runM / 2) * walked.scale),
  };
}

const RESIDENTIAL_ONLY: ReadonlySet<string> = new Set(['residential']);

export function maxResidentialRunInfo(
  edges: TraceEdge[],
  geometry: LineString,
  origin: GracePoints,
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): ResidentialRunInfo {
  // R25-U5a: the wide predicate under V2; legacy set otherwise (identical off)
  return maxClassRunInfo(
    edges,
    geometry,
    HOOD_MEASURE_V2_ON ? residentialMatch : RESIDENTIAL_ONLY,
    origin,
    graceRadiusM,
  );
}

/** Longest contiguous residential run in metres (see maxResidentialRunInfo). */
export function maxResidentialRunM(
  edges: TraceEdge[],
  geometry: LineString,
  origin: GracePoints,
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): number {
  return maxResidentialRunInfo(edges, geometry, origin, graceRadiusM).runM;
}

/**
 * Route countryness (owner round 11): length-weighted BD-26 class factor over
 * the traced edges — 1.0 on pure backroads (unclassified/tertiary), sinking
 * toward 0 on arterial-heavy routes. Uses the SAME factor the ranking key was
 * validated with (countryClassFactor); trace classes outside its vocabulary
 * (motorway/trunk/service_other) count as arterial-grade 0.15. Normalized
 * [0.15, 1] → [0, 1]. NO grace exemption: leaving town on an arterial is real
 * drive time too — this is a preference signal, not a violation gate.
 */
export function countryScoreOf(edges: TraceEdge[]): number | null {
  let total = 0;
  let weighted = 0;
  for (const e of edges) {
    // trace-only classes outside countryClassFactor's OSM vocabulary (its
    // default is mid-grade 0.5, meant for unknown *minor* tags) — motorway/
    // trunk/service are arterial-or-worse here
    const cls =
      e.roadClass === 'motorway' ||
      e.roadClass === 'trunk' ||
      e.roadClass === 'service_other' ||
      e.roadClass.endsWith('_link') // vocabulary-drift armor (FB-5): ramps = arterial
        ? 'primary'
        : e.roadClass;
    total += e.lengthM;
    weighted += countryClassFactor(cls) * e.lengthM;
  }
  if (total === 0) return null;
  const meanFactor = weighted / total;
  return Math.max(0, Math.min(1, (meanFactor - 0.15) / 0.85));
}

/** Trace road classes counted as "boring main road" for the honesty metric
 *  (R18-0). Motorway/trunk/primary/secondary + ramps/turn channels — the
 *  classes the R18 audit measured dominating routes (58–88 % of bests). */
const ARTERIAL_ROAD_CLASSES: ReadonlySet<string> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
]);

/**
 * Arterial share (R18-0 honesty metric): length-weighted fraction of the route
 * on arterial-grade pavement. NO grace exemption (same rationale as
 * countryScoreOf: leaving town on an arterial is real drive time). Null when
 * the trace is empty/unavailable — unknown is never reported as 0 % arterial.
 */
export function arterialShareOf(edges: TraceEdge[]): number | null {
  let total = 0;
  let arterial = 0;
  for (const e of edges) {
    total += e.lengthM;
    const isArterial =
      ARTERIAL_ROAD_CLASSES.has(e.roadClass) ||
      e.roadClass.endsWith('_link') ||
      e.use === 'ramp' ||
      e.use === 'turn_channel';
    if (isArterial) arterial += e.lengthM;
  }
  if (total === 0) return null;
  return arterial / total;
}
