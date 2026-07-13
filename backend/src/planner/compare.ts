/**
 * Route comparison — computed deltas between original ρ and refined ρ'
 * (M5-T06; Protocol §17.3, RQ 24). ALL NUMBERS ARE COMPUTED HERE — the LLM
 * may later *phrase* the comparison (same §14-R6 grounding boundary), never
 * compute or invent it.
 */

import type { LineString } from '@shared/types';

import { pairOverlap } from './overlap';

/** The comparable facts of one presented route (both sides use the same shape). */
export interface ComparableRoute {
  durationS: number;
  distanceM: number;
  /** Curvature score of the presented route; null if unscored. */
  curvatureScore: number | null;
  /** Scenic signal (labels-only default, BD-32); null when absent. */
  scenicSignal: number | null;
  stopNames: string[];
  geometry: LineString;
}

export interface RouteComparison {
  durationDeltaS: number;
  distanceDeltaM: number;
  curvatureDelta: number | null;
  scenicDelta: number | null;
  stopsAdded: string[];
  stopsRemoved: string[];
  /** Fraction of the ORIGINAL's length the refined route still runs along
   *  (edge_overlap(ρ, ρ') §17.3) — "how much actually changed". */
  edgeOverlap: number;
}

/** Deterministic diff, refined minus original. */
export function compareRoutes(
  original: ComparableRoute,
  refined: ComparableRoute,
): RouteComparison {
  const origSet = new Set(original.stopNames);
  const refSet = new Set(refined.stopNames);
  return {
    durationDeltaS: refined.durationS - original.durationS,
    distanceDeltaM: refined.distanceM - original.distanceM,
    curvatureDelta:
      original.curvatureScore !== null && refined.curvatureScore !== null
        ? refined.curvatureScore - original.curvatureScore
        : null,
    scenicDelta:
      original.scenicSignal !== null && refined.scenicSignal !== null
        ? refined.scenicSignal - original.scenicSignal
        : null,
    stopsAdded: refined.stopNames.filter((s) => !origSet.has(s)),
    stopsRemoved: original.stopNames.filter((s) => !refSet.has(s)),
    edgeOverlap: pairOverlap(original.geometry, refined.geometry),
  };
}

/** Compact factual phrasing (template; a grounded LLM may re-phrase, not re-compute). */
export function describeComparison(cmp: RouteComparison): string {
  const bits: string[] = [];
  const dMin = Math.round(cmp.durationDeltaS / 60);
  const dKm = Math.round(cmp.distanceDeltaM / 100) / 10;
  if (dMin !== 0) bits.push(`${dMin > 0 ? '+' : ''}${dMin} min`);
  if (dKm !== 0) bits.push(`${dKm > 0 ? '+' : ''}${dKm} km`);
  if (cmp.stopsAdded.length) bits.push(`adds ${cmp.stopsAdded.join(', ')}`);
  if (cmp.stopsRemoved.length) bits.push(`drops ${cmp.stopsRemoved.join(', ')}`);
  bits.push(`keeps ${Math.round(cmp.edgeOverlap * 100)}% of the original roads`);
  return bits.join(' · ');
}
