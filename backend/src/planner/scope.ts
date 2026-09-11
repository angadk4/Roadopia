/**
 * Search-region module — builds Ω, the isochrone-bounded scope (M3-T03; §3.3).
 *
 * Loops:  Ω = isochrone(origin, τ_out) with τ_out = ALPHA_LOOP · T* — the outbound
 *         share of the time budget (α ≈ 0.55, calibrated at M4).
 * A→B:    Ω is CORRIDOR-SHAPED (BD-203): a buffer of the direct route, half-width
 *         max(8 km, 0.2 × direct distance), split into ≤ 60 km chunks so every
 *         stretch of a long corridor gets its own retrieval seats. The union of
 *         two endpoint isochrones at ALPHA_ATOB · T* each is the FALLBACK when
 *         the direct route is unavailable (it sized every corridor from a
 *         5 400 s duration the app never sends — the same region for a 6 km hop
 *         and a 163 km cross-region drive).
 *
 * Isochrone-bounding beats a guessed radius because reachability already scales
 * with the requested duration (§3.3). The isochrone caller is injected so the
 * geometry logic is unit-testable without a live engine.
 */

import type { GetIsochroneInput, GetIsochroneOutput, LatLng, LineString } from '@shared/types';

import { resample, type LonLat } from '../../../data/curvature/geometry';
import { getIsochrone } from '../valhalla/isochrone';

import { segIntersect } from './crossings';

/** Outbound share of the budget for loops (§3.3, α ≈ 0.55; M4 calibrates). */
export const ALPHA_LOOP = 0.45; // frozen M4-T12 (was 0.55): DEV sweep, validated on VAL
/** Per-endpoint share for the A→B corridor union (first form; M4 calibrates). */
export const ALPHA_ATOB = 0.55;
/** Floor so tiny budgets still produce a usable region (minutes granularity). */
export const MIN_TAU_S = 5 * 60;
/**
 * Ceiling: Valhalla rejects isochrone contours beyond 120 min (HTTP 400 — found
 * live when a 3 h brief's ladder-widened τ hit 129 min and killed the run).
 * Beyond ~2 h outbound the reachable set is effectively the whole region anyway.
 */
export const MAX_TAU_S = 115 * 60;

/**
 * BD-203 (H) — corridor Ω parameters (NEW product bars; owner to confirm).
 * Half-width = max(ATOB_CORRIDOR_MIN_HALF_WIDTH_M, ATOB_CORRIDOR_HALF_WIDTH_FRAC
 * × direct distance), widened by the ladder's τ multiplier at rung 1. Corridors
 * longer than ATOB_CORRIDOR_CHUNK_M split into equal chunks (one ring each) so
 * the per-ring top-N curviness ranking cannot starve the middle of a long
 * corridor (Guelph→Owen Sound's middle third came back empty under one ring).
 */
export const ATOB_CORRIDOR_MIN_HALF_WIDTH_M = Number(
  process.env['ATOB_CORRIDOR_MIN_HALF_WIDTH_M'] ?? 8_000,
);
export const ATOB_CORRIDOR_HALF_WIDTH_FRAC = Number(
  process.env['ATOB_CORRIDOR_HALF_WIDTH_FRAC'] ?? 0.2,
);
export const ATOB_CORRIDOR_CHUNK_M = Number(process.env['ATOB_CORRIDOR_CHUNK_M'] ?? 60_000);

export type IsochroneFn = (input: GetIsochroneInput) => Promise<GetIsochroneOutput>;

export interface ScopeRequest {
  origin: LatLng;
  shape: 'loop' | 'a_to_b';
  /** Total requested duration T* in seconds. */
  durationS: number;
  /** Required when shape = a_to_b. */
  destination?: LatLng;
  costing?: string;
  /** Outbound-budget fraction override (M4-T12 calibration); default ALPHA_LOOP/ALPHA_ATOB. */
  alpha?: number;
}

export interface Scope {
  /** One or more rings (loop: single isochrone; a_to_b: corridor chunks, or
   *  origin + destination isochrones in the fallback form). */
  rings: LatLng[][];
  /** The outbound budget(s) used, seconds (0 for a corridor scope). */
  tauOutS: number;
  shape: 'loop' | 'a_to_b';
  /** BD-203: set when the rings are a corridor buffer of the direct route. */
  corridorHalfWidthM?: number;
}

/** Convert a Scope ring to a GeoJSON Polygon (closed ring) for the PostGIS RPCs. */
export function ringToGeoJsonPolygon(ring: LatLng[]): {
  type: 'Polygon';
  coordinates: number[][][];
} {
  const coords = ring.map((p) => [p.lng, p.lat]);
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
  return { type: 'Polygon', coordinates: [coords] };
}

/**
 * Build Ω for a request. Throws if a_to_b lacks a destination (schema-level rule,
 * revalidated here because this module is callable directly).
 */
export async function buildScope(
  baseUrl: string,
  request: ScopeRequest,
  isochroneFn: IsochroneFn = (input) => getIsochrone(baseUrl, input),
): Promise<Scope> {
  const costing = request.costing ?? 'auto';

  if (request.shape === 'loop') {
    const tau = Math.min(
      MAX_TAU_S,
      Math.max(MIN_TAU_S, Math.round(request.durationS * (request.alpha ?? ALPHA_LOOP))),
    );
    const iso = await isochroneFn({ origin: request.origin, time_s: tau, costing });
    return { rings: [iso.polygon], tauOutS: tau, shape: 'loop' };
  }

  if (!request.destination) {
    throw new Error('a_to_b scope requires a destination');
  }
  const tau = Math.min(MAX_TAU_S, Math.max(MIN_TAU_S, Math.round(request.durationS * ALPHA_ATOB)));
  const [fromOrigin, fromDest] = await Promise.all([
    isochroneFn({ origin: request.origin, time_s: tau, costing }),
    isochroneFn({ origin: request.destination, time_s: tau, costing }),
  ]);
  return { rings: [fromOrigin.polygon, fromDest.polygon], tauOutS: tau, shape: 'a_to_b' };
}

// --- BD-203 (H): corridor Ω from the direct route ---------------------------

type XY = readonly [number, number];

/** Corridor half-width for a direct distance, widened by the ladder's τ multiplier. */
export function atobCorridorHalfWidthM(directDistanceM: number, widen = 1): number {
  return (
    Math.max(ATOB_CORRIDOR_MIN_HALF_WIDTH_M, ATOB_CORRIDOR_HALF_WIDTH_FRAC * directDistanceM) *
    widen
  );
}

/** Andrew's monotone chain — a counter-clockwise hull without the closing duplicate. */
function convexHull(points: readonly XY[]): XY[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: XY, a: XY, b: XY): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** True when any two non-adjacent edges of the closed ring cross (invalid polygon). */
function ringSelfIntersects(ring: readonly XY[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i]!;
    const a2 = ring[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // closing edge is adjacent to the first
      const b1 = ring[j]!;
      const b2 = ring[(j + 1) % n]!;
      if (segIntersect([a1[0], a1[1]], [a2[0], a2[1]], [b1[0], b1[1]], [b2[0], b2[1]]) !== null) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Offset polygon of an open polyline at half-width `h` (local metres): left
 * offsets forward, a square cap at each end, right offsets back. Vertex normals
 * are the averaged adjacent segment normals; a ring that folds on itself at a
 * sharp turn falls back to the convex hull of the same points (always a valid
 * ring that still contains the line — larger, never smaller).
 */
function bufferRingXY(pts: readonly XY[], h: number): XY[] {
  const p: XY[] = [];
  for (const q of pts) {
    const last = p[p.length - 1];
    if (last === undefined || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1) p.push(q);
  }
  if (p.length === 0) return [];
  if (p.length === 1) {
    const [x, y] = p[0]!;
    return [
      [x - h, y - h],
      [x + h, y - h],
      [x + h, y + h],
      [x - h, y + h],
    ];
  }
  const n = p.length;
  const dirs: XY[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i + 1]![0] - p[i]![0];
    const dy = p[i + 1]![1] - p[i]![1];
    const len = Math.hypot(dx, dy);
    dirs.push([dx / len, dy / len]);
  }
  const left: XY[] = [];
  const right: XY[] = [];
  for (let i = 0; i < n; i++) {
    let nx: number;
    let ny: number;
    if (i === 0 || i === n - 1) {
      const d = dirs[i === 0 ? 0 : n - 2]!;
      nx = -d[1];
      ny = d[0];
    } else {
      const a = dirs[i - 1]!;
      const b = dirs[i]!;
      let sx = -a[1] - b[1];
      let sy = a[0] + b[0];
      const len = Math.hypot(sx, sy);
      if (len < 1e-9) {
        sx = -b[1];
        sy = b[0];
      } else {
        sx /= len;
        sy /= len;
      }
      nx = sx;
      ny = sy;
    }
    left.push([p[i]![0] + h * nx, p[i]![1] + h * ny]);
    right.push([p[i]![0] - h * nx, p[i]![1] - h * ny]);
  }
  const d0 = dirs[0]!;
  const dN = dirs[n - 2]!;
  const capStart: XY = [p[0]![0] - h * d0[0], p[0]![1] - h * d0[1]];
  const capEnd: XY = [p[n - 1]![0] + h * dN[0], p[n - 1]![1] + h * dN[1]];
  const ring: XY[] = [capStart, ...left, capEnd, ...right.reverse()];
  return ringSelfIntersects(ring) ? convexHull(ring) : ring;
}

/**
 * Corridor rings for a direct-route line: one buffer polygon per ≤ `chunkM`
 * stretch (chunks share their boundary vertex, and each cap extends `halfWidthM`
 * past it, so consecutive rings overlap — no gap along the corridor). Every
 * ring is a valid, non-self-intersecting GeoJSON-ready ring containing its
 * stretch of the line. Pure: engine-free, unit-tested with synthetic lines.
 */
export function corridorRings(
  line: LineString,
  halfWidthM: number,
  chunkM: number = ATOB_CORRIDOR_CHUNK_M,
): LatLng[][] {
  const raw = line.coordinates.map(([lng, lat]) => [lng, lat] as LonLat);
  if (raw.length === 0) return [];
  const h = Math.max(1, halfWidthM);
  // coarse resample: spacing of at least h/2 keeps the offset polygon simple
  // (fine spacing at a sharp turn folds the inner offset back on itself; the
  // hull fallback covers what remains)
  const pts = resample(raw, Math.max(2_000, h / 2));
  const refLat = pts.reduce((s, q) => s + q[1], 0) / pts.length;
  const lng0 = pts[0]![0];
  const lat0 = pts[0]![1];
  const kx = 111_320 * Math.cos((refLat * Math.PI) / 180);
  const ky = 111_320;
  const toXY = (q: LonLat): XY => [(q[0] - lng0) * kx, (q[1] - lat0) * ky];
  const toLL = (q: XY): LatLng => ({ lng: lng0 + q[0] / kx, lat: lat0 + q[1] / ky });
  const xy = pts.map(toXY);

  const cum: number[] = [0];
  for (let i = 1; i < xy.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(xy[i]![0] - xy[i - 1]![0], xy[i]![1] - xy[i - 1]![1]));
  }
  const total = cum[cum.length - 1]!;
  const k = Math.max(1, Math.ceil(total / Math.max(1, chunkM)));

  const rings: LatLng[][] = [];
  let start = 0;
  for (let c = 1; c <= k; c++) {
    const cutM = (total * c) / k;
    let end = start;
    while (end < xy.length - 1 && cum[end]! < cutM - 1e-6) end++;
    if (c === k) end = xy.length - 1;
    if (end === start && start < xy.length - 1) end = start + 1;
    rings.push(bufferRingXY(xy.slice(start, end + 1), h).map(toLL));
    start = end;
  }
  return rings;
}

/** The corridor Scope for an A→B request whose direct route is known. */
export function corridorScope(
  line: LineString,
  halfWidthM: number,
  chunkM: number = ATOB_CORRIDOR_CHUNK_M,
): Scope {
  return {
    rings: corridorRings(line, halfWidthM, chunkM),
    tauOutS: 0,
    shape: 'a_to_b',
    corridorHalfWidthM: halfWidthM,
  };
}
