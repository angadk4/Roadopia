/**
 * Out-and-back detection (R27) — the defect the owner keeps reporting and every
 * shipped detector keeps missing: "random drives down a road then u turns back
 * again".
 *
 * WHY THIS EXISTS WHEN WE ALREADY HAVE THREE DETECTORS.
 * `uturnCount` reads Valhalla MANEUVERS, and a route built with `through`
 * waypoints emits no `uturn_*` maneuver even when the driver plainly turns
 * around — Valhalla is forbidden from u-turning AT a through point, so it
 * doubles back along the road instead and reports the reversal as ordinary
 * turns. `spurPositions` and `maxRetraceRunM` key on named-road repetition,
 * which misses a reversal that happens across a road-name change or on unnamed
 * rural segments. audit-v13 measured the gap directly: routes with 3-10 km of
 * geometric doubling reporting `uturns: 0`.
 *
 * So this measures the thing itself, from geometry alone, with no dependence on
 * maneuver types or road names: a stretch of route that comes back along a
 * piece of road it already used, travelling the other way.
 */
import type { LineString } from '@shared/types';

/** Corridor half-width for "this is the same piece of road again", metres. */
export const OAB_NEAR_M = 30;
/** Heading difference above which two passes count as OPPOSITE, degrees. */
export const OAB_OPPOSED_DEG = 135;
/**
 * Ignore doublings shorter than this. A roundabout, a jughandle and the wiggle
 * through a junction are all legitimately "opposed" for a few tens of metres;
 * a driver only experiences an out-and-back when it runs for a while.
 */
export const OAB_MIN_RUN_M = Number(process.env['OAB_MIN_RUN_M'] ?? 250);

export interface OutAndBackRun {
  /** Distance along the route where the doubling starts, metres. */
  atM: number;
  lengthM: number;
  /** Midpoint [lng, lat] — so a human can go and look at it. */
  point: [number, number];
}

export interface OutAndBackResult {
  totalM: number;
  longestM: number;
  runs: OutAndBackRun[];
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

function bearing(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x =
    Math.cos(a[1] * rad) * Math.sin(b[1] * rad) -
    Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Metres of route that retrace an earlier stretch in the opposite direction.
 *
 * Grid-bucketed so it stays roughly linear in point count (cells ~55 m, and
 * only the 3x3 neighbourhood is searched). Deterministic: no RNG, no ordering
 * dependence beyond the polyline itself.
 */
export function outAndBack(geometry: LineString): OutAndBackResult {
  const c = geometry.coordinates as Array<[number, number]>;
  if (c.length < 4) return { totalM: 0, longestM: 0, runs: [] };

  const segLen: number[] = [];
  const segBear: number[] = [];
  const cum: number[] = [0];
  for (let i = 0; i < c.length - 1; i++) {
    const l = hav(c[i]!, c[i + 1]!);
    segLen.push(l);
    segBear.push(bearing(c[i]!, c[i + 1]!));
    cum.push(cum[i]! + l);
  }

  const CELL = 0.0005; // ~55 m
  const grid = new Map<string, number[]>();
  const opposed: boolean[] = new Array(segLen.length).fill(false);

  for (let i = 0; i < segLen.length; i++) {
    const mid: [number, number] = [(c[i]![0] + c[i + 1]![0]) / 2, (c[i]![1] + c[i + 1]![1]) / 2];
    const gx = Math.round(mid[0] / CELL);
    const gy = Math.round(mid[1] / CELL);
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
          // Skip immediate neighbours — consecutive segments of a sharp switchback
          // are not a revisit, they are the corner itself.
          if (i - j < 4) continue;
          const jm: [number, number] = [
            (c[j]![0] + c[j + 1]![0]) / 2,
            (c[j]![1] + c[j + 1]![1]) / 2,
          ];
          if (hav(mid, jm) > OAB_NEAR_M) continue;
          const d = Math.abs(segBear[i]! - segBear[j]!);
          if ((d > 180 ? 360 - d : d) >= OAB_OPPOSED_DEG) {
            opposed[i] = true;
            break outer;
          }
        }
      }
    }
    const k = `${gx}:${gy}`;
    const arr = grid.get(k);
    if (arr) arr.push(i);
    else grid.set(k, [i]);
  }

  const runs: OutAndBackRun[] = [];
  let i = 0;
  let total = 0;
  let longest = 0;
  while (i < opposed.length) {
    if (!opposed[i]) {
      i++;
      continue;
    }
    const start = i;
    let len = 0;
    while (i < opposed.length && opposed[i]) {
      len += segLen[i]!;
      i++;
    }
    if (len >= OAB_MIN_RUN_M) {
      total += len;
      longest = Math.max(longest, len);
      const midIdx = Math.floor((start + i) / 2);
      runs.push({
        atM: Math.round(cum[start]!),
        lengthM: Math.round(len),
        point: [+c[midIdx]![0].toFixed(5), +c[midIdx]![1].toFixed(5)],
      });
    }
  }
  return { totalM: Math.round(total), longestM: Math.round(longest), runs };
}
