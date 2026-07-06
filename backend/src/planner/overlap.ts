/**
 * Overlap primitives (M3-T07/T09; Protocol §9 diversity + §10 retracing).
 *
 *   self_overlap(ρ)      — fraction of a route's length traversed more than once
 *                          (out-and-back detector; §3.6 sanity cap).
 *   edge_overlap(ρ1, ρ2) — fraction of ρ1's length that runs along ρ2 (candidate
 *                          similarity for dedup; TAU_OVERLAP threshold).
 *
 * Both work on resampled geometry bucketed into ~grid cells: consecutive resampled
 * points form undirected "edges" keyed by their cell pair. Deterministic, engine-free,
 * robust to vertex-density differences (the resampling from the SPK-10 engine).
 */

import type { LineString } from '@shared/types';

import { resample, type LonLat } from '../../../data/curvature/geometry';

/** Resample spacing for overlap math (m) — finer than cells to avoid gaps. */
export const OVERLAP_RESAMPLE_M = 60;
/** Grid cell size (m) — two traversals within this lateral distance share cells. */
export const OVERLAP_CELL_M = 120;

function cellKey(p: LonLat, cellM: number): string {
  // ~metre-scaled grid at Niagara latitudes (fixed factor keeps it deterministic)
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const cx = Math.round((p[0] * lngM) / cellM);
  const cy = Math.round((p[1] * latM) / cellM);
  return `${cx}:${cy}`;
}

function edgeKeys(geometry: LineString, cellM: number): string[] {
  const pts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    OVERLAP_RESAMPLE_M,
  );
  const keys: string[] = [];
  let prev = cellKey(pts[0]!, cellM);
  for (let i = 1; i < pts.length; i++) {
    const cur = cellKey(pts[i]!, cellM);
    if (cur !== prev) {
      // undirected edge — out-and-back traversals collide on the same key
      keys.push(prev < cur ? `${prev}|${cur}` : `${cur}|${prev}`);
      prev = cur;
    }
  }
  return keys;
}

/**
 * Origin grace radius (m): repeated edges within this distance of the origin are
 * NOT counted as retracing (SPK-15 finding: funnel-topology towns — one approach
 * road — force every real loop to reuse its first/last kilometres, exactly like
 * leaving and returning on your own street; genuine out-and-backs still repeat
 * edges FAR from the origin and are caught). Candidate value; M4 [GATE-L] tunes.
 */
export const ORIGIN_GRACE_RADIUS_M = 2_500;

/**
 * Fraction of the route's edge-steps traversed more than once (0 = clean loop).
 * With `origin` given, repeats inside ORIGIN_GRACE_RADIUS_M are exempt.
 */
export function selfOverlapRatio(
  geometry: LineString,
  cellM: number = OVERLAP_CELL_M,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): number {
  const pts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    OVERLAP_RESAMPLE_M,
  );
  if (pts.length < 2) return 0;

  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const inGrace = (p: LonLat): boolean => {
    if (!origin) return false;
    const dx = (p[0] - origin.lng) * lngM;
    const dy = (p[1] - origin.lat) * latM;
    return Math.hypot(dx, dy) <= graceRadiusM;
  };

  const steps: Array<{ key: string; graced: boolean }> = [];
  let prevKey = cellKey(pts[0]!, cellM);
  let prevGrace = inGrace(pts[0]!);
  for (let i = 1; i < pts.length; i++) {
    const curKey = cellKey(pts[i]!, cellM);
    const curGrace = inGrace(pts[i]!);
    if (curKey !== prevKey) {
      steps.push({
        key: prevKey < curKey ? `${prevKey}|${curKey}` : `${curKey}|${prevKey}`,
        graced: prevGrace && curGrace,
      });
      prevKey = curKey;
      prevGrace = curGrace;
    }
  }
  if (steps.length === 0) return 0;

  const seen = new Map<string, number>();
  for (const s of steps) seen.set(s.key, (seen.get(s.key) ?? 0) + 1);
  let repeated = 0;
  for (const s of steps) {
    if (!s.graced && seen.get(s.key)! > 1) repeated++;
  }
  return repeated / steps.length;
}

/** Fraction of ρ1's edge-steps that also appear in ρ2 (asymmetric; use max for pairs). */
export function edgeOverlapRatio(
  a: LineString,
  b: LineString,
  cellM: number = OVERLAP_CELL_M,
): number {
  const aKeys = edgeKeys(a, cellM);
  if (aKeys.length === 0) return 0;
  const bSet = new Set(edgeKeys(b, cellM));
  let shared = 0;
  for (const k of aKeys) if (bSet.has(k)) shared++;
  return shared / aKeys.length;
}

/** Symmetric pairwise overlap — the §9 dedup comparison value. */
export function pairOverlap(a: LineString, b: LineString, cellM: number = OVERLAP_CELL_M): number {
  return Math.max(edgeOverlapRatio(a, b, cellM), edgeOverlapRatio(b, a, cellM));
}
