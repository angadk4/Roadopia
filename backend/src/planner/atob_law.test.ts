import type { LatLng, RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  ATOB_DURATION_RATIO_MAX,
  ATOB_ENDPOINT_GRACE_M,
  ATOB_WORTH_IT_MIN_GAIN,
  atobDefectCount,
  atobDefectLabels,
  atobDefectPositions,
  atobStructuralDefects,
  atobWorthItVerdict,
  directAvoidDisclosures,
  directCostingOptions,
  filterAtoBAlternates,
  nearestSpanToDefects,
  offenceScoreAtoB,
  type AssembledAtoB,
} from './atob';
import type { CandidateSpanRef, WaypointCandidate } from './candidates';

/**
 * BD-203 — the A→B structural law as ONE pure measurement (engine-free,
 * synthetic geometry): the same detectors the judge refuses on are what the
 * assembly row ranks on, the repair pass aims at and the alternates filter
 * reads — graced 500 m at BOTH endpoints. Plus the worth-it decision table,
 * the direct-baseline disclosures and the repair aim.
 *
 * Geometry in local metres at 43.8°N; the detectors use a fixed 43.2° lng
 * factor, so the same factor converts here.
 */
const LAT = 43.8;
const LNG0 = -79.9;
const LAT_M = 111_320;
const LNG_M = 111_320 * Math.cos((43.2 * Math.PI) / 180);
const pt = (xM: number, yM: number): [number, number] => [LNG0 + xM / LNG_M, LAT + yM / LAT_M];
const ll = (xM: number, yM: number): LatLng => ({ lng: LNG0 + xM / LNG_M, lat: LAT + yM / LAT_M });
const ORIGIN = ll(0, 0);
const DEST = ll(20_000, 0);

/** Polyline through metre-space corners, interpolated every 25 m. */
function poly(corners: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i]!;
    const [bx, by] = corners[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    for (let d = 0; d < len; d += 25) {
      out.push(pt(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len));
    }
  }
  const last = corners[corners.length - 1]!;
  out.push(pt(last[0], last[1]));
  return out;
}
const east = (x0: number, x1: number): Array<[number, number]> =>
  poly([
    [x0, 0],
    [x1, 0],
  ]);
/** In-and-back street stub: north `lenM` from (x, 0) and straight back. */
const stub = (x: number, lenM: number): Array<[number, number]> =>
  poly([
    [x, 0],
    [x, lenM],
    [x, 0],
  ]);
/** Block-spin crescent tangent to the road at (x, 0): a full circle north of
 *  the road, rejoining exactly where it left — no retraced pavement. */
function crescent(x: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let a = 270; a <= 630; a += 5) {
    const rad = (a * Math.PI) / 180;
    out.push(pt(x + r * Math.cos(rad), r + r * Math.sin(rad)));
  }
  return out;
}
/** A detour that crosses its own earlier leg ONCE (a knot at (x + s/2, s)),
 *  rejoining the road 2·s further east without retracing anything. */
const knot = (x: number, s: number): Array<[number, number]> =>
  poly([
    [x, 0],
    [x, s],
    [x + s, s],
    [x + s, -s / 2],
    [x + s / 2, -s / 2],
    [x + s / 2, 1.5 * s],
    [x + 2 * s, 1.5 * s],
    [x + 2 * s, 0],
  ]);

function routeOf(
  coords: Array<[number, number]>,
  maneuvers: RouteThroughOutput['maneuvers'] = [],
): RouteThroughOutput {
  return {
    geometry: { type: 'LineString', coordinates: coords },
    distance_m: 20_000,
    duration_s: 1_200,
    legs: [],
    maneuvers,
    has_highway: false,
    has_toll: false,
    has_ferry: false,
    has_unpaved: false,
  };
}
const CLEAN = routeOf(east(0, 20_000));
const withStub = (x: number): RouteThroughOutput =>
  routeOf([...east(0, x), ...stub(x, 300), ...east(x + 25, 20_000)]);
const withCrescent = (x: number): RouteThroughOutput =>
  routeOf([...east(0, x), ...crescent(x, 120), ...east(x + 25, 20_000)]);
const withKnot = (x: number, s: number): RouteThroughOutput =>
  routeOf([
    ...east(0, x),
    ...knot(x, s),
    ...east(x + 2 * s + 25, Math.max(x + 2 * s + 25, 20_000)),
  ]);

describe('atobStructuralDefects — the judge, assembly, repair and alternates share it', () => {
  it('a straight road carries no defect at all', () => {
    const d = atobStructuralDefects(CLEAN, ORIGIN, DEST);
    expect(atobDefectCount(d)).toBe(0);
    expect(atobDefectLabels(d)).toEqual([]);
    expect(atobDefectPositions(d)).toEqual([]);
  });

  it('a mid-route street stub is ONE spur, labelled in the judge vocabulary', () => {
    const d = atobStructuralDefects(withStub(10_000), ORIGIN, DEST);
    expect(d.spurs).toHaveLength(1);
    expect(d.crescents).toHaveLength(0);
    expect(d.crossings).toHaveLength(0);
    expect(d.uturns).toBe(0);
    expect(atobDefectLabels(d)).toEqual(['street stubs ×1']);
    expect(atobDefectPositions(d)).toHaveLength(1);
  });

  it('a block-spin crescent (no retrace) is ONE crescent and no spur', () => {
    const d = atobStructuralDefects(withCrescent(10_000), ORIGIN, DEST);
    expect(d.crescents).toHaveLength(1);
    expect(d.spurs).toHaveLength(0);
    expect(atobDefectLabels(d)).toEqual(['crescents ×1']);
  });

  it('a self-crossing detour is ONE knot', () => {
    const d = atobStructuralDefects(withKnot(10_000, 1_000), ORIGIN, DEST);
    expect(d.crossings).toHaveLength(1);
    expect(d.spurs).toHaveLength(0);
    expect(d.crescents).toHaveLength(0);
    expect(atobDefectLabels(d)).toEqual(['self-crossings ×1']);
  });

  it('u-turns come from maneuver labels; a mid-route one is refused', () => {
    const d = atobStructuralDefects(
      routeOf(east(0, 20_000), [
        { type: 'start', instruction: 'head east', distance_m: 10_000 },
        { type: 'uturn_left', instruction: 'turn around', distance_m: 100 },
        { type: 'destination', instruction: 'arrive', distance_m: 9_900 },
      ]),
      ORIGIN,
      DEST,
    );
    expect(d.uturns).toBe(1);
    expect(d.uturnPositions).toHaveLength(1);
    expect(atobDefectLabels(d)).toEqual(['u-turn ×1']);
    expect(atobDefectCount(d)).toBe(1);
  });

  it('a u-turn at the origin PIN or the destination approach is graced; an unlocated one never is', () => {
    // "make a left U-turn to stay on Broadway" 0 m into the drive (the
    // Orangeville→Creemore case) — the pin-side twin of the arrival block-loop
    const atPin = atobStructuralDefects(
      routeOf(east(0, 20_000), [
        { type: 'uturn_left', instruction: 'turn around', distance_m: 100 },
        { type: 'destination', instruction: 'arrive', distance_m: 19_900 },
      ]),
      ORIGIN,
      DEST,
    );
    expect(atPin.uturns).toBe(0);
    expect(atPin.uturnPositions).toHaveLength(0);
    const atArrival = atobStructuralDefects(
      routeOf(east(0, 20_000), [
        { type: 'start', instruction: 'head east', distance_m: 19_800 },
        { type: 'uturn_right', instruction: 'turn around', distance_m: 200 },
      ]),
      ORIGIN,
      DEST,
    );
    expect(atArrival.uturns).toBe(0);
    // an EARLIER maneuver without a distance makes the u-turn's position
    // unrecoverable (uturnPositions fails open) → it is counted, not excused
    const unlocated = atobStructuralDefects(
      routeOf(east(0, 20_000), [
        { type: 'start', instruction: 'head east' },
        { type: 'uturn_left', instruction: 'turn around', distance_m: 100 },
      ]),
      ORIGIN,
      DEST,
    );
    expect(unlocated.uturns).toBe(1);
    expect(atobDefectLabels(unlocated)).toEqual(['u-turn ×1']);
  });

  it('grace at the ORIGIN: a stub / crescent / crossing within 500 m of the start is excused', () => {
    expect(atobDefectCount(atobStructuralDefects(withStub(200), ORIGIN, DEST))).toBe(0);
    expect(atobDefectCount(atobStructuralDefects(withCrescent(300), ORIGIN, DEST))).toBe(0);
    // the knot's crossing sits at (x + s/2, s) = (250, 200) → 320 m from the origin
    expect(atobDefectCount(atobStructuralDefects(withKnot(100, 300), ORIGIN, DEST))).toBe(0);
  });

  it('grace at the DESTINATION (BD-185): the same 500 m excuses the arrival block-loop', () => {
    // stub 200 m before the destination; crescent whose closure is 200 m out;
    // knot whose crossing is at (19 650, 300) → 461 m from the destination
    const stubEnd = withStub(19_800);
    const cresEnd = withCrescent(19_800);
    const knotEnd = withKnot(19_500, 300);
    expect(atobDefectCount(atobStructuralDefects(stubEnd, ORIGIN, DEST))).toBe(0);
    expect(atobDefectCount(atobStructuralDefects(cresEnd, ORIGIN, DEST))).toBe(0);
    expect(atobDefectCount(atobStructuralDefects(knotEnd, ORIGIN, DEST))).toBe(0);
    // ...and with NO grace every one of them is a real defect — proving the
    // destination filter (not the geometry) is what excused them
    expect(atobStructuralDefects(stubEnd, ORIGIN, DEST, 0).spurs).toHaveLength(1);
    expect(atobStructuralDefects(cresEnd, ORIGIN, DEST, 0).crescents).toHaveLength(1);
    expect(atobStructuralDefects(knotEnd, ORIGIN, DEST, 0).crossings).toHaveLength(1);
    // the default grace is the documented constant
    expect(ATOB_ENDPOINT_GRACE_M).toBe(500);
  });

  it('a defect just OUTSIDE the destination grace still counts', () => {
    // stub at 19 000 m: its bite position is ~1 km from the destination
    expect(atobStructuralDefects(withStub(19_000), ORIGIN, DEST).spurs).toHaveLength(1);
  });
});

describe('nearestSpanToDefects — the generalized SHIFT aim (BD-203 A)', () => {
  const waypoints: LatLng[] = [ll(5_000, 0), ll(6_000, 0), ll(15_000, 0), ll(16_000, 0)];
  const spans: CandidateSpanRef[] = [
    { segmentId: 'a', startIndex: 0, endIndex: 1 },
    { segmentId: 'b', startIndex: 2, endIndex: 3 },
  ];

  it('picks the span nearest ANY defect (stub, crescent or crossing — not just a u-turn)', () => {
    const d = atobStructuralDefects(withStub(15_200), ORIGIN, DEST);
    expect(nearestSpanToDefects(spans, waypoints, atobDefectPositions(d))?.segmentId).toBe('b');
    const c = atobStructuralDefects(withCrescent(5_500), ORIGIN, DEST);
    expect(nearestSpanToDefects(spans, waypoints, atobDefectPositions(c))?.segmentId).toBe('a');
  });

  it('measures to the nearest waypoint of a span, and returns null with nothing to aim at', () => {
    // a defect at 6 900 m is 900 m from span a's END and 8 100 m from span b's start
    expect(nearestSpanToDefects(spans, waypoints, [pt(6_900, 0)])?.segmentId).toBe('a');
    expect(nearestSpanToDefects(spans, waypoints, [])).toBeNull();
    expect(nearestSpanToDefects([], waypoints, [pt(6_900, 0)])).toBeNull();
  });
});

describe('filterAtoBAlternates — alternates meet the judge too (BD-203 F)', () => {
  it('keeps only alternates the structural judge would pass', () => {
    const alts = [
      { id: 'clean', route: CLEAN },
      { id: 'stub', route: withStub(10_000) },
      { id: 'knot', route: withKnot(10_000, 1_000) },
      { id: 'arrival-loop', route: withCrescent(19_800) }, // graced at the destination
    ];
    expect(filterAtoBAlternates(alts, ORIGIN, DEST).map((a) => a.id)).toEqual([
      'clean',
      'arrival-loop',
    ]);
  });
});

describe('atobWorthItVerdict — the decision table (BD-203 D; pre-registered bars)', () => {
  it('bars are the documented constants', () => {
    expect(ATOB_WORTH_IT_MIN_GAIN).toBe(0.1);
    expect(ATOB_DURATION_RATIO_MAX).toBe(1.5);
  });

  it('worth it: +30 pp backroad and 1.2× duration', () => {
    const v = atobWorthItVerdict({
      routeBackroadShare: 0.5,
      directBackroadShare: 0.2,
      durationRatio: 1.2,
    });
    expect(v.worthIt).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.gainPp).toBe(30);
  });

  it('not worth it: +5 pp is under the 10 pp bar — the reason names both shares', () => {
    const v = atobWorthItVerdict({
      routeBackroadShare: 0.25,
      directBackroadShare: 0.2,
      durationRatio: 1.2,
    });
    expect(v.worthIt).toBe(false);
    expect(v.gainPp).toBe(5);
    expect(v.reasons).toHaveLength(1);
    expect(v.reasons[0]).toMatch(/not meaningfully better than the direct way/);
    expect(v.reasons[0]).toMatch(/25% backroads vs 20% on the direct route/);
  });

  it('the gain bar is inclusive: exactly +10 pp passes', () => {
    expect(
      atobWorthItVerdict({ routeBackroadShare: 0.3, directBackroadShare: 0.2, durationRatio: 1 })
        .worthIt,
    ).toBe(true);
  });

  it('not worth it: over the duration ratio even with a big backroad gain', () => {
    const v = atobWorthItVerdict({
      routeBackroadShare: 0.7,
      directBackroadShare: 0.1,
      durationRatio: 1.6,
    });
    expect(v.worthIt).toBe(false);
    expect(v.reasons).toHaveLength(1);
    expect(v.reasons[0]).toMatch(/about 60% longer than the direct way/);
  });

  it('both bars missed → both reasons, gain first', () => {
    const v = atobWorthItVerdict({
      routeBackroadShare: 0.12,
      directBackroadShare: 0.1,
      durationRatio: 1.9,
    });
    expect(v.worthIt).toBe(false);
    expect(v.reasons).toHaveLength(2);
    expect(v.reasons[0]).toMatch(/not meaningfully better/);
    expect(v.reasons[1]).toMatch(/longer than the direct way/);
  });

  it('an unmeasured share is never rewarded (no claimed measurement)', () => {
    const v = atobWorthItVerdict({
      routeBackroadShare: null,
      directBackroadShare: 0.1,
      durationRatio: 1.0,
    });
    expect(v.worthIt).toBe(false);
    expect(v.gainPp).toBeNull();
    expect(v.reasons[0]).toMatch(/could not be measured/);
    expect(
      atobWorthItVerdict({ routeBackroadShare: 0.5, directBackroadShare: null, durationRatio: 1 })
        .worthIt,
    ).toBe(false);
  });

  it('with no baseline duration the duration bar is simply not applied', () => {
    expect(
      atobWorthItVerdict({ routeBackroadShare: 0.5, directBackroadShare: 0.1, durationRatio: null })
        .worthIt,
    ).toBe(true);
  });

  it('bars are overridable per call (the eval sweeps them)', () => {
    const v = atobWorthItVerdict({
      routeBackroadShare: 0.25,
      directBackroadShare: 0.2,
      durationRatio: 1.6,
      minGain: 0.05,
      maxDurationRatio: 2,
    });
    expect(v.worthIt).toBe(true);
  });
});

describe('the direct baseline: costing + honest avoid disclosures (BD-203 C/E)', () => {
  it('directCostingOptions carries the FULL avoid set as hard exclusions', () => {
    expect(
      directCostingOptions({ highways: true, tolls: false, ferries: true, unpaved: false }),
    ).toEqual({
      exclude_highways: true,
      exclude_tolls: false,
      exclude_ferries: true,
      exclude_unpaved: false,
    });
  });

  it('nothing asked, or nothing present → no disclosure', () => {
    const none = { highways: false, tolls: false, ferries: false, unpaved: false };
    expect(directAvoidDisclosures({ route: CLEAN, avoidHonoured: true }, none)).toEqual([]);
    expect(
      directAvoidDisclosures(
        { route: CLEAN, avoidHonoured: true },
        { ...none, tolls: true, highways: true },
      ),
    ).toEqual([]);
  });

  it('an exclusion the engine could not honour says so; a kept exclusion that still traced the thing is shown honestly', () => {
    const tolled = { ...CLEAN, has_toll: true };
    const asked = { highways: false, tolls: true, ferries: false, unpaved: false };
    expect(directAvoidDisclosures({ route: tolled, avoidHonoured: false }, asked)).toEqual([
      'the direct way uses a toll road — no toll-free direct route exists here',
    ]);
    expect(directAvoidDisclosures({ route: tolled, avoidHonoured: true }, asked)).toEqual([
      'the direct way still includes a toll road (shown honestly)',
    ]);
    const hwy = { ...CLEAN, has_highway: true, has_unpaved: true };
    expect(
      directAvoidDisclosures(
        { route: hwy, avoidHonoured: false },
        { highways: true, tolls: false, ferries: false, unpaved: true },
      ),
    ).toEqual([
      'the direct way uses a stretch of highway — no highway-free direct route exists here',
      'the direct way uses unpaved road — no fully paved direct route exists here',
    ]);
  });
});

describe('offenceScoreAtoB — an accepted route with a law defect is still repair material', () => {
  const candidate: WaypointCandidate = {
    id: 'c',
    kind: 'atob',
    waypoints: [],
    sector: 0,
    returnSector: null,
    clusterId: null,
    stops: [],
    clusterWeight: 1,
  };
  const assembled = (
    route: RouteThroughOutput,
    over: Partial<AssembledAtoB> = {},
  ): AssembledAtoB => {
    const defects = atobStructuralDefects(route, ORIGIN, DEST);
    return {
      candidate,
      route,
      detourRatio: 1.2,
      durationRatio: 1.1,
      selfOverlap: 0.05,
      accepted: true,
      rejectReasons: [],
      tspOrdered: false,
      trace: null,
      residentialShare: null,
      residentialRunM: null,
      countryScore: null,
      arterialShare: null,
      classMix: null,
      backroadLongestM: null,
      backroadMeanM: null,
      hoodRunM: null,
      turnsPer10min: null,
      defects,
      spursWide: defects.spurs.length,
      microloops: defects.crescents.length,
      crossings: defects.crossings.length,
      retraceRunM: 0,
      ...over,
    };
  };

  it('clean + accepted scores 0 (repair stops); a stub, crescent or crossing scores > 0', () => {
    expect(offenceScoreAtoB(assembled(CLEAN))).toBe(0);
    expect(offenceScoreAtoB(assembled(withStub(10_000)))).toBeGreaterThan(0);
    expect(offenceScoreAtoB(assembled(withCrescent(10_000)))).toBeGreaterThan(0);
    expect(offenceScoreAtoB(assembled(withKnot(10_000, 1_000)))).toBeGreaterThan(0);
  });

  it('weights follow the loop scale: crescent > u-turn = crossing > stub; caps dominate', () => {
    const uturn = assembled(CLEAN, {
      defects: { spurs: [], crescents: [], crossings: [], uturns: 1, uturnPositions: [] },
    });
    const knotted = assembled(withKnot(10_000, 1_000));
    const cres = assembled(withCrescent(10_000));
    const stubbed = assembled(withStub(10_000));
    expect(offenceScoreAtoB(knotted)).toBe(offenceScoreAtoB(uturn));
    expect(offenceScoreAtoB(cres)).toBeGreaterThan(offenceScoreAtoB(uturn));
    expect(offenceScoreAtoB(uturn)).toBeGreaterThan(offenceScoreAtoB(stubbed));
    // over the duration guard outweighs any single defect
    expect(offenceScoreAtoB(assembled(CLEAN, { durationRatio: 1.9 }))).toBeGreaterThan(
      offenceScoreAtoB(cres),
    );
  });
});
