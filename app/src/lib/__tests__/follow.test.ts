import type { LineString, Maneuver } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  anchorsFromMatched,
  buildFollowTrack,
  decimateForMatch,
  derivedGuidanceUsable,
  etaSeconds,
  fmtDistance,
  fmtDuration,
  followStatus,
  locateOnTrack,
  matchAgrees,
  pointAtDistance,
  splitAtAlong,
  trimProgressWindow,
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

  it('a saved multi-leg drive never anchors "you have arrived" mid-drive (device pass, 2026-09-07)', () => {
    // as the engine returned a hand-built drive with a waypoint at 4 km: the
    // first leg "arrives" there (length 0) and the second "starts" again on
    // the same road — the card read "then: You have arrived at your destination"
    const t = buildFollowTrack(LINE, [
      { type: 'start', instruction: 'Drive east.', distance_m: 4000, street_names: ['Main St'] },
      { type: 'destination', instruction: 'You have arrived at your destination.', distance_m: 0 },
      {
        type: 'start',
        instruction: 'Drive east on Main St.',
        distance_m: 1000,
        street_names: ['Main St'],
      },
      {
        type: 'left',
        instruction: 'Turn left onto Forks Rd.',
        distance_m: 2000,
        street_names: ['Forks Rd'],
      },
      { type: 'destination', instruction: 'You have arrived at your destination.', distance_m: 0 },
    ]);
    expect(t.anchors.map((a) => a.instruction)).toEqual([
      'Turn left onto Forks Rd.',
      'You have arrived at your destination.',
    ]);
    // the turn is still at 5/7 of the line: the folded leg kept the running sum honest
    expect(t.anchors[0]!.atM / t.totalM).toBeCloseTo(5 / 7, 2);
    const st = followStatus(t, { lat: 43, lng: -80 }, null);
    expect(st.hint?.instruction).toBe('Turn left onto Forks Rd.');
    expect(st.then?.instruction).toBe('You have arrived at your destination.');
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
    // a real value, not the formula restated: ~1.6 km along an ~8.1 km line
    expect(st.alongM).toBeGreaterThan(1500);
    expect(st.alongM).toBeLessThan(1800);
    expect(st.remainingM).toBeGreaterThan(6300);
    expect(st.remainingM).toBeLessThan(6700);
    expect(st.hint!.instruction).toBe('Turn left onto Forks Rd.');
    expect(st.hint!.inM).toBeGreaterThan(2000);
  });

  it('flags off-route without swinging progress, and never re-routes', () => {
    const st = followStatus(t, { lat: 43.02, lng: -79.95 }, 1600); // ~2.2 km north
    expect(st.offRoute).toBe(true);
    expect(st.alongM).toBe(1600); // held at last known progress
    expect(st.hint).toBeNull();
  });

  it('is done only near the end AFTER real progress', () => {
    const end = { lat: 43, lng: -79.9 };
    expect(followStatus(t, end, null).done).toBe(false); // teleported to end
    expect(followStatus(t, end, t.totalM * 0.95).done).toBe(true);
  });
});

describe('a LOOP starts at its start (regression)', () => {
  /** first vertex == last vertex, so the origin projects equally onto metre 0
   *  and metre `totalM`; GPS noise used to decide which, and 11 of 24 bearings
   *  picked the END — follow-mode announced "that's the drive" while parked. */
  const ring: LineString = {
    type: 'LineString',
    coordinates: Array.from({ length: 61 }, (_, i) => {
      const a = (i / 60) * Math.PI * 2;
      return [-79.9 + 0.05 * Math.cos(a) * 1.37, 43.4 + 0.05 * Math.sin(a)];
    }),
  };
  (ring.coordinates as number[][])[60] = (ring.coordinates as number[][])[0]!;

  it('never reports done at the origin, from any approach bearing', () => {
    const t = buildFollowTrack(ring, []);
    const [lng0, lat0] = ring.coordinates[0] as [number, number];
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const fix = {
        lat: lat0 + (6 * Math.cos(rad)) / 111_320,
        lng: lng0 + (6 * Math.sin(rad)) / (111_320 * Math.cos((lat0 * Math.PI) / 180)),
      };
      const first = followStatus(t, fix, null);
      const second = followStatus(t, fix, first.alongM);
      expect(second.done).toBe(false);
      expect(second.remainingM).toBeGreaterThan(t.totalM * 0.9);
    }
  });

  it('still finishes once the driver has actually gone round', () => {
    const t = buildFollowTrack(ring, []);
    const [lng0, lat0] = ring.coordinates[0] as [number, number];
    const st = followStatus(t, { lat: lat0, lng: lng0 }, t.totalM * 0.97);
    expect(st.done).toBe(true);
  });
});

describe('degenerate geometry degrades, never crashes', () => {
  it('a 1-point or empty line yields an off-route zero rather than a TypeError', () => {
    for (const coords of [[], [[-79.9, 43.2]]]) {
      const t = buildFollowTrack({ type: 'LineString', coordinates: coords } as LineString, []);
      const st = followStatus(t, { lat: 43.2, lng: -79.9 }, null);
      expect(st.alongM).toBe(0);
      expect(st.done).toBe(false);
    }
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

describe('guidance travelling with the route (device pass, 2026-09-04)', () => {
  const t = buildFollowTrack(LINE, MANEUVERS);

  it('pointAtDistance walks the line and clamps at both ends', () => {
    expect(pointAtDistance(t, -5)).toEqual({ lat: 43, lng: -80 });
    expect(pointAtDistance(t, t.totalM + 5)).toEqual({ lat: 43, lng: -79.9 });
    const mid = pointAtDistance(t, t.totalM / 2);
    expect(mid.lng).toBeCloseTo(-79.95, 3);
    expect(mid.lat).toBeCloseTo(43, 6);
  });

  it('a matched line that rebuilt the whole drive yields every turn, in order', () => {
    const d = anchorsFromMatched(t, LINE, MANEUVERS);
    expect(d.total).toBe(2);
    expect(d.kept).toBe(2);
    expect(d.anchors.map((a) => a.instruction)).toEqual(['Turn left onto Forks Rd.', 'Arrive.']);
    // anchored by POSITION: the turn sits 4,000 real metres along the matched
    // line (not at 4/7 of it — the engine's metres are the truth here)
    expect(d.anchors[0]!.atM).toBeCloseTo(4000, -2);
    expect(derivedGuidanceUsable(d)).toBe(true);
  });

  it('a matcher SHORTCUT drops only the turns inside it — the rest survive', () => {
    // the matcher rebuilt just the first 40 % of the line (the retraced-stem
    // shortcut a closed loop always provokes); its turns fall ON our line, so
    // they are kept — the old whole-set length gate refused all of them
    const fragment: LineString = {
      type: 'LineString',
      coordinates: LINE.coordinates.slice(0, 5),
    };
    const turns: Maneuver[] = [
      { type: 'start', instruction: 'Drive east.', distance_m: 1600 },
      { type: 'turn', instruction: 'Turn left onto Forks Rd.', distance_m: 1600 },
      { type: 'end', instruction: 'Arrive.', distance_m: 0 },
    ];
    const d = anchorsFromMatched(t, fragment, turns);
    expect(d.kept).toBe(2);
    expect(d.anchors[0]!.atM).toBeGreaterThan(1400);
    expect(d.anchors[0]!.atM).toBeLessThan(1800);
  });

  it('turns from an unrelated match land off the line and the set is refused', () => {
    const elsewhere: LineString = {
      type: 'LineString',
      coordinates: LINE.coordinates.map(([lng, lat]) => [lng!, lat! + 0.05]),
    };
    const d = anchorsFromMatched(t, elsewhere, MANEUVERS);
    expect(d.kept).toBe(0);
    expect(d.total).toBe(2);
    expect(derivedGuidanceUsable(d)).toBe(false);
  });

  it('followStatus also offers the turn AFTER the next one', () => {
    const three: Maneuver[] = [
      { type: 'start', instruction: 'Drive east.', distance_m: 2000 },
      { type: 'turn', instruction: 'Turn left.', distance_m: 1000 },
      { type: 'turn', instruction: 'Turn right.', distance_m: 4000 },
      { type: 'end', instruction: 'Arrive.', distance_m: 0 },
    ];
    const tt = buildFollowTrack(LINE, three);
    const st = followStatus(tt, { lat: 43, lng: -79.99 }, null); // ~800 m along
    expect(st.hint!.instruction).toBe('Turn left.');
    expect(st.then!.instruction).toBe('Turn right.');
  });

  it('splitAtAlong yields driven + ahead lines that meet at the cut', () => {
    const half = splitAtAlong(t, t.totalM / 2);
    expect(half.behind!.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(half.ahead!.coordinates.length).toBeGreaterThanOrEqual(2);
    const cut = half.behind!.coordinates[half.behind!.coordinates.length - 1];
    expect(half.ahead!.coordinates[0]).toEqual(cut);
    expect(splitAtAlong(t, 0).behind).toBeNull();
    expect(splitAtAlong(t, t.totalM).ahead).toBeNull();
  });

  it('the windowed locate falls back to the whole line when the window is off-route', () => {
    // progress says "near the end"; the fix is at the start (the same loop
    // driven again from home) — the window finds nothing on-route, the full
    // scan does, and progress honestly restarts
    const loc = locateOnTrack(t, { lat: 43, lng: -79.999 }, t.totalM - 200);
    expect(loc.offTrackM).toBeLessThan(30);
    expect(loc.alongM).toBeLessThan(200);
  });

  it('etaSeconds: the planned pace until a real window of progress exists, then the windowed rate', () => {
    expect(etaSeconds(10_000, [], 40_000, 3_600)).toBeCloseTo(900, 0);
    // 20 m/s for two minutes (2.4 km): the observed pace takes over
    const cruise = Array.from({ length: 13 }, (_, i) => ({ t: i * 10_000, alongM: i * 200 }));
    expect(etaSeconds(10_000, cruise, 40_000, 3_600)).toBeCloseTo(500, 0);
    // a 45 s red light inside the window moves the estimate a little — never 4×
    const light = [
      ...cruise,
      ...Array.from({ length: 5 }, (_, i) => ({ t: 120_000 + (i + 1) * 9_000, alongM: 2_400 })),
    ];
    const eta = etaSeconds(10_000, light, 40_000, 3_600)!;
    expect(eta).toBeGreaterThan(500);
    expect(eta).toBeLessThan(750);
    // too little to judge (30 s / 600 m) → still the planned pace
    expect(
      etaSeconds(
        10_000,
        [
          { t: 0, alongM: 0 },
          { t: 30_000, alongM: 600 },
        ],
        40_000,
        3_600,
      ),
    ).toBeCloseTo(900, 0);
    // parked for the whole window → no progress → planned pace, not infinity
    const parked = Array.from({ length: 10 }, (_, i) => ({ t: i * 10_000, alongM: 5_000 }));
    expect(etaSeconds(10_000, parked, 40_000, 3_600)).toBeCloseTo(900, 0);
    expect(etaSeconds(10_000, [], 0, 0)).toBeNull();
    // the window forgets what is older than PACE_WINDOW_MS
    expect(trimProgressWindow(cruise, 400_000)).toHaveLength(0);
    expect(trimProgressWindow(cruise, 120_000)).toHaveLength(13);
  });

  it('fmtDuration reads as a duration', () => {
    expect(fmtDuration(720)).toBe('12 min');
    expect(fmtDuration(4_800)).toBe('1 h 20 min');
    expect(fmtDuration(7_200)).toBe('2 h');
  });
});

describe('driving logic (review, 2026-09-07)', () => {
  /** An out-and-back: 2 km east, then straight back over the same road. */
  const OUT_AND_BACK: LineString = {
    type: 'LineString',
    coordinates: [
      [-80, 43],
      [-79.99, 43],
      [-79.98, 43],
      [-79.99, 43],
      [-80, 43],
    ],
  };
  const EW = 0.01 * 111_320 * Math.cos((43 * Math.PI) / 180); // ~814 m per vertex

  it('progress never walks backwards through a U-turn when the course is known', () => {
    const t = buildFollowTrack(OUT_AND_BACK, [
      { type: 'start', instruction: 'Drive east.', distance_m: 2 * EW },
      { type: 'uturn_left', instruction: 'Make a U-turn.', distance_m: 2 * EW },
      { type: 'destination', instruction: 'Arrive.', distance_m: 0 },
    ]);
    let last: number | null = null;
    let minAlong: number | null = null;
    const trail: number[] = [];
    for (let d = 0; d <= t.totalM; d += 15) {
      const heading = d < t.totalM / 2 ? 90 : 270; // east out, west home
      const st = followStatus(t, pointAtDistance(t, d), last, {
        course: { headingDeg: heading, speedMps: 15 },
        minAlongM: minAlong,
      });
      expect(st.offRoute).toBe(false);
      trail.push(st.alongM);
      last = st.alongM;
      minAlong = minAlong === null ? st.alongM : Math.min(minAlong, st.alongM);
    }
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i]!).toBeGreaterThanOrEqual(trail[i - 1]! - 1);
    }
    // ...and the U-turn hint is gone once the car is heading home
    const home = followStatus(t, pointAtDistance(t, t.totalM * 0.7), t.totalM * 0.69, {
      course: { headingDeg: 270, speedMps: 15 },
      minAlongM: 0,
    });
    expect(home.hint?.instruction).toBe('Arrive.');
    // arrival is recognised at the end
    const end = followStatus(t, pointAtDistance(t, t.totalM), t.totalM - 20, {
      course: { headingDeg: 270, speedMps: 15 },
      minAlongM: 0,
    });
    expect(end.done).toBe(true);
  });

  it('without a course (parked, or no heading) the old position rule still applies', () => {
    const t = buildFollowTrack(OUT_AND_BACK, []);
    const st = followStatus(t, pointAtDistance(t, 400), 380, {
      course: { headingDeg: null, speedMps: 0 },
    });
    expect(st.alongM).toBeCloseTo(400, 0);
  });

  it('a turn stays the hint AT its junction and hands over once it is passed', () => {
    const t = buildFollowTrack(LINE, MANEUVERS);
    const turnAt = t.anchors[0]!.atM;
    const before = followStatus(t, pointAtDistance(t, turnAt - 5), turnAt - 20);
    expect(before.hint?.instruction).toBe('Turn left onto Forks Rd.');
    expect(before.hint?.inM).toBeCloseTo(5, 0);
    const at = followStatus(t, pointAtDistance(t, turnAt), turnAt - 5);
    expect(at.hint?.instruction).toBe('Turn left onto Forks Rd.');
    const past = followStatus(t, pointAtDistance(t, turnAt + 30), turnAt);
    expect(past.hint?.instruction).toBe('Arrive.');
  });

  it('a first fix that is OFF the line seeds no progress, and cannot finish a loop at its origin', () => {
    const ring: LineString = {
      type: 'LineString',
      coordinates: Array.from({ length: 61 }, (_, i) => {
        const a = (i / 60) * Math.PI * 2;
        return [-79.9 + 0.05 * Math.cos(a) * 1.37, 43.4 + 0.05 * Math.sin(a)];
      }),
    };
    (ring.coordinates as number[][])[60] = (ring.coordinates as number[][])[0]!;
    const t = buildFollowTrack(ring, []);
    // parked 200 m OUTSIDE the ring, nearest to its last stretch
    const near = pointAtDistance(t, t.totalM - 300);
    const off = { lat: near.lat + 200 / 111_320, lng: near.lng + 200 / 81_400 };
    const first = followStatus(t, off, null, { minAlongM: null });
    expect(first.offRoute).toBe(true);
    expect(first.alongM).toBe(0); // no progress to keep yet
    expect(first.remainingM).toBeCloseTo(t.totalM, 0);
    // the screen commits nothing off-route, so lastAlong stays null → the
    // origin resolves to the START on the first on-route fix
    const [lng0, lat0] = ring.coordinates[0] as [number, number];
    const atOrigin = followStatus(t, { lat: lat0, lng: lng0 }, null, { minAlongM: null });
    expect(atOrigin.alongM).toBeLessThan(50);
    expect(atOrigin.done).toBe(false);
    const second = followStatus(t, { lat: lat0, lng: lng0 }, atOrigin.alongM, {
      minAlongM: atOrigin.alongM,
    });
    expect(second.done).toBe(false);
    expect(second.remainingM).toBeGreaterThan(t.totalM * 0.9);
    // and even a car that somehow joined the line at the end never "finishes" it
    const joinedLate = followStatus(t, { lat: lat0, lng: lng0 }, t.totalM - 10, {
      minAlongM: t.totalM - 300,
    });
    expect(joinedLate.done).toBe(false);
  });
});

describe('anchoring on a retraced stem (review, 2026-09-04)', () => {
  // A → stem east (~4.9 km) → B → a rectangular ring back to B → the same
  // stem home to A. Every point on the stem projects onto BOTH the outbound
  // and the homebound copy; the ring turns are matched 330 m off our line so
  // they drop, which is exactly the gap that let a homebound turn be pinned
  // onto the outbound copy.
  const A: [number, number] = [-80, 43];
  const B: [number, number] = [-79.94, 43];
  const ring: Array<[number, number]> = [B, [-79.94, 43.02], [-79.92, 43.02], [-79.92, 43], B];
  const LOOP: LineString = { type: 'LineString', coordinates: [A, ...ring, A] };
  const OFF = 0.003; // ~330 m — beyond OFF_ROUTE_M
  const MATCHED_RING_OFF: LineString = {
    type: 'LineString',
    coordinates: [A, B, [-79.94, 43.02 + OFF], [-79.92, 43.02 + OFF], [-79.92, 43 + OFF], B, A],
  };
  const STEM = 0.06 * 111_320 * Math.cos((43 * Math.PI) / 180); // ~4,885 m
  const NS = 0.02 * 111_320; // ~2,226 m
  const EW = 0.02 * 111_320 * Math.cos((43 * Math.PI) / 180); // ~1,628 m
  const TURNS: Maneuver[] = [
    { type: 'start', instruction: 'Drive east.', distance_m: STEM },
    { type: 'left', instruction: 'Turn left onto Ring Rd.', distance_m: NS },
    { type: 'right', instruction: 'Turn right.', distance_m: EW },
    { type: 'right', instruction: 'Turn right.', distance_m: NS },
    { type: 'right', instruction: 'Turn right onto Ring Rd.', distance_m: EW },
    { type: 'left', instruction: 'Turn left onto Stem Rd toward home.', distance_m: STEM },
    { type: 'end', instruction: 'Arrive.', distance_m: 0 },
  ];

  it('a homebound turn on the stem is anchored on the HOMEBOUND copy, not the outbound one', () => {
    const t = buildFollowTrack(LOOP, []);
    const d = anchorsFromMatched(t, MATCHED_RING_OFF, TURNS);
    const home = d.anchors.find((a) => a.instruction.includes('toward home'))!;
    expect(home).toBeDefined();
    expect(home.atM).toBeGreaterThan(STEM + 7000); // after the ring, not at 4.9 km
    // a driver still outbound never sees the homebound turn as the NEXT one
    const guided = { ...t, anchors: d.anchors };
    const st = followStatus(guided, { lat: 43, lng: -79.945 }, 4000); // ~4.5 km out
    expect(st.hint).not.toBeNull();
    expect(st.hint!.instruction).toBe('Turn left onto Ring Rd.');
    expect(st.hint!.instruction).not.toContain('toward home');
  });

  it('with the whole loop matched, every turn lands in order', () => {
    const t = buildFollowTrack(LOOP, []);
    const d = anchorsFromMatched(t, LOOP, TURNS);
    expect(d.kept).toBe(6);
    for (let i = 1; i < d.anchors.length; i++) {
      expect(d.anchors[i]!.atM).toBeGreaterThan(d.anchors[i - 1]!.atM);
    }
  });
});
