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

/**
 * Spur detection (owner round 5: "quickly entering a road and spinning right
 * back onto it" — neighbourhood dips, roundabout spins, ramp in-outs).
 *
 * A SPUR = the route retraces its own immediately-preceding roadway: the same
 * undirected cell-edge reappears within a short lookback window, for several
 * consecutive steps. Deliberately FINER grid than the overlap metric
 * (20 m resample / 40 m cells): a true spur reuses the SAME roadway (0 m
 * apart → identical cells), while a fun switchback's parallel legs sit
 * 40–100 m apart → different cells → NOT flagged. Requiring a run of
 * ≥ SPUR_MIN_RUN repeated steps (≥ ~60 m of retraced road) keeps single-cell
 * coincidences (crossovers, tight corners) out.
 */
export const SPUR_RESAMPLE_M = 20;
export const SPUR_CELL_M = 40;
/**
 * Lookback windows (steps). The NARROW window (≈400 m) is the ASSEMBLY gate —
 * proven pool-viable in round 5. The WIDE window (≈1 km) additionally catches
 * full-block neighbourhood spins (in on street X, around the block ~600–800 m,
 * back out on X — owner round 6) and is used at PRESENTATION/AC only: a hard
 * assembly gate at this width killed every pool (round-6 measurement: 575 spur
 * rejections, 0/40). Hairpin safety comes from the fine CELLS (lateral
 * separation), not the window.
 */
export const SPUR_WINDOW_STEPS = 20;
export const SPUR_WINDOW_WIDE_STEPS = 50;
/** Consecutive repeated steps needed to count one spur event. */
export const SPUR_MIN_RUN = 3;

/**
 * Count spur events (distinct micro-retrace excursions) outside the origin
 * grace radius. 0 = clean; each event is one "in-and-spin-back" the driver
 * would feel.
 */
export function spurEvents(
  geometry: LineString,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
  windowSteps: number = SPUR_WINDOW_STEPS,
): number {
  const pts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    SPUR_RESAMPLE_M,
  );
  if (pts.length < 3) return 0;

  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const inGrace = (p: LonLat): boolean => {
    if (!origin) return false;
    const dx = (p[0] - origin.lng) * lngM;
    const dy = (p[1] - origin.lat) * latM;
    return Math.hypot(dx, dy) <= graceRadiusM;
  };

  const lastSeen = new Map<string, number>();
  let events = 0;
  let run = 0;
  let counted = false;
  let prevKey = cellKey(pts[0]!, SPUR_CELL_M);
  let prevGrace = inGrace(pts[0]!);
  let stepIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    const curKey = cellKey(pts[i]!, SPUR_CELL_M);
    const curGrace = inGrace(pts[i]!);
    if (curKey === prevKey) continue;
    const edge = prevKey < curKey ? `${prevKey}|${curKey}` : `${curKey}|${prevKey}`;
    const seenAt = lastSeen.get(edge);
    const isRepeat =
      seenAt !== undefined && stepIdx - seenAt <= windowSteps && !(prevGrace && curGrace);
    if (isRepeat) {
      run++;
      if (run >= SPUR_MIN_RUN && !counted) {
        events++;
        counted = true; // one event per contiguous run
      }
    } else {
      run = 0;
      counted = false;
    }
    lastSeen.set(edge, stepIdx);
    stepIdx++;
    prevKey = curKey;
    prevGrace = curGrace;
  }
  return events;
}

/**
 * Longest CONTIGUOUS doubled-roadway run in metres (approximate: repeated
 * steps × cell size), outside the origin grace. Owner round 6: "enter an area
 * on a road, do some driving, then come back on the SAME road" — a long
 * there-and-back reads boring even when the overall self-overlap RATIO stays
 * under its cap (5 doubled km on an 80 km loop is only 6 %); the ratio cannot
 * see contiguity, this can.
 */
export function maxRetraceRunM(
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
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(s.key, (counts.get(s.key) ?? 0) + 1);

  let best = 0;
  let run = 0;
  for (const s of steps) {
    if (!s.graced && counts.get(s.key)! > 1) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best * cellM;
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

/**
 * Micro-loop detection (owner round 8: "go into a random neighbourhood and
 * spin the crescent"). A crescent/block spin is a SMALL CLOSED CIRCUIT away
 * from the origin: the path returns to within MICROLOOP_CLOSE_M of itself
 * after 150–3000 m of NEW pavement enclosing real area. Every other detector
 * is structurally blind to it — no doubled travel (not a spur/retrace), no
 * u-turn maneuver (the circle IS the turnaround — Valhalla reverses heading
 * at a 'through' waypoint without emitting a u-turn), and a few hundred
 * metres of crescent is ~1 % residential share on a long loop.
 *
 * Discriminators (validated on the 40-brief corpus, 2026-07-11):
 *   - closure < 30 m: switchback stacks never CLOSE (parallel legs 40–100 m
 *     apart) — they stay invisible here;
 *   - cycle length ∈ [150 m, 3 km]: normal roundabout passage (~125 m full
 *     circle) stays under the floor; large scenic sub-circuits and the main
 *     loop exceed the cap (the main loop's closure is also origin-graced);
 *   - enclosed area > 3000 m²: a genuine circle, not a sliver of parallel
 *     carriageways.
 */
export const MICROLOOP_MIN_M = 150;
export const MICROLOOP_MAX_M = 3_000;
export const MICROLOOP_CLOSE_M = 30;
export const MICROLOOP_AREA_M2 = 3_000;
const MICROLOOP_RESAMPLE_M = 20;

/** Count of small closed circuits outside the origin grace radius. */
export function microloopEvents(
  geometry: LineString,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): number {
  const pts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    MICROLOOP_RESAMPLE_M,
  );
  if (pts.length < 3) return 0;
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const dM = (a: LonLat, b: LonLat): number =>
    Math.hypot((a[0] - b[0]) * lngM, (a[1] - b[1]) * latM);
  const area = (cycle: LonLat[]): number => {
    let s = 0;
    for (let k = 0; k < cycle.length; k++) {
      const a = cycle[k]!;
      const b = cycle[(k + 1) % cycle.length]!;
      s += a[0] * lngM * (b[1] * latM) - b[0] * lngM * (a[1] * latM);
    }
    return Math.abs(s / 2);
  };

  const minSteps = Math.ceil(MICROLOOP_MIN_M / MICROLOOP_RESAMPLE_M);
  const maxSteps = Math.ceil(MICROLOOP_MAX_M / MICROLOOP_RESAMPLE_M);
  let events = 0;
  let i = 0;
  while (i < pts.length) {
    let advanced = false;
    const jMax = Math.min(pts.length - 1, i + maxSteps);
    for (let j = i + minSteps; j <= jMax; j++) {
      if (dM(pts[i]!, pts[j]!) < MICROLOOP_CLOSE_M) {
        const graced =
          origin !== undefined && dM(pts[i]!, [origin.lng, origin.lat]) <= graceRadiusM;
        if (!graced && area(pts.slice(i, j + 1)) > MICROLOOP_AREA_M2) {
          events++;
          i = j; // consume the cycle; scan onward from its closure
          advanced = true;
        }
        break; // first closure decides this i (closed or too small — move on)
      }
    }
    if (!advanced) i++;
  }
  return events;
}
