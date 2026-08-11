/** BD-146 — every bar maps to a sentence the owner said. Each test flips ONE
 *  metric across its bar so a regression names the exact standard it broke. */
import { describe, expect, it } from 'vitest';

import {
  driveClosedLoopiness,
  judgeTrip,
  TRIP_COMMUTE_SHARE_MAX,
  TRIP_CONNECTOR_OVERLAP_MAX,
  TRIP_CORE_OVERLAP_MAX,
  TRIP_DURATION_TOL,
  TRIP_LOOPINESS_MIN,
  TRIP_OAB_MAX_M,
  tripShapeMetrics,
  type TripMetrics,
} from './trip_gates';

/** A trip that honours every one of the owner's rules. */
const CLEAN: TripMetrics = {
  durationS: 3600,
  targetS: 3600,
  loopiness: 0.4,
  oabLongestM: 300,
  spurs: 0,
  microloops: 0,
  knots: 0,
  pierces: 0,
  uturns: 0,
  commuteShare: 0.35,
  outHomeOverlap: 0.05,
  outCoreOverlap: 0.0,
  homeCoreOverlap: 0.0,
};

describe('judgeTrip (the owner’s words as gates)', () => {
  it('passes a clean trip', () => {
    expect(judgeTrip(CLEAN)).toEqual({ pass: true, failures: [] });
  });

  it('"1 hour means 1 hour" — trip duration judged against the ask', () => {
    // The R29 defect exactly: 106 minutes served for a 60-minute ask.
    const v = judgeTrip({ ...CLEAN, durationS: 106 * 60 });
    expect(v.pass).toBe(false);
    expect(v.failures).toContain('trip_duration');
    // the tolerance edge passes
    expect(judgeTrip({ ...CLEAN, durationS: 3600 * (1 + TRIP_DURATION_TOL) }).pass).toBe(true);
  });

  it('"loops should look like loops" — whole-trip loopiness, core bar', () => {
    // rq30 measured mean 0.14 on served trips; every one must now fail here.
    const v = judgeTrip({ ...CLEAN, loopiness: 0.14 });
    expect(v.failures).toContain('not_a_loop');
    expect(judgeTrip({ ...CLEAN, loopiness: TRIP_LOOPINESS_MIN }).pass).toBe(true);
    // degenerate geometry can never pass as a loop
    expect(judgeTrip({ ...CLEAN, loopiness: null }).failures).toContain('not_a_loop');
  });

  it('"no same roads twice" — doubling at the legacy reject bar', () => {
    const v = judgeTrip({ ...CLEAN, oabLongestM: TRIP_OAB_MAX_M + 1 });
    expect(v.failures).toContain('doubling');
  });

  it('"random street then a u-turn" — zero spurs, zero crescents', () => {
    expect(judgeTrip({ ...CLEAN, spurs: 1 }).failures).toContain('spurs');
    expect(judgeTrip({ ...CLEAN, microloops: 1 }).failures).toContain('microloops');
  });

  it('BD-164: a loop is a SIMPLE CLOSED CURVE — zero self-crossings of any kind, zero u-turns', () => {
    expect(judgeTrip({ ...CLEAN, knots: 1 }).failures).toContain('self_crossing');
    // the figure-eight the owner photographed: ONE far crossing, big lobes —
    // the old "pierce tolerance" served it; it can never pass again.
    expect(judgeTrip({ ...CLEAN, pierces: 1 }).failures).toContain('self_crossing');
    expect(judgeTrip({ ...CLEAN, uturns: 1 }).failures).toContain('uturn');
  });

  it('the commute must not outweigh the drive', () => {
    const v = judgeTrip({ ...CLEAN, commuteShare: TRIP_COMMUTE_SHARE_MAX + 0.01 });
    expect(v.failures).toContain('commute_majority');
  });

  it('out and home must be different roads; neither may ride the core', () => {
    expect(
      judgeTrip({ ...CLEAN, outHomeOverlap: TRIP_CONNECTOR_OVERLAP_MAX + 0.01 }).failures,
    ).toContain('same_way_home');
    expect(
      judgeTrip({ ...CLEAN, outCoreOverlap: TRIP_CORE_OVERLAP_MAX + 0.01 }).failures,
    ).toContain('connector_rides_core');
    expect(
      judgeTrip({ ...CLEAN, homeCoreOverlap: TRIP_CORE_OVERLAP_MAX + 0.01 }).failures,
    ).toContain('connector_rides_core');
  });

  it('a failing trip names every broken rule at once (the trace shows why)', () => {
    const v = judgeTrip({
      ...CLEAN,
      durationS: 7200,
      loopiness: 0.1,
      oabLongestM: 7300,
      spurs: 3,
    });
    expect(v.pass).toBe(false);
    expect(v.failures).toEqual(
      expect.arrayContaining(['trip_duration', 'not_a_loop', 'doubling', 'spurs']),
    );
  });
});

describe('tripShapeMetrics', () => {
  it('measures a lollipop as not-a-loop and an honest ring as a loop', () => {
    // Ring of radius ~2 km around a centre — loopiness near the isoperimetric
    // ideal. Built in lng/lat with the 43.2° latitude correction.
    const ring: Array<[number, number]> = [];
    const cx = -79.9;
    const cy = 43.8;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      ring.push([
        cx + (Math.cos(a) * 0.02) / Math.cos((cy * Math.PI) / 180),
        cy + Math.sin(a) * 0.02,
      ]);
    }
    const ringLp = driveClosedLoopiness({ type: 'LineString', coordinates: ring });
    expect(ringLp).not.toBeNull();
    expect(ringLp!).toBeGreaterThan(0.5);

    // Lollipop: 10 km straight stick out, the same ring, 10 km back on the
    // stick — the R29 shape. Must measure as NOT a loop and as doubled.
    const stick: Array<[number, number]> = [];
    for (let i = 0; i <= 20; i++) stick.push([cx, cy - 0.11 + (0.09 * i) / 20]);
    const lolli: Array<[number, number]> = [
      ...stick,
      ...ring.map((p): [number, number] => [p[0], p[1]]),
      ...[...stick].reverse(),
    ];
    // whole-lollipop shape metrics: the doubled stick is a defect wherever it
    // sits beyond the origin grace
    const lolliM = tripShapeMetrics(
      { type: 'LineString', coordinates: lolli },
      { lat: cy - 0.11, lng: cx },
    );
    expect(lolliM.oabLongestM).toBeGreaterThan(1200);
    // and a straight out-and-back "drive" can never read as a loop
    const stickLp = driveClosedLoopiness({
      type: 'LineString',
      coordinates: [...stick, ...[...stick].reverse()],
    });
    expect(stickLp).not.toBeNull();
    expect(stickLp!).toBeLessThan(0.25);
  });
});
