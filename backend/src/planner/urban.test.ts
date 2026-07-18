import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  buildUrbanIndex,
  isUrbanContext,
  isUrbanPoint,
  urbanIntroM,
  urbanRunInfo,
  urbanShareOf,
} from './urban';

/**
 * R19 — urban context on synthetic material. Geometry near lat 43.78 (the
 * Mayfield frame); 0.001° lng ≈ 80 m, 0.001° lat ≈ 111 m.
 */

const square = (w: number, s: number, e: number, n: number): string =>
  JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });

const line = (coords: Array<[number, number]>): LineString => ({
  type: 'LineString',
  coordinates: coords,
});

describe('urban index + flank predicate (R19)', () => {
  // two subdivision blocks flanking an east-west arterial corridor at lat 43.78
  // (blocks end 40 m from the centreline — inside the 120 m flank probe)
  const north = square(-79.8, 43.7804, -79.7, 43.79);
  const south = square(-79.8, 43.77, -79.7, 43.7796);
  const idx = buildUrbanIndex([north, south]);

  it('point-in-polygon: inside / outside / hole handling', () => {
    expect(isUrbanPoint(idx, -79.75, 43.785)).toBe(true); // inside north block
    expect(isUrbanPoint(idx, -79.75, 43.78)).toBe(false); // in the corridor gap
    expect(isUrbanPoint(idx, -79.65, 43.78)).toBe(false); // east of everything
    const holed = buildUrbanIndex([
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [-79.8, 43.7],
            [-79.7, 43.7],
            [-79.7, 43.76],
            [-79.8, 43.76],
            [-79.8, 43.7],
          ],
          [
            [-79.76, 43.72],
            [-79.74, 43.72],
            [-79.74, 43.74],
            [-79.76, 43.74],
            [-79.76, 43.72],
          ],
        ],
      }),
    ]);
    expect(isUrbanPoint(holed, -79.75, 43.73)).toBe(false); // inside the hole
    expect(isUrbanPoint(holed, -79.78, 43.71)).toBe(true); // in the solid part
  });

  it('flank predicate: arterial BETWEEN subdivisions = urban; one-side = fine', () => {
    // east-west travel through the corridor: both flanks hit the blocks
    expect(isUrbanContext(idx, -79.75, 43.78, 0.001, 0)).toBe(true);
    // same corridor but only the NORTH block exists → fields on one side = fine
    const oneSide = buildUrbanIndex([north]);
    expect(isUrbanContext(oneSide, -79.75, 43.78, 0.001, 0)).toBe(false);
    // a point inside a block is urban regardless of direction
    expect(isUrbanContext(idx, -79.75, 43.785, 0.001, 0)).toBe(true);
  });

  it('urbanShareOf: corridor route ~1, country route ~0, null without polygons', () => {
    const corridor = line([
      [-79.8, 43.78],
      [-79.7, 43.78],
    ]);
    const country = line([
      [-79.68, 43.78],
      [-79.6, 43.78],
    ]);
    expect(urbanShareOf(idx, corridor)!).toBeGreaterThan(0.9);
    expect(urbanShareOf(idx, country)!).toBeLessThan(0.05);
    expect(urbanShareOf(buildUrbanIndex([]), corridor)).toBeNull();
  });

  it('urbanRunInfo: longest run outside the origin grace, with a midpoint', () => {
    // route: 8 km corridor (urban) then 8 km east into open country
    const route = line([
      [-79.8, 43.78],
      [-79.7, 43.78],
      [-79.6, 43.78],
    ]);
    // origin far WEST so grace covers only the start
    const info = urbanRunInfo(idx, route, { lat: 43.78, lng: -79.8 }, 1_000);
    expect(info.runM).toBeGreaterThan(5_000); // most of the corridor
    expect(info.mid).not.toBeNull();
    expect(info.mid![0]).toBeLessThan(-79.7); // midpoint inside the corridor
  });

  it('urbanIntroM: town start opens up where the corridor ends', () => {
    const route = line([
      [-79.8, 43.78],
      [-79.7, 43.78],
      [-79.6, 43.78],
    ]);
    const intro = urbanIntroM(idx, route);
    expect(intro).not.toBeNull();
    // corridor is ~8 km; must open within ~1 km after it ends
    expect(intro!).toBeGreaterThan(5_000);
    expect(intro!).toBeLessThan(10_000);
    // a country-only route opens immediately
    const country = line([
      [-79.65, 43.78],
      [-79.55, 43.78],
    ]);
    expect(urbanIntroM(idx, country)).toBe(0);
  });
});
