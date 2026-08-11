/** R35-U11 — origin stem contracts, incl. the Recovery §17.3 metamorphic law:
 *  a funnel origin's stem must exceed a well-connected origin's. */
import type { RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { computeOriginStem, STEM_CAP_M, STEM_FLOOR_M, type StemRouteFn } from './origin_stem';

const route = (coords: Array<[number, number]>): RouteThroughOutput => ({
  geometry: { type: 'LineString', coordinates: coords },
  distance_m: 1,
  duration_s: 1,
  legs: [],
  maneuvers: [],
  has_highway: false,
  has_toll: false,
  has_ferry: false,
  has_unpaved: false,
});

const O = { lat: 43.75, lng: -79.83 };
const KM = 1 / 111.32;

/** Funnel: every path leaves via the SAME 2 km north stem, then fans out. */
const funnelFn: StemRouteFn = async (_u, req) => {
  const [, [tx, ty]] = [req.waypoints[0]!, req.waypoints[1]!];
  const stemEnd: [number, number] = [O.lng, O.lat + 2 * KM];
  return route([[O.lng, O.lat], stemEnd, [tx, ty]]);
};

/** Connected: every path departs straight toward its own target. */
const connectedFn: StemRouteFn = async (_u, req) => {
  const [, [tx, ty]] = [req.waypoints[0]!, req.waypoints[1]!];
  return route([
    [O.lng, O.lat],
    [tx, ty],
  ]);
};

describe('computeOriginStem', () => {
  it('a funnel origin measures its shared escape (~2 km), capped and floored', async () => {
    const stem = await computeOriginStem('http://x', O, {}, funnelFn);
    expect(stem).toBeGreaterThan(1_500);
    expect(stem).toBeLessThanOrEqual(STEM_CAP_M);
  });

  it('metamorphic (Recovery §17.3): moving to a well-connected corner SHRINKS the stem', async () => {
    const funnel = await computeOriginStem('http://x', O, {}, funnelFn);
    const connected = await computeOriginStem('http://x', O, {}, connectedFn);
    expect(connected).toBeLessThan(funnel);
    expect(connected).toBe(STEM_FLOOR_M); // instant divergence → floor
  });

  it('degrades to the old fixed radius when the engine cannot answer', async () => {
    const failing: StemRouteFn = async () => {
      throw new Error('down');
    };
    expect(await computeOriginStem('http://x', O, {}, failing)).toBe(1_000);
  });
});
