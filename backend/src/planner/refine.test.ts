import type { LineString, ParsedConstraints } from '@shared/types';
import { validateParsedConstraints } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { compareRoutes, describeComparison, type ComparableRoute } from './compare';
import { parseRules } from './parse_rules';
import { mergeConstraints, parseFollowUp, refineConstraints } from './refine';

/** M5-T06 — REF fixtures: merge semantics per Protocol §17.1; AC "hard-constraint
 *  retention 100%; comparison reflects real deltas". */

const BASE: ParsedConstraints = validateParsedConstraints({
  origin: { lat: 43.5448, lng: -80.2482 },
  destination: null,
  shape: 'loop',
  duration_target_s: 5400,
  distance_target_m: null,
  stops: [{ type: 'coffee', count: 1, importance: 'required', at_fraction: null }],
  avoid: { highways: true, tolls: false, ferries: false, unpaved: true },
  surface_pref: 'paved',
  character: ['twisty'],
  scenic_pref: null,
  twistiness_pref: 0.7,
  intensity: null,
  preset: null,
  weights: null,
  location_constraints: [{ kind: 'near', text: 'Elora' }],
  ambiguous_terms: [],
  missing: [],
  contradictions: [],
  confidence: { overall: 0.9, fields: {} },
  clarification: { needed: false, question: null },
  unsafe_flag: false,
  out_of_region_flag: false,
  prompt_injection_flag: false,
});

/** Every §3.6 hard/hard-relaxable field the merge must never silently drop. */
function hardSet(c: ParsedConstraints) {
  return {
    avoid: c.avoid,
    requiredStops: c.stops.filter((s) => s.importance === 'required'),
    surface: c.surface_pref,
    near: c.location_constraints.filter((lc) => lc.kind === 'near'),
  };
}

describe('refine merge (M5-T06, RF6 rules)', () => {
  it('"make it longer" steps duration +20%; ALL hard constraints retained', () => {
    const { merged, changes, recognized } = refineConstraints(BASE, 'make it longer');
    expect(recognized).toBe(true);
    expect(merged.duration_target_s).toBe(5400 + 1080); // 20% of 90 min
    expect(changes).toEqual(['duration longer → 108 min']);
    expect(hardSet(merged)).toEqual(hardSet(BASE)); // retention 100%
    expect(BASE.duration_target_s).toBe(5400); // original untouched
  });

  it('a stated value wins over a step: "make it 2 hours" → 7200 s', () => {
    const { merged } = refineConstraints(BASE, 'make it 2 hours');
    expect(merged.duration_target_s).toBe(7200);
  });

  it('"add a viewpoint" appends a hard-relaxable stop; the required stop persists', () => {
    const { merged } = refineConstraints(BASE, 'add a viewpoint');
    expect(merged.stops).toContainEqual({
      type: 'viewpoint',
      count: 1,
      importance: 'nice_to_have',
      at_fraction: null,
    });
    expect(merged.stops).toContainEqual({
      type: 'coffee',
      count: 1,
      importance: 'required',
      at_fraction: null,
    });
  });

  it('"avoid Erin" becomes a location avoid, not a hard flag; near-Elora persists', () => {
    const { merged, changes } = refineConstraints(BASE, 'avoid Erin');
    expect(merged.location_constraints).toContainEqual({ kind: 'avoid', text: 'Erin' });
    expect(merged.location_constraints).toContainEqual({ kind: 'near', text: 'Elora' });
    expect(merged.avoid).toEqual(BASE.avoid);
    expect(changes).toEqual(['avoid location "Erin"']);
  });

  it('explicit lift clears exactly one hard constraint: "actually highways are fine"', () => {
    const { merged } = refineConstraints(BASE, 'actually highways are fine');
    expect(merged.avoid.highways).toBe(false); // the ONE §17.1 removal case
    expect(merged.avoid.unpaved).toBe(true); // other hard avoids persist
  });

  it('"more backroads" sets the FROZEN backroads preset - explicit ask overrides (M7-T09/FB-3)', () => {
    const { merged, changes, recognized } = refineConstraints(BASE, 'more backroads please');
    expect(recognized).toBe(true);
    expect(merged.preset).toBe('backroads');
    expect(changes).toContain('preset → backroads');
    expect(hardSet(merged)).toEqual(hardSet(BASE)); // hard constraints untouched
    // explicit ask overrides an existing preset
    const withPreset = { ...structuredClone(BASE), preset: 'chill' as const };
    expect(refineConstraints(withPreset, 'country roads').merged.preset).toBe('backroads');
  });

  it('"more twisty" steers the twisty preset ONLY when no chip was chosen', () => {
    const { merged } = refineConstraints(BASE, 'more twisty');
    expect(merged.preset).toBe('twisty'); // BASE has preset null
    expect(merged.twistiness_pref).toBeCloseTo(0.9); // nudge still applies
    const withChip = { ...structuredClone(BASE), preset: 'chill' as const };
    const kept = refineConstraints(withChip, 'more twisty');
    expect(kept.merged.preset).toBe('chill'); // never clobbers the user's chip
    expect(kept.merged.twistiness_pref).toBeCloseTo(0.9);
  });

  it('"more twisty more backroads": backroads (explicit) wins the preset; pref nudge kept', () => {
    const { merged, changes } = refineConstraints(BASE, 'more twisty more backroads');
    expect(merged.preset).toBe('backroads');
    expect(merged.twistiness_pref).toBeCloseTo(0.9);
    expect(changes).toContain('preset → backroads');
  });

  it('unrecognized follow-up → recognized:false, constraints unchanged (no guess)', () => {
    const out = refineConstraints(BASE, 'hmm what about vibes');
    expect(out.recognized).toBe(false);
    expect(out.changes).toEqual([]);
    expect(out.merged).toEqual(BASE);
  });

  it('"twistier" nudges the soft target, clamped to 1', () => {
    const d = parseFollowUp('twistier please');
    expect(d.twistinessDelta).toBe(0.2);
    const once = mergeConstraints(BASE, d).merged; // 0.7 → 0.9
    expect(mergeConstraints(once, d).merged.twistiness_pref).toBe(1); // 0.9 → clamp 1
  });
});

describe('route comparison (M5-T06, §17.3 computed deltas)', () => {
  const line = (coords: Array<[number, number]>): LineString => ({
    type: 'LineString',
    coordinates: coords,
  });
  // ~4.5 km west-east line near Hamilton; refined veers north halfway
  const orig: ComparableRoute = {
    durationS: 5400,
    distanceM: 90_000,
    curvatureScore: 1.4,
    scenicSignal: null,
    stopNames: ['Higher Ground Café'],
    geometry: line([
      [-79.9, 43.2],
      [-79.87, 43.2],
      [-79.845, 43.2],
    ]),
  };
  const refined: ComparableRoute = {
    durationS: 6480,
    distanceM: 104_000,
    curvatureScore: 1.6,
    scenicSignal: null,
    stopNames: ['Higher Ground Café', "Devil's Punchbowl Lookout"],
    geometry: line([
      [-79.9, 43.2],
      [-79.87, 43.2],
      [-79.87, 43.23],
    ]),
  };

  it('deltas are real computed numbers; stop set-difference correct', () => {
    const cmp = compareRoutes(orig, refined);
    expect(cmp.durationDeltaS).toBe(1080);
    expect(cmp.distanceDeltaM).toBe(14_000);
    expect(cmp.curvatureDelta).toBeCloseTo(0.2);
    expect(cmp.scenicDelta).toBeNull();
    expect(cmp.stopsAdded).toEqual(["Devil's Punchbowl Lookout"]);
    expect(cmp.stopsRemoved).toEqual([]);
  });

  it('edge overlap: identical route ≈ 1, diverged route materially lower', () => {
    const same = compareRoutes(orig, { ...refined, geometry: orig.geometry });
    const diverged = compareRoutes(orig, refined);
    expect(same.edgeOverlap).toBeGreaterThan(0.9);
    expect(diverged.edgeOverlap).toBeLessThan(same.edgeOverlap - 0.2);
    expect(diverged.edgeOverlap).toBeGreaterThan(0.2); // shares the first half
  });

  it('describeComparison phrases only the computed facts', () => {
    const text = describeComparison(compareRoutes(orig, refined));
    expect(text).toContain('+18 min');
    expect(text).toContain('+14 km');
    expect(text).toContain("adds Devil's Punchbowl Lookout");
    expect(text).toMatch(/keeps \d+% of the original roads/);
  });
});

describe('through-intent refinement (R18-4)', () => {
  it('"actually go through Hockley Valley" merges a through-constraint', () => {
    const delta = parseFollowUp('actually go through Hockley Valley please');
    expect(delta.recognized).toBe(true);
    expect(delta.throughLocations).toEqual(['Hockley Valley']);
    const base = parseRules('2 hour loop from Orangeville');
    const { merged, changes } = mergeConstraints(base, delta);
    expect(merged.location_constraints).toContainEqual({
      kind: 'through',
      text: 'Hockley Valley',
    });
    expect(changes).toContain('through "Hockley Valley"');
    // idempotent: merging again adds nothing
    const again = mergeConstraints(merged, delta);
    expect(
      again.merged.location_constraints.filter((lc) => lc.text === 'Hockley Valley'),
    ).toHaveLength(1);
  });
});
