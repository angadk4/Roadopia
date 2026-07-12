import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { microloopEvents } from './overlap';

/**
 * Round 8 — micro-loop (crescent/block-spin) detection. Synthetic geometry at
 * 43.5°N: 0.00001° lat ≈ 1.11 m, lng ≈ 0.81 m.
 */
const ORIGIN = { lat: 43.5, lng: -80.5 };

/** Circle of radius rM centred cM metres east of origin, closed, entered/exited by a stem. */
function circleRoute(rM: number, awayM: number): LineString {
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const cx = ORIGIN.lng + awayM / lngM;
  const cy = ORIGIN.lat;
  const coords: Array<[number, number]> = [];
  // stem out (due east)
  for (let m = 0; m <= awayM - rM; m += 50) coords.push([ORIGIN.lng + m / lngM, ORIGIN.lat]);
  // full circle
  for (let a = 180; a <= 540; a += 5) {
    const rad = (a * Math.PI) / 180;
    coords.push([cx + (rM * Math.cos(rad)) / lngM, cy + (rM * Math.sin(rad)) / latM]);
  }
  // stem back
  for (let m = awayM - rM; m >= 0; m -= 50) coords.push([ORIGIN.lng + m / lngM, ORIGIN.lat]);
  return { type: 'LineString', coordinates: coords };
}

describe('microloopEvents (owner round 8: crescent/block spins)', () => {
  it('fires on a crescent-sized circle far from the origin', () => {
    // r=120 m → circumference ~754 m, area ~45 000 m², 8 km out
    expect(microloopEvents(circleRoute(120, 8_000), ORIGIN)).toBe(1);
  });

  it('ignores normal roundabout geometry (under the length floor)', () => {
    // r=20 m → circumference ~126 m < 150 m floor
    expect(microloopEvents(circleRoute(20, 8_000), ORIGIN)).toBe(0);
  });

  it('exempts circles inside the origin grace (turning around near home)', () => {
    expect(microloopEvents(circleRoute(120, 1_500), ORIGIN)).toBe(0);
  });

  it('ignores large scenic sub-circuits (over the 3 km cap)', () => {
    // r=600 m → circumference ~3.77 km > cap
    expect(microloopEvents(circleRoute(600, 10_000), ORIGIN)).toBe(0);
  });

  it('ignores switchback stacks (parallel legs never CLOSE)', () => {
    const latM = 111_320;
    const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
    const coords: Array<[number, number]> = [];
    // 6 hairpin legs 500 m long, 60 m apart, 8 km east of origin (never
    // within 30 m of a previous leg)
    for (let leg = 0; leg < 6; leg++) {
      const y = ORIGIN.lat + (leg * 60) / latM;
      const xs = leg % 2 === 0 ? [8_000, 8_500] : [8_500, 8_000];
      for (const x of xs) coords.push([ORIGIN.lng + x / lngM, y]);
    }
    expect(microloopEvents({ type: 'LineString', coordinates: coords }, ORIGIN)).toBe(0);
  });

  it('counts distinct spins separately', () => {
    const a = circleRoute(120, 6_000);
    const b = circleRoute(150, 12_000);
    const joined: LineString = {
      type: 'LineString',
      coordinates: [...a.coordinates, ...b.coordinates],
    };
    expect(microloopEvents(joined, ORIGIN)).toBe(2);
  });
});
