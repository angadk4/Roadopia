import { describe, expect, it } from 'vitest';

import { bundleForRequest } from './bundles';
import { parseRules } from './parse_rules';
import { PRESET_WEIGHTS } from './presets';
import { DEFAULT_WEIGHTS } from './score';

/** R18-4 — bundles resolve deterministically from presets, aliases and tags. */

describe('bundleForRequest (R18-4)', () => {
  it('presets map to their bundles; aliases resolve; weights stay frozen', () => {
    const twisty = bundleForRequest(parseRules('90 minute twisty loop from Guelph'));
    expect(twisty.id).toBe('twisty');
    expect(twisty.urbanShareSoft).toBe(0.15);

    const backroads = bundleForRequest(parseRules('90 minute backroads loop from Bolton'));
    expect(backroads.id).toBe('backroads');
    expect(backroads.urbanShareSoft).toBe(0.12);
    expect(backroads.weights).toEqual(PRESET_WEIGHTS.backroads);

    const simple = bundleForRequest(parseRules('simple loop from Erin'));
    expect(simple.id).toBe('simple');
    expect(simple.urbanShareSoft).toBe(1.0); // fastest-path IS the ask
    expect(simple.durationTolerance).toBe(0.15); // tightest clock
  });

  it('scenic: anti-urban bar + ONE nice-to-have viewpoint; [GATE-S] holds (no scenic weight)', () => {
    const scenic = bundleForRequest(parseRules('2 hour scenic loop from Owen Sound'));
    expect(scenic.id).toBe('scenic');
    expect(scenic.urbanShareSoft).toBe(0.1);
    expect(scenic.autoViewpointStop).toBe(true);
    expect(scenic.weights['scenic']).toBe(0); // Hard rule C
  });

  it('characterless default keeps today exactly', () => {
    const d = bundleForRequest(parseRules('90 minute loop from Hamilton'));
    expect(d.id).toBe('default');
    expect(d.urbanShareSoft).toBe(0.25); // R19: default demotes town-heavy options too
    expect(d.weights).toEqual(DEFAULT_WEIGHTS);
    expect(d.autoViewpointStop).toBe(false);
  });
});
