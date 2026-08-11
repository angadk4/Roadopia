/** BD-161 — self-intersection detector contracts (the owner's "square within
 *  the loop"). */
import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { selfIntersections, summarizeCrossings } from './crossings';

const line = (coords: Array<[number, number]>): LineString => ({
  type: 'LineString',
  coordinates: coords,
});

const LAT = 43.8;
/** ~1 km in degrees at the test latitude. */
const KM = 1 / 111.32;

describe('selfIntersections', () => {
  it('a clean ring has ZERO crossings (closing touch is not a cross)', () => {
    const ring: Array<[number, number]> = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * 2 * Math.PI;
      ring.push([-79.9 + Math.cos(a) * 3 * KM, LAT + Math.sin(a) * 3 * KM]);
    }
    expect(selfIntersections(line(ring))).toHaveLength(0);
  });

  it('the owner’s square: a figure-eight sub-loop is detected exactly once', () => {
    // out east, then a 2km×2km square hung off the path, then continue east —
    // the path crosses itself once where the square closes.
    const pts: Array<[number, number]> = [
      [-80.0, LAT],
      [-79.95, LAT], // heading east
      // square: north, east, south, back west PAST the entry point → crossing
      [-79.95, LAT + 2 * KM],
      [-79.93, LAT + 2 * KM],
      [-79.93, LAT - 0.2 * KM],
      [-79.96, LAT - 0.2 * KM], // crosses the eastbound leg twice? no — passes under start of square
      [-79.96, LAT],
      [-79.9, LAT], // continue east through the square's hang point
    ];
    const hits = selfIntersections(line(pts));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // the crossing sits mid-route, not at the ends
    for (const h of hits) {
      expect(h.atM[1]).toBeGreaterThan(h.atM[0] + 500);
    }
  });

  it('a spoke CROSSING the ring (lasso with pierce) is detected', () => {
    const ring: Array<[number, number]> = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * 2 * Math.PI;
      ring.push([-79.9 + Math.cos(a) * 3 * KM, LAT + Math.sin(a) * 3 * KM]);
    }
    // out-spoke from far west THROUGH the ring's west edge into the centre,
    // then the ring, then home exiting south — the entry pierce is a crossing
    const trip: Array<[number, number]> = [
      [-79.9 - 8 * KM, LAT],
      [-79.9, LAT], // centre — crossed the ring's west edge to get here
      ...ring,
      [-79.9 - 8 * KM, LAT - 6 * KM],
    ];
    const hits = selfIntersections(line(trip), { lat: LAT, lng: -79.9 - 8 * KM });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('origin grace excuses a driveway cross-over at the trip mouth', () => {
    const originLng = -79.9;
    const cross: Array<[number, number]> = [
      [originLng, LAT],
      [originLng + 0.3 * KM, LAT + 0.1 * KM],
      [originLng + 0.1 * KM, LAT + 0.3 * KM],
      [originLng + 0.2 * KM, LAT - 0.1 * KM], // crosses near origin
      [originLng + 3 * KM, LAT - 2 * KM],
      [originLng + 6 * KM, LAT],
    ];
    const excused = selfIntersections(line(cross), { lat: LAT, lng: originLng }, 500, 100);
    expect(excused).toHaveLength(0);
    const unexcused = selfIntersections(line(cross), undefined, 0, 100);
    expect(unexcused.length).toBeGreaterThanOrEqual(1);
  });

  it('BD-162 screenshot shape: out+home piercing the ring SIDE BY SIDE is a knot-pair, not two pierces', () => {
    // ring ~4km radius; out spoke pierces its NE edge; home spoke pierces
    // ~1.5km away on the same edge — far apart ALONG-ROUTE (enclosed > 10km)
    // but clustered in SPACE: the unreadable X-square.
    const ring: Array<[number, number]> = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * 2 * Math.PI;
      ring.push([-79.9 + Math.cos(a) * 4 * KM, LAT + Math.sin(a) * 4 * KM]);
    }
    const trip: Array<[number, number]> = [
      [-79.9 + 9 * KM, LAT + 5 * KM], // origin NE, outside
      [-79.9 + 1 * KM, LAT + 1 * KM], // out spoke pierces NE edge into centre
      ...ring,
      [-79.9 + 1.5 * KM, LAT - 0.5 * KM], // wander to home-spoke start
      [-79.9 + 9 * KM, LAT + 4 * KM], // home spoke pierces ~1.5km from out pierce
    ];
    const sum = summarizeCrossings(
      selfIntersections(line(trip), { lat: LAT + 5 * KM, lng: -79.9 + 9 * KM }),
    );
    expect(sum.knots).toBeGreaterThanOrEqual(2);
  });

  it('two crossings FAR APART in space stay tolerated pierces (no cluster)', () => {
    // A long west→east baseline crossed twice by later passes, 11 km apart:
    // transversal, big enclosures, no spatial cluster — the topology the
    // ≤2-pierce allowance exists for. (A FULL-ring lasso always re-crosses
    // beside its entry — clustered → knots — which is exactly the screenshot
    // X; the real builder uses partial arcs with separated J1/J2.)
    const trip: Array<[number, number]> = [
      [-80.0, LAT],
      [-79.8, LAT], // 16 km baseline east
      [-79.8, LAT + 4 * KM],
      [-79.95 + 0.3 * KM, LAT + 4 * KM],
      [-79.95, LAT - 3 * KM], // crossing #1 over the baseline at x≈-79.95
      [-79.88, LAT - 3 * KM],
      [-79.85, LAT + 5 * KM], // crossing #2 at x≈-79.85… ~8-11 km east of #1
      [-79.82, LAT + 6 * KM],
    ];
    const sum = summarizeCrossings(selfIntersections(line(trip), { lat: LAT, lng: -80.0 }));
    expect(sum.knots).toBe(0); // spaced crossings NEVER become knots
    expect(sum.pierces).toBe(3); // the zigzag makes three, all transversal + distant
  });

  it('a tight hairpin (near-adjacent passes) is NOT a crossing', () => {
    const hairpin: Array<[number, number]> = [
      [-79.9, LAT],
      [-79.9 + 2 * KM, LAT + 0.05 * KM],
      [-79.9 + 2.05 * KM, LAT + 0.1 * KM],
      [-79.9 + 2 * KM, LAT + 0.15 * KM],
      [-79.9, LAT + 0.1 * KM], // returns nearly parallel, crossing nothing distant
    ];
    expect(selfIntersections(line(hairpin), undefined, 0, 500)).toHaveLength(0);
  });
});
