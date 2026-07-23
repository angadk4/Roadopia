import { validateParsedConstraints } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { parseChips } from '../parse_summary';

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

describe('parseChips', () => {
  it('surfaces places first, then time, style, avoids, character', () => {
    const chips = parseChips(
      constraints({
        location_constraints: [
          { kind: 'through', text: 'Forks of the Credit' },
          { kind: 'near', text: 'Elora' },
        ],
        duration_target_s: 5400,
        preset: 'backroads',
        avoid: { highways: true, tolls: false, ferries: false, unpaved: true },
        character: ['scenic'],
      }),
    );
    expect(chips).toEqual([
      'Through Forks of the Credit',
      'Near Elora',
      '~1.5 hr',
      'Fun & Explorative',
      'No highways',
      'Paved only',
      'Scenic',
    ]);
  });

  it('relabels presets for engagement, never speed (Hard rule D)', () => {
    expect(parseChips(constraints({ preset: 'simple' }))).toEqual(['Direct']);
    expect(parseChips(constraints({ duration_target_s: 3600 }))).toEqual(['~1 hr']);
    expect(parseChips(constraints({ duration_target_s: 2700 }))).toEqual(['~45 min']);
  });

  it('de-dupes when a preset and an avoid flag say the same thing', () => {
    const chips = parseChips(
      constraints({
        preset: 'avoid_highways',
        avoid: { highways: true, tolls: false, ferries: false, unpaved: false },
      }),
    );
    expect(chips.filter((c) => c === 'No highways')).toHaveLength(1);
  });

  it('is empty for a bare loop (nothing understood beyond the default)', () => {
    expect(parseChips(constraints({}))).toEqual([]);
  });
});
