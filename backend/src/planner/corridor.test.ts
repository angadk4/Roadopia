import type { RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { RouteThroughRequest } from '../valhalla/route';

import {
  arrivalBearing,
  bearingDeg,
  bearingDiffDeg,
  corridorRings,
  departureBearing,
  glueLegs,
  haversineM,
  lineLengthM,
  ringsPerimeterM,
  routeCorridorLeg,
  sampleAlong,
  simplifyLine,
  type XY,
} from './corridor';

/**
 * BD-203 — loops by construction. The pure geometry here is what makes
 * "the way home may not reuse the way out" a request the engine can honour;
 * the builder test pins the hole ladder and the heading hand-off.
 */

const LAT = 43.5;
/** metres east/north of a base point → [lng, lat] */
const at = (eastM: number, northM: number): XY => [
  -79.9 + eastM / (111_320 * Math.cos((LAT * Math.PI) / 180)),
  LAT + northM / 111_320,
];
/** straight line with vertices every 100 m, `lenM` long, heading east */
const eastLine = (lenM: number, northM = 0): XY[] =>
  Array.from({ length: Math.floor(lenM / 100) + 1 }, (_, i) => at(i * 100, northM));

function route(coords: XY[], durationS = 600, distanceM = lineLengthM(coords)): RouteThroughOutput {
  return {
    geometry: { type: 'LineString', coordinates: coords },
    distance_m: distanceM,
    duration_s: durationS,
    legs: [{ duration_s: durationS, distance_m: distanceM }],
    maneuvers: [
      {
        type: 'start',
        instruction: 'Drive east.',
        distance_m: distanceM,
        street_names: ['A Road'],
      },
      { type: 'destination', instruction: 'You have arrived.', distance_m: 0 },
    ],
    has_highway: false,
    has_toll: false,
    has_ferry: false,
    has_unpaved: false,
  };
}

describe('geometry helpers', () => {
  it('bearings: east is 90, north is 0, and the difference wraps', () => {
    expect(Math.round(bearingDeg(at(0, 0), at(100, 0)))).toBe(90);
    expect(Math.round(bearingDeg(at(0, 0), at(0, 100)))).toBe(0);
    expect(bearingDiffDeg(350, 10)).toBe(20);
    expect(bearingDiffDeg(90, 270)).toBe(180);
    const line = eastLine(1000);
    expect(Math.round(departureBearing(line))).toBe(90);
    expect(Math.round(arrivalBearing(line))).toBe(90);
  });

  it('simplifyLine keeps the ends and drops collinear points; sampleAlong keeps both ends', () => {
    const line = eastLine(2000);
    const simp = simplifyLine(line, 20);
    expect(simp[0]).toEqual(line[0]);
    expect(simp[simp.length - 1]).toEqual(line[line.length - 1]);
    expect(simp.length).toBeLessThan(line.length);
    const s = sampleAlong(line, 500);
    expect(s[0]).toEqual(line[0]);
    expect(s[s.length - 1]).toEqual(line[line.length - 1]);
    expect(s.length).toBeGreaterThanOrEqual(4);
    expect(s.length).toBeLessThanOrEqual(6);
  });
});

describe('corridorRings', () => {
  it('boxes the line with the requested holes at both ends', () => {
    const line = eastLine(3000);
    const rings = corridorRings(line, { halfWidthM: 50, skipStartM: 500, skipEndM: 1000 });
    expect(rings.length).toBeGreaterThan(0);
    for (const r of rings) {
      expect(r.length).toBe(5);
      expect(r[0]).toEqual(r[4]); // closed
    }
    // every ring vertex lies within the open stretch [500 - 50, 2000 + 50] m
    for (const r of rings) {
      for (const p of r) {
        const east = haversineM(at(0, p[1] === LAT ? 0 : 0), [p[0], LAT]);
        expect(east).toBeGreaterThanOrEqual(400);
        expect(east).toBeLessThanOrEqual(2100);
      }
    }
    // a point ON the line inside the stretch is inside some ring; a point in
    // the hole is inside none (ray-cast)
    const inside = (p: XY): boolean =>
      rings.some((r) => {
        let ok = false;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const yi = r[i]![1];
          const yj = r[j]![1];
          const xi = r[i]![0];
          const xj = r[j]![0];
          const cross =
            yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
          if (cross) ok = !ok;
        }
        return ok;
      });
    expect(inside(at(1500, 0))).toBe(true);
    expect(inside(at(1500, 30))).toBe(true); // within the half-width
    expect(inside(at(1500, 90))).toBe(false); // beyond it
    expect(inside(at(200, 0))).toBe(false); // in the start hole
    expect(inside(at(2600, 0))).toBe(false); // in the end hole
    expect(ringsPerimeterM(rings)).toBeGreaterThan(2 * 1400); // one 1.5 km box, extended by the half-width
  });

  it('is empty when the holes swallow the line', () => {
    expect(corridorRings(eastLine(1000), { skipStartM: 600, skipEndM: 600 })).toEqual([]);
  });
});

describe('glueLegs', () => {
  it('joins geometry without repeating the joint, sums totals, folds joint maneuvers, ORs flags', () => {
    const a = route(eastLine(1000), 100);
    const bCoords = eastLine(1000).map((p) => at(haversineM(at(0, 0), p) + 1000, 0));
    bCoords[0] = a.geometry.coordinates[a.geometry.coordinates.length - 1] as XY; // same joint
    const b = { ...route(bCoords, 200), has_unpaved: true };
    const glued = glueLegs([a, b]);
    expect(glued.geometry.coordinates.length).toBe(
      a.geometry.coordinates.length + b.geometry.coordinates.length - 1,
    );
    expect(glued.duration_s).toBe(300);
    expect(glued.distance_m).toBeCloseTo(a.distance_m + b.distance_m, 3);
    expect(glued.legs).toEqual([
      { duration_s: 100, distance_m: a.distance_m },
      { duration_s: 200, distance_m: b.distance_m },
    ]);
    // one start, one destination; the joint's arrival dropped and its
    // same-road departure folded into the first instruction
    expect(glued.maneuvers.map((m) => m.type)).toEqual(['start', 'destination']);
    expect(glued.maneuvers[0]!.distance_m).toBeCloseTo(a.distance_m + b.distance_m, 3);
    expect(glued.has_unpaved).toBe(true);
    expect(glued.has_highway).toBe(false);
  });
});

describe('routeCorridorLeg', () => {
  const stemM = 300;
  const base = 'http://engine';

  it('sends the previous legs as exclusion rings with a start hole and a stem hole, plus the heading', async () => {
    const sent: RouteThroughRequest[] = [];
    const fake = async (_u: string, req: RouteThroughRequest): Promise<RouteThroughOutput> => {
      sent.push(req);
      return route(req.waypoints.map((w) => [w[0], w[1]] as XY));
    };
    const first: BuiltLegLike = {
      route: route(eastLine(5000)),
      coords: eastLine(5000),
      holes: { startHoleM: 0, stemHoleM: 0 },
    };
    const leg = await routeCorridorLeg(fake, base, {
      waypoints: [at(5000, 0), at(5000, 3000)],
      costingOptions: { use_highways: 0.2 },
      heading: 90,
      previous: [first],
      stemM,
    });
    expect(sent.length).toBe(1);
    const req = sent[0]!;
    expect(req.startHeading).toEqual({ deg: 90 });
    expect(req.excludePolygons?.length ?? 0).toBeGreaterThan(0);
    // the rings cover [stem + 400, 5000 - 800] of the first leg — none within
    // 300 m of the origin, none within 700 m of the joint
    for (const ring of req.excludePolygons!) {
      for (const p of ring) {
        const east = haversineM([p[0], LAT], at(0, 0));
        expect(east).toBeGreaterThan(stemM + 400 - 60);
        expect(east).toBeLessThan(5000 - 800 + 60);
      }
    }
    expect(leg.holes).toEqual({ startHoleM: 800, stemHoleM: stemM + 400 });
  });

  it('walks the hole ladder on "no path" and reports the rung that worked; throws when all fail', async () => {
    let calls = 0;
    const fake = async (_u: string, req: RouteThroughRequest): Promise<RouteThroughOutput> => {
      calls++;
      if (calls < 3) throw new Error('No path could be found for input');
      return route(req.waypoints.map((w) => [w[0], w[1]] as XY));
    };
    const prev: BuiltLegLike = {
      route: route(eastLine(5000)),
      coords: eastLine(5000),
      holes: { startHoleM: 0, stemHoleM: 0 },
    };
    const leg = await routeCorridorLeg(fake, base, {
      waypoints: [at(5000, 0), at(0, 3000)],
      costingOptions: {},
      heading: null,
      previous: [prev],
      stemM,
    });
    expect(calls).toBe(3);
    expect(leg.holes).toEqual({ startHoleM: 1600, stemHoleM: stemM + 1200 });

    const alwaysFail = async (): Promise<RouteThroughOutput> => {
      throw new Error('No path could be found for input');
    };
    await expect(
      routeCorridorLeg(alwaysFail, base, {
        waypoints: [at(0, 0), at(0, 3000)],
        costingOptions: {},
        heading: null,
        previous: [prev],
        stemM,
      }),
    ).rejects.toThrow(/No path/);
  });

  it('with no previous legs and no heading the request is a plain through-route (byte-identical contract)', async () => {
    const sent: RouteThroughRequest[] = [];
    const fake = async (_u: string, req: RouteThroughRequest): Promise<RouteThroughOutput> => {
      sent.push(req);
      return route(req.waypoints.map((w) => [w[0], w[1]] as XY));
    };
    await routeCorridorLeg(fake, base, {
      waypoints: [at(0, 0), at(1000, 0)],
      costingOptions: { use_highways: 0.2 },
      heading: null,
      previous: [],
      stemM,
    });
    expect(sent[0]!.excludePolygons).toBeUndefined();
    expect(sent[0]!.startHeading).toBeUndefined();
    expect(sent[0]!.middleType).toBe('through');
  });
});

interface BuiltLegLike {
  route: RouteThroughOutput;
  coords: XY[];
  holes: { startHoleM: number; stemHoleM: number };
}
