import { validateParsedConstraints } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { INITIAL_RUN, runReducer } from '../plan_run';
import { buildRefineRequest, compareSummaries, summarizeRoute } from '../refine';

const CONSTRAINTS = validateParsedConstraints({
  origin: { lat: 43.26, lng: -79.87 },
  destination: null,
  shape: 'loop',
  duration_target_s: 5400,
  distance_target_m: null,
  stops: [],
  avoid: { highways: true, tolls: false, ferries: false, unpaved: false },
  surface_pref: 'any',
  character: ['twisty'],
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
});

describe('buildRefineRequest', () => {
  it('carries the held constraints + trimmed follow-up (brief doubles as the log line)', () => {
    const req = buildRefineRequest(CONSTRAINTS, '  make it longer  ');
    expect(req.brief).toBe('make it longer');
    expect(req.followUp).toBe('make it longer');
    expect(req.constraints).toBe(CONSTRAINTS);
    expect(req.origin).toBeUndefined(); // origin lives INSIDE the constraints
  });
});

describe('compareSummaries — real computed deltas (FR-254)', () => {
  const prev = { distance_m: 68000, duration_s: 4500, curviness: 1.4, climb_m: 300 };

  it('signed deltas for time/distance/twistiness/climb', () => {
    const next = { distance_m: 82500, duration_s: 5580, curviness: 1.7, climb_m: 260 };
    const rows = compareSummaries(prev, next);
    expect(rows.map((r) => [r.label, r.delta])).toEqual([
      ['drive time', '+18 min'],
      ['distance', '+14.5 km'],
      ['twistiness', '+0.3'],
      ['climb', '−40 m'],
    ]);
    expect(rows[0]!.before).toBe('≈75 min');
    expect(rows[0]!.after).toBe('≈93 min');
  });

  it('“no change” when equal; climb row dropped when either climb is unknown', () => {
    const rows = compareSummaries(prev, { ...prev, climb_m: null });
    expect(rows.find((r) => r.label === 'drive time')!.delta).toBe('no change');
    expect(rows.some((r) => r.label === 'climb')).toBe(false);
  });
});

describe('constraints event → held running c', () => {
  it('the reducer stores the constraints event for the refine round-trip', () => {
    const s = runReducer(INITIAL_RUN, {
      type: 'event',
      event: { type: 'constraints', constraints: CONSTRAINTS },
    });
    expect(s.constraints).toEqual(CONSTRAINTS);
  });
});

describe('summarizeRoute', () => {
  it('extracts the compact comparison summary', () => {
    expect(
      summarizeRoute({
        distance_m: 68000,
        duration_s: 4500,
        curviness: 1.4,
        climb_m: null,
      } as never),
    ).toEqual({ distance_m: 68000, duration_s: 4500, curviness: 1.4, climb_m: null });
  });
});
