/**
 * BD-203 — LOOPS BY CONSTRUCTION: corridor-excluded, glued legs.
 *
 * Every retrace, same-way-home, lollipop and crossing the owner has
 * photographed came from ONE /route request that was free to come home the
 * way it went out. The engine has always had the mechanism for "not those
 * edges" (`exclude_polygons`, `allow_hard_exclusions: true` in our config) and
 * it was never sent (grep 0 uses before this file). Probed live on the pinned
 * 3.7.0 (2026-09-07, eval/experiments/sweep_diag*.ts):
 *
 *   - honoured: a second A→B route excluding thin corridors around the first
 *     shared ≤ 5 % of its edges with it (the rest sits in the end holes);
 *   - cheap: 20-60 ms per call with ~30-60 rectangles, ~1.5 s worst case when
 *     an exclusion fences the target off (so legs carry a short timeout);
 *   - roads that merely CROSS a ring are excluded too — a later leg cannot
 *     cross an earlier one, which is the zero-crossing law by construction;
 *   - the start location must not sit on an excluded edge: the corridor of
 *     the previous leg keeps a HOLE around its end (the edge the next leg
 *     departs on can be 1-2 km in the country), and leg 1 keeps a hole around
 *     the origin the size of the measured unavoidable stem — a driveway or a
 *     subdivision exit is the one place a loop may repeat by necessity.
 *
 * A leg glued onto the end of a previous leg departs with a `heading` hint so
 * it continues forward instead of reversing through the hole. Geometry is
 * continuous at the joint (same snapped point); maneuvers are concatenated
 * and folded by the shared `cleanLegManeuvers`.
 *
 * This module is the mechanism only. The ring path (drive_first_trip.ts) uses
 * it to rebuild a trip that failed on doubling/crossing; the sweep
 * (loop_sweep.ts) uses it for every leg. Both meet the same judge afterwards —
 * construction removes the reasons for rejection, it does not replace the
 * judge (the judge is the firewall).
 */
import { cleanLegManeuvers, type RouteThroughOutput } from '@shared/types';

import { routeThrough, type RouteThroughRequest } from '../valhalla/route';

/** [lng, lat] */
export type XY = [number, number];
/** A closed ring of [lng, lat] (first == last). */
export type Ring = XY[];

const LAT_M = 111_320;

export function haversineM(a: XY, b: XY): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function lineLengthM(coords: ReadonlyArray<XY>): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += haversineM(coords[i - 1]!, coords[i]!);
  return s;
}

/** Compass bearing a → b in degrees clockwise from north (0..360). */
export function bearingDeg(a: XY, b: XY): number {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Smallest absolute difference between two bearings (0..180). */
export function bearingDiffDeg(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** Departure bearing of a polyline: over its first ~`spanM` metres. */
export function departureBearing(coords: ReadonlyArray<XY>, spanM = 200): number {
  const first = coords[0]!;
  let i = 1;
  let acc = 0;
  while (i < coords.length - 1 && acc < spanM) {
    acc += haversineM(coords[i - 1]!, coords[i]!);
    i++;
  }
  return bearingDeg(first, coords[Math.min(i, coords.length - 1)]!);
}

/** Arrival bearing of a polyline: over its last ~`spanM` metres. */
export function arrivalBearing(coords: ReadonlyArray<XY>, spanM = 200): number {
  const last = coords[coords.length - 1]!;
  let i = coords.length - 2;
  let acc = 0;
  while (i > 0 && acc < spanM) {
    acc += haversineM(coords[i]!, coords[i + 1]!);
    i--;
  }
  return bearingDeg(coords[Math.max(0, i)]!, last);
}

/** Douglas–Peucker on lon/lat with a metric tolerance (deterministic). */
export function simplifyLine(coords: ReadonlyArray<XY>, tolM: number): XY[] {
  if (coords.length < 3) return coords.slice();
  const lat0 = coords[0]![1];
  const kx = LAT_M * Math.cos((lat0 * Math.PI) / 180);
  const pts = coords.map((c) => [c[0] * kx, c[1] * LAT_M] as [number, number]);
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    const a = pts[s]!;
    const b = pts[e]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    let worst = -1;
    let worstD = tolM;
    for (let i = s + 1; i < e; i++) {
      const p = pts[i]!;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([s, worst], [worst, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

export interface CorridorOpts {
  /** Half-width of the excluded band (m). 50 m covers the road and any edge
   *  that touches it at a junction; parallel country roads sit far outside. */
  halfWidthM?: number;
  /** Metres of the line to leave OPEN at its start (the origin stem). */
  skipStartM?: number;
  /** Metres of the line to leave OPEN at its end (the next leg departs here). */
  skipEndM?: number;
  /** Simplification tolerance before boxing (m). */
  simplifyTolM?: number;
}

/**
 * Thin rectangles around each simplified segment of `coords`, leaving holes
 * at the ends. Rectangles are extended by the half-width along the segment
 * so consecutive boxes overlap at bends (no gap a road could slip through).
 */
export function corridorRings(coords: ReadonlyArray<XY>, opts: CorridorOpts = {}): Ring[] {
  const wM = opts.halfWidthM ?? 50;
  const skipStartM = opts.skipStartM ?? 0;
  const skipEndM = opts.skipEndM ?? 0;
  const tolM = opts.simplifyTolM ?? 20;
  if (coords.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1]! + haversineM(coords[i - 1]!, coords[i]!));
  }
  const total = cum[cum.length - 1]!;
  const kept = coords.filter((_, i) => cum[i]! >= skipStartM && cum[i]! <= total - skipEndM);
  if (kept.length < 2) return [];
  const simp = simplifyLine(kept, tolM);
  const rings: Ring[] = [];
  for (let i = 1; i < simp.length; i++) {
    const a = simp[i - 1]!;
    const b = simp[i]!;
    const kx = LAT_M * Math.cos((a[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * LAT_M;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * wM;
    const ny = (dx / len) * wM;
    const ex = (dx / len) * wM;
    const ey = (dy / len) * wM;
    const P = (x: number, y: number): XY => [x / kx, y / LAT_M];
    const ax = a[0] * kx;
    const ay = a[1] * LAT_M;
    const bx = b[0] * kx;
    const by = b[1] * LAT_M;
    rings.push([
      P(ax - ex + nx, ay - ey + ny),
      P(bx + ex + nx, by + ey + ny),
      P(bx + ex - nx, by + ey - ny),
      P(ax - ex - nx, ay - ey - ny),
      P(ax - ex + nx, ay - ey + ny),
    ]);
  }
  return rings;
}

/** The line without its first `m` metres (empty when shorter than that). */
export function trimLineStart(coords: ReadonlyArray<XY>, m: number): XY[] {
  if (m <= 0) return coords.slice();
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversineM(coords[i - 1]!, coords[i]!);
    if (acc >= m) return coords.slice(i);
  }
  return [];
}

/** The line without its last `m` metres (empty when shorter than that). */
export function trimLineEnd(coords: ReadonlyArray<XY>, m: number): XY[] {
  if (m <= 0) return coords.slice();
  let acc = 0;
  for (let i = coords.length - 2; i >= 0; i--) {
    acc += haversineM(coords[i]!, coords[i + 1]!);
    if (acc >= m) return coords.slice(0, i + 1);
  }
  return [];
}

/** Total perimeter of a ring set (the engine caps this — service_limits). */
export function ringsPerimeterM(rings: ReadonlyArray<Ring>): number {
  let s = 0;
  for (const r of rings) s += lineLengthM(r);
  return s;
}

/** Evenly spaced through-points along a line (first and last always kept). */
export function sampleAlong(coords: ReadonlyArray<XY>, spacingM: number): XY[] {
  if (coords.length === 0) return [];
  const out: XY[] = [coords[0]!];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversineM(coords[i - 1]!, coords[i]!);
    if (acc >= spacingM) {
      out.push(coords[i]!);
      acc = 0;
    }
  }
  const last = coords[coords.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Evenly spaced through-points along a line WITH the line's local bearing
 *  at each (the direction of travel there), first and last always kept. */
export function sampleAlongWithBearing(
  coords: ReadonlyArray<XY>,
  spacingM: number,
): Array<{ pt: XY; bearingDeg: number }> {
  if (coords.length === 0) return [];
  const bearingAtIdx = (i: number): number => {
    const a = coords[Math.max(0, i - 1)]!;
    const b = coords[Math.min(coords.length - 1, i + 1)]!;
    return a === b ? 0 : bearingDeg(a, b);
  };
  const out: Array<{ pt: XY; bearingDeg: number }> = [
    { pt: coords[0]!, bearingDeg: bearingAtIdx(0) },
  ];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversineM(coords[i - 1]!, coords[i]!);
    if (acc >= spacingM) {
      out.push({ pt: coords[i]!, bearingDeg: bearingAtIdx(i) });
      acc = 0;
    }
  }
  const lastI = coords.length - 1;
  if (out[out.length - 1]!.pt !== coords[lastI]) {
    out.push({ pt: coords[lastI]!, bearingDeg: bearingAtIdx(lastI) });
  }
  return out;
}

/**
 * Glue routed legs end-to-end into one RouteThroughOutput: continuous
 * geometry (the joint point is not repeated), summed distance/duration, one
 * entry per leg in `legs`, maneuvers concatenated and folded (no arrival card
 * at a joint, a same-road departure folded into the previous instruction),
 * has_* flags OR'd. Pure.
 */
export function glueLegs(legs: ReadonlyArray<RouteThroughOutput>): RouteThroughOutput {
  if (legs.length === 0) throw new Error('glueLegs: no legs');
  const coords: XY[] = [];
  for (const leg of legs) {
    const c = leg.geometry.coordinates as XY[];
    for (const p of c) {
      const prev = coords[coords.length - 1];
      if (prev === undefined || prev[0] !== p[0] || prev[1] !== p[1]) coords.push([p[0], p[1]]);
    }
  }
  const warnings = legs.flatMap((l) => l.warnings ?? []);
  return {
    geometry: { type: 'LineString', coordinates: coords },
    distance_m: legs.reduce((s, l) => s + l.distance_m, 0),
    duration_s: legs.reduce((s, l) => s + l.duration_s, 0),
    legs: legs.map((l) => ({ duration_s: l.duration_s, distance_m: l.distance_m })),
    maneuvers: cleanLegManeuvers(legs.flatMap((l) => l.maneuvers.map((m) => ({ ...m })))),
    has_highway: legs.some((l) => l.has_highway),
    has_toll: legs.some((l) => l.has_toll),
    has_ferry: legs.some((l) => l.has_ferry),
    has_unpaved: legs.some((l) => l.has_unpaved),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export type CorridorRouteFn = (
  baseUrl: string,
  request: RouteThroughRequest,
  opts?: { timeoutMs?: number },
) => Promise<RouteThroughOutput>;

export interface BuiltLeg {
  route: RouteThroughOutput;
  coords: XY[];
  /** Holes the engine needed (start hole / stem hole, metres) — the trace
   *  tells the truth about where a repeat was forced by the network. */
  holes: { startHoleM: number; stemHoleM: number };
  /** Metres at this leg's END that stay open for EVERY later leg (a
   *  connector that was allowed to ride the first part of the piece it
   *  reached must not fence that piece's drive). */
  openTailM?: number;
}

/** Per-leg timeout: a fenced-off target makes the engine explore the whole
 *  graph before giving up (measured 2-7 s); a feasible leg answers in <0.3 s. */
export const CORRIDOR_LEG_TIMEOUT_MS = Number(process.env['CORRIDOR_LEG_TIMEOUT_MS'] ?? 2000);

/** A timed-out call means the engine searched the whole graph — the target
 *  is fenced off, and a wider hole will not change that cheaply. */
export function isEngineTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/** Hole ladder: the start hole must cover the whole edge the next leg departs
 *  on (unknown length; country edges run 1-2 km); the stem hole grows only
 *  when the network leaves no other way home. Each rung is one engine call. */
export const CORRIDOR_HOLE_LADDER: ReadonlyArray<readonly [number, number]> = [
  [800, 400],
  [1600, 400],
  [1600, 1200],
  [3000, 2500],
];

/**
 * Sequential leg builder. `previous` legs contribute their corridors; the
 * first leg's corridor leaves `stemM + stemHole` open at the origin and the
 * last leg's corridor leaves `startHole` open at its end (where this leg
 * departs). Extra rings (e.g. "do not ride the ribbon you are heading for")
 * are added verbatim. Throws the last engine error when every rung fails.
 */
export async function routeCorridorLeg(
  routeFn: CorridorRouteFn,
  baseUrl: string,
  req: {
    waypoints: XY[];
    costingOptions: NonNullable<RouteThroughRequest['costingOptions']>;
    middleType?: RouteThroughRequest['middleType'];
    heading: number | null;
    /** Per-waypoint headings (index-aligned; null = none) — the local
     *  bearing of the driven line at each through-sample. */
    waypointHeadings?: ReadonlyArray<number | null>;
    previous: ReadonlyArray<BuiltLeg>;
    stemM: number;
    extraRings?: Ring[];
    halfWidthM?: number;
    timeoutMs?: number;
    ladder?: ReadonlyArray<readonly [number, number]>;
    /** Epoch ms; no new rung starts past it (the wall clock is the law). */
    deadlineMs?: number;
  },
): Promise<BuiltLeg> {
  const ladder = req.ladder ?? CORRIDOR_HOLE_LADDER;
  let lastErr: unknown = null;
  for (const [startHoleM, stemExtraM] of ladder) {
    if (req.deadlineMs !== undefined && Date.now() > req.deadlineMs) {
      lastErr = lastErr ?? new Error('corridor leg: out of time');
      break;
    }
    const stemHoleM = req.stemM + stemExtraM;
    const rings: Ring[] = [];
    req.previous.forEach((leg, i) => {
      const isFirst = i === 0;
      const isLast = i === req.previous.length - 1;
      rings.push(
        ...corridorRings(leg.coords, {
          ...(req.halfWidthM !== undefined ? { halfWidthM: req.halfWidthM } : {}),
          skipStartM: isFirst ? stemHoleM : 0,
          skipEndM: Math.max(isLast ? startHoleM : 0, leg.openTailM ?? 0),
        }),
      );
    });
    if (req.extraRings) rings.push(...req.extraRings);
    try {
      const route = await routeFn(
        baseUrl,
        {
          waypoints: req.waypoints,
          costingOptions: req.costingOptions,
          middleType: req.middleType ?? 'through',
          ...(rings.length > 0 ? { excludePolygons: rings } : {}),
          ...(req.heading !== null ? { startHeading: { deg: req.heading } } : {}),
          ...(req.waypointHeadings ? { waypointHeadings: req.waypointHeadings } : {}),
        },
        { timeoutMs: req.timeoutMs ?? CORRIDOR_LEG_TIMEOUT_MS },
      );
      const coords = (route.geometry.coordinates as XY[]).map((p) => [p[0], p[1]] as XY);
      if (coords.length < 2) throw new Error('corridor leg: degenerate geometry');
      return { route, coords, holes: { startHoleM, stemHoleM } };
    } catch (e) {
      lastErr = e;
      if (isEngineTimeout(e)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('corridor leg: unroutable');
}

/** The default engine call (typed client). */
export const defaultCorridorRouteFn: CorridorRouteFn = (baseUrl, request, opts) =>
  routeThrough(baseUrl, request, opts);
