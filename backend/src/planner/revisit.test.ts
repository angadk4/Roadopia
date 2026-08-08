import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { REVISIT_NEAR_M, revisitCount, revisitPlaces } from './revisit';

/**
 * R28 — the detector for the owner's "in and out of Inglewood many times".
 * It is about to gate real routes, so it is pinned against the two ways it
 * could be worthless: firing on a correct loop closing at its origin, and
 * firing on a route that merely passes near itself once.
 */

const LAT0 = 44.0;
const LNG0 = -80.0;
const M_LAT = 111_320;
const M_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

const ls = (coordinates: Array<[number, number]>): LineString => ({
  type: 'LineString',
  coordinates,
});

/** Straight run between two points in metre-offsets from (LAT0, LNG0). */
function leg(from: [number, number], to: [number, number], stepM = 50): Array<[number, number]> {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.ceil(len / stepM));
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const x = from[0] + (dx * i) / n;
    const y = from[1] + (dy * i) / n;
    out.push([LNG0 + x / M_LNG, LAT0 + y / M_LAT]);
  }
  return out;
}

describe('revisitPlaces — the "back in Inglewood again" detector', () => {
  it('fires when the route returns to the same place from a different direction', () => {
    // A figure-eight through a crossroads at (0,0): the route passes the SAME
    // junction twice, on different roads, with kilometres in between. No shared
    // edge, no u-turn, no closed micro-circuit — invisible to every other
    // detector, and exactly what the owner described.
    const hub: [number, number] = [0, 0];
    const pts = [
      ...leg([-4000, 0], hub),
      ...leg(hub, [0, 4000]),
      ...leg([0, 4000], [4000, 4000]),
      ...leg([4000, 4000], [4000, 0]),
      ...leg([4000, 0], hub),
      ...leg(hub, [0, -4000]),
    ];
    const r = revisitPlaces(ls(pts));
    expect(r.places.length).toBeGreaterThan(0);
    expect(r.worstPasses).toBeGreaterThanOrEqual(2);
  });

  it('does NOT fire on a clean rectangular loop that never returns', () => {
    const pts = [
      ...leg([0, 0], [5000, 0]),
      ...leg([5000, 0], [5000, 5000]),
      ...leg([5000, 5000], [0, 5000]),
      ...leg([0, 5000], [0, 0]),
    ];
    // origin grace covers the closing corner, which is not a defect
    expect(revisitCount(ls(pts), { lat: LAT0, lng: LNG0 })).toBe(0);
  });

  it('does NOT count the loop closing at its own origin as a revisit', () => {
    // THE false positive that would make this detector fire on every correct
    // loop: a loop is supposed to end where it started.
    const pts = [
      ...leg([0, 0], [6000, 0]),
      ...leg([6000, 0], [6000, 6000]),
      ...leg([6000, 6000], [0, 6000]),
      ...leg([0, 6000], [0, 0]),
    ];
    const withOrigin = revisitCount(ls(pts), { lat: LAT0, lng: LNG0 });
    expect(withOrigin).toBe(0);
  });

  it('needs real along-route separation, not just spatial nearness', () => {
    // A single straight run: consecutive vertices are within REVISIT_NEAR_M of
    // each other, but there is no RETURN. Must be silent.
    const pts = leg([0, 0], [8000, 0]);
    expect(revisitCount(ls(pts))).toBe(0);
    expect(REVISIT_NEAR_M).toBeGreaterThan(0);
  });

  it('is deterministic and safe on degenerate input', () => {
    expect(revisitPlaces(ls([]))).toEqual({ places: [], worstPasses: 0 });
    const pts = [...leg([-3000, 0], [0, 0]), ...leg([0, 0], [0, 3000]), ...leg([0, 3000], [0, 0])];
    expect(revisitPlaces(ls(pts))).toEqual(revisitPlaces(ls(pts)));
  });
});
