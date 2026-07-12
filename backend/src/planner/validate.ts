/**
 * Deterministic feasibility gates (M3-T11; Protocol §3.6, Spec §33).
 *
 * A routed candidate passes/fails per-constraint with reasons:
 *   Tier 1 (inviolable): routable geometry sanity; loop closure within ε.
 *   Tier 2 (hard-relaxable): the avoid set — verified by RESULT-SCAN of the routed
 *     flags (BD-16 caveat: never trust request flags), each violation reported;
 *     required stops present or their absence reported.
 *   Tier 3 (soft): duration within ±DURATION_TOLERANCE; self-overlap sanity.
 * Feasibility is BINARY (Tier-1 pass AND every Tier-2 either satisfied or
 * explicitly disclosed-relaxed); soft misses annotate but do not fail (§3.6).
 */

import type { ParsedConstraints, RouteThroughOutput } from '@shared/types';

import { EPSILON_CLOSURE_M, SELF_OVERLAP_CAP } from './loop';

// frozen M4-T12 (was 0.1): p80 of the frozen config's |dur err| across DEV+VAL —
// §21 "the band where most feasible routes land"; misses beyond it disclose.
// The 0.1 bar failed routes the planner measurably cannot hit (BD-29: 8/9
// seeded failures were pure duration misses, unrepairable by any move).
export const DURATION_TOLERANCE_DEFAULT = 0.2;

export type ConstraintStatus = 'satisfied' | 'violated' | 'relaxed' | 'not_applicable';

export interface ConstraintResult {
  constraint: string;
  tier: 1 | 2 | 3;
  status: ConstraintStatus;
  detail: string;
}

export interface ValidationInput {
  route: RouteThroughOutput;
  constraints: ParsedConstraints;
  /** Loop closure distance (m) from assembly; null for A→B. */
  closureM: number | null;
  selfOverlap: number;
  /** Spot ids actually included in the candidate vs requested count. */
  includedStops: number;
  requestedStops: number;
  /** Tier-2 constraints the relaxation ladder has already relaxed (disclosed). */
  relaxedConstraints?: string[];
}

export interface ValidationVerdict {
  feasible: boolean;
  results: ConstraintResult[];
}

/** Run every gate; feasible = all Tier-1 satisfied AND no un-relaxed Tier-2 violation. */
export function validateCandidate(
  input: ValidationInput,
  {
    durationTolerance = DURATION_TOLERANCE_DEFAULT,
    epsilonM = EPSILON_CLOSURE_M,
    selfOverlapCap = SELF_OVERLAP_CAP,
  }: {
    durationTolerance?: number;
    epsilonM?: number;
    selfOverlapCap?: number;
  } = {},
): ValidationVerdict {
  const { route, constraints, closureM, selfOverlap } = input;
  const relaxed = new Set(input.relaxedConstraints ?? []);
  const results: ConstraintResult[] = [];

  // --- Tier 1: routable + sane geometry ---
  const routable = route.geometry.coordinates.length >= 2 && route.distance_m > 0;
  results.push({
    constraint: 'routable',
    tier: 1,
    status: routable ? 'satisfied' : 'violated',
    detail: routable ? `${Math.round(route.distance_m)} m routed` : 'empty or zero-length geometry',
  });

  // --- Tier 1: loop closure ---
  if (constraints.shape === 'loop') {
    const closes = closureM !== null && closureM <= epsilonM;
    results.push({
      constraint: 'loop_closure',
      tier: 1,
      status: closes ? 'satisfied' : 'violated',
      detail:
        closureM === null
          ? 'no closure measurement'
          : `closure ${Math.round(closureM)} m (ε ${epsilonM} m)`,
    });
  }

  // --- Tier 2: avoid set (RESULT-SCAN of routed flags — BD-16) ---
  const scans: Array<[keyof ParsedConstraints['avoid'], boolean, string]> = [
    ['highways', route.has_highway, 'highway'],
    ['tolls', route.has_toll, 'toll'],
    ['ferries', route.has_ferry, 'ferry'],
    ['unpaved', route.has_unpaved, 'unpaved'],
  ];
  for (const [key, present, label] of scans) {
    if (!constraints.avoid[key]) {
      results.push({
        constraint: `avoid_${label}`,
        tier: 2,
        status: 'not_applicable',
        detail: 'not requested',
      });
      continue;
    }
    const status: ConstraintStatus = present
      ? relaxed.has(`avoid_${label}`)
        ? 'relaxed'
        : 'violated'
      : 'satisfied';
    results.push({
      constraint: `avoid_${label}`,
      tier: 2,
      status,
      detail: present
        ? status === 'relaxed'
          ? `${label} present — relaxed with disclosure`
          : `route contains ${label} despite avoid request (result-scan)`
        : `no ${label} in routed result`,
    });
  }

  // --- Tier 2: required stops present or absence reported ---
  const requiredRequested = constraints.stops.some((s) => s.importance === 'required');
  if (input.requestedStops > 0) {
    const covered = input.includedStops >= input.requestedStops;
    const status: ConstraintStatus = covered
      ? 'satisfied'
      : requiredRequested && !relaxed.has('stops')
        ? 'violated'
        : 'relaxed';
    results.push({
      constraint: 'stops',
      tier: 2,
      status,
      detail: `${input.includedStops}/${input.requestedStops} requested stops included`,
    });
  }

  // --- Tier 3 (soft): duration band ---
  if (constraints.duration_target_s !== null) {
    const err =
      Math.abs(route.duration_s - constraints.duration_target_s) / constraints.duration_target_s;
    results.push({
      constraint: 'duration',
      tier: 3,
      status: err <= durationTolerance ? 'satisfied' : 'relaxed',
      detail: `duration ${Math.round(route.duration_s)} s vs target ${constraints.duration_target_s} s (${(err * 100).toFixed(0)} % err, tol ${durationTolerance * 100} %)`,
    });
  }

  // --- Tier 3 (soft-ish sanity): self-overlap ---
  results.push({
    constraint: 'self_overlap',
    tier: 3,
    status: selfOverlap <= selfOverlapCap ? 'satisfied' : 'relaxed',
    detail: `self_overlap ${selfOverlap.toFixed(2)} (cap ${selfOverlapCap})`,
  });

  const feasible =
    results.filter((r) => r.tier === 1).every((r) => r.status === 'satisfied') &&
    results.filter((r) => r.tier === 2).every((r) => r.status !== 'violated');

  return { feasible, results };
}
