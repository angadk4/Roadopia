import type { ParsedConstraints } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_TOPSPEED_ON,
  FUN_DEFAULT_ADOPTED,
  profileForRequest,
  SHORTEST_SIZING_SPEED_KMH,
  SHORTEST_SIZING_SPEED_NO_HIGHWAY_KMH,
  TOPSPEED_KMH,
} from './costing';

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

  it('backroads/twisty preset or pref ≥ 0.7 → backroads, on the ADOPTED connector costing', () => {
    // R26-B2 (BD-100): the fun/backroads connector is `top_speed` costing, NOT
    // `shortest`. `shortest` bypassed every soft factor, which is why the
    // profile could never honour a use_* or maneuver knob; the probe measured
    // top_speed:50 at +39 pp backroad and the A/B adopted it on both suites.
    for (const c of [
      constraints({ preset: 'backroads' }),
      constraints({ preset: 'twisty' }),
      constraints({ twistiness_pref: 0.7 }),
      constraints({ twistiness_pref: 0.9 }),
    ]) {
      const p = profileForRequest(c, 'on');
      expect(p.id).toBe('backroads');
      expect(p.options.use_living_streets).toBe(0);
      if (CONNECTOR_TOPSPEED_ON) {
        expect(p.options.top_speed).toBe(TOPSPEED_KMH);
        expect(p.options.shortest).toBeUndefined(); // the soft factors are re-armed
      } else {
        expect(p.options.shortest).toBe(true); // pinned rollback state
        expect(p.options.top_speed).toBeUndefined();
      }
    }
  });

  it('characterless default follows FUN_DEFAULT_ADOPTED (re-judged after repair v2)', () => {
    const p = profileForRequest(constraints(), 'on');
    expect(p.id).toBe(FUN_DEFAULT_ADOPTED ? 'fun' : 'legacy');
  });

  it('backroads carries the PROBE-MEASURED sizing speeds for whichever connector is adopted', () => {
    const p = profileForRequest(constraints({ preset: 'backroads' }), 'on');
    if (CONNECTOR_TOPSPEED_ON) {
      expect(p.sizingSpeedKmh).toBe(35); // R26-B1: 50 / 1.42 (the probe's own ratio)
      expect(p.sizingSpeedNoHighwayKmh).toBe(27); // 38 / 1.42
    } else {
      expect(p.sizingSpeedKmh).toBe(50); // rq18: 55 / 1.098
      expect(p.sizingSpeedNoHighwayKmh).toBe(38); // rq18: 42 / 1.098
    }
  });

  it('the fun connector never carries a dead knob (no use_highways in either state)', () => {
    // under `shortest` use_highways was bypassed; under top_speed the real
    // highway lever is the realized exclude (BD-84), never a profile default
    expect(
      profileForRequest(constraints({ preset: 'twisty' }), 'on').options.use_highways,
    ).toBeUndefined();
  });
});

describe('BD-111 — top_speed is a LOOP lever; A→B keeps the costing BD-99 judged', () => {
  it('a loop backroads request gets the adopted top_speed connector', () => {
    const p = profileForRequest(constraints({ preset: 'backroads', shape: 'loop' }), 'on');
    if (CONNECTOR_TOPSPEED_ON) {
      expect(p.options.top_speed).toBe(TOPSPEED_KMH);
      expect(p.options.shortest).toBeUndefined();
    } else {
      expect(p.options.shortest).toBe(true);
    }
  });

  it('the SAME request as A→B does NOT — the change was refused on A→B bars (BD-99)', () => {
    const p = profileForRequest(
      constraints({ preset: 'backroads', shape: 'a_to_b', destination: { lat: 43.5, lng: -80.1 } }),
      'on',
    );
    expect(p.options.top_speed).toBeUndefined();
    if (CONNECTOR_TOPSPEED_ON) {
      // reverted to exactly the pre-BD-100 connector, not to some third thing
      expect(p.options.shortest).toBe(true);
      expect(p.sizingSpeedKmh).toBe(SHORTEST_SIZING_SPEED_KMH);
      expect(p.sizingSpeedNoHighwayKmh).toBe(SHORTEST_SIZING_SPEED_NO_HIGHWAY_KMH);
    }
  });

  it('the loop/A→B split is the ONLY difference — id and every other field match', () => {
    const loop = profileForRequest(constraints({ preset: 'twisty', shape: 'loop' }), 'on');
    const atob = profileForRequest(
      constraints({ preset: 'twisty', shape: 'a_to_b', destination: { lat: 43.5, lng: -80.1 } }),
      'on',
    );
    expect(atob.id).toBe(loop.id);
  });

  it('simple/chill are unaffected by shape (they never had the lever)', () => {
    const loop = profileForRequest(constraints({ preset: 'simple', shape: 'loop' }), 'on');
    const atob = profileForRequest(
      constraints({ preset: 'simple', shape: 'a_to_b', destination: { lat: 43.5, lng: -80.1 } }),
      'on',
    );
    expect(atob).toEqual(loop);
  });
});
