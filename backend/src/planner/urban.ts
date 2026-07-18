/**
 * Route-level urban context (R19; owner directive 2026-07-18): "main roads
 * are fine when surrounded by fields or forest — neighbourhoods are not."
 * Road CLASS was the wrong axis (an arterial through farmland is a good
 * drive; a curvy tertiary collector inside a subdivision is not a backroad);
 * this module measures what a route is actually SURROUNDED by.
 *
 * Mechanism: built-up landuse polygons (migration 0011, OSM residential/
 * industrial/commercial/retail — loaded offline) → an in-memory point-in-
 * polygon index per bbox (one SECURITY DEFINER read, cached; ~40 k simplified
 * polygons region-wide) → route measures by resampling the geometry every
 * RESAMPLE_M and testing each point:
 *
 *   urbanShareOf   — fraction of route length inside built-up areas. The
 *                    presentation bar input (replaces the R18-4 arterial bars
 *                    — BD-60 records the supersession).
 *   urbanRunInfo   — longest CONTIGUOUS urban stretch outside the origin
 *                    grace (the ratio-vs-run lesson, urban edition).
 *   urbanIntroM    — metres of town/main-street driving before the drive
 *                    first "opens up" (a sustained low-urban window) — feeds
 *                    the honest "about N min through town before the good
 *                    stuff" disclosure for arterial-locked origins.
 *
 * Same buffer-0 semantics as curvy_segments.urban_share: OSM subdivision
 * polygons stop at boundary arterials, so an edge main road measures ~0 —
 * exactly the owner's "edge main road is fine".
 *
 * Deterministic; fail-open (no polygons loaded → measures return null and
 * nothing downstream penalizes).
 */

import type { LatLng, LineString } from '@shared/types';
import type { Client } from 'pg';

import { plannerBuiltAreas } from '../db/planner_reads';

/** R19 master kill switch: gates CONSUMPTION everywhere (retrieval corpus
 *  filter, presentation tier, disclosure). Measurement helpers stay callable.
 *  Off restores R18-4 behavior byte-identically. Lives here (not run.ts) so
 *  retrieve.ts can honor it without an import cycle. */
export const URBAN_CONTEXT_ON = true;

export const URBAN_RESAMPLE_M = 60;
/**
 * "Surrounded by" probe distance (m): a route point counts as urban when it
 * is INSIDE a built polygon (subdivision street) OR when BOTH perpendicular
 * flanks at this offset are (arterial threading through town — polygons stop
 * at the road edge, so the point itself never tests inside). One-side-built
 * (fields on the other) stays NON-urban — the owner's "main road along
 * fields is fine" verbatim. Measured calibration: buffer-0 alone scored a
 * Brampton main-road slog 0.02 urban — plainly wrong.
 */
export const URBAN_FLANK_OFFSET_M = 120;
/** Origin grace (m): leaving your own neighbourhood is unavoidable. */
export const URBAN_GRACE_RADIUS_M = 2_500;
/** A rolling window this long under URBAN_OPEN_MAX_SHARE = "opened up". */
export const URBAN_OPEN_WINDOW_M = 2_000;
export const URBAN_OPEN_MAX_SHARE = 0.25;
/** Bridge ≤ this many metres of non-urban inside an urban run. */
export const URBAN_RUN_BRIDGE_M = 250;

type Ring = Array<[number, number]>; // [lng, lat]
interface IndexedPolygon {
  rings: Ring[]; // exterior + holes; even-odd crossing over ALL rings
  bbox: [number, number, number, number]; // west, south, east, north
}

export interface UrbanIndex {
  polygons: IndexedPolygon[];
  /** cell key "x:y" (CELL_DEG grid) → polygon indices whose bbox overlaps. */
  grid: Map<string, number[]>;
}

const CELL_DEG = 0.01; // ~800 m cells
const cellKey = (x: number, y: number): string => `${x}:${y}`;

export function buildUrbanIndex(geojsons: readonly string[]): UrbanIndex {
  const polygons: IndexedPolygon[] = [];
  for (const gj of geojsons) {
    let geom: { type: string; coordinates: unknown };
    try {
      geom = JSON.parse(gj) as { type: string; coordinates: unknown };
    } catch {
      continue;
    }
    const polys: Ring[][] =
      geom.type === 'Polygon'
        ? [geom.coordinates as Ring[]]
        : geom.type === 'MultiPolygon'
          ? (geom.coordinates as Ring[][])
          : [];
    for (const rings of polys) {
      if (!rings.length || rings[0]!.length < 4) continue;
      let w = Infinity,
        s = Infinity,
        e = -Infinity,
        n = -Infinity;
      for (const [lng, lat] of rings[0]!) {
        if (lng < w) w = lng;
        if (lng > e) e = lng;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
      polygons.push({ rings, bbox: [w, s, e, n] });
    }
  }
  const grid = new Map<string, number[]>();
  polygons.forEach((p, i) => {
    const [w, s, e, n] = p.bbox;
    for (let x = Math.floor(w / CELL_DEG); x <= Math.floor(e / CELL_DEG); x++) {
      for (let y = Math.floor(s / CELL_DEG); y <= Math.floor(n / CELL_DEG); y++) {
        const k = cellKey(x, y);
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  });
  return { polygons, grid };
}

/** Even-odd point-in-polygon over all rings (handles holes). */
function inPolygon(p: IndexedPolygon, lng: number, lat: number): boolean {
  const [w, s, e, n] = p.bbox;
  if (lng < w || lng > e || lat < s || lat > n) return false;
  let inside = false;
  for (const ring of p.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export function isUrbanPoint(index: UrbanIndex, lng: number, lat: number): boolean {
  const list = index.grid.get(cellKey(Math.floor(lng / CELL_DEG), Math.floor(lat / CELL_DEG)));
  if (!list) return false;
  for (const i of list) if (inPolygon(index.polygons[i]!, lng, lat)) return true;
  return false;
}

/** Urban-CONTEXT test for a route point: inside a built area, or built on
 *  BOTH flanks (perpendicular to travel direction — see URBAN_FLANK_OFFSET_M). */
export function isUrbanContext(
  index: UrbanIndex,
  lng: number,
  lat: number,
  dirLng: number,
  dirLat: number,
): boolean {
  if (isUrbanPoint(index, lng, lat)) return true;
  const kx = mLng(lat);
  const dx = dirLng * kx;
  const dy = dirLat * mLat;
  const len = Math.hypot(dx, dy);
  if (len === 0) return false;
  // unit normal in metre-space → back to degrees
  const nx = (-dy / len) * URBAN_FLANK_OFFSET_M;
  const ny = (dx / len) * URBAN_FLANK_OFFSET_M;
  const lLng = lng + nx / kx;
  const lLat = lat + ny / mLat;
  const rLng = lng - nx / kx;
  const rLat = lat - ny / mLat;
  return isUrbanPoint(index, lLng, lLat) && isUrbanPoint(index, rLng, rLat);
}

// ---------------------------------------------------------------------------
// index cache: one DB read per quantized bbox (planner runs from the same
// area share an entry; eval sweeps hold a handful)
// ---------------------------------------------------------------------------
const CACHE_MAX = 8;
const cache = new Map<string, UrbanIndex>(); // insertion-ordered → LRU-ish

export async function urbanIndexFor(
  db: Client,
  bbox: { west: number; south: number; east: number; north: number },
): Promise<UrbanIndex> {
  const q = (v: number): number => Math.round(v / 0.05) * 0.05; // 0.05° quantize
  const key = [q(bbox.west), q(bbox.south), q(bbox.east), q(bbox.north)].join(',');
  const hit = cache.get(key);
  if (hit) return hit;
  const geojsons = await plannerBuiltAreas(db, {
    west: q(bbox.west) - 0.05,
    south: q(bbox.south) - 0.05,
    east: q(bbox.east) + 0.05,
    north: q(bbox.north) + 0.05,
  });
  const index = buildUrbanIndex(geojsons);
  cache.set(key, index);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return index;
}

// ---------------------------------------------------------------------------
// route measures
// ---------------------------------------------------------------------------
const mLat = 111_320;
const mLng = (lat: number): number => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Resampled [lng, lat] points every stepM along the line. */
function resampleLine(coords: Array<[number, number]>, stepM: number): Array<[number, number]> {
  if (coords.length < 2) return coords.slice();
  const out: Array<[number, number]> = [coords[0]!];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const kx = mLng((a[1] + b[1]) / 2);
    const segLen = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * mLat);
    let d = stepM - carry;
    while (d <= segLen) {
      const t = d / segLen;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += stepM;
    }
    carry = (carry + segLen) % stepM;
  }
  return out;
}

/**
 * Fraction of route length inside built-up areas, EXCLUDING points within the
 * grace radius of any grace point (the origin — and both ends for A→B):
 * leaving your own town is unavoidable and must not count against the route
 * (the same origin-grace principle as the residential/overlap metrics; the
 * ungraced version was measured to punish every town-origin brief for
 * existing — fixed-suite AC 16→10 before this fix). No grace points = raw.
 * null = no index/degenerate geometry.
 */
export function urbanShareOf(
  index: UrbanIndex | null,
  geometry: LineString,
  gracePoints: readonly LatLng[] = [],
  graceRadiusM: number = URBAN_GRACE_RADIUS_M,
): number | null {
  if (index === null || index.polygons.length === 0) return null;
  const pts = resampleLine(geometry.coordinates as Array<[number, number]>, URBAN_RESAMPLE_M);
  if (pts.length < 2) return null;
  let urban = 0;
  let counted = 0;
  for (let i = 0; i < pts.length; i++) {
    const [lng, lat] = pts[i]!;
    const graced = gracePoints.some(
      (g) => Math.hypot((lng - g.lng) * mLng(g.lat), (lat - g.lat) * mLat) <= graceRadiusM,
    );
    if (graced) continue;
    counted++;
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    if (isUrbanContext(index, lng, lat, b[0] - a[0], b[1] - a[1])) urban++;
  }
  return counted < 5 ? 0 : urban / counted; // all-graced short loops: honest 0
}

export interface UrbanRunInfo {
  runM: number;
  /** Midpoint [lng, lat] of the longest run; null when no run. */
  mid: [number, number] | null;
}

/** Longest contiguous urban run outside the origin grace (bridged ≤ 250 m). */
export function urbanRunInfo(
  index: UrbanIndex | null,
  geometry: LineString,
  origin: LatLng,
  graceRadiusM: number = URBAN_GRACE_RADIUS_M,
): UrbanRunInfo {
  if (index === null || index.polygons.length === 0) return { runM: 0, mid: null };
  const pts = resampleLine(geometry.coordinates as Array<[number, number]>, URBAN_RESAMPLE_M);
  if (pts.length < 2) return { runM: 0, mid: null };
  const kx = mLng(origin.lat);
  const bridgeSteps = Math.round(URBAN_RUN_BRIDGE_M / URBAN_RESAMPLE_M);
  let best = 0;
  let bestEnd = -1;
  let run = 0;
  let gap = 0;
  pts.forEach(([lng, lat], i) => {
    const graced = Math.hypot((lng - origin.lng) * kx, (lat - origin.lat) * mLat) <= graceRadiusM;
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const urban = !graced && isUrbanContext(index, lng, lat, b[0] - a[0], b[1] - a[1]);
    if (urban) {
      run += gap + 1;
      gap = 0;
      if (run > best) {
        best = run;
        bestEnd = i;
      }
    } else if (run > 0 && !graced && gap < bridgeSteps) {
      gap++;
    } else {
      run = 0;
      gap = 0;
    }
  });
  if (best === 0 || bestEnd < 0) return { runM: 0, mid: null };
  const midIdx = Math.max(0, bestEnd - Math.floor(best / 2));
  return { runM: best * URBAN_RESAMPLE_M, mid: pts[midIdx] ?? null };
}

/**
 * Metres of driving before the route first "opens up" — the first point where
 * the NEXT URBAN_OPEN_WINDOW_M of driving is ≤ URBAN_OPEN_MAX_SHARE urban.
 * 0 = opens immediately; null = never opens (fully urban route) or no index.
 */
export function urbanIntroM(index: UrbanIndex | null, geometry: LineString): number | null {
  if (index === null || index.polygons.length === 0) return null;
  const pts = resampleLine(geometry.coordinates as Array<[number, number]>, URBAN_RESAMPLE_M);
  const win = Math.max(2, Math.round(URBAN_OPEN_WINDOW_M / URBAN_RESAMPLE_M));
  if (pts.length < win + 1) return null;
  const flags = pts.map(([lng, lat], i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    return isUrbanContext(index, lng, lat, b[0] - a[0], b[1] - a[1]) ? 1 : 0;
  });
  let sum = 0;
  for (let i = 0; i < win; i++) sum += flags[i]!;
  for (let i = 0; i + win < flags.length; i++) {
    if (sum / win <= URBAN_OPEN_MAX_SHARE) return i * URBAN_RESAMPLE_M;
    sum += flags[i + win]! - flags[i]!;
  }
  return null; // never opens up
}
