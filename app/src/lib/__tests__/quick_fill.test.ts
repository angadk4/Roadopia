import { validateParsedConstraints } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { DEFAULT_DRAFT } from '../plan_draft';
import { applyAutoFill, computeAutoFill } from '../quick_fill';

/**
 * R25-U16d — quick-fill: the parse populates the buttons, visibly, and never
 * re-moves a touched one. Untouched control = f(default, parse), recomputed
 * per parse (deleting text un-fills).
 */

function constraints(over: Record<string, unknown>) {
  return validateParsedConstraints({
    origin: { lat: 43.26, lng: -79.87 },
    destination: null,
    shape: 'loop',
    duration_target_s: null,
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
  });
}

const NO_TOUCH = new Set<never>();

describe('computeAutoFill (R25-U16d)', () => {
  it('an empty brief reproduces the defaults exactly — nothing marked "from your text"', () => {
    const auto = computeAutoFill(constraints({}));
    expect(auto.shape).toBe(DEFAULT_DRAFT.shape);
    expect(auto.style).toBe(DEFAULT_DRAFT.style);
    expect(auto.durationTargetS).toBe(DEFAULT_DRAFT.durationTargetS);
    expect(auto.avoidHighways).toBe(false);
    expect(auto.pavedOnly).toBe(false);
    expect(auto.preferViews).toBe(false);
    expect(auto.fromText).toEqual([]);
    expect(auto.note).toBeNull();
  });

  it('"simple" flips the chip to Direct; avoids + scenery light up, all marked', () => {
    const auto = computeAutoFill(
      constraints({
        preset: 'simple',
        avoid: { highways: true, tolls: false, ferries: false, unpaved: true },
        character: ['scenic'],
      }),
    );
    expect(auto.style).toBe('simple');
    expect(auto.avoidHighways).toBe(true);
    expect(auto.pavedOnly).toBe(true);
    expect(auto.preferViews).toBe(true);
    expect(auto.fromText).toEqual(
      expect.arrayContaining(['style', 'avoidHighways', 'pavedOnly', 'preferViews']),
    );
  });

  it('a twisty ask CLEARS the chip to No preference — the text decides (issue #9 fix)', () => {
    // pre-U16b the backroads default preset silently ATE the twisty ask
    const auto = computeAutoFill(constraints({ twistiness_pref: 0.9, character: ['twisty'] }));
    expect(auto.style).toBeNull();
    expect(auto.fromText).toContain('style');
  });

  it('duration snaps to the nearest chip only within ±20 %, else "Any" + an honest note', () => {
    expect(computeAutoFill(constraints({ duration_target_s: 5000 })).durationTargetS).toBe(5400);
    const off = computeAutoFill(constraints({ duration_target_s: 12_000 })); // 200 min — no chip
    expect(off.durationTargetS).toBeNull();
    expect(off.note).toContain('200 min');
    expect(off.fromText).not.toContain('duration');
  });
});

describe('applyAutoFill (R25-U16d)', () => {
  it('fills untouched fields and returns only the deltas', () => {
    const auto = computeAutoFill(
      constraints({
        preset: 'simple',
        avoid: { highways: true, tolls: false, ferries: false, unpaved: false },
      }),
    );
    const updates = applyAutoFill(DEFAULT_DRAFT, auto, NO_TOUCH);
    expect(updates.style).toBe('simple');
    expect(updates.routeOptions).toEqual({ avoidHighways: true, pavedOnly: false });
    expect(updates).not.toHaveProperty('shape'); // unchanged → not in the delta
  });

  it('a touched chip is NEVER moved by the parse — the mechanical guarantee', () => {
    const auto = computeAutoFill(constraints({ preset: 'simple' }));
    const updates = applyAutoFill(
      { ...DEFAULT_DRAFT, style: 'backroads' },
      auto,
      new Set(['style'] as const),
    );
    expect(updates).not.toHaveProperty('style');
  });

  it('deleting text un-fills: a later empty parse restores the default on untouched fields', () => {
    const filled = { ...DEFAULT_DRAFT, style: 'simple' as const };
    const auto = computeAutoFill(constraints({}));
    const updates = applyAutoFill(filled, auto, NO_TOUCH);
    expect(updates.style).toBe(DEFAULT_DRAFT.style);
  });
});
