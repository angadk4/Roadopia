import type { LineString, Maneuver } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  buildFollowTrack,
  decimateForMatch,
  fmtDistance,
  followStatus,
  locateOnTrack,
  matchAgrees,
  OFF_ROUTE_M,
} from '../follow';

/** M9-T06 — follow-mode geometry (FR-110/111). */

/** Straight east–west line at lat 43: ~8.1 km in 0.1° lng steps (~810 m each). */
const LINE: LineString = {
  type: 'LineString',
  coordinates: Array.from({ length: 11 }, (_, i) => [-80 + i * 0.01, 43]),
};

const MANEUVERS: Maneuver[] = [
  { type: 'start', instruction: 'Drive east.', distance_m: 4000 },
  { type: 'turn', instruction: 'Turn left onto Forks Rd.', distance_m: 3000 },
  { type: 'end', instruction: 'Arrive.', distance_m: 0 },
];

describe('buildFollowTrack', () => {
  it('anchors maneuvers proportionally along the line, skipping the start', () => {
    const t = buildFollowTrack(LINE, MANEUVERS);
    expect(t.totalM).toBeGreaterThan(7000);
    // start at 0 is not an anchor; the turn sits at 4000/7000 of the line
    expect(t.anchors).toHaveLength(2);
    expect(t.anchors[0]!.instruction).toBe('Turn left onto Forks Rd.');
    expect(t.anchors[0]!.atM / t.totalM).toBeCloseTo(4 / 7, 2);
  });

  it('yields no anchors without maneuvers — guidance honestly absent', () => {
    expect(buildFollowTrack(LINE, []).anchors).toHaveLength(0);
  });
});

describe('locateOnTrack', () => {
  const t = buildFollowTrack(LINE, []);

  it('projects a nearby fix with its along-distance', () => {
    // just north of the midpoint (~4.05 km along)
    const loc = locateOnTrack(t, { lat: 43.0002, lng: -79.95 }, null);
    expect(loc.offTrackM).toBeLessThan(30);
    expect(loc.alongM / t.totalM).toBeCloseTo(0.5, 1);
  });

  it('resolves an overlapping out-and-back stem by progress, not proximity', () => {
    // A line that goes east then returns west over the same street.
    const stem: LineString = {
      type: 'LineString',
      coordinates: [
        [-80, 43],
        [-79.99, 43],
        [-79.98, 43],
        [-79.99, 43.0001], // hairpin offset so segments aren't identical
        [-80, 43.0001],
      ],
    };
    const st = buildFollowTrack(stem, []);
    const fix = { lat: 43.00005, lng: -79.995 }; // equidistant from both passes
    const outbound = locateOnTrack(st, fix, 100);
    const homebound = locateOnTrack(st, fix, st.totalM - 900);
    expect(outbound.alongM).toBeLessThan(st.totalM / 2);
    expect(homebound.alongM).toBeGreaterThan(st.totalM / 2);
  });
});

describe('followStatus', () => {
  const t = buildFollowTrack(LINE, MANEUVERS);

  it('reports remaining distance and the next turn ahead', () => {
    const st = followStatus(t, { lat: 43, lng: -79.98 }, null); // ~1.6 km along
    expect(st.offRoute).toBe(false);
    expect(st.remainingM).toBeCloseTo(t.totalM - st.alongM, 5);
    expect(st.hint!.instruction).toBe('Turn left onto Forks Rd.');
    expect(st.hint!.inM).toBeGreaterThan(2000);
  });

  it('flags off-route without swinging progress, and never re-routes', () => {
    const st = followStatus(t, { lat: 43.02, lng: -79.95 }, 1600); // ~2.2 km north
    expect(st.offRoute).toBe(true);
    expect(st.alongM).toBe(1600); // held at last known progress
    expect(st.hint).toBeNull();
    expect(OFF_ROUTE_M).toBeLessThan(2000);
  });

  it('is done only near the end AFTER real progress', () => {
    const end = { lat: 43, lng: -79.9 };
    expect(followStatus(t, end, null).done).toBe(false); // teleported to end
    expect(followStatus(t, end, t.totalM * 0.95).done).toBe(true);
  });
});

describe('guidance honesty', () => {
  it('trusts derived maneuvers only when the match rebuilt the same line', () => {
    expect(matchAgrees(10_000, 10_400)).toBe(true);
    expect(matchAgrees(10_000, 12_000)).toBe(false); // different route — no hints
    expect(matchAgrees(0, 5_000)).toBe(false);
  });

  it('decimates long lines under the /match cap, keeping the endpoints', () => {
    const long: LineString = {
      type: 'LineString',
      coordinates: Array.from({ length: 4000 }, (_, i) => [-80 + i * 0.0001, 43]),
    };
    const trace = decimateForMatch(long, 1500);
    expect(trace).toHaveLength(1500);
    expect(trace[0]!.lng).toBeCloseTo(-80, 6);
    expect(trace[1499]!.lng).toBeCloseTo(-80 + 3999 * 0.0001, 6);
    expect(decimateForMatch(LINE, 1500)).toHaveLength(11);
  });
});

describe('fmtDistance', () => {
  it('metres under 1 km, one-decimal km above', () => {
    expect(fmtDistance(784)).toBe('780 m');
    expect(fmtDistance(12_440)).toBe('12.4 km');
  });
});
