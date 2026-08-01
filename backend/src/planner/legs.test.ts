import type { LatLng, LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { driveGeometry, splitLoopLegs } from './legs';

/**
 * R27 — the three-leg split is about to change what every road-class number in
 * the product means, so it gets pinned: it must find the corpus span, refuse to
 * invent a drive that isn't there, and never claim more than the route contains.
 */

const LAT0 = 44.0;
const LNG0 = -80.0;
const M_PER_DEG = 111_320;

/** A straight north line of `lengthM`, sampled every 25 m. */
function line(lengthM: number, fromM = 0): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let d = fromM; d <= fromM + lengthM; d += 25) pts.push([LNG0, LAT0 + d / M_PER_DEG]);
  return pts;
}
const ls = (coordinates: Array<[number, number]>): LineString => ({
  type: 'LineString',
  coordinates,
});
const at = (m: number): LatLng => ({ lat: LAT0 + m / M_PER_DEG, lng: LNG0 });

describe('splitLoopLegs — getting there / the drive / getting home', () => {
  it('splits at the first and last corpus waypoint', () => {
    // 10 km total; corpus waypoints at 2 km and 8 km.
    const g = ls(line(10_000));
    const s = splitLoopLegs(g, [at(2000), at(5000), at(8000)]);
    expect(s).not.toBeNull();
    expect(s!.thereM).toBeGreaterThan(1800);
    expect(s!.thereM).toBeLessThan(2200);
    expect(s!.driveM).toBeGreaterThan(5800);
    expect(s!.driveM).toBeLessThan(6200);
    expect(s!.homeM).toBeGreaterThan(1800);
    expect(s!.homeM).toBeLessThan(2200);
  });

  it('the three legs account for the whole route and nothing more', () => {
    const g = ls(line(10_000));
    const s = splitLoopLegs(g, [at(2000), at(8000)])!;
    expect(s.thereM + s.driveM + s.homeM).toBeGreaterThan(9800);
    expect(s.thereM + s.driveM + s.homeM).toBeLessThan(10_200);
    expect(s.therePct + s.drivePct + s.homePct).toBeGreaterThanOrEqual(99);
    expect(s.therePct + s.drivePct + s.homePct).toBeLessThanOrEqual(101);
  });

  it('REFUSES to report a drive that is a sliver of the trip', () => {
    // A 10 km trip whose corpus span is 500 m is a commute with a detour, not a
    // drive. Claiming "the drive" for it would be exactly the dishonesty this
    // split exists to remove.
    const g = ls(line(10_000));
    expect(splitLoopLegs(g, [at(4800), at(5300)])).toBeNull();
  });

  it('returns null when there is nothing to split on', () => {
    const g = ls(line(10_000));
    expect(splitLoopLegs(g, [])).toBeNull();
    expect(splitLoopLegs(ls([[LNG0, LAT0]]), [at(100)])).toBeNull();
  });

  it('driveGeometry yields ONLY the drive span', () => {
    const g = ls(line(10_000));
    const s = splitLoopLegs(g, [at(2000), at(8000)])!;
    const d = driveGeometry(g, s);
    const c = d.coordinates as Array<[number, number]>;
    expect(c.length).toBeLessThan((g.coordinates as unknown[]).length);
    // starts at ~2 km and ends at ~8 km along the original line
    expect((c[0]![1] - LAT0) * M_PER_DEG).toBeGreaterThan(1800);
    expect((c[c.length - 1]![1] - LAT0) * M_PER_DEG).toBeLessThan(8200);
  });

  it('is deterministic', () => {
    const g = ls(line(10_000));
    const w = [at(2000), at(8000)];
    expect(splitLoopLegs(g, w)).toEqual(splitLoopLegs(g, w));
  });
});
