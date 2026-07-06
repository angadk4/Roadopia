/**
 * §19 metric calculators (M4-T05) — pure functions over AttemptRecords + gold.
 *
 * Every calculator states its denominator explicitly and returns `value: null`
 * on an empty denominator (never NaN, never a silent success-only average).
 * Reliability → A; quality → P/F; specialized denominators named in-line.
 */

import type { LatLng, ParsedConstraints } from '@shared/types';

import type { GoldLabel, RequestExample } from '../datasets/schema';
import type { AttemptRecord, MetricValue } from '../harness/types';

export const DURATION_TOLERANCE_FRACTION = 0.25;
export const NUMERIC_PREF_TOLERANCE = 0.25;
export const CLOSURE_EPSILON_M = 300;
export const EXCESSIVE_RETRACE_CAP = 0.3;
export const THETA_TWISTY_HIT = 0.6;

// --- helpers -----------------------------------------------------------------

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
}

/** Spearman rank correlation (average-rank ties) — [GATE-W] responsiveness. */
export function spearmanRho(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 2) return null;
  const rank = (vals: number[]): number[] => {
    const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const ranks = new Array<number>(n);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k]![1]] = avg;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(pairs.map((p) => p[0]));
  const ry = rank(pairs.map((p) => p[1]));
  const mx = mean(rx)!;
  const my = mean(ry)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let k = 0; k < n; k++) {
    num += (rx[k]! - mx) * (ry[k]! - my);
    dx += (rx[k]! - mx) ** 2;
    dy += (ry[k]! - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

const P = (records: AttemptRecord[]) => records.filter((r) => r.route !== null);
const F = (records: AttemptRecord[]) => records.filter((r) => r.feasible);

// --- parse metrics (over A; gold-based) ---------------------------------------

type FieldCheck = { name: string; match: (p: ParsedConstraints, g: ParsedConstraints) => boolean };

const near = (a: number | null, b: number | null, tol: number): boolean => {
  if (a === null || b === null) return a === b;
  const base = Math.max(Math.abs(b), 1e-9);
  return Math.abs(a - b) / base <= tol;
};
const latLngEq = (a: unknown, b: unknown): boolean => {
  const isPt = (x: unknown): x is LatLng =>
    typeof x === 'object' && x !== null && 'lat' in x && 'lng' in x;
  if (isPt(a) && isPt(b)) return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return a === b || (a === null && b === null);
};
const stopsEq = (p: ParsedConstraints, g: ParsedConstraints): boolean => {
  const key = (s: ParsedConstraints['stops'][number]) => `${s.type}|${s.count}|${s.importance}`;
  const ps = p.stops.map(key).sort();
  const gs = g.stops.map(key).sort();
  return ps.length === gs.length && ps.every((v, i) => v === gs[i]);
};

/** The scored gold field set (§7.4 parse gold) — 19 fields per example. */
export const PARSE_FIELDS: FieldCheck[] = [
  { name: 'shape', match: (p, g) => p.shape === g.shape },
  { name: 'origin', match: (p, g) => latLngEq(p.origin, g.origin) },
  { name: 'destination', match: (p, g) => latLngEq(p.destination, g.destination) },
  {
    name: 'duration_target_s',
    match: (p, g) => near(p.duration_target_s, g.duration_target_s, DURATION_TOLERANCE_FRACTION),
  },
  {
    name: 'distance_target_m',
    match: (p, g) => near(p.distance_target_m, g.distance_target_m, DURATION_TOLERANCE_FRACTION),
  },
  { name: 'stops', match: stopsEq },
  { name: 'avoid.highways', match: (p, g) => p.avoid.highways === g.avoid.highways },
  { name: 'avoid.tolls', match: (p, g) => p.avoid.tolls === g.avoid.tolls },
  { name: 'avoid.ferries', match: (p, g) => p.avoid.ferries === g.avoid.ferries },
  { name: 'avoid.unpaved', match: (p, g) => p.avoid.unpaved === g.avoid.unpaved },
  { name: 'surface_pref', match: (p, g) => p.surface_pref === g.surface_pref },
  { name: 'intensity', match: (p, g) => p.intensity === g.intensity },
  { name: 'preset', match: (p, g) => p.preset === g.preset },
  {
    name: 'twistiness_pref',
    match: (p, g) => near(p.twistiness_pref, g.twistiness_pref, NUMERIC_PREF_TOLERANCE),
  },
  {
    name: 'scenic_pref',
    match: (p, g) => near(p.scenic_pref, g.scenic_pref, NUMERIC_PREF_TOLERANCE),
  },
  { name: 'unsafe_flag', match: (p, g) => p.unsafe_flag === g.unsafe_flag },
  { name: 'out_of_region_flag', match: (p, g) => p.out_of_region_flag === g.out_of_region_flag },
  {
    name: 'prompt_injection_flag',
    match: (p, g) => p.prompt_injection_flag === g.prompt_injection_flag,
  },
  {
    name: 'clarification.needed',
    match: (p, g) => p.clarification.needed === g.clarification.needed,
  },
];

export interface GoldIndex {
  [exampleId: string]: GoldLabel;
}

export function goldIndexOf(examples: RequestExample[]): GoldIndex {
  const idx: GoldIndex = {};
  for (const e of examples) if (e.gold) idx[e.id] = e.gold;
  return idx;
}

/** parse_accuracy: matched gold fields / total gold fields, micro-avg over A. */
export function parseAccuracy(records: AttemptRecord[], gold: GoldIndex): MetricValue {
  let matched = 0;
  let total = 0;
  for (const r of records) {
    const g = gold[r.exampleId];
    if (!g) continue;
    total += PARSE_FIELDS.length;
    if (r.parsed === null) continue; // failed parse scores 0 for its fields
    for (const f of PARSE_FIELDS) if (f.match(r.parsed, g.constraints)) matched++;
  }
  return {
    name: 'parse_accuracy',
    value: total === 0 ? null : matched / total,
    denominator: 'A (gold fields; failed parse = 0)',
    n: total,
  };
}

/** clarification_appropriateness: correct asks / (asked + should-have-asked). */
export function clarificationAppropriateness(
  records: AttemptRecord[],
  gold: GoldIndex,
): MetricValue {
  let correct = 0;
  let denom = 0;
  for (const r of records) {
    const g = gold[r.exampleId];
    if (!g) continue;
    const shouldAsk = g.expected_disposition === 'clarify';
    const asked = r.parsed?.clarification.needed === true;
    if (asked || shouldAsk) {
      denom++;
      if (asked && shouldAsk) correct++;
    }
  }
  return {
    name: 'clarification_appropriateness',
    value: denom === 0 ? null : correct / denom,
    denominator: 'asked + should-have-asked, over A',
    n: denom,
  };
}

/** disposition_accuracy (§7.4 outcome gold): resolved disposition vs expected. */
export function dispositionAccuracy(records: AttemptRecord[], gold: GoldIndex): MetricValue {
  let correct = 0;
  let denom = 0;
  for (const r of records) {
    const g = gold[r.exampleId];
    if (!g) continue;
    denom++;
    const actual =
      r.disposition ?? (r.outcome === 'refused' ? 'refuse_unsafe' : (r.outcome as string));
    const expected =
      g.expected_disposition === 'proceed' ? 'proceed' : (g.expected_disposition as string);
    if (
      (expected === 'proceed' && actual === 'proceed') ||
      (expected !== 'proceed' && actual === expected)
    ) {
      correct++;
    }
  }
  return {
    name: 'disposition_accuracy',
    value: denom === 0 ? null : correct / denom,
    denominator: 'A (gold-labeled)',
    n: denom,
  };
}

// --- reliability metrics (over A) ---------------------------------------------

export function routeValidityRate(records: AttemptRecord[]): MetricValue {
  const n = records.length;
  return {
    name: 'route_validity_rate',
    value: n === 0 ? null : F(records).length / n,
    denominator: 'A',
    n,
  };
}

export function firstPassFeasibility(records: AttemptRecord[]): MetricValue {
  const n = records.length;
  return {
    name: 'first_pass_feasibility',
    value: n === 0 ? null : records.filter((r) => r.firstPassFeasible).length / n,
    denominator: 'A',
    n,
  };
}

export function fallbackRate(records: AttemptRecord[]): MetricValue {
  const n = records.length;
  const fb = records.filter((r) => r.outcome === 'best_so_far' || r.outcome === 'redirect').length;
  return { name: 'fallback_rate', value: n === 0 ? null : fb / n, denominator: 'A', n };
}

export function timeoutRate(records: AttemptRecord[]): MetricValue {
  const n = records.length;
  return {
    name: 'timeout_rate',
    value: n === 0 ? null : records.filter((r) => r.outcome === 'timeout').length / n,
    denominator: 'A',
    n,
  };
}

/** generation_time mean/p90/p99 — failures and timeouts INCLUDED (§19). */
export function generationTime(records: AttemptRecord[]): MetricValue[] {
  const times = records.map((r) => r.generationTimeMs);
  return [
    { name: 'generation_time_mean_ms', value: mean(times), denominator: 'A', n: times.length },
    {
      name: 'generation_time_p90_ms',
      value: percentile(times, 90),
      denominator: 'A',
      n: times.length,
    },
    {
      name: 'generation_time_p99_ms',
      value: percentile(times, 99),
      denominator: 'A',
      n: times.length,
    },
  ];
}

export function costMetrics(records: AttemptRecord[]): MetricValue[] {
  const total = records.reduce((s, r) => s + r.costUsd, 0);
  const nA = records.length;
  const nF = F(records).length;
  const llmCalls = records.reduce((s, r) => s + r.llmCalls, 0);
  const invalid = records.reduce((s, r) => s + r.llmInvalidOutputs, 0);
  return [
    { name: 'cost_per_attempt_usd', value: nA === 0 ? null : total / nA, denominator: 'A', n: nA },
    {
      name: 'cost_per_successful_route_usd',
      value: nF === 0 ? null : total / nF,
      denominator: 'F',
      n: nF,
    },
    {
      name: 'invalid_model_output_rate',
      value: llmCalls === 0 ? null : invalid / llmCalls,
      denominator: 'LLM calls',
      n: llmCalls,
    },
  ];
}

export function routeEngineCalls(records: AttemptRecord[]): MetricValue[] {
  const vals = records.map((r) => r.routeEngineCalls).filter((v): v is number => v !== null);
  return [
    {
      name: 'route_engine_calls_mean',
      value: mean(vals),
      denominator: 'A (instrumented)',
      n: vals.length,
    },
    {
      name: 'route_engine_calls_p90',
      value: percentile(vals, 90),
      denominator: 'A (instrumented)',
      n: vals.length,
    },
  ];
}

// --- quality metrics (over P/F) -------------------------------------------------

/** gold_constraint_satisfaction over P + the A-based satisfied-and-returned. */
export function goldConstraintSatisfaction(
  records: AttemptRecord[],
  gold: GoldIndex,
): MetricValue[] {
  const returned = P(records).filter((r) => gold[r.exampleId]);
  const perExample: number[] = [];
  for (const r of returned) {
    const g = gold[r.exampleId]!;
    const hard: string[] = [];
    if (g.constraints.avoid.highways) hard.push('avoid_highway');
    if (g.constraints.avoid.tolls) hard.push('avoid_toll');
    if (g.constraints.avoid.ferries) hard.push('avoid_ferry');
    if (g.constraints.avoid.unpaved) hard.push('avoid_unpaved');
    for (const s of g.constraints.stops) {
      if (s.importance === 'required') hard.push(`stop_${s.type}`);
    }
    hard.push('shape');
    const violated = new Set(
      r.violations.filter((v) => v.tier === 2 && !v.disclosed).map((v) => v.name),
    );
    const satisfied = hard.filter((h) => !violated.has(h)).length;
    perExample.push(hard.length === 0 ? 1 : satisfied / hard.length);
  }
  const sat = mean(perExample);
  const nA = records.filter((r) => gold[r.exampleId]).length;
  return [
    {
      name: 'gold_constraint_satisfaction',
      value: sat,
      denominator: 'P (gold-labeled)',
      n: perExample.length,
    },
    {
      name: 'gold_satisfied_and_returned',
      value: sat === null || nA === 0 ? null : (perExample.length / nA) * sat,
      denominator: 'A (P/A × satisfaction)',
      n: nA,
    },
  ];
}

/** hard_constraint_satisfaction: returns with ZERO undisclosed Tier-2 violations. */
export function hardConstraintSatisfaction(records: AttemptRecord[]): MetricValue {
  const returned = P(records);
  const clean = returned.filter(
    (r) => !r.violations.some((v) => v.tier === 2 && !v.disclosed),
  ).length;
  return {
    name: 'hard_constraint_satisfaction',
    value: returned.length === 0 ? null : clean / returned.length,
    denominator: 'P',
    n: returned.length,
  };
}

export function hardRelaxableDisclosureRate(records: AttemptRecord[]): MetricValue {
  const relaxed = records.flatMap((r) => r.relaxations);
  return {
    name: 'hard_relaxable_disclosure_rate',
    value: relaxed.length === 0 ? null : relaxed.filter((x) => x.disclosed).length / relaxed.length,
    denominator: 'relaxations applied',
    n: relaxed.length,
  };
}

export function durationError(records: AttemptRecord[], gold: GoldIndex): MetricValue[] {
  const errs: number[] = [];
  for (const r of P(records)) {
    const target = gold[r.exampleId]?.constraints.duration_target_s ?? null;
    if (target === null || r.route === null) continue;
    errs.push(Math.abs(r.route.duration_s - target) / target);
  }
  return [
    {
      name: 'duration_pct_error_median',
      value: percentile(errs, 50),
      denominator: 'P (with duration target)',
      n: errs.length,
    },
    {
      name: 'duration_pct_error_p90',
      value: percentile(errs, 90),
      denominator: 'P (with duration target)',
      n: errs.length,
    },
  ];
}

export function loopClosure(records: AttemptRecord[]): MetricValue[] {
  const loops = P(records).filter((r) => r.route!.isLoop && r.route!.closureM !== null);
  const dists = loops.map((r) => r.route!.closureM!);
  const within = loops.filter((r) => r.route!.closureM! <= CLOSURE_EPSILON_M).length;
  return [
    {
      name: 'loop_closure_distance_median_m',
      value: percentile(dists, 50),
      denominator: 'loop returns in P',
      n: loops.length,
    },
    {
      name: 'loop_closure_rate',
      value: loops.length === 0 ? null : within / loops.length,
      denominator: 'loop returns in P',
      n: loops.length,
    },
  ];
}

export function retrace(records: AttemptRecord[]): MetricValue[] {
  const returned = P(records);
  const ratios = returned.map((r) => r.route!.selfOverlap);
  const excessive = returned.filter((r) => r.route!.selfOverlap > EXCESSIVE_RETRACE_CAP).length;
  return [
    {
      name: 'retrace_ratio_median',
      value: percentile(ratios, 50),
      denominator: 'P',
      n: returned.length,
    },
    {
      name: 'retrace_ratio_p90',
      value: percentile(ratios, 90),
      denominator: 'P',
      n: returned.length,
    },
    {
      name: 'excessive_retrace_rate',
      value: returned.length === 0 ? null : excessive / returned.length,
      denominator: 'P',
      n: returned.length,
    },
  ];
}

export function requestedStopCoverage(records: AttemptRecord[]): MetricValue {
  const withStops = P(records).filter((r) => r.route!.requiredStopsRequested > 0);
  const fracs = withStops.map(
    (r) => r.route!.requiredStopsPresent / r.route!.requiredStopsRequested,
  );
  return {
    name: 'requested_stop_coverage',
    value: mean(fracs),
    denominator: 'P (with required stops)',
    n: withStops.length,
  };
}

export function twistinessHitRate(records: AttemptRecord[], gold: GoldIndex): MetricValue {
  const twistyAsks = P(records).filter(
    (r) => (gold[r.exampleId]?.constraints.twistiness_pref ?? 0) >= 0.5,
  );
  const hits = twistyAsks.filter((r) => r.route!.curvature >= THETA_TWISTY_HIT).length;
  return {
    name: 'twistiness_hit_rate',
    value: twistyAsks.length === 0 ? null : hits / twistyAsks.length,
    denominator: 'P (twisty requests)',
    n: twistyAsks.length,
  };
}

export function connectedRouteRate(records: AttemptRecord[]): MetricValue {
  const returned = P(records);
  return {
    name: 'connected_route_rate',
    value:
      returned.length === 0
        ? null
        : returned.filter((r) => r.route!.connected).length / returned.length,
    denominator: 'P',
    n: returned.length,
  };
}

export function diversity(records: AttemptRecord[]): MetricValue {
  const multi = records.filter((r) => r.presented >= 2 && r.diversityPairwise !== null);
  return {
    name: 'diversity_mean_pairwise',
    value: mean(multi.map((r) => r.diversityPairwise!)),
    denominator: 'generations presenting ≥2',
    n: multi.length,
  };
}

// --- correction metrics ---------------------------------------------------------

export function correctionMetrics(records: AttemptRecord[]): MetricValue[] {
  const failedFirst = records.filter((r) => !r.firstPassFeasible);
  const repaired = failedFirst.filter((r) => r.repairedToFeasible);
  const efficacious = repaired.filter((r) => !r.correctionIntroducedViolation);
  const corrections = records.filter((r) => r.correctionsApplied > 0);
  const newViol = corrections.filter((r) => r.correctionIntroducedViolation);
  return [
    {
      name: 'repair_success',
      value: failedFirst.length === 0 ? null : repaired.length / failedFirst.length,
      denominator: 'failed-first-pass attempts',
      n: failedFirst.length,
    },
    {
      name: 'self_correction_efficacy',
      value: failedFirst.length === 0 ? null : efficacious.length / failedFirst.length,
      denominator: 'failed-first-pass attempts',
      n: failedFirst.length,
    },
    {
      name: 'new_violation_rate_after_correction',
      value: corrections.length === 0 ? null : newViol.length / corrections.length,
      denominator: 'corrections applied',
      n: corrections.length,
    },
  ];
}

// --- report assembly --------------------------------------------------------------

export function computeAllMetrics(records: AttemptRecord[], gold: GoldIndex): MetricValue[] {
  return [
    parseAccuracy(records, gold),
    clarificationAppropriateness(records, gold),
    dispositionAccuracy(records, gold),
    routeValidityRate(records),
    firstPassFeasibility(records),
    fallbackRate(records),
    timeoutRate(records),
    ...generationTime(records),
    ...costMetrics(records),
    ...routeEngineCalls(records),
    ...goldConstraintSatisfaction(records, gold),
    hardConstraintSatisfaction(records),
    hardRelaxableDisclosureRate(records),
    ...durationError(records, gold),
    ...loopClosure(records),
    ...retrace(records),
    requestedStopCoverage(records),
    twistinessHitRate(records, gold),
    connectedRouteRate(records),
    diversity(records),
    ...correctionMetrics(records),
  ];
}

/** Render a fixed-width report table (name · value · denominator · n). */
export function formatMetricTable(metrics: MetricValue[]): string {
  const lines = ['metric'.padEnd(38) + 'value'.padEnd(10) + 'n'.padEnd(7) + 'denominator'];
  lines.push('-'.repeat(90));
  for (const m of metrics) {
    const v = m.value === null ? '—' : m.value.toFixed(3);
    lines.push(m.name.padEnd(38) + v.padEnd(10) + String(m.n).padEnd(7) + m.denominator);
  }
  return lines.join('\n');
}
