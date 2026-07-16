/**
 * Stop bookkeeping (R16-3): per-type coverage + measured arrivals.
 *
 * Coverage replaces the old scalar `spotCount/requestedCount` — a required
 * fuel stop missing is a violation even when the coffee stop is covered.
 * Arrivals come from per-leg durations: stop waypoints are routed as
 * `break_through` (the only leg-splitting non-terminal type), so the stops
 * sorted by waypointIndex ARE the interior leg boundaries in drive order:
 * arrival at the j-th stop (1-based) = Σ legs[0..j-1].duration_s. When legs
 * and stops disagree (engine merged legs, topology changed), every arrival is
 * an honest null — never interpolated.
 */

import type {
  RouteThroughOutput,
  StopFraction,
  StopImportance,
  StopRequest,
  StopType,
} from '@shared/types';

import type { CandidateStop } from './candidates';

export interface StopCoverage {
  type: StopType;
  importance: StopImportance;
  requested: number;
  included: number;
}

/** Per-type request-vs-included tally (importance = strongest requested). */
export function stopCoverageOf(
  requests: readonly StopRequest[],
  stops: readonly Pick<CandidateStop, 'requestedType'>[],
): StopCoverage[] {
  const byType = new Map<StopType, StopCoverage>();
  for (const r of requests) {
    const existing = byType.get(r.type);
    if (existing) {
      existing.requested += r.count;
      if (r.importance === 'required') existing.importance = 'required';
    } else {
      byType.set(r.type, {
        type: r.type,
        importance: r.importance,
        requested: r.count,
        included: 0,
      });
    }
  }
  for (const s of stops) {
    const c = byType.get(s.requestedType);
    if (c) c.included += 1;
  }
  return [...byType.values()];
}

/** Mean over requested types of min(1, included/requested); 1 with no requests.
 *  Feeds the frozen w_stop weight — coffee-covered/fuel-missing scores 0.5. */
export function stopCoverScore(coverage: readonly StopCoverage[]): number {
  if (coverage.length === 0) return 1;
  const sum = coverage.reduce((acc, c) => acc + Math.min(1, c.included / c.requested), 0);
  return sum / coverage.length;
}

export interface ResolvedStop {
  spotId: string;
  name: string;
  spotType: string;
  requestedType: StopType;
  atFraction: StopFraction | null;
  waypointIndex: number;
  /** Measured arrival (s from start); null = legs/stops misaligned (honest). */
  arrivalS: number | null;
}

/** Compute arrivals from per-leg durations (see module header for the rule). */
export function resolveStopArrivals(
  stops: readonly CandidateStop[],
  route: Pick<RouteThroughOutput, 'legs'>,
): ResolvedStop[] {
  const ordered = [...stops].sort((a, b) => a.waypointIndex - b.waypointIndex);
  const aligned = route.legs.length === ordered.length + 1 && ordered.length > 0;
  let cumulative = 0;
  return ordered.map((s, j) => {
    if (aligned) cumulative += route.legs[j]!.duration_s;
    return { ...s, arrivalS: aligned ? cumulative : null };
  });
}
