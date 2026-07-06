/**
 * Eval-harness record types (M4-T05; Protocol §19/§22).
 *
 * Every planner/baseline variant is normalized into `AttemptRecord`s — one per
 * (example, attempt) — and ALL metrics are pure functions over those records.
 * Denominator convention (§19): A = all attempts; P = attempts returning ANY
 * route; F = attempts returning a FEASIBLE route. Reliability metrics run over
 * A (failures/timeouts count); quality metrics run over P or F as stated —
 * never silently over successes.
 */

import type { Disposition, ParsedConstraints } from '@shared/types';

export interface RouteStats {
  duration_s: number;
  distance_m: number;
  /** Loop closure distance (m); null for A→B. */
  closureM: number | null;
  isLoop: boolean;
  selfOverlap: number;
  /** Chosen curvature formula's route value (C7 today; frozen at [GATE-C]). */
  curvature: number;
  /** Geometry continuity (legs join); false ⇒ a broken/gapped route. */
  connected: boolean;
  /** Required-stop accounting for requested_stop_coverage. */
  requiredStopsRequested: number;
  requiredStopsPresent: number;
}

export type AttemptOutcome =
  | 'feasible'
  | 'relaxed'
  | 'best_so_far'
  | 'redirect'
  | 'refused'
  | 'clarify'
  | 'timeout'
  | 'error';

export interface AttemptRecord {
  exampleId: string;
  configId: string;
  /** Parser output (null = parse crashed; scores 0 on its gold fields). */
  parsed: ParsedConstraints | null;
  disposition: Disposition | null;
  outcome: AttemptOutcome;
  /** The returned route, if ANY was returned (feasible or relaxed/best-so-far). */
  route: RouteStats | null;
  feasible: boolean;
  /** Distinct candidates presented (diversify kept). */
  presented: number;
  /** Mean pairwise (1 − edge_overlap) when presented ≥ 2; else null. */
  diversityPairwise: number | null;
  /** Tier-2 relaxations applied, each with its disclosure status. */
  relaxations: Array<{ name: string; disclosed: boolean }>;
  /** Constraint violations found by result-scan, with disclosure status. */
  violations: Array<{ tier: 1 | 2; name: string; disclosed: boolean }>;
  firstPassFeasible: boolean;
  correctionsApplied: number;
  correctionIntroducedViolation: boolean;
  /** Failed first pass but a correction/relaxation round made it feasible. */
  repairedToFeasible: boolean;
  generationTimeMs: number;
  routeEngineCalls: number | null;
  llmCalls: number;
  llmInvalidOutputs: number;
  costUsd: number;
}

/** One computed metric with its declared denominator (§19 honesty rule). */
export interface MetricValue {
  name: string;
  /** null when the denominator is empty — never NaN, never silently dropped. */
  value: number | null;
  denominator: 'A' | 'P' | 'F' | string;
  /** Size of the denominator population actually used. */
  n: number;
  detail?: string;
}
