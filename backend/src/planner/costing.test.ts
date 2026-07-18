import type { ParsedConstraints } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { FUN_DEFAULT_ADOPTED, profileForRequest } from './costing';

/** R18-1 — costing profile selection: deterministic, legacy byte-identical. */

function constraints(over: Partial<ParsedConstraints> = {}): ParsedConstraints {
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
    ...over,
  };
}

describe('profileForRequest (R18-1)', () => {
  it("mode 'legacy' is the byte-identical BD-21 rollback, regardless of request", () => {
    for (const c of [
      constraints(),
      constraints({ preset: 'twisty' }),
      constraints({ preset: 'backroads', twistiness_pref: 0.9 }),
    ]) {
      const p = profileForRequest(c, 'legacy');
      expect(p.id).toBe('legacy');
      expect(p.options).toEqual({ use_highways: 0.2, use_living_streets: 0 });
      expect(p.sizingSpeedKmh).toBe(55);
      expect(p.sizingSpeedNoHighwayKmh).toBe(42);
    }
  });

  it('simple/chill → fastest-path (shortest OFF — fewer turns is the ask)', () => {
    for (const preset of ['simple', 'chill'] as const) {
      const p = profileForRequest(constraints({ preset }), 'on');
      expect(p.id).toBe('simple');
      expect(p.options.shortest).toBeUndefined();
    }
  });

  it('backroads/twisty preset or pref ≥ 0.7 → backroads (shortest ON)', () => {
    for (const c of [
      constraints({ preset: 'backroads' }),
      constraints({ preset: 'twisty' }),
      constraints({ twistiness_pref: 0.7 }),
      constraints({ twistiness_pref: 0.9 }),
    ]) {
      const p = profileForRequest(c, 'on');
      expect(p.id).toBe('backroads');
      expect(p.options.shortest).toBe(true);
      expect(p.options.use_living_streets).toBe(0);
    }
  });

  it('characterless default follows FUN_DEFAULT_ADOPTED (re-judged after repair v2)', () => {
    const p = profileForRequest(constraints(), 'on');
    expect(p.id).toBe(FUN_DEFAULT_ADOPTED ? 'fun' : 'legacy');
  });

  it('backroads carries the probe-measured sizing speeds', () => {
    const p = profileForRequest(constraints({ preset: 'backroads' }), 'on');
    expect(p.sizingSpeedKmh).toBe(50); // rq18: 55 / 1.098
    expect(p.sizingSpeedNoHighwayKmh).toBe(38); // rq18: 42 / 1.098
  });

  it('a shortest profile carries NO use_highways (dead knob under shortest)', () => {
    expect(
      profileForRequest(constraints({ preset: 'twisty' }), 'on').options.use_highways,
    ).toBeUndefined();
  });
});
