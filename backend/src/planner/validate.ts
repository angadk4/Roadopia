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

import type {
  ConstraintResult,
  ConstraintStatus,
  ParsedConstraints,
  RouteThroughOutput,
} from '@shared/types';

import { EPSILON_CLOSURE_M, SELF_OVERLAP_CAP } from './loop';
import type { ResolvedStop, StopCoverage } from './stops';

// frozen M4-T12 (was 0.1): p80 of the frozen config's |dur err| across DEV+VAL —
// §21 "the band where most feasible routes land"; misses beyond it disclose.
// The 0.1 bar failed routes the planner measurably cannot hit (BD-29: 8/9
// seeded failures were pure duration misses, unrepairable by any move).
export const DURATION_TOLERANCE_DEFAULT = 0.2;

// R16-3: a fraction-timed stop ("coffee midway") is satisfied when its measured
// arrival lands within ±20 % of total duration of the asked fraction — the chip
// vocabulary (0.25/0.5/0.75) makes neighbouring chips just-distinguishable at
// this width. Soft (Tier 3): misses disclose the actual %, never fail the route.
export const STOP_TIMING_TOLERANCE = 0.2;

// Single source of truth moved to shared at M7-T05 (the client constraints
// panel renders these rows); re-exported so existing backend imports hold.
export type { ConstraintResult, ConstraintStatus } from '@shared/types';

export interface ValidationInput {
  route: RouteThroughOutput;
  constraints: ParsedConstraints;
  /** Loop closure distance (m) from assembly; null for A→B. */
  closureM: number | null;
  selfOverlap: number;
  /** Per-type request-vs-included tally (R16-3; replaces the scalar counts —
   *  a missing required fuel stop must not hide behind a covered coffee). */
  stopCoverage: StopCoverage[];
  /** The candidate's stops with measured arrivals (timing verdicts). */
  stops: ResolvedStop[];
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

  // --- Tier 2: required stops present or absence reported — PER TYPE (R16-3;
  // the old scalar gate let a covered coffee hide a missing required fuel) ---
  for (const c of input.stopCoverage) {
    if (c.requested <= 0) continue;
    const key = `stop_${c.type}`;
    const covered = c.included >= c.requested;
    const status: ConstraintStatus = covered
      ? 'satisfied'
      : c.importance === 'required' && !relaxed.has(key) && !relaxed.has('stops')
        ? 'violated'
        : 'relaxed';
    results.push({
      constraint: key,
      tier: 2,
      status,
      detail: `${c.included}/${c.requested} requested ${c.type} stops included`,
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

  // --- Tier 3 (soft): fraction-timed stop arrivals (R16-3) ---
  // Verified against MEASURED per-leg arrivals (break_through legs) — never a
  // geometric estimate. Unmeasured arrivals disclose honestly as relaxed.
  const nthOfType = new Map<string, number>();
  for (const s of input.stops) {
    if (s.atFraction === null) continue;
    const nth = (nthOfType.get(s.requestedType) ?? 0) + 1;
    nthOfType.set(s.requestedType, nth);
    const key =
      nth === 1 ? `stop_timing_${s.requestedType}` : `stop_timing_${s.requestedType}_${nth}`;
    if (s.arrivalS === null || route.duration_s <= 0) {
      results.push({
        constraint: key,
        tier: 3,
        status: 'relaxed',
        detail: `${s.name}: arrival unmeasured — timing not verifiable`,
      });
      continue;
    }
    const actual = s.arrivalS / route.duration_s;
    const off = Math.abs(actual - s.atFraction);
    results.push({
      constraint: key,
      tier: 3,
      status: off <= STOP_TIMING_TOLERANCE ? 'satisfied' : 'relaxed',
      detail: `${s.name} at ${(actual * 100).toFixed(0)} % of the drive (asked ${(
        s.atFraction * 100
      ).toFixed(0)} %, tol ±${STOP_TIMING_TOLERANCE * 100} %)`,
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
