/**
 * Curvature scoring for the planner (M3-T05; Protocol §12, finalized at M4 [GATE-C]).
 *
 * Reuses the SPK-10 engine (data/curvature) — the SAME preprocessing + formulas that
 * produced the validated hand-label results (ρ = 0.825, grid-FP 6.3 % @ θ 0.60) and
 * that populate `curvy_segments`. Candidate formula = C7 (circumradius, 1/km);
 * C2 (heading/km) rides along for the M4 ablation.
 *
 * Route-level curviness (round 15/FB-5, config frozen-m4t12-v9): CLASS-AWARE —
 * the §12.1 maneuver-aware exclusion the M3 header deferred. Ramp/turn-channel/
 * roundabout/motorway/trunk edges (from the trace the residential gate already
 * fetches) are dropped and each kept run is measured in ISOLATION, mirroring
 * the corpus builder's per-way independence (data/curvature/compute.ts
 * isJunctionGeometry) — so junction wiggle can no longer masquerade as
 * twistiness (M7-T09 owner finding: "highway ramps count as twisty").
 * Tag-blind fallback when no usable trace exists (A→B, trace failure) — a
 * measurement fallback is still a measurement. Formula C7 + θ stay frozen;
 * only the measured geometry domain narrows.
 */

import type { LineString } from '@shared/types';

import {
  computeCurvature,
  DEFAULT_PARAMS,
  type CurvatureParams,
} from '../../../data/curvature/compute';
import type { TraceResult } from '../valhalla/trace';

/** Candidate THETA_CURVY (SPK-10 sweep; frozen at M4 [GATE-C]). */
export const THETA_CURVY = 0.6;

export interface RouteCurvature {
  /** C7 — circumradius curvature per km (the candidate primary metric). */
  curviness: number;
  /** C2 — heading change per km (deg/km), kept for the M4 ablation. */
  headingChangePerKm: number;
  /** Length used for the measurement (m). */
  lengthM: number;
  /** True when the geometry was too short/degenerate to score (values are 0). */
  skipped: boolean;
}

/** Measure curviness of a route/segment geometry (GeoJSON LineString). */
export function measureCurvature(
  geometry: LineString,
  params: CurvatureParams = DEFAULT_PARAMS,
): RouteCurvature {
  const result = computeCurvature(
    geometry.coordinates.map(([lon, lat]) => [lon, lat] as const),
    params,
  );
  return {
    curviness: result.circumCurvaturePerKm,
    headingChangePerKm: result.headingChangePerKm,
    lengthM: result.lengthM,
    skipped: result.skipped,
  };
}

/** Is a measured geometry "curvy" under the candidate threshold? */
export function isCurvy(curvature: RouteCurvature, theta: number = THETA_CURVY): boolean {
  return !curvature.skipped && curvature.curviness >= theta;
}

// --- class-aware route measurement (round 15/FB-5) ---------------------------

/** Edge uses whose geometry is junction plumbing, never "twisty road". */
export const CURV_EXCLUDED_USES: ReadonlySet<string> = new Set(['ramp', 'turn_channel']);
/** Road classes excluded from twistiness (corpus never contains them either). */
export const CURV_EXCLUDED_CLASSES: ReadonlySet<string> = new Set(['motorway', 'trunk']);

export interface ClassAwareCurvature extends RouteCurvature {
  /** True when trace segmentation was applied (false = tag-blind fallback). */
  classAware: boolean;
  /** Share of matched length excluded (ramps/turn channels/roundabouts/motorway/trunk). */
  excludedShare: number;
}

function keepEdge(e: TraceResult['edges'][number]): boolean {
  return (
    !CURV_EXCLUDED_USES.has(e.use ?? 'road') &&
    e.roundabout !== true &&
    !CURV_EXCLUDED_CLASSES.has(e.roadClass)
  );
}

/**
 * Measure route twistiness over KEPT road geometry only. Each contiguous kept
 * run is measured in isolation (per-way independence, §12.1): no curvature
 * triple can span an excluded edge, so the corner where a road meets a ramp
 * never counts as a turn. Falls back to the tag-blind measurement whenever the
 * trace lacks usable shape indices — never throws.
 */
export function measureCurvatureClassAware(
  geometry: LineString,
  trace: TraceResult | null,
  params: CurvatureParams = DEFAULT_PARAMS,
): ClassAwareCurvature {
  const fallback = (): ClassAwareCurvature => ({
    ...measureCurvature(geometry, params),
    classAware: false,
    excludedShare: 0,
  });

  if (!trace || trace.matchedShape === null || trace.edges.length === 0) return fallback();
  const shape = trace.matchedShape.coordinates;
  const edges = trace.edges;
  for (const e of edges) {
    if (e.beginShapeIndex === undefined || e.endShapeIndex === undefined) return fallback();
  }
  // index/shape consistency: the last edge must end at the final shape point
  if (edges[edges.length - 1]!.endShapeIndex !== shape.length - 1) return fallback();

  // coalesce consecutive kept edges into shape-index runs; drops close a run
  const runs: Array<[number, number]> = [];
  let excludedLenM = 0;
  let totalLenM = 0;
  let open: [number, number] | null = null;
  for (const e of edges) {
    totalLenM += e.lengthM;
    if (keepEdge(e)) {
      if (open && open[1] === e.beginShapeIndex!) open[1] = e.endShapeIndex!;
      else {
        if (open) runs.push(open);
        open = [e.beginShapeIndex!, e.endShapeIndex!];
      }
    } else {
      excludedLenM += e.lengthM;
      if (open) runs.push(open);
      open = null;
    }
  }
  if (open) runs.push(open);

  // measure each kept run independently; length-weighted aggregate
  let sumC7 = 0; // Σ (curviness/1000 · lengthM) — raw circum curvature sum
  let sumC2 = 0;
  let measuredLenM = 0;
  for (const [begin, end] of runs) {
    const coords = shape.slice(begin, end + 1);
    if (coords.length < 2) continue;
    const r = computeCurvature(
      coords.map(([lon, lat]) => [lon, lat] as const),
      params,
    );
    if (r.skipped) continue; // corpus convention: too-short runs never score
    sumC7 += (r.circumCurvaturePerKm / 1000) * r.lengthM;
    sumC2 += (r.headingChangePerKm / 1000) * r.lengthM;
    measuredLenM += r.lengthM;
  }

  const excludedShare = totalLenM > 0 ? excludedLenM / totalLenM : 0;
  if (measuredLenM === 0) {
    // an all-junction/motorway route has zero honest twistiness
    return {
      curviness: 0,
      headingChangePerKm: 0,
      lengthM: 0,
      skipped: true,
      classAware: true,
      excludedShare,
    };
  }
  return {
    curviness: (sumC7 / measuredLenM) * 1000,
    headingChangePerKm: (sumC2 / measuredLenM) * 1000,
    lengthM: measuredLenM,
    skipped: false,
    classAware: true,
    excludedShare,
  };
}
