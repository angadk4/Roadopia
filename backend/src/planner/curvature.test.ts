import type { LineString } from '@shared/types';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import type { TraceEdge, TraceResult } from '../valhalla/trace';

import { isCurvy, measureCurvature, measureCurvatureClassAware, THETA_CURVY } from './curvature';

/**
 * M3-T05 — the planner curvature module must agree with the hand-label ground
 * truth. Two layers:
 *   1. Pure synthetic checks (no DB): straight ≈ 0, R=300 m arc ≈ 1000/300 1/km.
 *   2. Hand-label agreement (DB, self-skipping): for known twisty vs grid roads,
 *      re-measuring the STORED geometry with this module reproduces the stored
 *      curviness (same engine ⇒ tight tolerance) and classifies twisty > θ > grid
 *      (the grid-FP guard).
 */

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client | null = null;

beforeAll(async () => {
  const candidate = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await candidate.connect();
    db = candidate;
  } catch {
    db = null;
  }
  return async () => {
    await db?.end();
  };
});

/** Build a lon/lat arc of radius R metres sweeping `sweepDeg`, at Hamilton's latitude. */
function arc(radiusM: number, sweepDeg: number, n: number): LineString {
  const R = 6_371_008.8;
  const D2R = Math.PI / 180;
  const refLat = 43.2;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (sweepDeg * D2R * i) / (n - 1);
    const x = radiusM * Math.cos(t);
    const y = radiusM * Math.sin(t);
    pts.push([x / (D2R * R * Math.cos(refLat * D2R)), refLat + y / (D2R * R)]);
  }
  return { type: 'LineString', coordinates: pts };
}

describe('measureCurvature — synthetic (M3-T05)', () => {
  it('straight ≈ 0; R=300 m arc recovers ≈ 1000/R per km', () => {
    const straight: LineString = {
      type: 'LineString',
      coordinates: Array.from({ length: 50 }, (_, i) => [-79.9 + i * 0.001, 43.2]),
    };
    const s = measureCurvature(straight);
    expect(s.skipped).toBe(false);
    expect(s.curviness).toBeLessThan(0.2);
    expect(isCurvy(s)).toBe(false);

    const a = measureCurvature(arc(300, 120, 200));
    expect(a.curviness).toBeGreaterThan(2.6);
    expect(a.curviness).toBeLessThan(4.0);
    expect(isCurvy(a)).toBe(true);
  });

  it('degenerate geometry is skipped, never scored', () => {
    const tiny: LineString = {
      type: 'LineString',
      coordinates: [
        [-79.9, 43.2],
        [-79.8999, 43.2001],
      ],
    };
    expect(measureCurvature(tiny).skipped).toBe(true);
  });

  it('BD-172: a CLOSED LOOP route measures (route-level), and twisty ring ≫ square ring', () => {
    // Every loop core in every index version scored curviness 0 because the
    // corpus builder's closed-ring skip (cul-de-sac poison, 3bf5403) also
    // caught loop ROUTES — so rankers could not tell a concession-road square
    // from a river-valley ring. Route-level measurement must score both, and
    // must rank the twisty ring far above the square.
    const D2R = Math.PI / 180;
    const refLat = 43.2;
    const R = 6_371_008.8;
    const toLL = (x: number, y: number): [number, number] => [
      -79.9 + x / (D2R * R * Math.cos(refLat * D2R)),
      refLat + y / (D2R * R),
    ];
    // 8 km × 8 km closed square (grid country), 60 m spacing
    const sq: [number, number][] = [];
    const side = 8_000;
    const step = 60;
    for (let d = 0; d < side; d += step) sq.push(toLL(d, 0));
    for (let d = 0; d < side; d += step) sq.push(toLL(side, d));
    for (let d = side; d > 0; d -= step) sq.push(toLL(d, side));
    for (let d = side; d > 0; d -= step) sq.push(toLL(0, d));
    sq.push(sq[0]!); // closed
    const square = measureCurvature({ type: 'LineString', coordinates: sq });
    expect(square.skipped).toBe(false); // the old behavior returned skipped/0 here

    // closed ring of the same scale whose path wiggles continuously (R~250 m)
    const tw: [number, number][] = [];
    const laps = 220;
    for (let i = 0; i <= laps; i++) {
      const t = (2 * Math.PI * i) / laps;
      const rr = 4_000 + 400 * Math.sin(12 * t);
      tw.push(toLL(4_000 + rr * Math.cos(t), 4_000 + rr * Math.sin(t)));
    }
    tw[tw.length - 1] = tw[0]!;
    const twisty = measureCurvature({ type: 'LineString', coordinates: tw });
    expect(twisty.skipped).toBe(false);
    expect(twisty.curviness).toBeGreaterThan(square.curviness * 3);
  });
});

// --- round 15/FB-5: class-aware route measurement ---------------------------

/** Concatenate segments into one shape + matching trace edges (indices align). */
function traceOf(parts: Array<{ geometry: LineString; edge: Partial<TraceEdge> }>): {
  geometry: LineString;
  trace: TraceResult;
} {
  const coordinates: Array<[number, number]> = [];
  const edges: TraceEdge[] = [];
  for (const part of parts) {
    const begin = coordinates.length === 0 ? 0 : coordinates.length - 1;
    if (coordinates.length === 0) {
      coordinates.push(...(part.geometry.coordinates as Array<[number, number]>));
    } else {
      // parts share their junction point (edge i+1 begins where edge i ends)
      coordinates.push(...(part.geometry.coordinates.slice(1) as Array<[number, number]>));
    }
    edges.push({
      roadClass: part.edge.roadClass ?? 'secondary',
      lengthM: part.edge.lengthM ?? 2000,
      ...(part.edge.use !== undefined ? { use: part.edge.use } : {}),
      ...(part.edge.roundabout !== undefined ? { roundabout: part.edge.roundabout } : {}),
      beginShapeIndex: begin,
      endShapeIndex: coordinates.length - 1,
    });
  }
  const geometry: LineString = { type: 'LineString', coordinates };
  return { geometry, trace: { edges, matchedShape: geometry } };
}

/** A straight run of `n` points heading east, starting at [lng0, lat0]. */
function straight(n: number, lng0 = -79.9, lat0 = 43.2, dLng = 0.001): LineString {
  return {
    type: 'LineString',
    coordinates: Array.from({ length: n }, (_, i) => [lng0 + i * dLng, lat0]),
  };
}

describe('measureCurvatureClassAware — round 15/FB-5', () => {
  it('a ramp-wiggle between straights inflates tag-blind but NOT class-aware', () => {
    const rampArc = arc(90, 200, 60); // tight ramp loop, R≈90 m
    const { geometry, trace } = traceOf([
      { geometry: straight(40), edge: { use: 'road' } },
      { geometry: rampArc, edge: { use: 'ramp' } },
      { geometry: straight(40, -79.8, 43.21), edge: { use: 'road' } },
    ]);
    const blind = measureCurvature(geometry);
    const aware = measureCurvatureClassAware(geometry, trace);
    expect(aware.classAware).toBe(true);
    expect(blind.curviness).toBeGreaterThan(aware.curviness * 3); // ramp dominated the blind read
    expect(aware.curviness).toBeLessThan(0.6); // straights are honestly straight
    expect(aware.excludedShare).toBeGreaterThan(0);
  });

  it('roundabout and motorway/trunk edges are excluded too', () => {
    const round = arc(25, 350, 80);
    const withRoundabout = traceOf([
      { geometry: straight(40), edge: {} },
      { geometry: round, edge: { roundabout: true } },
      { geometry: straight(40, -79.8, 43.21), edge: {} },
    ]);
    const a1 = measureCurvatureClassAware(withRoundabout.geometry, withRoundabout.trace);
    expect(a1.curviness).toBeLessThan(0.6);

    const motorwayCurve = arc(400, 90, 80);
    const withMotorway = traceOf([
      { geometry: straight(40), edge: {} },
      { geometry: motorwayCurve, edge: { roadClass: 'motorway' } },
    ]);
    const a2 = measureCurvatureClassAware(withMotorway.geometry, withMotorway.trace);
    expect(a2.curviness).toBeLessThan(0.6);
  });

  it('gap reset: a corner THROUGH an excluded edge never counts as a turn', () => {
    // two straights meeting at 90° via a dropped connector — measured in
    // isolation, both runs are dead straight
    const north: LineString = {
      type: 'LineString',
      coordinates: Array.from({ length: 40 }, (_, i) => [-79.8 + 39 * 0.001, 43.2 + i * 0.001]),
    };
    const { geometry, trace } = traceOf([
      { geometry: straight(40), edge: {} },
      { geometry: north, edge: { use: 'turn_channel' } },
    ]);
    const aware = measureCurvatureClassAware(geometry, trace);
    expect(aware.curviness).toBeLessThan(0.2);
  });

  it('fallback honesty: null/gappy traces measure tag-blind, classAware=false', () => {
    const g = arc(300, 120, 200);
    const blind = measureCurvature(g);
    for (const trace of [
      null,
      { edges: [], matchedShape: g },
      { edges: [{ roadClass: 'secondary', lengthM: 100 }], matchedShape: g }, // no indices
      {
        edges: [{ roadClass: 'secondary', lengthM: 100, beginShapeIndex: 0, endShapeIndex: 5 }],
        matchedShape: g, // last index ≠ shape end → inconsistent
      },
    ] as Array<TraceResult | null>) {
      const aware = measureCurvatureClassAware(g, trace);
      expect(aware.classAware).toBe(false);
      expect(aware.curviness).toBeCloseTo(blind.curviness, 10);
    }
  });

  it('an all-excluded route has zero honest twistiness (skipped, classAware)', () => {
    const ramp = arc(80, 270, 80);
    const { geometry, trace } = traceOf([{ geometry: ramp, edge: { use: 'ramp' } }]);
    const aware = measureCurvatureClassAware(geometry, trace);
    expect(aware).toMatchObject({ curviness: 0, skipped: true, classAware: true });
    expect(aware.excludedShare).toBe(1);
  });

  it('length-weighted aggregation: arc + equal straight ≈ half the arc alone', () => {
    // NB: butting the straight directly onto the arc creates a sharp synthetic
    // corner that alone contributes as much curvature as the whole arc — the
    // junction-wiggle phenomenon this function exists to exclude. So the two
    // runs are joined through an EXCLUDED connector, and per-run isolation
    // gives the honest length-weighted blend.
    const bend = arc(300, 120, 200); // ~628 m of R=300 arc
    const [endLng, endLat] = bend.coordinates[bend.coordinates.length - 1]!;
    const connector: LineString = {
      type: 'LineString',
      coordinates: [
        [endLng!, endLat!],
        [endLng! + 0.0004, endLat!],
      ],
    };
    const flat: LineString = {
      type: 'LineString',
      coordinates: Array.from({ length: 9 }, (_, i) => [endLng! + 0.0004 + i * 0.001, endLat!]),
    };
    const { geometry, trace } = traceOf([
      { geometry: bend, edge: {} },
      { geometry: connector, edge: { use: 'ramp', lengthM: 30 } },
      { geometry: flat, edge: {} },
    ]);
    const arcAlone = measureCurvature(bend).curviness;
    const aware = measureCurvatureClassAware(geometry, trace);
    expect(aware.classAware).toBe(true);
    expect(aware.curviness).toBeGreaterThan(arcAlone * 0.3);
    expect(aware.curviness).toBeLessThan(arcAlone * 0.7);
  });
});

describe('measureCurvature — hand-label agreement (DB, self-skipping)', () => {
  it('re-measuring stored geometry reproduces stored curviness (same engine)', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await db.query<{ name: string; curv: number; geometry: string }>(
      // R21-0(a): closed rings (cul-de-sac bulbs) are excluded from the corpus
      // at retrieval and now re-measure to 0 (compute.ts isClosedRing guard) —
      // the recompute-reproduces-stored invariant holds only for the valid,
      // non-ring material the planner actually retrieves.
      `select name, circum_curvature_per_km as curv, st_asgeojson(geom) as geometry
       from curvy_segments
       where length_m > 500 and not st_isclosed(geom)
       order by circum_curvature_per_km desc
       limit 12`,
    );
    expect(rows.rowCount).toBeGreaterThan(5);
    for (const row of rows.rows) {
      const measured = measureCurvature(JSON.parse(row.geometry) as LineString);
      // same engine, same params — allow small float/geojson-roundtrip drift
      expect(Math.abs(measured.curviness - Number(row.curv))).toBeLessThan(0.05);
    }
  });

  it('classifies known twisty roads above θ and grid roads below θ (grid-FP guard)', async (ctx) => {
    if (!db) return ctx.skip();
    const twisty = await db.query<{ name: string; geometry: string }>(
      `select name, st_asgeojson(geom) as geometry from curvy_segments
       where name in ('Snake Road', 'Mineral Springs Road', 'Old Dundas Road')
         and length_m > 300 limit 6`,
    );
    expect(twisty.rowCount).toBeGreaterThan(0);
    for (const row of twisty.rows) {
      const m = measureCurvature(JSON.parse(row.geometry) as LineString);
      expect(m.curviness).toBeGreaterThan(THETA_CURVY);
    }

    // grid roads were mostly SKIPPED from curvy_segments only if short/junction —
    // long grid arterials exist in the table with LOW curviness; verify below θ.
    const grid = await db.query<{ name: string; curv: number }>(
      `select name, circum_curvature_per_km as curv from curvy_segments
       where name in ('Geneva Street', 'Drummond Road', 'Barton Street East')
         and length_m > 500 limit 6`,
    );
    for (const row of grid.rows) {
      expect(Number(row.curv)).toBeLessThan(THETA_CURVY);
    }
  });
});
