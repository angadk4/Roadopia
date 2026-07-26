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
  /** R18-2 rung 5: loop-quality assembly caps loosened (with disclosure) —
   *  the last resort before redirect; run.ts maps it to RELAXED_ASSEMBLY_CAPS. */
  assemblyRelax: boolean;
  /** R25-U3: avoid.highways was IMPOSED by the fun profile, not asked by the
   *  user — rung 4's disclosure wording differs (product rule vs user ask). */
  imposedHighways?: boolean;
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
    assemblyRelax: false,
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

/** Pool telemetry from the just-finished iteration (R18-2 fast-forward). */
export interface LadderTelemetry {
  /** Candidates that survived assembly this iteration. */
  assembledCount?: number;
}

/**
 * Climb one rung. Rungs that do not apply to this request (e.g. no avoid set at
 * rung 4) fall through to the next rung in the SAME call — the ladder order is
 * strict but never wastes an attempt on a no-op.
 *
 * R18-2 FAST-FORWARD: when the finished iteration assembled ZERO candidates
 * (pure Wall-A death — lakeshore grids, funnel towns) and at least one
 * τ-widen has been tried, rungs 2-4 cannot help (they tune retrieval and
 * validation, never the assembly caps that killed everything) — jump straight
 * to the assembly-relax rung.
 */
export function nextRelaxation(params: SearchParams, telemetry?: LadderTelemetry): RelaxOutcome {
  const p: SearchParams = {
    ...params,
    avoid: { ...params.avoid },
    relaxedConstraints: [...params.relaxedConstraints],
    disclosures: [...params.disclosures],
  };

  // R25-U3 fix: the fast-forward used to jump straight to rung 5, SKIPPING
  // rung 4 — but rung 4 changes the COSTING (the avoid set reaches Valhalla),
  // so it genuinely changes which routes exist, exactly like rung 5. A
  // highway-locked region whose every assembly died could never shed its
  // avoid. Jump to 4 while any avoid is still set; 5 otherwise.
  if (telemetry?.assembledCount === 0 && p.rung >= 2 && !p.assemblyRelax) {
    const avoidPending = AVOID_RELAX_ORDER.some(([key]) => p.avoid[key]);
    p.rung = avoidPending && p.rung < 4 ? 4 : 5;
  }

  while (p.rung <= 5) {
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
          // R25-U3: an IMPOSED no-highway rule (the fun profile's, not the
          // user's) relaxes with product-rule wording, not broken-promise
          // wording — the user never asked, so nothing they asked was broken.
          p.disclosures.push(
            key === 'highways' && p.imposedHighways === true
              ? 'this area has no non-highway route at this length — the drive includes a stretch of highway (shown honestly)'
              : `RELAXED a hard constraint: ${label.replace('avoid_', 'no-')} could not be fully honoured — the route may include it (disclosed)`,
          );
          // stay on rung 4 — further avoid entries relax one per attempt
          return { kind: 'retry', params: p };
        }
        p.rung = 5;
        break;
      }
      case 5: {
        p.rung = 6;
        if (!p.assemblyRelax) {
          p.assemblyRelax = true;
          p.disclosures.push(
            'loosened loop-quality limits — the roads here force some repeated pavement',
          );
          return { kind: 'retry', params: p };
        }
        break; // already relaxed — nothing left
      }
    }
  }

  return {
    kind: 'redirect',
    reason: 'no feasible route from this origin/brief within budget',
    disclosures: p.disclosures,
  };
}
