import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { reversalPositions, REVERSAL_ANGLE_DEG } from './overlap';

/**
 * R25-U11 — the uncounted reversal: `middleType:'through'` forbids u-turns at
 * the point, so Valhalla circles a block instead and NO uturn maneuver is
 * emitted. This detector is pure geometry (net travel direction before vs
 * after a point), so it sees what uturnCount and the microloop detector miss.
 */

const LAT = 43.2;
const LNG0 = -79.9;
const LNG_M = 111_320 * Math.cos((LAT * Math.PI) / 180);
const LAT_M = 111_320;

/** Build a LineString from planar metre offsets around the base point. */
function line(offsetsM: Array<[number, number]>): LineString {
  return {
    type: 'LineString',
    coordinates: offsetsM.map(([x, y]) => [LNG0 + x / LNG_M, LAT + y / LAT_M]),
  };
}
function pointAt(xM: number, yM: number): { lat: number; lng: number } {
  return { lat: LAT + yM / LAT_M, lng: LNG0 + xM / LNG_M };
}

/** Dense polyline east to `toM`, then straight back (an out-and-back). */
function outAndBack(toM: number, stepM = 50): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let x = 0; x <= toM; x += stepM) pts.push([x, 0]);
  for (let x = toM - stepM; x >= 0; x -= stepM) pts.push([x, 0]);
  return pts;
}

describe('reversalPositions (R25-U11)', () => {
  it('flags the turnaround of an out-and-back (the case uturnCount misses)', () => {
    const geom = line(outAndBack(1500));
    expect(reversalPositions(geom, [pointAt(1500, 0)])).toEqual([0]);
  });

  it('a smooth pass-through and a 90° corner are NOT reversals', () => {
    // straight 3 km east — query the middle
    const straight: Array<[number, number]> = [];
    for (let x = 0; x <= 3000; x += 50) straight.push([x, 0]);
    expect(reversalPositions(line(straight), [pointAt(1500, 0)])).toEqual([]);
    // right-angle corner: east 1 km then north 1 km — 90° < 135° bar
    const corner: Array<[number, number]> = [];
    for (let x = 0; x <= 1000; x += 50) corner.push([x, 0]);
    for (let y = 50; y <= 1000; y += 50) corner.push([1000, y]);
    expect(reversalPositions(line(corner), [pointAt(1000, 0)])).toEqual([]);
    expect(REVERSAL_ANGLE_DEG).toBeGreaterThan(90);
  });

  it('a block-circle reversal (no uturn maneuver would be emitted) is caught', () => {
    // east 1 km, circle a 100 m block (north, west, south), then west home:
    // net direction after the mouth is WEST — a reversal in disguise.
    const pts: Array<[number, number]> = [];
    for (let x = 0; x <= 1000; x += 50) pts.push([x, 0]);
    for (let y = 50; y <= 100; y += 50) pts.push([1000, y]); // up
    for (let x = 950; x >= 900; x -= 50) pts.push([x, 100]); // left
    for (let y = 50; y >= 0; y -= 50) pts.push([900, y]); // down
    for (let x = 850; x >= 0; x -= 50) pts.push([x, 0]); // home, westbound
    expect(reversalPositions(line(pts), [pointAt(1000, 0)])).toEqual([0]);
  });

  it('points whose window does not fit are SKIPPED, never guessed', () => {
    const geom = line(outAndBack(1500));
    // the route's start: no "before" window exists
    expect(reversalPositions(geom, [pointAt(0, 0)])).toEqual([]);
    // multiple points: only the fitting turnaround reports (index 1)
    expect(reversalPositions(geom, [pointAt(0, 0), pointAt(1500, 0)])).toEqual([1]);
  });

  it('degenerate inputs return empty', () => {
    expect(reversalPositions(line([[0, 0]]), [pointAt(0, 0)])).toEqual([]);
    expect(reversalPositions(line(outAndBack(1500)), [])).toEqual([]);
  });
});
