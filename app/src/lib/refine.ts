/**
 * Client-side refinement helpers (M7-T07; Spec §34, Protocol §17).
 *
 * The client HOLDS the running `c` (the constraints event from the last run)
 * and sends it back with a follow-up; the server merges deterministically
 * (RF6) and re-plans. The comparison is COMPUTED from the two route payloads —
 * real deltas, never narrated numbers (FR-254; the LLM may phrase, never
 * compute). Pure module, fully unit-tested.
 */

import type { ParsedConstraints, Route } from '@shared/types';

import type { PlanRequest } from './api';

/** The compact previous-route summary carried through the refine round-trip. */
export interface RouteSummary {
  distance_m: number;
  duration_s: number;
  curviness: number;
  climb_m: number | null;
}

export function summarizeRoute(route: Route): RouteSummary {
  return {
    distance_m: route.distance_m,
    duration_s: route.duration_s,
    curviness: route.curviness,
    climb_m: route.climb_m,
  };
}

/** Follow-up + held constraints → the /plan refine request. */
export function buildRefineRequest(constraints: ParsedConstraints, followUp: string): PlanRequest {
  const text = followUp.trim();
  return {
    // brief doubles as the FR-049 log line for this generation
    brief: text,
    constraints,
    followUp: text,
  };
}

export interface CompareRow {
  label: string;
  before: string;
  after: string;
  /** Signed human delta, e.g. "+18 min" / "−4.2 km" / "no change". */
  delta: string;
}

function signed(value: number, unit: string, digits = 0): string {
  if (value === 0) return 'no change';
  const sign = value > 0 ? '+' : '−';
  return `${sign}${Math.abs(value).toFixed(digits)}${unit}`;
}

/** Real, computed deltas between the previous and the refined route (FR-254). */
export function compareSummaries(previous: RouteSummary, next: RouteSummary): CompareRow[] {
  const rows: CompareRow[] = [
    {
      label: 'drive time',
      before: `≈${Math.round(previous.duration_s / 60)} min`,
      after: `≈${Math.round(next.duration_s / 60)} min`,
      delta: signed(
        Math.round(next.duration_s / 60) - Math.round(previous.duration_s / 60),
        ' min',
      ),
    },
    {
      label: 'distance',
      before: `${(previous.distance_m / 1000).toFixed(1)} km`,
      after: `${(next.distance_m / 1000).toFixed(1)} km`,
      // diff at DISPLAY precision so 'no change' matches identical columns
      delta: signed(
        (Math.round(next.distance_m / 100) - Math.round(previous.distance_m / 100)) / 10,
        ' km',
        1,
      ),
    },
    {
      label: 'twistiness',
      before: previous.curviness.toFixed(1),
      after: next.curviness.toFixed(1),
      delta: signed(
        (Math.round(next.curviness * 10) - Math.round(previous.curviness * 10)) / 10,
        '',
        1,
      ),
    },
  ];
  if (previous.climb_m !== null && next.climb_m !== null) {
    rows.push({
      label: 'climb',
      before: `${Math.round(previous.climb_m)} m`,
      after: `${Math.round(next.climb_m)} m`,
      delta: signed(Math.round(next.climb_m) - Math.round(previous.climb_m), ' m'),
    });
  }
  return rows;
}
