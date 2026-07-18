import type { ParsedConstraints } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { initialParams, nextRelaxation, THETA_FLOOR } from './relax';

/**
 * M3-T12 — the §3.7 ladder on impossible fixtures: an all-backroad impossible
 * brief relaxes step-by-step WITH disclosures; a truly impossible one redirects.
 */

function constraints(over: Partial<ParsedConstraints> = {}): ParsedConstraints {
  return {
    origin: { lat: 43.2557, lng: -79.8711 },
    destination: null,
    shape: 'loop',
    duration_target_s: 5400,
    distance_target_m: null,
    stops: [{ type: 'coffee', count: 1, importance: 'nice_to_have', at_fraction: null }],
    avoid: { highways: true, tolls: true, ferries: false, unpaved: true },
    surface_pref: 'paved',
    character: ['twisty'],
    scenic_pref: null,
    twistiness_pref: 0.8,
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

function climbAll(c: ParsedConstraints): Array<ReturnType<typeof nextRelaxation>> {
  const outcomes: Array<ReturnType<typeof nextRelaxation>> = [];
  let params = initialParams(c);
  for (let i = 0; i < 12; i++) {
    const out = nextRelaxation(params);
    outcomes.push(out);
    if (out.kind === 'redirect') break;
    params = out.params;
  }
  return outcomes;
}

describe('nextRelaxation ladder (M3-T12)', () => {
  it('climbs widen → lower θ → soften → relax hards one-by-one → redirect, disclosing each', () => {
    const outcomes = climbAll(constraints());
    const retries = outcomes.filter((o) => o.kind === 'retry');
    const last = outcomes[outcomes.length - 1]!;

    // rung 1: widen
    expect(retries[0]!.kind).toBe('retry');
    const p1 = (retries[0] as { params: { tauMultiplier: number } }).params;
    expect(p1.tauMultiplier).toBeCloseTo(1.3, 5);

    // rung 2: θ lowered
    const p2 = (retries[1] as { params: { thetaCurvy: number } }).params;
    expect(p2.thetaCurvy).toBeCloseTo(0.6 * 0.67, 5);

    // rung 3: soft targets
    const p3 = (
      retries[2] as { params: { durationTolerance: number; dropNiceToHaveStops: boolean } }
    ).params;
    expect(p3.durationTolerance).toBe(0.25);
    expect(p3.dropNiceToHaveStops).toBe(true);

    // rung 4: hard relaxations ONE per attempt, most-explicit (highways) LAST
    // (collect labels only when the list GREW — the rung-5 retry repeats it)
    const relaxLabels: string[] = [];
    let prevLen = 0;
    for (const r of retries) {
      const list = (r as { params: { relaxedConstraints: string[] } }).params.relaxedConstraints;
      if (list.length > prevLen) relaxLabels.push(list[list.length - 1]!);
      prevLen = list.length;
    }
    expect(relaxLabels).toEqual(['avoid_unpaved', 'avoid_toll', 'avoid_highway']);

    // rung 5 (R18-2): assembly-relax is the LAST retry before redirect
    const lastRetry = retries[retries.length - 1] as {
      params: { assemblyRelax: boolean; disclosures: string[] };
    };
    expect(lastRetry.params.assemblyRelax).toBe(true);
    expect(lastRetry.params.disclosures[lastRetry.params.disclosures.length - 1]).toMatch(
      /loop-quality limits/,
    );

    // final: redirect with the full disclosure trail
    expect(last.kind).toBe('redirect');
    if (last.kind === 'redirect') {
      expect(last.disclosures.length).toBeGreaterThanOrEqual(6);
      expect(last.reason).toMatch(/no feasible route/);
    }
  });

  it('every retry rung carries a fresh human-readable disclosure (nothing silent)', () => {
    let params = initialParams(constraints());
    let previousCount = 0;
    for (let i = 0; i < 6; i++) {
      const out = nextRelaxation(params);
      if (out.kind === 'redirect') break;
      expect(out.params.disclosures.length).toBe(previousCount + 1);
      previousCount = out.params.disclosures.length;
      params = out.params;
    }
  });

  it('no avoid set ⇒ rung 4 skipped; assembly-relax still runs before redirect (R18-2)', () => {
    const outcomes = climbAll(
      constraints({ avoid: { highways: false, tolls: false, ferries: false, unpaved: false } }),
    );
    // widen, lower θ, soften, assembly-relax = 4 retries, then redirect
    const retries = outcomes.filter((o) => o.kind === 'retry');
    expect(retries).toHaveLength(4);
    expect((retries[3] as { params: { assemblyRelax: boolean } }).params.assemblyRelax).toBe(true);
    expect(outcomes[outcomes.length - 1]!.kind).toBe('redirect');
  });

  it('R18-2 fast-forward: a zero-assembled iteration at rung ≥ 2 jumps to assembly-relax', () => {
    let params = initialParams(constraints());
    // climb one rung normally (rung 1 → widen)
    const first = nextRelaxation(params, { assembledCount: 5 });
    expect(first.kind).toBe('retry');
    if (first.kind !== 'retry') return;
    params = first.params;
    // pool died at Wall A → skip rungs 2-4 entirely
    const jumped = nextRelaxation(params, { assembledCount: 0 });
    expect(jumped.kind).toBe('retry');
    if (jumped.kind === 'retry') {
      expect(jumped.params.assemblyRelax).toBe(true);
      // θ untouched — rungs 2-4 were bypassed, not silently applied
      expect(jumped.params.thetaCurvy).toBe(params.thetaCurvy);
    }
  });

  it('θ never drops below the floor; τ never exceeds 2×', () => {
    const params = { ...initialParams(constraints()), thetaCurvy: THETA_FLOOR };
    const out = nextRelaxation({ ...params, rung: 2 });
    // θ already floored → rung 2 falls through to rung 3 in the same call
    expect(out.kind).toBe('retry');
    if (out.kind === 'retry') {
      expect(out.params.thetaCurvy).toBe(THETA_FLOOR);
      expect(out.params.durationTolerance).toBe(0.25);
    }

    let p = initialParams(constraints());
    p = { ...p, tauMultiplier: 1.9, rung: 1 };
    const widened = nextRelaxation(p);
    if (widened.kind === 'retry') expect(widened.params.tauMultiplier).toBeLessThanOrEqual(2);
  });

  it('is pure — input params are never mutated', () => {
    const params = initialParams(constraints());
    const snapshot = JSON.stringify(params);
    nextRelaxation(params);
    expect(JSON.stringify(params)).toBe(snapshot);
  });
});
