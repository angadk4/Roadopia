import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { CORE_DURATION_MAX_FRAC, coreSeedCandidates, coreVias } from './core_seed';
import type { CoreRowRead } from './discover_cores';

/**
 * R28-2 — cores enter the live pool as ordinary candidates. These pin the two
 * properties that make that safe: the vias must be DENSE enough to force the
 * route onto the core (R25 probe 7 measured 3.8x distance blowup without that),
 * and the selection must be deterministic and duration-aware.
 */

const LAT0 = 44.0;
const LNG0 = -80.0;
const M_LAT = 111_320;

function straight(lengthM: number, stepM = 100): LineString {
  const coordinates: Array<[number, number]> = [];
  for (let d = 0; d <= lengthM; d += stepM) coordinates.push([LNG0, LAT0 + d / M_LAT]);
  return { type: 'LineString', coordinates };
}

function core(over: Partial<CoreRowRead> = {}): CoreRowRead {
  return {
    id: 'c1',
    kind: 'loop',
    name: 'Test Core',
    bar_profile: 'strict',
    geom_simplified: straight(12_000),
    entry: { lat: LAT0, lng: LNG0 },
    exit: { lat: LAT0 + 12_000 / M_LAT, lng: LNG0 },
    distance_m: 12_000,
    duration_s: 1_800,
    curviness: 1.2,
    backroad_share: 0.86,
    main_share: 0.1,
    highway_share: 0,
    hood_share: 0.02,
    turns_per_10min: 3,
    loopiness: 0.4,
    ...over,
  };
}

describe('coreVias — dense enough to actually follow the core', () => {
  it('samples at roughly the requested spacing and keeps both ends', () => {
    const v = coreVias(straight(12_000), 2_500);
    expect(v.length).toBeGreaterThanOrEqual(5); // 12 km / 2.5 km + endpoints
    expect(v[0]!.lat).toBeCloseTo(LAT0, 4);
    expect(v[v.length - 1]!.lat).toBeCloseTo(LAT0 + 12_000 / M_LAT, 4);
  });

  it('never returns only the endpoints for a long core — that is the 3.8x failure', () => {
    // Two far-apart waypoints let Valhalla choose its own path between them,
    // which is the recorded failure mode of four refused attempts.
    expect(coreVias(straight(20_000), 2_500).length).toBeGreaterThan(5);
  });

  it('is safe on a degenerate core', () => {
    expect(coreVias({ type: 'LineString', coordinates: [] })).toEqual([]);
  });
});

describe('coreSeedCandidates', () => {
  it('ranks by MEASURED backroad share, then curviness, then id', () => {
    const out = coreSeedCandidates(
      [
        core({ id: 'low', backroad_share: 0.4 }),
        core({ id: 'high', backroad_share: 0.9 }),
        core({ id: 'mid', backroad_share: 0.6 }),
      ],
      3_600,
    );
    expect(out.map((c) => c.id)).toEqual(['core-high', 'core-mid', 'core-low']);
  });

  it('drops a core whose own duration already blows the ask', () => {
    // No connector can make a core shorter, so assembling it would spend an
    // engine call to produce a guaranteed duration failure.
    const target = 3_600;
    const tooLong = core({ id: 'long', duration_s: target * (CORE_DURATION_MAX_FRAC + 0.5) });
    expect(coreSeedCandidates([tooLong], target)).toHaveLength(0);
    expect(coreSeedCandidates([tooLong], null)).toHaveLength(1); // no ask → no filter
  });

  it('PREFERS a core that leaves room for the connectors that must exist', () => {
    // The bug the first A/B exposed: a core sized to the WHOLE ask gets
    // assembled and then thrown away, because the connectors needed to reach it
    // push the loop past the duration tier. A slightly less pretty core that
    // fits alongside its connectors beats a gorgeous one that eats the budget.
    const ask = 5_400; // 90 min
    const hog = core({ id: 'hog', duration_s: 5_200, backroad_share: 0.95 });
    const fits = core({ id: 'fits', duration_s: 3_000, backroad_share: 0.7 });
    const out = coreSeedCandidates([hog, fits], ask);
    expect(out[0]!.id).toBe('core-fits');
  });

  it('still lets road class decide between cores that BOTH fit', () => {
    const ask = 5_400;
    const good = core({ id: 'good', duration_s: 2_900, backroad_share: 0.9 });
    const meh = core({ id: 'meh', duration_s: 3_000, backroad_share: 0.6 });
    expect(coreSeedCandidates([meh, good], ask)[0]!.id).toBe('core-good');
  });

  it('respects the seed cap', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      core({ id: `c${i}`, backroad_share: 0.5 + i / 100 }),
    );
    expect(coreSeedCandidates(many, 3_600, 3)).toHaveLength(3);
  });

  it('produces candidates the assembly can consume, with no privileges', () => {
    const [c] = coreSeedCandidates([core()], 3_600);
    expect(c!.kind).toBe('loop');
    expect(c!.stops).toEqual([]);
    expect(c!.waypoints.length).toBeGreaterThan(2);
    // clusterWeight carries the core's measured backroad share — its real worth
    expect(c!.clusterWeight).toBeCloseTo(0.86, 5);
  });

  it('is deterministic', () => {
    const cs = [core({ id: 'a' }), core({ id: 'b' })];
    expect(coreSeedCandidates(cs, 3_600)).toEqual(coreSeedCandidates(cs, 3_600));
  });
});
