/**
 * R27 — the three-leg split: GETTING THERE · THE DRIVE · GETTING HOME.
 *
 * WHY THIS EXISTS. audit-v14 measured backroad share by position along a loop:
 *
 *     first 20 % (leaving the door)   13.7 % backroad · 83.4 % main+urban
 *     middle 60 % (the actual drive)  34.1 % backroad
 *     last 20 % (coming home)         12.3 % backroad
 *
 * A drive that starts in a suburb has to reach the countryside on arterial and
 * come back the same way. That is the road network, not a routing defect — but
 * because every metric averaged the whole polyline, the escape was dragging the
 * headline road-class number down and no lever could ever fix it. Ranking and
 * costing levers were both falsified against it (BD-123).
 *
 * So stop pretending the drive starts at the driveway. The route is split at
 * the first and last corpus waypoint: everything before the first is getting
 * there, everything after the last is getting home, and the span between them
 * is THE DRIVE — the part the product is actually about, measured on its own.
 *
 * The split is geometric because loop waypoints are `through` locations, which
 * Valhalla does NOT split legs at (route.ts:18-21) — `route.legs` is a single
 * leg for a loop, so per-leg summaries cannot supply this.
 */
import type { LatLng, LineString } from '@shared/types';

import { waypointVertexIndices } from './connectors';

export interface LegSplit {
  /** Vertex index where the drive begins / ends (inclusive bounds). */
  driveStartIdx: number;
  driveEndIdx: number;
  thereM: number;
  driveM: number;
  homeM: number;
  /** Fractions of total distance — what the card shows. */
  therePct: number;
  drivePct: number;
  homePct: number;
}

function hav(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la = (a[1] * Math.PI) / 180;
  const lb = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Split a routed loop into getting-there / drive / getting-home.
 *
 * Returns null when the split is not meaningful — no waypoints, or a drive span
 * that would be shorter than `minDriveFrac` of the route (a "drive" that is 5 %
 * of the trip is not a drive, and reporting one would be its own dishonesty).
 */
export function splitLoopLegs(
  geometry: LineString,
  waypoints: readonly LatLng[],
  minDriveFrac = 0.25,
): LegSplit | null {
  const coords = geometry.coordinates as Array<[number, number]>;
  if (coords.length < 4 || waypoints.length === 0) return null;

  const idx = waypointVertexIndices(geometry, waypoints).filter(
    (i) => i > 0 && i < coords.length - 1,
  );
  if (idx.length === 0) return null;
  const driveStartIdx = Math.min(...idx);
  const driveEndIdx = Math.max(...idx);
  if (driveEndIdx <= driveStartIdx) return null;

  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1]! + hav(coords[i - 1]!, coords[i]!));
  const total = cum[cum.length - 1]!;
  if (total <= 0) return null;

  const thereM = cum[driveStartIdx]!;
  const driveM = cum[driveEndIdx]! - cum[driveStartIdx]!;
  const homeM = total - cum[driveEndIdx]!;
  if (driveM / total < minDriveFrac) return null;

  return {
    driveStartIdx,
    driveEndIdx,
    thereM: Math.round(thereM),
    driveM: Math.round(driveM),
    homeM: Math.round(homeM),
    therePct: Math.round((thereM / total) * 100),
    drivePct: Math.round((driveM / total) * 100),
    homePct: Math.round((homeM / total) * 100),
  };
}

/** The drive portion as its own LineString, for measuring it on its own. */
export function driveGeometry(geometry: LineString, split: LegSplit): LineString {
  const coords = geometry.coordinates as Array<[number, number]>;
  return {
    type: 'LineString',
    coordinates: coords.slice(split.driveStartIdx, split.driveEndIdx + 1),
  };
}
