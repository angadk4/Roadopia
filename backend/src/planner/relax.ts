/**
 * Relaxation hierarchy + redirect (M3-T12; Protocol §3.7, Spec §28/§40).
 *
 * A pure, deterministic ladder the orchestrator climbs when a search attempt
 * yields no feasible candidate:
 *   1. WIDEN the isochrone budget (τ_out × TAU_WIDEN, once).
 *   2. LOWER THETA_CURVY (admit gentler roads; floored).
 *   3. RELAX SOFT targets (duration band widens; nice-to-have stops droppable) — disclose.
 *   4. RELAX ONE Tier-2 hard constraint to soft — disclose PROMINENTLY (status=relaxed).
 *      Order: unpaved → tolls → ferries → highways (most-explicit intent LAST).
 *   5. REDIRECT — no feasible route from this origin/brief within budget.
 * Every rung returns a human-readable disclosure; nothing is ever silently bent
 * and no route is ever fabricated (failure is a first-class outcome).
 */

import type { ParsedConstraints } from '@shared/types';

export const TAU_WIDEN_FACTOR = 1.3;
export const THETA_LOWER_FACTOR = 0.67;
export const THETA_FLOOR = 0.3;
export const RELAXED_DURATION_TOLERANCE = 0.25;

/** Effective search parameters the ladder mutates (orchestrator re-runs with these). */
export interface SearchParams {
  tauMultiplier: number;
  thetaCurvy: number;
  durationTolerance: number;
  /** Effective avoid set (starts = constraints.avoid; rung 4 clears entries). */
  avoid: ParsedConstraints['avoid'];
  /** Disclosed relaxations, in ladder order (feeds validate + the explanation). */
  relaxedConstraints: string[];
  disclosures: string[];
  /** Next ladder rung to try (1-based; 5 = redirect). */
  rung: number;
  /** Nice-to-have stops may be dropped from rung 3 on. */
  dropNiceToHaveStops: boolean;
}

export function initialParams(constraints: ParsedConstraints, thetaCurvy = 0.6): SearchParams {
  return {
    tauMultiplier: 1,
    thetaCurvy,
    durationTolerance: 0.1,
    avoid: { ...constraints.avoid },
    relaxedConstraints: [],
    disclosures: [],
    rung: 1,
    dropNiceToHaveStops: false,
  };
}

export type RelaxOutcome =
  | { kind: 'retry'; params: SearchParams }
  | { kind: 'redirect'; reason: string; disclosures: string[] };

/** Tier-2 relax order — most-explicit user intent (highways) goes LAST. */
const AVOID_RELAX_ORDER: Array<[keyof ParsedConstraints['avoid'], string]> = [
  ['unpaved', 'avoid_unpaved'],
  ['tolls', 'avoid_toll'],
  ['ferries', 'avoid_ferry'],
  ['highways', 'avoid_highway'],
];

/**
 * Climb one rung. Rungs that do not apply to this request (e.g. no avoid set at
 * rung 4) fall through to the next rung in the SAME call — the ladder order is
 * strict but never wastes an attempt on a no-op.
 */
export function nextRelaxation(params: SearchParams): RelaxOutcome {
  const p: SearchParams = {
    ...params,
    avoid: { ...params.avoid },
    relaxedConstraints: [...params.relaxedConstraints],
    disclosures: [...params.disclosures],
  };

  while (p.rung <= 4) {
    switch (p.rung) {
      case 1: {
        p.rung = 2;
        p.tauMultiplier = Math.min(2, p.tauMultiplier * TAU_WIDEN_FACTOR);
        p.disclosures.push('widened the search area to find more options');
        return { kind: 'retry', params: p };
      }
      case 2: {
        p.rung = 3;
        const lowered = Math.max(THETA_FLOOR, p.thetaCurvy * THETA_LOWER_FACTOR);
        if (lowered < p.thetaCurvy) {
          p.thetaCurvy = lowered;
          p.disclosures.push('admitted gentler roads (lowered the twistiness bar)');
          return { kind: 'retry', params: p };
        }
        break; // already floored — fall through
      }
      case 3: {
        p.rung = 4;
        p.durationTolerance = RELAXED_DURATION_TOLERANCE;
        p.dropNiceToHaveStops = true;
        p.disclosures.push(
          'relaxed soft targets (wider duration band; optional stops may be dropped)',
        );
        return { kind: 'retry', params: p };
      }
      case 4: {
        const target = AVOID_RELAX_ORDER.find(([key]) => p.avoid[key]);
        if (target) {
          const [key, label] = target;
          p.avoid[key] = false;
          p.relaxedConstraints.push(label);
          p.disclosures.push(
            `RELAXED a hard constraint: ${label.replace('avoid_', 'no-')} could not be fully honoured — the route may include it (disclosed)`,
          );
          // stay on rung 4 — further avoid entries relax one per attempt
          return { kind: 'retry', params: p };
        }
        p.rung = 5;
        break;
      }
    }
  }

  return {
    kind: 'redirect',
    reason: 'no feasible route from this origin/brief within budget',
    disclosures: p.disclosures,
  };
}
