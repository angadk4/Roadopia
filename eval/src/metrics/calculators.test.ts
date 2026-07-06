import type { ParsedConstraints } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { GoldLabel } from '../datasets/schema';
import type { AttemptRecord, RouteStats } from '../harness/types';

import {
  clarificationAppropriateness,
  computeAllMetrics,
  costMetrics,
  durationError,
  formatMetricTable,
  generationTime,
  goldConstraintSatisfaction,
  hardRelaxableDisclosureRate,
  parseAccuracy,
  PARSE_FIELDS,
  percentile,
  routeValidityRate,
  spearmanRho,
  timeoutRate,
  type GoldIndex,
} from './calculators';

/**
 * M4-T05 — metric calculators: the §19 denominator convention is the thing
 * under test. Reliability over A (failures count), quality over P/F, empty
 * denominators → null (never NaN), failed parses score 0 on their fields.
 */

function pc(overrides: Partial<ParsedConstraints> = {}): ParsedConstraints {
  return {
    origin: { lat: 43.2557, lng: -79.8711 },
    destination: null,
    shape: 'loop',
    duration_target_s: 5400,
    distance_target_m: null,
    stops: [],
    avoid: { highways: false, tolls: false, ferries: false, unpaved: false },
    surface_pref: 'any',
    character: [],
    scenic_pref: null,
    twistiness_pref: null,
    intensity: null,
    preset: null,
    weights: null,
    location_constraints: [],
    ambiguous_terms: [],
    missing: [],
    contradictions: [],
    confidence: { overall: 0.9, fields: {} },
    clarification: { needed: false, question: null },
    unsafe_flag: false,
    out_of_region_flag: false,
    prompt_injection_flag: false,
    ...overrides,
  } as ParsedConstraints;
}

function gold(overrides: Partial<ParsedConstraints> = {}): GoldLabel {
  return {
    constraints: pc(overrides),
    expected_disposition: 'proceed',
    acceptable_relaxations: [],
    rationale: 'test gold',
  };
}

function route(overrides: Partial<RouteStats> = {}): RouteStats {
  return {
    duration_s: 5400,
    distance_m: 70_000,
    closureM: 50,
    isLoop: true,
    selfOverlap: 0.05,
    curvature: 1.2,
    connected: true,
    requiredStopsRequested: 0,
    requiredStopsPresent: 0,
    ...overrides,
  };
}

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    exampleId: 'dev-001',
    configId: 'B6',
    parsed: pc(),
    disposition: 'proceed',
    outcome: 'feasible',
    route: route(),
    feasible: true,
    presented: 4,
    diversityPairwise: 0.7,
    relaxations: [],
    violations: [],
    firstPassFeasible: true,
    correctionsApplied: 0,
    correctionIntroducedViolation: false,
    repairedToFeasible: false,
    generationTimeMs: 1000,
    routeEngineCalls: 20,
    llmCalls: 0,
    llmInvalidOutputs: 0,
    costUsd: 0,
    ...overrides,
  };
}

describe('denominator honesty (§19)', () => {
  it('route_validity_rate runs over A — errors and timeouts count', () => {
    const records = [
      attempt(),
      attempt({ exampleId: 'dev-002', outcome: 'error', route: null, feasible: false }),
      attempt({ exampleId: 'dev-003', outcome: 'timeout', route: null, feasible: false }),
      attempt({ exampleId: 'dev-004', outcome: 'relaxed', feasible: false }),
    ];
    const m = routeValidityRate(records);
    expect(m.value).toBeCloseTo(1 / 4, 5);
    expect(m.denominator).toBe('A');
    expect(timeoutRate(records).value).toBeCloseTo(1 / 4, 5);
  });

  it('generation_time includes failures and timeouts (§19 failure rule)', () => {
    const records = [
      attempt({ generationTimeMs: 1000 }),
      attempt({ exampleId: 'dev-002', outcome: 'timeout', route: null, generationTimeMs: 25_000 }),
    ];
    const [meanMs] = generationTime(records);
    expect(meanMs!.value).toBeCloseTo(13_000, 5);
    expect(meanMs!.n).toBe(2);
  });

  it('quality metrics run over P only, and empty denominators yield null (never NaN)', () => {
    const noReturns = [attempt({ outcome: 'error', route: null, feasible: false })];
    const g: GoldIndex = { 'dev-001': gold() };
    for (const m of [...durationError(noReturns, g), ...goldConstraintSatisfaction(noReturns, g)]) {
      expect(m.value === null || Number.isFinite(m.value)).toBe(true);
    }
    expect(durationError(noReturns, g)[0]!.value).toBeNull();
  });

  it('cost_per_successful_route uses F while cost_per_attempt uses A', () => {
    const records = [
      attempt({ costUsd: 0.02 }),
      attempt({ exampleId: 'dev-002', costUsd: 0.02, feasible: false, outcome: 'relaxed' }),
    ];
    const [perAttempt, perSuccess] = costMetrics(records);
    expect(perAttempt!.value).toBeCloseTo(0.02, 5);
    expect(perSuccess!.value).toBeCloseTo(0.04, 5);
  });
});

describe('parse metrics', () => {
  it('a failed parse scores 0 for all of its gold fields', () => {
    const g: GoldIndex = { 'dev-001': gold(), 'dev-002': gold() };
    const records = [
      attempt(), // perfect parse
      attempt({ exampleId: 'dev-002', parsed: null }),
    ];
    const m = parseAccuracy(records, g);
    expect(m.value).toBeCloseTo(0.5, 5);
    expect(m.n).toBe(2 * PARSE_FIELDS.length);
  });

  it('duration matches within ±25 % tolerance, mismatches beyond it', () => {
    const g: GoldIndex = { 'dev-001': gold({ duration_target_s: 5400 }) };
    const close = parseAccuracy([attempt({ parsed: pc({ duration_target_s: 6000 }) })], g);
    const far = parseAccuracy([attempt({ parsed: pc({ duration_target_s: 10_800 }) })], g);
    expect(close.value!).toBeGreaterThan(far.value!);
    expect(close.value).toBeCloseTo(1, 5);
  });

  it('clarification_appropriateness penalizes over- AND under-asking', () => {
    const g: GoldIndex = {
      'dev-001': gold(), // should NOT ask
      'dev-002': {
        ...gold({ origin: null, missing: ['origin'] }),
        expected_disposition: 'clarify',
      },
    };
    // over-asks on dev-001, under-asks on dev-002 → 0 / 2
    const records = [
      attempt({
        parsed: pc({
          origin: null,
          missing: ['origin'],
          clarification: { needed: true, question: 'where from?' },
        }),
      }),
      attempt({ exampleId: 'dev-002', parsed: pc() }),
    ];
    const m = clarificationAppropriateness(records, g);
    expect(m.value).toBe(0);
    expect(m.n).toBe(2);
  });
});

describe('gold constraint satisfaction', () => {
  it('undisclosed Tier-2 violations reduce satisfaction; the A-companion scales by P/A', () => {
    const g: GoldIndex = {
      'dev-001': gold({ avoid: { highways: true, tolls: false, ferries: false, unpaved: false } }),
      'dev-002': gold({ avoid: { highways: true, tolls: false, ferries: false, unpaved: false } }),
    };
    const records = [
      attempt({ violations: [{ tier: 2, name: 'avoid_highway', disclosed: false }] }),
      attempt({ exampleId: 'dev-002', outcome: 'error', route: null, feasible: false }),
    ];
    const [sat, companion] = goldConstraintSatisfaction(records, g);
    // hard set = avoid_highway + shape; one violated undisclosed → 1/2
    expect(sat!.value).toBeCloseTo(0.5, 5);
    // P/A = 1/2 → companion = 0.25
    expect(companion!.value).toBeCloseTo(0.25, 5);
  });

  it('disclosure rate counts only disclosed relaxations', () => {
    const records = [
      attempt({
        relaxations: [
          { name: 'avoid_toll', disclosed: true },
          { name: 'avoid_highway', disclosed: false },
        ],
      }),
    ];
    expect(hardRelaxableDisclosureRate(records).value).toBeCloseTo(0.5, 5);
  });
});

describe('math utilities', () => {
  it('percentile is deterministic on small samples', () => {
    expect(percentile([3, 1, 2], 50)).toBe(2);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 90)).toBe(5);
  });

  it('spearmanRho detects monotone responsiveness ([GATE-W])', () => {
    expect(
      spearmanRho([
        [0.1, 0.5],
        [0.5, 1.1],
        [0.9, 2.2],
      ]),
    ).toBeCloseTo(1, 5);
    expect(
      spearmanRho([
        [0.1, 2.0],
        [0.9, 0.4],
      ]),
    ).toBeCloseTo(-1, 5);
    expect(spearmanRho([[1, 1]])).toBeNull();
  });
});

describe('report assembly', () => {
  it('computeAllMetrics returns every §19 family with declared denominators', () => {
    const g: GoldIndex = { 'dev-001': gold() };
    const metrics = computeAllMetrics([attempt()], g);
    const names = metrics.map((m) => m.name);
    for (const expected of [
      'parse_accuracy',
      'route_validity_rate',
      'gold_constraint_satisfaction',
      'hard_relaxable_disclosure_rate',
      'duration_pct_error_median',
      'loop_closure_rate',
      'retrace_ratio_median',
      'twistiness_hit_rate',
      'diversity_mean_pairwise',
      'repair_success',
      'cost_per_attempt_usd',
    ]) {
      expect(names).toContain(expected);
    }
    for (const m of metrics) {
      expect(m.denominator.length).toBeGreaterThan(0);
      expect(m.value === null || Number.isFinite(m.value)).toBe(true);
    }
    expect(formatMetricTable(metrics)).toContain('parse_accuracy');
  });
});
