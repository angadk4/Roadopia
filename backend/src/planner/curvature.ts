/**
 * Curvature scoring for the planner (M3-T05; Protocol §12, finalized at M4 [GATE-C]).
 *
 * Reuses the SPK-10 engine (data/curvature) — the SAME preprocessing + formulas that
 * produced the validated hand-label results (ρ = 0.825, grid-FP 6.3 % @ θ 0.60) and
 * that populate `curvy_segments`. Candidate formula = C7 (circumradius, 1/km);
 * C2 (heading/km) rides along for the M4 ablation. Route-level curviness is the
 * same computation applied to the FINAL routed geometry ("re-measure on final
 * geometry" — M3-T05 guidance): resampled, junction wiggle damped by the maxRadius
 * clamp; M4 may add maneuver-aware exclusion when freezing.
 */

import type { LineString } from '@shared/types';

import {
  computeCurvature,
  DEFAULT_PARAMS,
  type CurvatureParams,
} from '../../../data/curvature/compute';

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
