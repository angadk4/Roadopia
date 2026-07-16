import type { ParsedConstraints, RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { validateCandidate } from './validate';

/**
 * M3-T11 — feasibility gates on labeled candidates. The headline AC: a
 * highway-containing route on a no-highway request is FLAGGED (result-scan,
 * BD-16 — request flags are never trusted); a clean route passes.
 */

function route(over: Partial<RouteThroughOutput> = {}): RouteThroughOutput {
  return {
    geometry: {
      type: 'LineString',
      coordinates: [
        [-79.9, 43.2],
        [-79.85, 43.23],
        [-79.8, 43.25],
      ],
    },
    distance_m: 42_000,
    duration_s: 5300,
    legs: [],
    maneuvers: [{ type: 'start', instruction: 'go' }],
    has_highway: false,
    has_toll: false,
    has_ferry: false,
    has_unpaved: false,
    ...over,
  };
}

function constraints(over: Partial<ParsedConstraints> = {}): ParsedConstraints {
  return {
    origin: { lat: 43.2557, lng: -79.8711 },
    destination: null,
    shape: 'loop',
    duration_target_s: 5400,
    distance_target_m: null,
    stops: [],
    avoid: { highways: true, tolls: false, ferries: false, unpaved: false },
    surface_pref: 'any',
    character: ['twisty'],
    scenic_pref: null,
    twistiness_pref: 0.7,
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
    ...over,
  };
}

const base = {
  closureM: 120,
  selfOverlap: 0.05,
  stopCoverage: [],
  stops: [],
};

describe('validateCandidate (M3-T11)', () => {
  it('passes a clean loop (AC)', () => {
    const v = validateCandidate({ route: route(), constraints: constraints(), ...base });
    expect(v.feasible).toBe(true);
    expect(v.results.find((r) => r.constraint === 'avoid_highway')!.status).toBe('satisfied');
    expect(v.results.find((r) => r.constraint === 'loop_closure')!.status).toBe('satisfied');
  });

  it('FLAGS a highway-containing route on a no-highway request (result-scan AC)', () => {
    const v = validateCandidate({
      route: route({ has_highway: true }),
      constraints: constraints(),
      ...base,
    });
    expect(v.feasible).toBe(false);
    const hw = v.results.find((r) => r.constraint === 'avoid_highway')!;
    expect(hw.status).toBe('violated');
    expect(hw.detail).toMatch(/result-scan/);
  });

  it('the same violation counts as RELAXED (feasible) once disclosed by the ladder', () => {
    const v = validateCandidate({
      route: route({ has_highway: true }),
      constraints: constraints(),
      ...base,
      relaxedConstraints: ['avoid_highway'],
    });
    expect(v.feasible).toBe(true);
    expect(v.results.find((r) => r.constraint === 'avoid_highway')!.status).toBe('relaxed');
  });

  it('loop closure beyond ε is a Tier-1 violation (infeasible)', () => {
    const v = validateCandidate({
      route: route(),
      constraints: constraints(),
      ...base,
      closureM: 900,
    });
    expect(v.feasible).toBe(false);
    expect(v.results.find((r) => r.constraint === 'loop_closure')!.status).toBe('violated');
  });

  it('missing REQUIRED stops violate; nice-to-have missing = relaxed note', () => {
    const required = validateCandidate({
      route: route(),
      constraints: constraints({
        stops: [{ type: 'coffee', count: 1, importance: 'required', at_fraction: null }],
      }),
      ...base,
      stopCoverage: [{ type: 'coffee', importance: 'required', requested: 1, included: 0 }],
    });
    expect(required.feasible).toBe(false);
    expect(required.results.find((r) => r.constraint === 'stop_coffee')!.status).toBe('violated');

    const nice = validateCandidate({
      route: route(),
      constraints: constraints({
        stops: [{ type: 'coffee', count: 1, importance: 'nice_to_have', at_fraction: null }],
      }),
      ...base,
      stopCoverage: [{ type: 'coffee', importance: 'nice_to_have', requested: 1, included: 0 }],
    });
    expect(nice.feasible).toBe(true);
    expect(nice.results.find((r) => r.constraint === 'stop_coffee')!.status).toBe('relaxed');
  });

  it('per-type gates: a covered coffee cannot hide a missing required fuel (R16-3)', () => {
    const v = validateCandidate({
      route: route(),
      constraints: constraints({
        stops: [
          { type: 'coffee', count: 1, importance: 'required', at_fraction: null },
          { type: 'fuel', count: 1, importance: 'required', at_fraction: null },
        ],
      }),
      ...base,
      stopCoverage: [
        { type: 'coffee', importance: 'required', requested: 1, included: 1 },
        { type: 'fuel', importance: 'required', requested: 1, included: 0 },
      ],
    });
    expect(v.feasible).toBe(false);
    expect(v.results.find((r) => r.constraint === 'stop_coffee')!.status).toBe('satisfied');
    expect(v.results.find((r) => r.constraint === 'stop_fuel')!.status).toBe('violated');
  });

  it('fraction-timed stop within ±20 % of duration = satisfied; miss = relaxed with actual % (R16-3)', () => {
    const mkStop = (arrivalS: number | null) => ({
      spotId: 's1',
      name: 'Ridge Café',
      spotType: 'coffee',
      requestedType: 'coffee' as const,
      atFraction: 0.5 as const,
      waypointIndex: 1,
      arrivalS,
    });
    // duration 5300 s; midway = 2650 s; tol ±1060 s
    const hit = validateCandidate({
      route: route(),
      constraints: constraints(),
      ...base,
      stops: [mkStop(2400)],
    });
    const hitRow = hit.results.find((r) => r.constraint === 'stop_timing_coffee')!;
    expect(hitRow.status).toBe('satisfied');
    expect(hitRow.tier).toBe(3);

    const miss = validateCandidate({
      route: route(),
      constraints: constraints(),
      ...base,
      stops: [mkStop(4800)],
    });
    const missRow = miss.results.find((r) => r.constraint === 'stop_timing_coffee')!;
    expect(missRow.status).toBe('relaxed');
    expect(missRow.detail).toMatch(/91 %/); // actual 4800/5300 disclosed
    expect(miss.feasible).toBe(true); // soft: never fails the route

    const unmeasured = validateCandidate({
      route: route(),
      constraints: constraints(),
      ...base,
      stops: [mkStop(null)],
    });
    expect(unmeasured.results.find((r) => r.constraint === 'stop_timing_coffee')!.detail).toMatch(
      /unmeasured/,
    );
  });

  it('anytime stops (at_fraction null) get no timing row', () => {
    const v = validateCandidate({
      route: route(),
      constraints: constraints(),
      ...base,
      stops: [
        {
          spotId: 's1',
          name: 'Ridge Café',
          spotType: 'coffee',
          requestedType: 'coffee',
          atFraction: null,
          waypointIndex: 1,
          arrivalS: 2400,
        },
      ],
    });
    expect(v.results.some((r) => r.constraint.startsWith('stop_timing'))).toBe(false);
  });

  it('duration outside tolerance is a SOFT relaxed annotation, never infeasibility', () => {
    const v = validateCandidate({
      route: route({ duration_s: 7000 }),
      constraints: constraints(),
      ...base,
    });
    expect(v.feasible).toBe(true);
    expect(v.results.find((r) => r.constraint === 'duration')!.status).toBe('relaxed');
  });

  it('A→B skips the closure gate; unrouteable geometry is Tier-1 infeasible', () => {
    const atob = validateCandidate({
      route: route(),
      constraints: constraints({ shape: 'a_to_b', destination: 'St. Catharines' }),
      ...base,
      closureM: null,
    });
    expect(atob.results.some((r) => r.constraint === 'loop_closure')).toBe(false);

    const broken = validateCandidate({
      route: route({ distance_m: 0 }),
      constraints: constraints(),
      ...base,
    });
    expect(broken.feasible).toBe(false);
  });
});
