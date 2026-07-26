import { describe, expect, it } from 'vitest';

import { parseRules } from '../planner/parse_rules';

import { applyClientOverrides, type ClientOverrideInputs } from './plan_overrides';

/**
 * R25-U16a — the merge keeps the EXACT win-order the five inline blocks had
 * (client wins), and adds the missing disclosure: overrides[] names every
 * control that genuinely contradicted the text — and stays SILENT when text
 * and controls agree (no noise on the common path).
 */

const NONE: ClientOverrideInputs = {
  shape: undefined,
  preset: undefined,
  weights: undefined,
  stopOverrides: null,
  avoidOverrides: undefined,
  characterOverrides: undefined,
  twistinessOverride: undefined,
  locationOverrides: null,
  durationTargetOverride: undefined,
};

describe('applyClientOverrides (R25-U16a)', () => {
  it('no client inputs → constraints unchanged, zero disclosures (BD-40 byte-identical)', () => {
    const parsed = parseRules('90 minute twisty loop from Guelph');
    const { constraints, overrides } = applyClientOverrides(parsed, NONE);
    expect(constraints).toEqual(parsed);
    expect(overrides).toEqual([]);
  });

  it('the chip still WINS over the text — and now SAYS so', () => {
    // the LLM parser can emit a preset from the text; rules-parse then pin it
    const parsed = {
      ...parseRules('90 minute twisty loop from Guelph'),
      preset: 'twisty' as const,
    };
    const { constraints, overrides } = applyClientOverrides(parsed, {
      ...NONE,
      preset: 'simple',
    });
    expect(constraints.preset).toBe('simple'); // client wins (unchanged semantics)
    expect(overrides).toEqual(["road character: the simple chip replaced the text's twisty ask"]);
  });

  it('agreement is silent: a chip matching the text discloses nothing', () => {
    const parsed = {
      ...parseRules('90 minute twisty loop from Guelph'),
      preset: 'twisty' as const,
    };
    const { overrides } = applyClientOverrides(parsed, { ...NONE, preset: 'twisty' });
    expect(overrides).toEqual([]);
  });

  it('filling a gap is silent: a preset onto a preset-less brief is no contradiction', () => {
    const parsed = parseRules('90 minute loop from Hamilton');
    expect(parsed.preset).toBeNull();
    const { constraints, overrides } = applyClientOverrides(parsed, {
      ...NONE,
      preset: 'backroads',
    });
    expect(constraints.preset).toBe('backroads');
    expect(overrides).toEqual([]);
  });

  it('duration + shape contradictions disclose with the values named', () => {
    const parsed = parseRules('90 minute loop from Hamilton');
    const { constraints, overrides } = applyClientOverrides(parsed, {
      ...NONE,
      durationTargetOverride: 3600,
      shape: parsed.shape, // agreement — silent
    });
    expect(constraints.duration_target_s).toBe(3600);
    expect(overrides).toEqual(["time: the 60 min control replaced the text's 90 min"]);
  });

  it('composition stays composition: stops/avoid/character never disclose', () => {
    const parsed = parseRules('90 minute loop from Hamilton with a coffee stop, no highways');
    const { constraints, overrides } = applyClientOverrides(parsed, {
      ...NONE,
      stopOverrides: [{ type: 'fuel', count: 1, importance: 'required', at_fraction: null }],
      avoidOverrides: { unpaved: true },
      characterOverrides: ['scenic'],
    });
    // per-type stop override + brief-only types ride along
    expect(constraints.stops.some((s) => s.type === 'fuel')).toBe(true);
    expect(constraints.stops.some((s) => s.type === 'coffee')).toBe(true);
    // avoid merges keys; untouched keys survive
    expect(constraints.avoid.highways).toBe(true);
    expect(constraints.avoid.unpaved).toBe(true);
    expect(constraints.surface_pref).toBe('paved');
    // character unions
    expect(constraints.character).toContain('scenic');
    expect(overrides).toEqual([]);
  });

  it('tap pins REPLACE parsed places and disclose the replacement', () => {
    const parsed = parseRules('Loop through Forks of the Credit from Belfountain');
    expect(parsed.location_constraints.length).toBeGreaterThan(0);
    const pin = {
      kind: 'through' as const,
      text: 'River Road',
      near_point: { lat: 43.73, lng: -79.94 },
    };
    const { constraints, overrides } = applyClientOverrides(parsed, {
      ...NONE,
      locationOverrides: [pin],
    });
    expect(constraints.location_constraints).toEqual([pin]);
    expect(overrides.some((s) => s.startsWith('places:'))).toBe(true);
  });
});
