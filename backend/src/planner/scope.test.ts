import type { GetIsochroneInput, GetIsochroneOutput, LatLng, LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { segIntersect } from './crossings';
import {
  ALPHA_LOOP,
  ATOB_CORRIDOR_CHUNK_M,
  ATOB_CORRIDOR_HALF_WIDTH_FRAC,
  ATOB_CORRIDOR_MIN_HALF_WIDTH_M,
  atobCorridorHalfWidthM,
  buildScope,
  corridorRings,
  corridorScope,
  MIN_TAU_S,
  ringToGeoJsonPolygon,
} from './scope';

/**
 * M3-T03 — scope module unit tests with an injected fake isochrone: the fake
 * returns a square ring whose half-size grows linearly with time_s, so polygon
 * scaling with duration is directly observable without a live engine.
 */

const HAMILTON: LatLng = { lat: 43.2557, lng: -79.8711 };
const STC: LatLng = { lat: 43.1594, lng: -79.2469 };

const calls: GetIsochroneInput[] = [];
async function fakeIso(input: GetIsochroneInput): Promise<GetIsochroneOutput> {
  calls.push(input);
  const half = input.time_s / 3600; // degrees per hour of budget — linear growth
  const { lat, lng } = input.origin;
  return {
    polygon: [
      { lat: lat - half, lng: lng - half },
      { lat: lat - half, lng: lng + half },
      { lat: lat + half, lng: lng + half },
      { lat: lat + half, lng: lng - half },
    ],
  };
}

function ringArea(ring: LatLng[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a.lng * b.lat - b.lng * a.lat;
  }
  return Math.abs(s / 2);
}

describe('buildScope (M3-T03)', () => {
  it('loop: single ring at τ_out = α·T*, polygon scales with duration', async () => {
    calls.length = 0;
    const short = await buildScope(
      'unused',
      { origin: HAMILTON, shape: 'loop', durationS: 3600 },
      fakeIso,
    );
    const long = await buildScope(
      'unused',
      { origin: HAMILTON, shape: 'loop', durationS: 10800 },
      fakeIso,
    );

    expect(short.rings).toHaveLength(1);
    expect(short.tauOutS).toBe(Math.round(3600 * ALPHA_LOOP));
    expect(long.tauOutS).toBe(Math.round(10800 * ALPHA_LOOP));
    // 3× the duration ⇒ 3× the linear size ⇒ ~9× the area on the fake engine
    const ratio = ringArea(long.rings[0]!) / ringArea(short.rings[0]!);
    expect(ratio).toBeGreaterThan(8);
    expect(ratio).toBeLessThan(10);
    expect(calls.every((c) => c.costing === 'auto')).toBe(true);
  });

  it('a_to_b: two rings (origin + destination) — differs sensibly from loop', async () => {
    calls.length = 0;
    const scope = await buildScope(
      'unused',
      { origin: HAMILTON, shape: 'a_to_b', durationS: 5400, destination: STC },
      fakeIso,
    );
    expect(scope.rings).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.origin).toEqual(HAMILTON);
    expect(calls[1]!.origin).toEqual(STC);
    // the two rings are centred differently — the corridor covers both ends
    expect(scope.rings[0]![0]!.lng).not.toBeCloseTo(scope.rings[1]![0]!.lng, 1);
  });

  it('a_to_b without a destination throws', async () => {
    await expect(
      buildScope('unused', { origin: HAMILTON, shape: 'a_to_b', durationS: 3600 }, fakeIso),
    ).rejects.toThrow(/destination/);
  });

  it('tiny budgets are floored to MIN_TAU_S', async () => {
    const scope = await buildScope(
      'unused',
      { origin: HAMILTON, shape: 'loop', durationS: 120 },
      fakeIso,
    );
    expect(scope.tauOutS).toBe(MIN_TAU_S);
  });

  it('ringToGeoJsonPolygon closes the ring for the PostGIS RPCs', () => {
    const gj = ringToGeoJsonPolygon([
      { lat: 43.2, lng: -79.9 },
      { lat: 43.3, lng: -79.9 },
      { lat: 43.3, lng: -79.8 },
    ]);
    const ring = gj.coordinates[0]!;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
    expect(ring[0]).toEqual([-79.9, 43.2]); // [lng, lat] order
  });
});

/**
 * BD-203 (H) — corridor Ω from the direct route. Synthetic lines in local
 * metres at 43.5°N; validity = a closed ring with no self-intersections that
 * contains every vertex of the line it buffers.
 */
describe('corridorRings / corridorScope (BD-203)', () => {
  const LAT0 = 43.5;
  const LNG0 = -80.0;
  const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
  const KY = 111_320;
  const p = (xM: number, yM: number): [number, number] => [LNG0 + xM / KX, LAT0 + yM / KY];
  const lineOf = (corners: Array<[number, number]>, stepM = 500): LineString => {
    const coords: Array<[number, number]> = [];
    for (let i = 0; i < corners.length - 1; i++) {
      const [ax, ay] = corners[i]!;
      const [bx, by] = corners[i + 1]!;
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < len; d += stepM) {
        coords.push(p(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len));
      }
    }
    const last = corners[corners.length - 1]!;
    coords.push(p(last[0], last[1]));
    return { type: 'LineString', coordinates: coords };
  };
  const inside = (ring: LatLng[], lng: number, lat: number): boolean => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (
        a.lat > lat !== b.lat > lat &&
        lng < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng
      ) {
        ins = !ins;
      }
    }
    return ins;
  };
  const selfIntersects = (ring: LatLng[]): boolean => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const a1 = ring[i]!;
        const a2 = ring[(i + 1) % n]!;
        const b1 = ring[j]!;
        const b2 = ring[(j + 1) % n]!;
        if (
          segIntersect([a1.lng, a1.lat], [a2.lng, a2.lat], [b1.lng, b1.lat], [b2.lng, b2.lat]) !==
          null
        ) {
          return true;
        }
      }
    }
    return false;
  };
  const coveredByOne = (rings: LatLng[][], line: LineString): boolean =>
    line.coordinates.every(([lng, lat]) => rings.some((r) => inside(r, lng, lat)));

  it('half-width: an 8 km floor, 0.2 × the direct distance above it, widened by τ', () => {
    expect(atobCorridorHalfWidthM(6_000)).toBe(ATOB_CORRIDOR_MIN_HALF_WIDTH_M);
    expect(atobCorridorHalfWidthM(100_000)).toBe(ATOB_CORRIDOR_HALF_WIDTH_FRAC * 100_000);
    expect(atobCorridorHalfWidthM(100_000, 1.3)).toBeCloseTo(26_000, 6);
  });

  it('a straight 30 km line → ONE valid ring of the asked width that contains the line', () => {
    const line = lineOf([
      [0, 0],
      [30_000, 0],
    ]);
    const rings = corridorRings(line, 8_000);
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(selfIntersects(ring)).toBe(false);
    expect(coveredByOne(rings, line)).toBe(true);
    // width: the ring spans 2 × 8 km across the line, 30 + 2 × 8 km along it
    const lats = ring.map((q) => q.lat);
    const lngs = ring.map((q) => q.lng);
    const acrossM = (Math.max(...lats) - Math.min(...lats)) * KY;
    const alongM = (Math.max(...lngs) - Math.min(...lngs)) * KX;
    expect(acrossM).toBeGreaterThan(15_500);
    expect(acrossM).toBeLessThan(16_500);
    expect(alongM).toBeGreaterThan(45_500);
    expect(alongM).toBeLessThan(46_500);
    // a point 12 km off the line is OUTSIDE (the corridor is not a blob)
    const [offLng, offLat] = p(15_000, 12_000);
    expect(inside(ring, offLng, offLat)).toBe(false);
  });

  it('a 150 km line splits into 3 chunks (≤ 60 km each) that together cover it', () => {
    const line = lineOf([
      [0, 0],
      [150_000, 20_000],
    ]);
    const rings = corridorRings(line, 30_000);
    expect(rings).toHaveLength(Math.ceil(150_000 / ATOB_CORRIDOR_CHUNK_M));
    for (const r of rings) expect(selfIntersects(r)).toBe(false);
    expect(coveredByOne(rings, line)).toBe(true);
  });

  it('a right-angle corridor still yields a valid ring containing the line', () => {
    const line = lineOf([
      [0, 0],
      [30_000, 0],
      [30_000, 30_000],
    ]);
    const rings = corridorRings(line, 8_000);
    expect(rings).toHaveLength(1);
    expect(selfIntersects(rings[0]!)).toBe(false);
    expect(coveredByOne(rings, line)).toBe(true);
  });

  it('a gently curving 40 km line is contained by its single ring', () => {
    const corners: Array<[number, number]> = [];
    for (let x = 0; x <= 40_000; x += 2_000) corners.push([x, 6_000 * Math.sin(x / 12_000)]);
    const line = lineOf(corners, 250);
    const rings = corridorRings(line, 8_000);
    expect(rings).toHaveLength(1);
    expect(selfIntersects(rings[0]!)).toBe(false);
    expect(coveredByOne(rings, line)).toBe(true);
  });

  it('corridorScope is an a_to_b Scope with the half-width recorded and no τ', () => {
    const scope = corridorScope(
      lineOf([
        [0, 0],
        [10_000, 0],
      ]),
      8_000,
    );
    expect(scope.shape).toBe('a_to_b');
    expect(scope.tauOutS).toBe(0);
    expect(scope.corridorHalfWidthM).toBe(8_000);
    expect(scope.rings).toHaveLength(1);
    // GeoJSON-ready: the polygon closes
    const gj = ringToGeoJsonPolygon(scope.rings[0]!);
    const ring = gj.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
