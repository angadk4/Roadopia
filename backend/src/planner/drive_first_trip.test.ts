import { describe, expect, it } from 'vitest';

import type { CoreRowRead } from './discover_cores';
import { tripQualityTiebreak } from './drive_first_trip';

/**
 * BD-171 — the twisty ranking lever. Measured at the owner's home: "1 hour
 * twisty" and "1 hour backroads" served the IDENTICAL core because the
 * candidate sort never saw the character. The tiebreak is pure, so the
 * contract is pinned here; the live adopt-or-refuse A/B judges the serves.
 */

const core = (id: string, backroad: number, curv: number): CoreRowRead =>
  ({
    id,
    kind: 'loop',
    name: id,
    bar_profile: 'strict',
    geom_simplified: { type: 'LineString', coordinates: [] },
    entry: { lat: 0, lng: 0 },
    exit: { lat: 0, lng: 0 },
    distance_m: 1,
    duration_s: 1,
    curviness: curv,
    backroad_share: backroad,
    main_share: 0,
    highway_share: 0,
    hood_share: 0,
    turns_per_10min: 0,
    loopiness: null,
  }) as CoreRowRead;

describe('tripQualityTiebreak (BD-171)', () => {
  const straightButRural = core('rural-straight', 0.9, 0.4);
  const curvyButMixed = core('curvy-mixed', 0.6, 2.1);

  it('default ranking prefers backroad share (character-blind, unchanged)', () => {
    expect(tripQualityTiebreak(straightButRural, curvyButMixed, false)).toBeLessThan(0);
  });

  it('twisty ranking prefers curvature first', () => {
    expect(tripQualityTiebreak(straightButRural, curvyButMixed, true)).toBeGreaterThan(0);
  });

  it('deterministic id tiebreak when equal both ways', () => {
    const a = core('aaa', 0.7, 1.0);
    const b = core('bbb', 0.7, 1.0);
    expect(tripQualityTiebreak(a, b, false)).toBeLessThan(0);
    expect(tripQualityTiebreak(a, b, true)).toBeLessThan(0);
  });
});
