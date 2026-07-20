import { describe, expect, it } from 'vitest';
import {
  circumradiusMeters,
  haversineMeters,
  lineLengthMeters,
  resample,
  toLocalXY,
  turnAngleDeg,
  type LonLat,
} from './geometry';
import { computeCurvature, DEFAULT_PARAMS, isClosedRing, isJunctionGeometry } from './compute';
import { gridFalsePositiveRate, percentile, ranks, spearman } from './stats';

const EARTH_RADIUS_M = 6_371_008.8;
const DEG2RAD = Math.PI / 180;
const REF_LAT = 43.2; // ~Niagara escarpment latitude

/**
 * Build a lon/lat from local metres (x=east, y=north) seated at REF_LAT, so the
 * fixture's true latitude matches the projection latitude the engine uses. Without
 * the REF_LAT base the points would sit at the equator and haversine/meanLat would
 * disagree with the cos(REF_LAT) projection.
 */
function fromXY(x: number, y: number): LonLat {
  const lat = REF_LAT + y / (DEG2RAD * EARTH_RADIUS_M);
  const lon = x / (DEG2RAD * EARTH_RADIUS_M * Math.cos(REF_LAT * DEG2RAD));
  return [lon, lat];
}

/** A circular arc of radius R (metres), `sweepDeg` of arc, `n` points. */
function arc(radiusM: number, sweepDeg: number, n: number, cx = 0, cy = 0): LonLat[] {
  const pts: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = (sweepDeg * DEG2RAD * i) / (n - 1);
    pts.push(fromXY(cx + radiusM * Math.cos(t), cy + radiusM * Math.sin(t)));
  }
  return pts;
}

/** A straight line of `lengthM` along the east axis, `n` points. */
function straight(lengthM: number, n: number): LonLat[] {
  const pts: LonLat[] = [];
  for (let i = 0; i < n; i++) pts.push(fromXY((lengthM * i) / (n - 1), 0));
  return pts;
}

describe('geometry primitives', () => {
  it('haversine matches a known short east-west span', () => {
    // 0.01° lon at lat 43.2 ≈ 811 m
    const d = haversineMeters([-79.0, 43.2], [-78.99, 43.2]);
    expect(d).toBeGreaterThan(800);
    expect(d).toBeLessThan(820);
  });

  it('fromXY/toLocalXY preserve relative east/north displacements', () => {
    const o = toLocalXY(fromXY(0, 0), REF_LAT);
    const p = toLocalXY(fromXY(1234, -567), REF_LAT);
    expect(p[0] - o[0]).toBeCloseTo(1234, 3);
    expect(p[1] - o[1]).toBeCloseTo(-567, 3);
  });

  it('circumradius of three points on a circle recovers its radius', () => {
    const a = arc(250, 60, 3);
    const r = circumradiusMeters(a[0]!, a[1]!, a[2]!, REF_LAT);
    expect(r).toBeGreaterThan(240);
    expect(r).toBeLessThan(260);
  });

  it('circumradius of collinear points is Infinity', () => {
    const s = straight(300, 3);
    expect(circumradiusMeters(s[0]!, s[1]!, s[2]!, REF_LAT)).toBe(Infinity);
  });

  it('turn angle is ~0 straight, ~+90 for a left turn', () => {
    expect(Math.abs(turnAngleDeg(fromXY(0, 0), fromXY(100, 0), fromXY(200, 0), REF_LAT))).toBeLessThan(0.5);
    const t = turnAngleDeg(fromXY(0, 0), fromXY(100, 0), fromXY(100, 100), REF_LAT);
    expect(t).toBeGreaterThan(89);
    expect(t).toBeLessThan(91);
  });

  it('resample yields ~fixed spacing and preserves endpoints', () => {
    const line = straight(1000, 2);
    const rs = resample(line, 50);
    expect(rs.length).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < rs.length; i++) {
      const d = haversineMeters(rs[i - 1]!, rs[i]!);
      expect(d).toBeLessThan(60);
    }
    expect(rs[0]).toEqual(line[0]);
    expect(rs[rs.length - 1]).toEqual(line[1]);
  });
});

describe('computeCurvature — synthetic shapes', () => {
  it('a straight road scores ~zero curvature', () => {
    const r = computeCurvature(straight(2000, 50), DEFAULT_PARAMS);
    expect(r.skipped).toBe(false);
    expect(r.headingChangePerKm).toBeLessThan(2);
    expect(r.circumCurvaturePerKm).toBeLessThan(0.2);
  });

  it('a circular arc recovers curvature ≈ 1000/R per km', () => {
    // R = 300 m → expected curvature ≈ 1000/300 ≈ 3.33 (1/km)
    const r = computeCurvature(arc(300, 120, 200), DEFAULT_PARAMS);
    expect(r.circumCurvaturePerKm).toBeGreaterThan(2.6);
    expect(r.circumCurvaturePerKm).toBeLessThan(4.0);
    // C2 for a constant-radius arc: (1000/R) rad/km → deg/km
    const expectedC2 = ((1000 / 300) * 180) / Math.PI;
    expect(r.headingChangePerKm).toBeGreaterThan(expectedC2 * 0.8);
    expect(r.headingChangePerKm).toBeLessThan(expectedC2 * 1.2);
  });

  it('a tight hairpin scores far higher than a gentle bend', () => {
    // hairpin: R=40 m, 240° sweep ⇒ ~168 m long (> minLengthM); gentle: R=800 m.
    const hairpin = computeCurvature(arc(40, 240, 150), DEFAULT_PARAMS);
    const gentle = computeCurvature(arc(800, 30, 120), DEFAULT_PARAMS);
    expect(hairpin.circumCurvaturePerKm).toBeGreaterThan(gentle.circumCurvaturePerKm * 5);
    expect(hairpin.headingChangePerKm).toBeGreaterThan(gentle.headingChangePerKm);
  });

  it('an urban-grid corner (one 90° turn over a long run) scores low on C2', () => {
    // 1 km east, then 1 km north — a single right-angle, like a grid block pair.
    const leg1: LonLat[] = [];
    for (let i = 0; i <= 25; i++) leg1.push(fromXY((1000 * i) / 25, 0));
    const leg2: LonLat[] = [];
    for (let i = 1; i <= 25; i++) leg2.push(fromXY(1000, (1000 * i) / 25));
    const gridLine = [...leg1, ...leg2];
    const r = computeCurvature(gridLine, DEFAULT_PARAMS);
    // one ~90° turn over ~2 km ⇒ ~45 deg/km, well below a twisty road's hundreds
    expect(r.headingChangePerKm).toBeLessThan(70);
  });

  it('too-short and degenerate geometries are skipped', () => {
    expect(computeCurvature(straight(50, 10), DEFAULT_PARAMS).skipped).toBe(true);
    expect(computeCurvature([[0, 0]], DEFAULT_PARAMS).skipped).toBe(true);
  });

  it('a closed ring (cul-de-sac bulb / circle) is skipped (R21-0)', () => {
    // a big loopy bulb (>minLengthM), then closed so last === first (ST_IsClosed)
    const ring = arc(80, 300, 60);
    ring.push(ring[0]!);
    expect(isClosedRing(ring)).toBe(true);
    expect(computeCurvature(ring, DEFAULT_PARAMS).skipped).toBe(true);
    // an open twisty arc with the same radius is NOT a ring and scores real curvature
    const open = arc(80, 300, 60);
    expect(isClosedRing(open)).toBe(false);
    expect(computeCurvature(open, DEFAULT_PARAMS).skipped).toBe(false);
  });

  it('junction geometry (roundabout / link) is excluded', () => {
    expect(isJunctionGeometry('tertiary', { junction: 'roundabout' })).toBe(true);
    expect(isJunctionGeometry('primary_link', {})).toBe(true);
    expect(isJunctionGeometry('residential', {})).toBe(false);
    const r = computeCurvature(arc(40, 270, 120), DEFAULT_PARAMS, 'tertiary', {
      junction: 'roundabout',
    });
    expect(r.skipped).toBe(true);
  });

  it('lineLengthMeters of a straight 2 km line ≈ 2000 m', () => {
    expect(lineLengthMeters(straight(2000, 5))).toBeGreaterThan(1990);
    expect(lineLengthMeters(straight(2000, 5))).toBeLessThan(2010);
  });
});

describe('stats', () => {
  it('ranks average ties', () => {
    expect(ranks([10, 20, 20, 40])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('spearman is 1 for a monotonic relation, -1 for anti-monotonic', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 25, 40])).toBeCloseTo(1, 5);
    expect(spearman([1, 2, 3, 4], [40, 25, 20, 10])).toBeCloseTo(-1, 5);
  });

  it('grid FP rate counts only ordinal-0 items above theta', () => {
    const ord = [0, 0, 0, 3];
    const metric = [1, 5, 9, 100];
    // theta=6 ⇒ one of three grid items (9) is a false positive
    expect(gridFalsePositiveRate(ord, metric, 6)).toBeCloseTo(1 / 3, 5);
  });

  it('percentile interpolates', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 5);
    expect(percentile([10], 0.9)).toBe(10);
  });
});
