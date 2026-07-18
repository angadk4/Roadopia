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
  if (pts.length < 2) return []; // degenerate geometry — no edges (R18-0 guard)
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
export function spurPositions(
  geometry: LineString,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
  windowSteps: number = SPUR_WINDOW_STEPS,
): LonLat[] {
  const pts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    SPUR_RESAMPLE_M,
  );
  if (pts.length < 3) return [];

  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const inGrace = (p: LonLat): boolean => {
    if (!origin) return false;
    const dx = (p[0] - origin.lng) * lngM;
    const dy = (p[1] - origin.lat) * latM;
    return Math.hypot(dx, dy) <= graceRadiusM;
  };

  const lastSeen = new Map<string, number>();
  const positions: LonLat[] = [];
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
        positions.push(pts[i]!); // where the spur bit (R18-2 repair aim)
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
  return positions;
}

/** Count of spur events — .length of spurPositions (behavior-identical). */
export function spurEvents(
  geometry: LineString,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
  windowSteps: number = SPUR_WINDOW_STEPS,
): number {
  return spurPositions(geometry, origin, graceRadiusM, windowSteps).length;
}

/**
 * Longest CONTIGUOUS doubled-roadway run in metres (approximate: repeated
 * steps × cell size), outside the origin grace. Owner round 6: "enter an area
 * on a road, do some driving, then come back on the SAME road" — a long
 * there-and-back reads boring even when the overall self-overlap RATIO stays
 * under its cap (5 doubled km on an 80 km loop is only 6 %); the ratio cannot
 * see contiguity, this can.
 */
export interface RetraceRunInfo {
  runM: number;
  /** Midpoint [lng, lat] of the longest doubled run — the repair aim (R18-2). */
  mid: LonLat | null;
}

export function maxRetraceRunInfo(
  geometry: LineString,
  cellM: number = OVERLAP_CELL_M,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): RetraceRunInfo {
  const pts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    OVERLAP_RESAMPLE_M,
  );
  if (pts.length < 2) return { runM: 0, mid: null };

  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const inGrace = (p: LonLat): boolean => {
    if (!origin) return false;
    const dx = (p[0] - origin.lng) * lngM;
    const dy = (p[1] - origin.lat) * latM;
    return Math.hypot(dx, dy) <= graceRadiusM;
  };

  const steps: Array<{ key: string; graced: boolean; pt: LonLat }> = [];
  let prevKey = cellKey(pts[0]!, cellM);
  let prevGrace = inGrace(pts[0]!);
  for (let i = 1; i < pts.length; i++) {
    const curKey = cellKey(pts[i]!, cellM);
    const curGrace = inGrace(pts[i]!);
    if (curKey !== prevKey) {
      steps.push({
        key: prevKey < curKey ? `${prevKey}|${curKey}` : `${curKey}|${prevKey}`,
        graced: prevGrace && curGrace,
        pt: pts[i]!,
      });
      prevKey = curKey;
      prevGrace = curGrace;
    }
  }
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(s.key, (counts.get(s.key) ?? 0) + 1);

  let best = 0;
  let bestEnd = -1;
  let run = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (!s.graced && counts.get(s.key)! > 1) {
      run++;
      if (run > best) {
        best = run;
        bestEnd = i;
      }
    } else {
      run = 0;
    }
  }
  const mid = bestEnd >= 0 ? steps[Math.max(0, bestEnd - Math.floor(best / 2))]!.pt : null;
  return { runM: best * cellM, mid };
}

/** Longest contiguous doubled run in metres (see maxRetraceRunInfo). */
export function maxRetraceRunM(
  geometry: LineString,
  cellM: number = OVERLAP_CELL_M,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): number {
  return maxRetraceRunInfo(geometry, cellM, origin, graceRadiusM).runM;
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

/**
 * Closure points ([lng, lat]) of small closed circuits outside the origin
 * grace radius — the repair pass (round 9) drops the waypoint nearest one.
 */
export function microloopPositions(
  geometry: LineString,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): LonLat[] {
  const pts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    MICROLOOP_RESAMPLE_M,
  );
  if (pts.length < 3) return [];
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
  const positions: LonLat[] = [];
  let i = 0;
  while (i < pts.length) {
    let advanced = false;
    const jMax = Math.min(pts.length - 1, i + maxSteps);
    for (let j = i + minSteps; j <= jMax; j++) {
      if (dM(pts[i]!, pts[j]!) < MICROLOOP_CLOSE_M) {
        const graced =
          origin !== undefined && dM(pts[i]!, [origin.lng, origin.lat]) <= graceRadiusM;
        if (!graced && area(pts.slice(i, j + 1)) > MICROLOOP_AREA_M2) {
          // Refine to the TIGHTEST closure inside [i, j]: a lollipop's
          // out-and-back stem closes first, putting the naive position up to
          // ~(MAX−cycle)/2 before the actual circle mouth — bad aim for the
          // repair pass. The minimal-cycle pair IS the mouth.
          let bi = i;
          let bj = j;
          for (let k = i; k <= j - minSteps; k++) {
            const kMax = Math.min(j, k + (bj - bi) - 1); // only strictly tighter
            for (let m = k + minSteps; m <= kMax; m++) {
              if (
                dM(pts[k]!, pts[m]!) < MICROLOOP_CLOSE_M &&
                area(pts.slice(k, m + 1)) > MICROLOOP_AREA_M2
              ) {
                bi = k;
                bj = m;
                break;
              }
            }
          }
          positions.push(pts[bi]!);
          i = j; // consume the whole event window; scan onward from its closure
          advanced = true;
        }
        break; // first closure decides this i (closed or too small — move on)
      }
    }
    if (!advanced) i++;
  }
  return positions;
}

/** Count of small closed circuits outside the origin grace radius. */
export function microloopEvents(
  geometry: LineString,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): number {
  return microloopPositions(geometry, origin, graceRadiusM).length;
}

// --- R18-0 essence metrics (report-only until gated in later units) ---------

/**
 * Curvy share (R18-0): fraction of the route's resampled points lying within
 * CURVY_MATCH_RADIUS_M of the retrieved curvy-segment set — the roads we CHOSE.
 * This is the audit's forced-vs-free number as a per-route metric: today's
 * routes measure ~3-10 %; the chain generator (R18-3) exists to raise it.
 *
 * The predicate is EXACT point distance; the cell hash is only an accelerator
 * (adversarial finding 2026-07-16: cell-EDGE matching was resample-phase-
 * dependent — driving 98 % of a diagonal road could measure 0.33). Known,
 * accepted floor: a route CROSSING a segment earns the few points inside the
 * radius (~0.2 pp per crossing on an 80 km loop) — documented, not gated.
 */
export const CURVY_MATCH_RADIUS_M = 90;

export function curvyShareOf(
  geometry: LineString,
  segments: ReadonlyArray<{ geometry: LineString }>,
): number | null {
  const routePts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    OVERLAP_RESAMPLE_M,
  );
  if (routePts.length < 2) return null;
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  // hash segment points at OVERLAP_CELL_M; ±1-cell reach covers the radius
  // exactly because CURVY_MATCH_RADIUS_M < OVERLAP_CELL_M (guarantee, not tune)
  const segCells = new Map<string, LonLat[]>();
  for (const s of segments) {
    const coords = s.geometry.coordinates;
    if (coords.length < 2) continue; // degenerate DB geometry — skip, never throw
    for (const p of resample(
      coords.map(([lon, lat]) => [lon, lat] as LonLat),
      OVERLAP_RESAMPLE_M,
    )) {
      const cx = Math.round((p[0] * lngM) / OVERLAP_CELL_M);
      const cy = Math.round((p[1] * latM) / OVERLAP_CELL_M);
      const key = `${cx}:${cy}`;
      let list = segCells.get(key);
      if (!list) {
        list = [];
        segCells.set(key, list);
      }
      list.push(p);
    }
  }
  if (segCells.size === 0) return 0;

  let onCurvy = 0;
  for (const p of routePts) {
    const cx = Math.round((p[0] * lngM) / OVERLAP_CELL_M);
    const cy = Math.round((p[1] * latM) / OVERLAP_CELL_M);
    let hit = false;
    for (let ix = cx - 1; ix <= cx + 1 && !hit; ix++) {
      for (let iy = cy - 1; iy <= cy + 1 && !hit; iy++) {
        const list = segCells.get(`${ix}:${iy}`);
        if (!list) continue;
        for (const q of list) {
          const dx = (p[0] - q[0]) * lngM;
          const dy = (p[1] - q[1]) * latM;
          if (dx * dx + dy * dy <= CURVY_MATCH_RADIUS_M * CURVY_MATCH_RADIUS_M) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) onCurvy++;
  }
  return onCurvy / routePts.length;
}

/**
 * Loopiness (R18-0): isoperimetric quotient 4πA/P² of the CLOSED route polygon
 * (first→last vertex closed). A perfect circle scores 1; a thin out-and-back —
 * including the parallel-corridor variant every other detector misses —
 * encloses ~no area and scores ~0. Blunt by design: the shape-level catchall
 * for "doesn't look like a loop". Uses the module's fixed planar scaling.
 *
 * VALIDITY: loops only. On open A→B geometry the closing chord makes the
 * number meaningless (a C-shaped arc reads like a real loop) — do not consume
 * it outside closed-loop contexts. KNOWN CAVEAT (adversarial finding
 * 2026-07-16): the signed shoelace lets a figure-8's opposite-winding lobes
 * cancel — a legitimate pretzel loop can read ~0. Report-only + p20-aggregated,
 * so a rare crossed best cannot move the scoreboard; revisit only if gating.
 */
export function loopiness(geometry: LineString): number | null {
  const pts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    OVERLAP_RESAMPLE_M,
  );
  if (pts.length < 3) return null;
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  let area2 = 0; // shoelace ×2, planar metres
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!; // wraps: closes first→last
    area2 += a[0] * lngM * (b[1] * latM) - b[0] * lngM * (a[1] * latM);
    perimeter += Math.hypot((b[0] - a[0]) * lngM, (b[1] - a[1]) * latM);
  }
  if (perimeter === 0) return null;
  return (4 * Math.PI * Math.abs(area2 / 2)) / (perimeter * perimeter);
}

/**
 * Directed corridor doubling (R18-0): out-on-X-back-on-parallel-Y detection.
 * The 120 m undirected grid cannot see two arterials one block apart; this
 * counts a step as doubled when an earlier step ran the OPPOSITE way (>135°
 * bearing difference) within CORRIDOR_LATERAL_M **exact distance** at
 * ≥ CORRIDOR_MIN_SEPARATION_M along-route separation. The hash grid is only
 * an accelerator — the predicate is exact, so identical shapes measure
 * identically regardless of grid phase (adversarial finding 2026-07-16: the
 * cell-membership version scored the same 500 m-apart pair 0.909 or 0
 * depending on where the grid fell).
 *
 * Known, accepted floors (report-only; thresholds calibrated on the corpus
 * before any gating): a single legitimate shallow self-crossing flags a
 * ~2·CORRIDOR_LATERAL_M band on both legs (~2-4 % of a long loop); a deep
 * switchback stack (≥4 legs) can pair its outermost legs (~a few %). A real
 * corridor out-and-back measures an order of magnitude above both. Origin
 * grace applies as everywhere.
 */
export const CORRIDOR_LATERAL_M = 350;
export const CORRIDOR_MIN_SEPARATION_M = 2_000;
const CORRIDOR_OPPOSE_DEG = 135;
/** Hash cell for the accelerator: > CORRIDOR_LATERAL_M so ±1-cell reach is a
 *  guarantee ((cell/2 + lateral)/cell < 1.5), never a tuning knob. */
const CORRIDOR_HASH_CELL_M = 400;

export function corridorDoublingRatio(
  geometry: LineString,
  origin?: { lat: number; lng: number },
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): number | null {
  const pts = resample(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat),
    OVERLAP_RESAMPLE_M,
  );
  if (pts.length < 3) return null;
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const inGrace = (p: LonLat): boolean => {
    if (!origin) return false;
    const dx = (p[0] - origin.lng) * lngM;
    const dy = (p[1] - origin.lat) * latM;
    return Math.hypot(dx, dy) <= graceRadiusM;
  };

  interface Step {
    x: number; // planar metres (midpoint)
    y: number;
    bearing: number; // degrees [0,360)
    alongM: number;
    graced: boolean;
  }
  // steps between consecutive resampled points (~OVERLAP_RESAMPLE_M each)
  const byCell = new Map<string, Step[]>();
  const steps: Step[] = [];
  let alongM = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = (b[0] - a[0]) * lngM;
    const dy = (b[1] - a[1]) * latM;
    const stepLen = Math.hypot(dx, dy);
    alongM += stepLen;
    if (stepLen === 0) continue;
    const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const mid: LonLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s: Step = {
      x: mid[0] * lngM,
      y: mid[1] * latM,
      bearing,
      alongM,
      graced: inGrace(mid),
    };
    steps.push(s);
    const key = `${Math.round(s.x / CORRIDOR_HASH_CELL_M)}:${Math.round(s.y / CORRIDOR_HASH_CELL_M)}`;
    let list = byCell.get(key);
    if (!list) {
      list = [];
      byCell.set(key, list);
    }
    list.push(s);
  }
  if (steps.length === 0) return null;

  const opposes = (a: number, b: number): boolean => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d) > CORRIDOR_OPPOSE_DEG;
  };
  const lateral2 = CORRIDOR_LATERAL_M * CORRIDOR_LATERAL_M;

  let doubled = 0;
  for (const s of steps) {
    if (s.graced) continue;
    const cx = Math.round(s.x / CORRIDOR_HASH_CELL_M);
    const cy = Math.round(s.y / CORRIDOR_HASH_CELL_M);
    let hit = false;
    for (let ix = cx - 1; ix <= cx + 1 && !hit; ix++) {
      for (let iy = cy - 1; iy <= cy + 1 && !hit; iy++) {
        const list = byCell.get(`${ix}:${iy}`);
        if (!list) continue;
        for (const other of list) {
          if (other === s || other.graced) continue;
          const ddx = other.x - s.x;
          const ddy = other.y - s.y;
          if (
            ddx * ddx + ddy * ddy <= lateral2 && // EXACT lateral distance
            Math.abs(other.alongM - s.alongM) >= CORRIDOR_MIN_SEPARATION_M &&
            opposes(other.bearing, s.bearing)
          ) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) doubled++;
  }
  return doubled / steps.length;
}
