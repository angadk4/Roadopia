import type { LatLng, LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { MatrixCell } from '../valhalla/matrix';

import {
  buildChainCandidates,
  buildCorridorChains,
  buildSpanPool,
  CHAIN_MAX_SPANS,
  chainMatrixLocations,
  CORRIDOR_MAX_SPANS,
  CORRIDOR_MIN_SPANS,
  M_SPAN_POOL,
} from './chain';
import type { CandidateSegment } from './retrieve';

/**
 * R18-3 — chain generator on synthetic material: deterministic, budget-aware,
 * sweep-ordered, span identity intact. Matrix cells are synthesized from
 * straight-line distance at a fixed speed so budgets are analyzable.
 */

const ORIGIN: LatLng = { lat: 43.25, lng: -79.87 };
const LAT_M = 111_320;
const LNG_M = 111_320 * Math.cos((43.25 * Math.PI) / 180);

function at(bearingDeg: number, km: number): LatLng {
  const r = (bearingDeg * Math.PI) / 180;
  return {
    lat: ORIGIN.lat + ((km * 1000) / LAT_M) * Math.cos(r),
    lng: ORIGIN.lng + ((km * 1000) / LNG_M) * Math.sin(r),
  };
}

let seq = 0;
function segmentAt(bearing: number, km: number, lengthM = 2000, curviness = 3): CandidateSegment {
  seq += 1;
  const c = at(bearing, km);
  const dx = lengthM / 2 / LNG_M;
  const geometry: LineString = {
    type: 'LineString',
    coordinates: [
      [c.lng - dx, c.lat],
      [c.lng, c.lat],
      [c.lng + dx, c.lat],
    ],
  };
  return {
    id: `s${seq}`,
    osmWayId: `${9000 + seq}`,
    name: `Chain Rd ${seq}`,
    highway: 'tertiary',
    lengthM,
    curviness,
    geometry,
  };
}

/** Synthetic matrix: time = straight-line distance / 15 m/s; symmetric. */
function syntheticMatrix(locs: Array<[number, number]>): MatrixCell[][] {
  return locs.map(([alng, alat]) =>
    locs.map(([blng, blat]) => {
      const d = Math.hypot((alng - blng) * LNG_M, (alat - blat) * LAT_M);
      return { timeS: d / 15, distanceM: d };
    }),
  );
}

describe('buildSpanPool (R18-3)', () => {
  it('ranks by value, enforces separation + plausibility, caps the pool', () => {
    seq = 0;
    const segs: CandidateSegment[] = [];
    for (let i = 0; i < 40; i++) segs.push(segmentAt((i * 37) % 360, 6 + (i % 8)));
    // an implausibly far span for a 1-hour budget (2·60 km at 50 km/h ≫ 1.5 h)
    segs.push(segmentAt(10, 60));
    // a too-short segment
    segs.push(segmentAt(20, 6, 500));
    const pool = buildSpanPool(ORIGIN, segs, 3600, 50);
    expect(pool.length).toBeLessThanOrEqual(M_SPAN_POOL);
    expect(pool.length).toBeGreaterThan(5);
    expect(pool.some((p) => p.distanceM > 55_000)).toBe(false); // far span excluded
    expect(pool.every((p) => p.segment.lengthM >= 1200)).toBe(true);
    // deterministic
    const pool2 = buildSpanPool(ORIGIN, segs, 3600, 50);
    expect(pool.map((p) => p.segment.id)).toEqual(pool2.map((p) => p.segment.id));
  });
});

describe('buildChainCandidates (R18-3)', () => {
  function fixture() {
    seq = 0;
    const segs: CandidateSegment[] = [];
    // 12 good spans spread around the compass at 6-9 km
    for (let i = 0; i < 12; i++) segs.push(segmentAt(i * 30, 6 + (i % 4)));
    const pool = buildSpanPool(ORIGIN, segs, 5400, 50);
    const locs = chainMatrixLocations(ORIGIN, pool);
    return { pool, matrix: syntheticMatrix(locs) };
  }

  it('chains 3+ spans, sweep-ordered, with intact span identity', () => {
    const { pool, matrix } = fixture();
    const chains = buildChainCandidates(ORIGIN, pool, matrix, { durationS: 5400 });
    expect(chains.length).toBeGreaterThan(0);
    for (const c of chains) {
      expect(c.spans!.length).toBeGreaterThanOrEqual(3);
      expect(c.spans!.length).toBeLessThanOrEqual(CHAIN_MAX_SPANS);
      // every span's indices point at real waypoints
      for (const sp of c.spans!) {
        expect(c.waypoints[sp.startIndex]).toBeDefined();
        expect(c.waypoints[sp.endIndex]).toBeDefined();
        expect(Math.abs(sp.endIndex - sp.startIndex)).toBe(1);
      }
      // sweep order: rotated bearings of span entries are non-decreasing
      const rot = (x: number) => (x - (c.sector * 360) / 4 + 360) % 360;
      const bearings = c.spans!.map((sp) => {
        const w = c.waypoints[sp.startIndex]!;
        const deg =
          (Math.atan2((w.lng - ORIGIN.lng) * LNG_M, (w.lat - ORIGIN.lat) * LAT_M) * 180) / Math.PI;
        return rot((deg + 360) % 360);
      });
      for (let i = 1; i < bearings.length; i++) {
        expect(bearings[i]!).toBeGreaterThanOrEqual(bearings[i - 1]! - 1e-6);
      }
    }
  });

  it('is deterministic and dedupes identical span-sets across rotations', () => {
    const { pool, matrix } = fixture();
    const a = buildChainCandidates(ORIGIN, pool, matrix, { durationS: 5400 });
    const b = buildChainCandidates(ORIGIN, pool, matrix, { durationS: 5400 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const keys = a.map((c) => c.spans!.map((s) => s.segmentId).join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('respects the budget: predicted duration ≤ fill target (matrix-checked)', () => {
    const { pool, matrix } = fixture();
    const chains = buildChainCandidates(ORIGIN, pool, matrix, { durationS: 5400 });
    // re-predict each chain with the same matrix and assert ≤ 1.0 × budget
    const locOf = (p: LatLng): number => {
      const locs = chainMatrixLocations(ORIGIN, pool);
      for (let i = 0; i < locs.length; i++) {
        if (Math.abs(locs[i]![0] - p.lng) < 1e-9 && Math.abs(locs[i]![1] - p.lat) < 1e-9) return i;
      }
      return -1;
    };
    for (const c of chains) {
      let t = 0;
      let prev = 0; // origin
      for (const w of c.waypoints) {
        const idx = locOf(w);
        if (idx === -1) continue; // anchor point — not in the matrix
        t += matrix[prev]![idx]!.timeS!;
        prev = idx;
      }
      t += matrix[prev]![0]!.timeS!;
      expect(t).toBeLessThanOrEqual(5400 * 1.0 + 1);
    }
  });

  it('returns [] when the pool is too small or hops are unroutable', () => {
    const { pool, matrix } = fixture();
    expect(buildChainCandidates(ORIGIN, pool.slice(0, 2), matrix, { durationS: 5400 })).toEqual([]);
    const dead = matrix.map((row) => row.map(() => ({ timeS: null, distanceM: null })));
    expect(buildChainCandidates(ORIGIN, pool, dead, { durationS: 5400 })).toEqual([]);
  });
});

describe('buildCorridorChains (R18-3 A→B parity)', () => {
  const DEST: LatLng = at(90, 40); // 40 km due east

  function corridorSegs(): CandidateSegment[] {
    seq = 0;
    const segs: CandidateSegment[] = [];
    // six good spans strung along the corridor at progress ~0.2..0.8,
    // a few km off-axis (small marginal detour)
    for (let i = 0; i < 6; i++) {
      const along = 8 + i * 5; // km east
      const off = i % 2 === 0 ? 78 : 102; // slightly north/south of the axis
      segs.push(segmentAt(off, along));
    }
    // far off-corridor span (huge marginal detour) — must be excluded
    segs.push(segmentAt(0, 30));
    // too-short piece
    segs.push(segmentAt(90, 20, 300));
    return segs;
  }

  it('chains 2-4 spans monotone by corridor progress, span identity intact', () => {
    const chains = buildCorridorChains(ORIGIN, DEST, corridorSegs());
    expect(chains.length).toBeGreaterThan(0);
    const prog = (p: LatLng): number => {
      const dO = Math.hypot((p.lng - ORIGIN.lng) * LNG_M, (p.lat - ORIGIN.lat) * LAT_M);
      const dD = Math.hypot((p.lng - DEST.lng) * LNG_M, (p.lat - DEST.lat) * LAT_M);
      const direct = Math.hypot((DEST.lng - ORIGIN.lng) * LNG_M, (DEST.lat - ORIGIN.lat) * LAT_M);
      return (dO - dD) / (2 * direct) + 0.5;
    };
    for (const c of chains) {
      expect(c.kind).toBe('atob');
      expect(c.spans!.length).toBeGreaterThanOrEqual(CORRIDOR_MIN_SPANS);
      expect(c.spans!.length).toBeLessThanOrEqual(CORRIDOR_MAX_SPANS);
      // far off-corridor span never selected
      expect(c.waypoints.every((w) => prog(w) > -0.2 && prog(w) < 1.2)).toBe(true);
      // waypoint progress is monotone non-decreasing (no backtracking) within
      // tolerance of the span's own geometry
      const progs = c.waypoints.map(prog);
      for (let i = 1; i < progs.length; i++) {
        expect(progs[i]!).toBeGreaterThanOrEqual(progs[i - 1]! - 0.05);
      }
      // span refs point at real waypoints
      for (const sp of c.spans!) {
        expect(c.waypoints[sp.startIndex]).toBeDefined();
        expect(c.waypoints[sp.endIndex]).toBeDefined();
      }
    }
  });

  it('is deterministic and returns [] on starved corridors', () => {
    const a = buildCorridorChains(ORIGIN, DEST, corridorSegs());
    const b = buildCorridorChains(ORIGIN, DEST, corridorSegs());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // one span is not a chain
    seq = 0;
    expect(buildCorridorChains(ORIGIN, DEST, [segmentAt(90, 20)])).toEqual([]);
    // degenerate o≈d
    expect(buildCorridorChains(ORIGIN, ORIGIN, corridorSegs())).toEqual([]);
  });
});
