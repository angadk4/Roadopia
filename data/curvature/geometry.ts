/**
 * Pure planar-geometry helpers for the curvature engine (SPK-10).
 *
 * Coordinates are GeoJSON `[lon, lat]` in degrees (WGS84). For the small spans of a
 * single road segment (≤ a few km) we project to a *local* equirectangular metric
 * plane around a reference latitude — accurate to well under a metre at these scales,
 * and far cheaper than full geodesics. All distances returned are in metres.
 *
 * Nothing here touches OSM tags, the DB, or I/O — it is unit-testable in isolation.
 */

export type LonLat = readonly [number, number];
/** A point on the local equirectangular plane, in metres. */
export type XY = readonly [number, number];

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean radius
const DEG2RAD = Math.PI / 180;

/** Great-circle distance between two lon/lat points, in metres (haversine). */
export function haversineMeters(a: LonLat, b: LonLat): number {
  const lat1 = a[1] * DEG2RAD;
  const lat2 = b[1] * DEG2RAD;
  const dLat = (b[1] - a[1]) * DEG2RAD;
  const dLon = (b[0] - a[0]) * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Project a lon/lat onto a local equirectangular plane (metres) around `refLat`.
 * x = east, y = north. Used so 3-point circumradius / heading maths is plain 2-D.
 */
export function toLocalXY(p: LonLat, refLatDeg: number): XY {
  const x = p[0] * DEG2RAD * EARTH_RADIUS_M * Math.cos(refLatDeg * DEG2RAD);
  const y = p[1] * DEG2RAD * EARTH_RADIUS_M;
  return [x, y];
}

/** Euclidean distance on the local plane, metres. */
export function distXY(a: XY, b: XY): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Total polyline length in metres (haversine sum). */
export function lineLengthMeters(coords: readonly LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1]!, coords[i]!);
  }
  return total;
}

/**
 * Resample a polyline to (approximately) fixed spacing in metres, preserving the
 * first and last vertices. Degenerate inputs (< 2 points, ~zero length) are returned
 * unchanged. This is the §12.1 preprocessing step that makes curvature metrics
 * comparable across roads digitised at different vertex densities.
 */
export function resample(coords: readonly LonLat[], spacingM: number): LonLat[] {
  if (coords.length < 2 || spacingM <= 0) return [...coords];
  // Cumulative distance along the path, then sample at fixed intervals by interpolation.
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1]! + haversineMeters(coords[i - 1]!, coords[i]!));
  }
  const total = cum[cum.length - 1]!;
  if (total === 0) return [...coords];
  const out: LonLat[] = [coords[0]!];
  let seg = 1;
  for (let d = spacingM; d < total; d += spacingM) {
    while (seg < coords.length && cum[seg]! < d) seg++;
    if (seg >= coords.length) break;
    const a = coords[seg - 1]!;
    const b = coords[seg]!;
    const span = cum[seg]! - cum[seg - 1]!;
    const t = span > 0 ? (d - cum[seg - 1]!) / span : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(coords[coords.length - 1]!);
  return out;
}

/**
 * Signed turn angle (degrees) at vertex `p2` going p1→p2→p3, in (-180, 180].
 * 0 = straight ahead; ±180 = full reversal. Returns 0 for degenerate triples.
 */
export function turnAngleDeg(p1: LonLat, p2: LonLat, p3: LonLat, refLatDeg: number): number {
  const a = toLocalXY(p1, refLatDeg);
  const b = toLocalXY(p2, refLatDeg);
  const c = toLocalXY(p3, refLatDeg);
  const v1x = b[0] - a[0];
  const v1y = b[1] - a[1];
  const v2x = c[0] - b[0];
  const v2y = c[1] - b[1];
  if ((v1x === 0 && v1y === 0) || (v2x === 0 && v2y === 0)) return 0;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  return Math.atan2(cross, dot) / DEG2RAD;
}

/**
 * Radius of the circle through three points, in metres (circumradius). Collinear or
 * coincident triples → Infinity (i.e. zero curvature). This is the geometric core of
 * the C7 metric: small radius ⇒ tight corner ⇒ high curvature.
 */
export function circumradiusMeters(
  p1: LonLat,
  p2: LonLat,
  p3: LonLat,
  refLatDeg: number,
): number {
  const a = toLocalXY(p1, refLatDeg);
  const b = toLocalXY(p2, refLatDeg);
  const c = toLocalXY(p3, refLatDeg);
  const ab = distXY(a, b);
  const bc = distXY(b, c);
  const ca = distXY(c, a);
  // twice the signed triangle area
  const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
  if (area2 === 0) return Infinity;
  return (ab * bc * ca) / (2 * area2);
}

/** Mean latitude of a polyline — the reference latitude for local projection. */
export function meanLat(coords: readonly LonLat[]): number {
  if (coords.length === 0) return 0;
  let s = 0;
  for (const c of coords) s += c[1];
  return s / coords.length;
}
