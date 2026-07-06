import { describe, expect, it } from 'vitest';

import {
  MAX_DURATION_S,
  resolveDisposition,
  validateParsedConstraints,
  type ParsedConstraints,
} from './constraints';

/**
 * M3-T01 — ParsedConstraints schema + validator (Protocol §3.4/§3.5).
 * AC: valid objects parse; invalid (bad enum, out-of-range duration) rejected.
 */

/** A fully-valid canonical loop brief ("90-min twisty loop, no highways, a café"). */
function canonical(): ParsedConstraints {
  return {
    origin: { lat: 43.2557, lng: -79.8711 },
    destination: null,
    shape: 'loop',
    duration_target_s: 5400,
    distance_target_m: null,
    stops: [{ type: 'coffee', count: 1, importance: 'nice_to_have' }],
    avoid: { highways: true, tolls: false, ferries: false, unpaved: false },
    surface_pref: 'paved',
    character: ['twisty'],
    scenic_pref: null,
    twistiness_pref: 0.8,
    intensity: 'moderate',
    preset: null,
    weights: null,
    location_constraints: [],
    ambiguous_terms: [],
    missing: [],
    contradictions: [],
    confidence: { overall: 0.85, fields: { duration_target_s: 0.95 } },
    clarification: { needed: false, question: null },
    unsafe_flag: false,
    out_of_region_flag: false,
    prompt_injection_flag: false,
  };
}

describe('ParsedConstraints schema (§3.4)', () => {
  it('parses the canonical loop brief', () => {
    const pc = validateParsedConstraints(canonical());
    expect(pc.shape).toBe('loop');
    expect(pc.stops[0]!.importance).toBe('nice_to_have');
  });

  it('accepts origin as coords, "current", or a place-name', () => {
    for (const origin of [{ lat: 43.2, lng: -79.9 }, 'current', 'Hamilton'] as const) {
      expect(() => validateParsedConstraints({ ...canonical(), origin })).not.toThrow();
    }
  });

  it('rejects a bad enum (invalid stop type / preset / intensity)', () => {
    expect(() =>
      validateParsedConstraints({
        ...canonical(),
        stops: [{ type: 'racetrack', count: 1, importance: 'required' }],
      }),
    ).toThrow();
    expect(() => validateParsedConstraints({ ...canonical(), preset: 'fastest' })).toThrow();
    expect(() => validateParsedConstraints({ ...canonical(), intensity: 'flat_out' })).toThrow();
  });

  it('rejects out-of-range durations and prefs (AC)', () => {
    expect(() => validateParsedConstraints({ ...canonical(), duration_target_s: -600 })).toThrow();
    expect(() =>
      validateParsedConstraints({ ...canonical(), duration_target_s: MAX_DURATION_S + 1 }),
    ).toThrow();
    expect(() => validateParsedConstraints({ ...canonical(), twistiness_pref: 1.4 })).toThrow();
    expect(() =>
      validateParsedConstraints({ ...canonical(), confidence: { overall: 2, fields: {} } }),
    ).toThrow();
  });

  it('a_to_b requires a destination unless declared missing', () => {
    expect(() =>
      validateParsedConstraints({ ...canonical(), shape: 'a_to_b', destination: null }),
    ).toThrow(/destination/);
    expect(() =>
      validateParsedConstraints({
        ...canonical(),
        shape: 'a_to_b',
        destination: null,
        missing: ['destination'],
      }),
    ).not.toThrow();
    expect(() =>
      validateParsedConstraints({
        ...canonical(),
        shape: 'a_to_b',
        destination: 'Niagara Falls',
      }),
    ).not.toThrow();
  });

  it('a null origin must be explicit in missing (nulls, not guesses)', () => {
    expect(() => validateParsedConstraints({ ...canonical(), origin: null })).toThrow(/origin/);
    expect(() =>
      validateParsedConstraints({ ...canonical(), origin: null, missing: ['origin'] }),
    ).not.toThrow();
  });

  it('clarification is allowed ONLY for the two §3.5 cases and needs a question', () => {
    // spurious clarification (origin present, no shape contradiction) → invalid
    expect(() =>
      validateParsedConstraints({
        ...canonical(),
        clarification: { needed: true, question: 'How twisty?' },
      }),
    ).toThrow(/clarification/);
    // case (a): no origin
    expect(() =>
      validateParsedConstraints({
        ...canonical(),
        origin: null,
        missing: ['origin'],
        clarification: { needed: true, question: 'Where should the drive start?' },
      }),
    ).not.toThrow();
    // case (b): shape contradiction
    expect(() =>
      validateParsedConstraints({
        ...canonical(),
        contradictions: [{ kind: 'shape', description: 'loop ending in another city' }],
        clarification: { needed: true, question: 'Loop back home, or end in St. Catharines?' },
      }),
    ).not.toThrow();
    // needed without a question → invalid
    expect(() =>
      validateParsedConstraints({
        ...canonical(),
        origin: null,
        missing: ['origin'],
        clarification: { needed: true, question: null },
      }),
    ).toThrow(/question/);
  });
});

describe('resolveDisposition (§3.5 precedence)', () => {
  it('unsafe wins over everything', () => {
    const pc = validateParsedConstraints({
      ...canonical(),
      unsafe_flag: true,
      out_of_region_flag: true,
    });
    expect(resolveDisposition(pc)).toBe('refuse_unsafe');
  });

  it('out-of-region redirects (not a clarification)', () => {
    const pc = validateParsedConstraints({ ...canonical(), out_of_region_flag: true });
    expect(resolveDisposition(pc)).toBe('redirect_out_of_region');
  });

  it('no-origin clarifies; injection alone still proceeds (ignored instruction)', () => {
    const clarify = validateParsedConstraints({
      ...canonical(),
      origin: null,
      missing: ['origin'],
      clarification: { needed: true, question: 'Where should the drive start?' },
    });
    expect(resolveDisposition(clarify)).toBe('clarify');

    const injected = validateParsedConstraints({ ...canonical(), prompt_injection_flag: true });
    expect(resolveDisposition(injected)).toBe('proceed');
  });
});
