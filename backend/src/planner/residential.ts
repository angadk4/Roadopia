/**
 * Residential exposure of a route (owner round 7: "driving inside a small
 * neighbourhood with just houses shouldn't be there at all").
 *
 * Pure math over the trace_attributes edge list: the share of route length on
 * `residential`-class edges, EXEMPTING the origin grace zone — a user whose
 * start point sits on a residential street must legally drive their own
 * street out and back, exactly the convention the spur/overlap checks use
 * (ORIGIN_GRACE_RADIUS_M). Edge positions are recovered by walking the route
 * geometry proportionally to cumulative matched length (trace edges follow
 * the shape in order).
 */

import type { LatLng, LineString } from '@shared/types';

import type { TraceEdge } from '../valhalla/trace';

import { ORIGIN_GRACE_RADIUS_M } from './overlap';

const R = 6_371_000;
function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la = (a[1] * Math.PI) / 180;
  const lb = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Point at cumulative distance d along the line (clamped). */
function pointAt(coords: Array<[number, number]>, cum: number[], d: number): [number, number] {
  if (d <= 0) return coords[0]!;
  const total = cum[cum.length - 1]!;
  if (d >= total) return coords[coords.length - 1]!;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi]! - cum[lo]!;
  const t = segLen > 0 ? (d - cum[lo]!) / segLen : 0;
  const a = coords[lo]!;
  const b = coords[hi]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Share of matched route length on residential edges, outside the origin
 * grace radius. Returns 0 when everything sits inside the grace zone.
 */
export function residentialShareOf(
  edges: TraceEdge[],
  geometry: LineString,
  origin: LatLng,
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): number {
  const coords = geometry.coordinates as Array<[number, number]>;
  if (coords.length < 2 || edges.length === 0) return 0;
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1]! + haversineM(coords[i - 1]!, coords[i]!));
  }
  const geomLen = cum[cum.length - 1]!;
  const traceLen = edges.reduce((s, e) => s + e.lengthM, 0);
  if (geomLen === 0 || traceLen === 0) return 0;
  // trace edges follow the shape in order; scale trace positions onto the
  // geometry so midpoints can be located even when lengths drift slightly
  const scale = geomLen / traceLen;
  const originLngLat: [number, number] = [origin.lng, origin.lat];

  let outsideTotal = 0;
  let outsideResidential = 0;
  let pos = 0;
  for (const e of edges) {
    const mid = pointAt(coords, cum, (pos + e.lengthM / 2) * scale);
    pos += e.lengthM;
    if (haversineM(mid, originLngLat) <= graceRadiusM) continue;
    outsideTotal += e.lengthM;
    if (e.roadClass === 'residential') outsideResidential += e.lengthM;
  }
  return outsideTotal > 0 ? outsideResidential / outsideTotal : 0;
}

/** Non-residential gap (m) that does NOT end a residential run — a short
 *  connector inside a subdivision never "leaves the neighbourhood". */
export const RESIDENTIAL_RUN_BRIDGE_M = 250;

/**
 * Longest CONTIGUOUS residential run in metres, outside the origin grace
 * (owner round 8b, Bolton: 1.3 km of subdivision weaving hid at 4 % share on
 * a 101 km route — the SHARE scales with route length, the offence does not;
 * exactly the round-6 ratio-vs-run lesson, applied to road class). Runs
 * bridge non-residential gaps ≤ RESIDENTIAL_RUN_BRIDGE_M.
 */
export function maxResidentialRunM(
  edges: TraceEdge[],
  geometry: LineString,
  origin: LatLng,
  graceRadiusM: number = ORIGIN_GRACE_RADIUS_M,
): number {
  const coords = geometry.coordinates as Array<[number, number]>;
  if (coords.length < 2 || edges.length === 0) return 0;
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1]! + haversineM(coords[i - 1]!, coords[i]!));
  }
  const geomLen = cum[cum.length - 1]!;
  const traceLen = edges.reduce((s, e) => s + e.lengthM, 0);
  if (geomLen === 0 || traceLen === 0) return 0;
  const scale = geomLen / traceLen;
  const originLngLat: [number, number] = [origin.lng, origin.lat];

  let best = 0;
  let run = 0;
  let gap = 0;
  let pos = 0;
  for (const e of edges) {
    const mid = pointAt(coords, cum, (pos + e.lengthM / 2) * scale);
    pos += e.lengthM;
    const graced = haversineM(mid, originLngLat) <= graceRadiusM;
    if (!graced && e.roadClass === 'residential') {
      run += gap + e.lengthM; // bridge the swallowed gap
      gap = 0;
      if (run > best) best = run;
    } else if (run > 0 && !graced && gap + e.lengthM <= RESIDENTIAL_RUN_BRIDGE_M) {
      gap += e.lengthM; // short connector — run may continue
    } else {
      run = 0;
      gap = 0;
    }
  }
  return best;
}
