/**
 * Curvature metrics for a single road geometry (SPK-10 / Experimental Protocol §12).
 *
 * Two candidate formulas are computed side-by-side so the M4 [GATE-C] ablation can
 * pick the simplest one that ranks known twisty roads above urban grids:
 *
 *   C2  heading_change_per_km — Σ|Δheading| over the resampled polyline ÷ length_km
 *                               (deg/km). Cheap, robust, length-normalised.
 *   C7  circumradius method   — per resampled point-triple corner curvature κ = 1/R
 *                               (1/m), length-weighted to a route mean, reported as
 *                               curvature per km travelled (×1000 → 1/km units).
 *
 * Preprocessing (§12.1, fixed across both): resample to fixed spacing, drop degenerate
 * (near-collinear / coincident) triples, enforce a minimum segment length, and exclude
 * junction-like geometry (roundabouts, *_link ramps) at the way level so junction
 * wiggle is not misread as "twisty". Nothing here is frozen — M4 finalises the formula,
 * THETA_CURVY, turn_threshold and resample spacing.
 */

import {
  circumradiusMeters,
  haversineMeters,
  lineLengthMeters,
  meanLat,
  resample,
  turnAngleDeg,
  type LonLat,
} from './geometry';

/** Tunable preprocessing/curvature parameters — candidate values, finalised at M4. */
export interface CurvatureParams {
  /** Resample spacing in metres (§12.1). */
  resampleSpacingM: number;
  /** Minimum way length to score; shorter ways are too noisy (metres). */
  minLengthM: number;
  /**
   * Minimum corner radius considered for C7 (metres). Triples with a larger radius
   * (gentler than this) contribute ~0 curvature; clamps OSM digitisation noise on
   * near-straight roads from inflating the score. Triples below it are real corners.
   */
  maxRadiusM: number;
  /** A turn smaller than this (deg) is treated as noise for the curve-density view. */
  turnThresholdDeg: number;
}

export const DEFAULT_PARAMS: CurvatureParams = {
  resampleSpacingM: 20,
  minLengthM: 120,
  maxRadiusM: 1000,
  turnThresholdDeg: 8,
};

export interface CurvatureResult {
  /** Polyline length in metres (post-resample, ~equal to raw). */
  lengthM: number;
  /** C2 — total absolute heading change per km (deg/km). */
  headingChangePerKm: number;
  /** C7 — length-weighted mean curvature over travelled distance (1/km). */
  circumCurvaturePerKm: number;
  /** Count of significant turns (> turnThreshold) per km — supporting signal (C4). */
  significantTurnsPerKm: number;
  /** True if the way was too short / degenerate to score (metrics are 0). */
  skipped: boolean;
}

/** OSM tag bag (string→string), as exported by osmium. */
export type Tags = Record<string, string>;

/**
 * Whether a way is junction-like geometry that should be excluded from curvature
 * scoring (§12.1): roundabouts, mini-roundabouts, circular junctions, and link ramps.
 */
export function isJunctionGeometry(highway: string | undefined, tags: Tags): boolean {
  if (tags['junction'] === 'roundabout' || tags['junction'] === 'circular') return true;
  if (highway && highway.endsWith('_link')) return true;
  return false;
}

const ZERO: Omit<CurvatureResult, 'lengthM'> = {
  headingChangePerKm: 0,
  circumCurvaturePerKm: 0,
  significantTurnsPerKm: 0,
  skipped: true,
};

/**
 * Compute curvature metrics for one polyline. `highway`/`tags` drive junction
 * exclusion; pass `{}` to score raw geometry.
 */
export function computeCurvature(
  coords: readonly LonLat[],
  params: CurvatureParams = DEFAULT_PARAMS,
  highway?: string,
  tags: Tags = {},
): CurvatureResult {
  const rawLen = lineLengthMeters(coords);
  if (
    coords.length < 3 ||
    rawLen < params.minLengthM ||
    isJunctionGeometry(highway, tags)
  ) {
    return { ...ZERO, lengthM: rawLen };
  }

  const pts = resample(coords, params.resampleSpacingM);
  if (pts.length < 3) return { ...ZERO, lengthM: rawLen };

  const refLat = meanLat(pts);
  const lengthM = lineLengthMeters(pts);
  const lengthKm = lengthM / 1000;

  let totalAbsHeading = 0; // deg
  let weightedCurvature = 0; // Σ κ_i · len_i  (1/m · m = dimensionless)
  let significantTurns = 0;

  for (let i = 1; i < pts.length - 1; i++) {
    const p1 = pts[i - 1]!;
    const p2 = pts[i]!;
    const p3 = pts[i + 1]!;
    const turn = Math.abs(turnAngleDeg(p1, p2, p3, refLat));
    totalAbsHeading += turn;
    if (turn >= params.turnThresholdDeg) significantTurns++;

    const r = circumradiusMeters(p1, p2, p3, refLat);
    if (r <= params.maxRadiusM && Number.isFinite(r)) {
      // local travelled length attributed to this vertex (half of each adjacent leg)
      const segLen =
        (haversineMeters(p1, p2) + haversineMeters(p2, p3)) / 2;
      weightedCurvature += (1 / r) * segLen;
    }
  }

  return {
    lengthM,
    headingChangePerKm: lengthKm > 0 ? totalAbsHeading / lengthKm : 0,
    // Σκ·len ÷ length = mean curvature (1/m); ×1000 → 1/km for readable magnitudes.
    circumCurvaturePerKm: lengthM > 0 ? (weightedCurvature / lengthM) * 1000 : 0,
    significantTurnsPerKm: lengthKm > 0 ? significantTurns / lengthKm : 0,
    skipped: false,
  };
}
