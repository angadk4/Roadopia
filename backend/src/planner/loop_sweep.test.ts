import type { LatLng, RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { RouteThroughRequest } from '../valhalla/route';

import { lineLengthM, type XY } from './corridor';
import type { CoreRowRead } from './discover_cores';
import {
  buildSweepTour,
  enumerateTours,
  matrixIndex,
  matrixLocations,
  pieceChunks,
  piecesFromRows,
  ringHalves,
  sweepCoreOf,
  sweepTrip,
  type SweepPiece,
  type TourPlan,
} from './loop_sweep';

/**
 * BD-203 — the sweep: loops built from measured pieces with corridor-excluded
 * legs. The planning half is pure (material, dedup, tour enumeration and its
 * screens); the build half runs against a fake engine that draws straight
 * legs, so the judge's verdict on a clean construction is pinned without a
 * live Valhalla.
 */

const LAT = 43.5;
const KX = 111_320 * Math.cos((LAT * Math.PI) / 180);
const KY = 111_320;
/** metres east/north of the origin → [lng, lat] */
const at = (eastM: number, northM: number): XY => [-79.9 + eastM / KX, LAT + northM / KY];
const ORIGIN: LatLng = { lat: LAT, lng: -79.9 };

/** a polyline from (x0,y0) to (x1,y1) in metres, vertices every ~100 m */
function line(x0: number, y0: number, x1: number, y1: number): XY[] {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 100) + 1);
  return Array.from({ length: n }, (_, i) =>
    at(x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)),
  );
}

function row(
  id: string,
  coords: XY[],
  kind: 'ribbon' | 'loop',
  durationS: number,
  curv = 1.5,
): CoreRowRead {
  return {
    id,
    kind,
    name: `Road ${id}`,
    bar_profile: 'strict',
    geom_simplified: { type: 'LineString', coordinates: coords },
    geometry: { type: 'LineString', coordinates: coords },
    entry: { lat: coords[0]![1], lng: coords[0]![0] },
    exit: { lat: coords[coords.length - 1]![1], lng: coords[coords.length - 1]![0] },
    distance_m: lineLengthM(coords),
    duration_s: durationS,
    curviness: curv,
    backroad_share: 1,
    main_share: 0,
    highway_share: 0,
    hood_share: 0,
    turns_per_10min: 3,
    loopiness: kind === 'loop' ? 0.6 : null,
  };
}

/** a square ring of side `s` metres centred `cx,cy` metres from the origin */
function ring(cx: number, cy: number, s: number): XY[] {
  const h = s / 2;
  return [
    ...line(cx - h, cy - h, cx + h, cy - h),
    ...line(cx + h, cy - h, cx + h, cy + h).slice(1),
    ...line(cx + h, cy + h, cx - h, cy + h).slice(1),
    ...line(cx - h, cy + h, cx - h, cy - h).slice(1),
  ];
}

describe('ringHalves / piecesFromRows', () => {
  it('cuts a ring into two halves at the origin-nearest vertex and its antipode', () => {
    const r = row('ring', ring(0, 8000, 8000), 'loop', 3600);
    const halves = ringHalves(r, ORIGIN);
    expect(halves.map((h) => h.label)).toEqual(['h1', 'h2', 'q1', 'q2', 'q3', 'q4']);
    const l1 = lineLengthM(halves[0]!.coords);
    const l2 = lineLengthM(halves[1]!.coords);
    expect(Math.abs(l1 - l2)).toBeLessThan(300);
    // the cut is at the vertex nearest the origin (the bottom edge's middle)
    expect(halves[0]!.coords[0]![1]).toBeCloseTo(at(0, 4000)[1], 4);
  });

  it('ribbons stay whole, rings contribute halves, copies of one road are deduped, halves of one ring are kept', () => {
    const rib = row('rib', line(6000, 0, 6000, 6000), 'ribbon', 420);
    const copy = row('rib-copy', line(6000, 0, 6000, 5900), 'ribbon', 410); // same road, other cell
    const loop = row('ring', ring(-9000, 0, 8000), 'loop', 3600);
    const pieces = piecesFromRows([rib, copy], [loop], ORIGIN);
    const ids = pieces.map((p) => p.id);
    expect(ids).toContain('rib');
    expect(ids).not.toContain('rib-copy');
    expect(ids).toContain('ring#h1');
    expect(ids).toContain('ring#h2');
    const half = pieces.find((p) => p.id === 'ring#h1')!;
    expect(half.family).toBe('ring');
    expect(half.durationS).toBeCloseTo(1800, -2);
    expect(half.kind).toBe('ring_half');
  });

  it('matrix locations are origin + entry/exit per piece, indexed by matrixIndex', () => {
    const rib = row('rib', line(6000, 0, 6000, 6000), 'ribbon', 420);
    const pieces = piecesFromRows([rib], [], ORIGIN);
    const locs = matrixLocations(ORIGIN, pieces);
    expect(locs.length).toBe(3);
    expect(locs[matrixIndex(0, 'entry')]).toEqual(pieces[0]!.coords[0]);
    expect(locs[matrixIndex(0, 'exit')]).toEqual(pieces[0]!.coords[pieces[0]!.coords.length - 1]);
  });

  it('pieceChunks samples densely and never exceeds the engine location cap per chunk', () => {
    const long = line(0, 0, 40_000, 0);
    const chunks = pieceChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(17);
    const total = chunks.reduce((s, c) => s + c.length, 0);
    expect(total).toBeGreaterThanOrEqual(35); // ~1 km spacing over 40 km (vertex quantisation)
    expect(chunks[chunks.length - 1]!.slice(-1)[0]!.pt).toEqual(long[long.length - 1]);
    // every sample carries the line's local bearing (east = 90)
    for (const c of chunks) for (const s of c) expect(Math.round(s.bearingDeg)).toBe(90);
  });
});

/** Two pieces east and north of the origin, plus a crossing distractor. */
function threePieces(): SweepPiece[] {
  const east = row('east', line(6000, -3000, 6000, 3000), 'ribbon', 600); // runs south→north 6 km east
  const north = row('north', line(3000, 6000, -3000, 6000), 'ribbon', 600); // runs east→west 6 km north
  // a piece that CROSSES the east piece
  const crosser = row('crosser', line(3000, 0, 9000, 0), 'ribbon', 600);
  return piecesFromRows([east, north, crosser], [], ORIGIN, 10);
}

/** hop = straight-line seconds at 50 km/h */
function hopOf(locs: XY[]): (i: number, j: number) => number | null {
  return (i, j) => {
    const a = locs[i]!;
    const b = locs[j]!;
    return Math.round((Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY) / 50_000) * 3600);
  };
}

describe('enumerateTours', () => {
  it('never pairs crossing pieces, screens turn-backs, orders exact-band tours first, one plan per piece set', () => {
    const pieces = threePieces();
    const locs = matrixLocations(ORIGIN, pieces);
    // east + north with straight hops at 50 km/h predicts ~41 min door to door
    const plans = enumerateTours(pieces, ORIGIN, hopOf(locs), 40 * 60);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      const ids = p.steps.map((s) => s.piece.id);
      // east and crosser intersect — never together
      expect(ids.includes('east') && ids.includes('crosser')).toBe(false);
      // one plan per set
      expect(
        plans.filter(
          (q) =>
            q.steps
              .map((s) => s.piece.id)
              .sort()
              .join() === ids.slice().sort().join(),
        ).length,
      ).toBe(1);
      expect(p.commutePred).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.predS - 2400) / 2400).toBeLessThanOrEqual(0.25);
    }
    // exact-band plans lead
    const exactFlags = plans.map((p) => (Math.abs(p.predS - 2400) / 2400 <= 0.15 ? 0 : 1));
    for (let i = 1; i < exactFlags.length; i++)
      expect(exactFlags[i]!).toBeGreaterThanOrEqual(exactFlags[i - 1]!);
  });

  it('a twisty ask ranks the curvier material first; a backroads ask does not', () => {
    const mild = row('mild', line(6000, -3000, 6000, 3000), 'ribbon', 1500, 0.6);
    const curvy = row('curvy', line(-6000, -3000, -6000, 3000), 'ribbon', 1500, 2.4);
    const pieces = piecesFromRows([mild, curvy], [], ORIGIN, 10);
    const locs = matrixLocations(ORIGIN, pieces);
    const single = (twisty: boolean) =>
      enumerateTours(pieces, ORIGIN, hopOf(locs), 41 * 60, { twisty }).filter(
        (p) => p.steps.length === 1,
      );
    const twistyFirst = single(true)[0]!.steps[0]!.piece.id;
    expect(twistyFirst).toBe('curvy');
    // symmetric material: without the twisty rule the order is the shape/time/id order
    expect(
      single(false)
        .map((p) => p.steps[0]!.piece.id)
        .sort(),
    ).toEqual(['curvy', 'mild']);
  });

  it('a piece that ends pointing away from the next target is a turn-back and is not planned that way', () => {
    // one piece whose exit points due east while the way home is due west: driven
    // in that direction it needs a reversal; reversed it does not.
    const away = row('away', line(4000, 4000, 12_000, 4000), 'ribbon', 600); // west→east
    const pieces = piecesFromRows([away], [], ORIGIN, 10);
    const locs = matrixLocations(ORIGIN, pieces);
    const plans = enumerateTours(pieces, ORIGIN, hopOf(locs), 25 * 60);
    // the only single-piece plan drives it exit→entry (arriving from the east,
    // heading home to the west), never entry→exit
    for (const p of plans) {
      expect(p.steps.length).toBe(1);
      expect(p.steps[0]!.reversed).toBe(true);
    }
  });
});

/** Fake engine: straight legs through the waypoints at 50 km/h, 1 vertex/100 m. */
function fakeRouteFn(sent: RouteThroughRequest[]) {
  return async (_u: string, req: RouteThroughRequest): Promise<RouteThroughOutput> => {
    sent.push(req);
    const pts = req.waypoints.map((w) => [w[0], w[1]] as XY);
    const coords: XY[] = [];
    for (let i = 1; i < pts.length; i++) {
      const seg = line(
        (pts[i - 1]![0] - ORIGIN.lng) * KX,
        (pts[i - 1]![1] - ORIGIN.lat) * KY,
        (pts[i]![0] - ORIGIN.lng) * KX,
        (pts[i]![1] - ORIGIN.lat) * KY,
      );
      for (const p of seg) {
        const prev = coords[coords.length - 1];
        if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) coords.push(p);
      }
    }
    const distance_m = lineLengthM(coords);
    const duration_s = Math.round((distance_m / 50_000) * 3600);
    return {
      geometry: { type: 'LineString', coordinates: coords },
      distance_m,
      duration_s,
      legs: [{ duration_s, distance_m }],
      maneuvers: [
        { type: 'start', instruction: 'Go.', distance_m, street_names: ['Road'] },
        { type: 'destination', instruction: 'Arrive.', distance_m: 0 },
      ],
      has_highway: false,
      has_toll: false,
      has_ferry: false,
      has_unpaved: false,
    };
  };
}

describe('buildSweepTour', () => {
  it('routes connector → piece → … → home with exclusions and headings, and a clean construction passes the judge', async () => {
    const pieces = threePieces().filter((p) => p.id !== 'crosser');
    const locs = matrixLocations(ORIGIN, pieces);
    const plans = enumerateTours(pieces, ORIGIN, hopOf(locs), 40 * 60);
    const two = plans.find((p) => p.steps.length === 2)!;
    expect(two).toBeDefined();
    const sent: RouteThroughRequest[] = [];
    const built = await buildSweepTour(two, {
      baseUrl: 'http://engine',
      routeFn: fakeRouteFn(sent),
      origin: ORIGIN,
      targetS: 40 * 60,
      stemM: 300,
      costingOptions: { use_highways: 0.2 },
      outOfTime: () => false,
    });
    expect(built.failures).toEqual([]);
    expect(built.trip).not.toBeNull();
    const trip = built.trip!;
    expect(trip.source).toBe('sweep');
    expect(trip.pieceNames).toEqual(two.steps.map((s) => s.piece.name));
    expect(trip.tier === 'exact' || trip.tier === 'alternate').toBe(true);
    expect(trip.metrics.spurs).toBe(0);
    expect(trip.metrics.knots + trip.metrics.pierces).toBe(0);
    expect(trip.metrics.outHomeOverlap).toBeLessThanOrEqual(0.2);
    expect(trip.fidelity).toBeGreaterThanOrEqual(0.85);
    // request shape: the first connector has no heading and excludes only the
    // piece it heads for (beyond its entry); later legs exclude what was
    // driven and carry a heading; the piece drives are through-routed
    expect(sent[0]!.startHeading).toBeUndefined();
    const later = sent.slice(1);
    expect(later.some((r) => (r.excludePolygons?.length ?? 0) > 0)).toBe(true);
    expect(later.some((r) => r.startHeading !== undefined)).toBe(true);
    expect(sent.some((r) => r.middleType === 'through' && r.waypoints.length > 2)).toBe(true);
    // legs recorded there / drive / home
    expect(trip.legs.thereS + trip.legs.driveS + trip.legs.homeS).toBe(trip.durationS);
    expect(trip.holes?.length).toBe(sent.length);
  });

  it('abandons a tour whose connector is a forced detour (never finishes a 219-minute "90")', async () => {
    // a 25-minute piece 6 km east: ~8 min out, 25 on it, ~8 home → 41 min
    const east = row('east', line(6000, -3000, 6000, 3000), 'ribbon', 1500);
    const pieces = piecesFromRows([east], [], ORIGIN, 10);
    const locs = matrixLocations(ORIGIN, pieces);
    const plans = enumerateTours(pieces, ORIGIN, hopOf(locs), 40 * 60);
    expect(plans.length).toBe(1);
    const slow = async (_u: string, req: RouteThroughRequest): Promise<RouteThroughOutput> => {
      const r = await fakeRouteFn([])(_u, req);
      return { ...r, duration_s: r.duration_s * 5 };
    };
    const built = await buildSweepTour(plans[0]!, {
      baseUrl: 'http://engine',
      routeFn: slow,
      origin: ORIGIN,
      targetS: 40 * 60,
      stemM: 300,
      costingOptions: {},
      outOfTime: () => false,
    });
    expect(built.trip).toBeNull();
    expect(built.failures).toEqual(['connector_1_detour']);
  });

  it('sweepCoreOf names the pieces and length-weights their measured stats', () => {
    const pieces = threePieces();
    const plan: TourPlan = {
      steps: [
        { piece: pieces.find((p) => p.id === 'east')!, reversed: false },
        { piece: pieces.find((p) => p.id === 'north')!, reversed: false },
      ],
      predS: 3000,
      commutePred: 0.3,
      pieceS: 1200,
      pieceCurv: 1.5,
      hopS: [300, 300, 300],
      shapePred: 0.5,
    };
    const core = sweepCoreOf(plan, { type: 'LineString', coordinates: line(0, 0, 1000, 0) });
    expect(core.name).toBe('Road east and Road north');
    expect(core.curviness).toBeCloseTo(1.5, 5);
    expect(core.backroad_share).toBe(1);
    expect(core.id.startsWith('sweep:')).toBe(true);
  });
});

describe('sweepTrip', () => {
  it('reads ribbons and rings in reach, prices one matrix, builds best-first and serves the best clean trip', async () => {
    const east = row('east', line(6000, -3000, 6000, 3000), 'ribbon', 600);
    const north = row('north', line(3000, 6000, -3000, 6000), 'ribbon', 600);
    const kinds: string[] = [];
    const coresFn = async (
      _db: unknown,
      _bbox: [number, number, number, number],
      _v: string,
      _limit: number,
      kind: 'loop' | 'ribbon',
    ): Promise<CoreRowRead[]> => {
      kinds.push(kind);
      return kind === 'ribbon' ? [east, north] : [];
    };
    let matrixCalls = 0;
    const matrixFn = async (
      _u: string,
      req: { locations: ReadonlyArray<readonly [number, number]> },
    ) => {
      matrixCalls++;
      const locs = req.locations.map((l) => [l[0], l[1]] as XY);
      const hop = hopOf(locs);
      return locs.map((_, i) => locs.map((__, j) => ({ timeS: hop(i, j), distanceM: 0 })));
    };
    const out = await sweepTrip({} as never, 'http://engine', ORIGIN, 45 * 60, {
      reachM: 15_000,
      stemM: 300,
      costingOptions: { use_highways: 0.2 },
      coresFn,
      matrixFn,
      routeFn: fakeRouteFn([]),
    });
    expect(kinds.sort()).toEqual(['loop', 'ribbon']);
    expect(matrixCalls).toBe(1);
    expect(out.pieces).toBe(2);
    expect(out.plans).toBeGreaterThan(0);
    expect(out.trip).not.toBeNull();
    expect(out.trip!.source).toBe('sweep');
    expect(out.calls).toBeGreaterThan(0);
  });

  it('an index or matrix failure is never fatal — the caller falls through', async () => {
    const boom = async (): Promise<CoreRowRead[]> => {
      throw new Error('db down');
    };
    const out = await sweepTrip({} as never, 'http://engine', ORIGIN, 3600, {
      reachM: 15_000,
      stemM: 300,
      costingOptions: {},
      coresFn: boom,
    });
    expect(out.trip).toBeNull();
    expect(out.rejected).toEqual([]);
  });
});
