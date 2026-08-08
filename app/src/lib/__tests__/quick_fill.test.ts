import { validateParsedConstraints } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { DEFAULT_DRAFT, buildPlanRequest, type PlanDraft } from '../plan_draft';
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

  it('a twisty ask FILLS the fun chip — it must never DE-SELECT it (R27)', () => {
    // THIS TEST PREVIOUSLY ASSERTED THE DEFECT. It expected `style` to become
    // null on a twisty ask, reasoning that "No preference" would let the free
    // text decide. But null is not neutral in the UI: it is the third chip, and
    // DEFAULT_DRAFT.style is 'backroads', so the screen opened with
    // "Fun & Explorative" lit and typing "twisty" visibly turned it OFF. The
    // owner reported exactly that as "the text box isn't filling in the options
    // properly" (2026-07-29). The expectation was wrong, not the code, so the
    // test is corrected rather than the behaviour re-broken.
    const auto = computeAutoFill(constraints({ twistiness_pref: 0.9, character: ['twisty'] }));
    expect(auto.style).toBe('backroads');
    expect(auto.fromText).toContain('style');
  });

  it('a plain "backroads" ask still marks the chip as coming from the text', () => {
    // The old guard only pushed 'style' when the parsed value DIFFERED from the
    // default, so an explicit "backroads drive" could never show its
    // "from your text" marker — the marker means "your text chose this", not
    // "your text changed this".
    const auto = computeAutoFill(constraints({ preset: 'backroads' }));
    expect(auto.style).toBe('backroads');
    expect(auto.fromText).toContain('style');
  });

  it('a "chill" ask reaches the Direct chip — the old branch was unreachable', () => {
    // parse_rules emits chill on `intensity`, never on `preset`, so the previous
    // `c.preset === 'chill'` test could not fire and typing "chill drive" moved
    // nothing at all.
    const auto = computeAutoFill(constraints({ intensity: 'chill' }));
    expect(auto.style).toBe('simple');
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

describe('R28 — a brief-named destination must not block Generate', () => {
  const draft = (over: Partial<PlanDraft> = {}): PlanDraft => ({
    ...DEFAULT_DRAFT,
    brief: 'backroads drive to Erin',
    origin: { source: 'pin', point: { lat: 43.75, lng: -79.83 } },
    shape: 'a_to_b',
    destination: null,
    ...over,
  });

  it('blocks when NOTHING named a destination', () => {
    const r = buildPlanRequest(draft(), undefined, false);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.problems.join(' ')).toContain('destination');
  });

  it('ALLOWS it when the brief resolved one — the server routes it', () => {
    // The owner reported this as the text box "not filling the options": the
    // parser found Erin, the app flipped Shape to A→B, then demanded he pick
    // Erin on a map. /plan only overrides destination when the BODY supplies
    // one, so the brief-resolved place stands.
    const r = buildPlanRequest(draft(), undefined, true);
    expect(r.ok).toBe(true);
  });

  it('still allows a user-picked destination with no brief', () => {
    const r = buildPlanRequest(
      draft({ brief: '', destination: { lat: 43.77, lng: -80.07 } }),
      undefined,
      false,
    );
    expect(r.ok).toBe(true);
  });
});
