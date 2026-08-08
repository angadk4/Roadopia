/**
 * Area-revisit detection (R28) — the fourth and last unmodelled defect class,
 * reported by the owner from the device on 2026-07-31:
 *
 *   "random road entries and exits u-turns like many times in Inglewood"
 *
 * WHY EVERY EXISTING DETECTOR MISSES IT.
 *   - `outAndBack` (R27) requires OPPOSED headings on the same piece of road. A
 *     route that passes through the same village three times on three different
 *     roads never triggers it. Measured: 0/24 of the owner's routes showed
 *     multi-doubling even with the floor dropped to 80 m.
 *   - `microloopPositions` looks for a small CLOSED circuit; these revisits are
 *     kilometres apart along the route and never close.
 *   - `spurPositions` / `maxRetraceRunM` key on named-road repetition.
 *   - `uturnCount` reads maneuver labels, which `through` waypoints suppress.
 *   - `selfOverlapRatio` counts shared EDGES; approaching the same crossroads
 *     from four different directions shares no edge at all.
 * So the planner believed these routes were clean, and the driver kept finding
 * himself back in Inglewood. Measured on the owner's own places: 13 of 24
 * routes revisit 2+ distinct locations, worst 9 locations on one 60 km loop.
 *
 * WHAT COUNTS AS A REVISIT. The route comes within `REVISIT_NEAR_M` of a place
 * it has already been, having travelled at least `REVISIT_APART_M` along the
 * route in between. The along-route separation is what distinguishes a genuine
 * return from simply being on the same stretch of road — without it, every
 * consecutive vertex would "revisit" its neighbour.
 */
import type { LineString } from '@shared/types';

/** How close counts as "the same place", metres. */
export const REVISIT_NEAR_M = 350;
/** Minimum along-route distance between two passes for them to be separate. */
export const REVISIT_APART_M = 2_500;
/** Sampling stride — every Nth vertex is considered as a candidate place. */
const STRIDE = 3;

export interface RevisitPlace {
  /** [lng, lat] of the revisited place. */
  point: [number, number];
  /** How many separate times the route passes it (>= 2 by construction). */
  passes: number;
}

export interface RevisitResult {
  /** Distinct places the route returns to. */
  places: RevisitPlace[];
  /** Most passes over any single place. */
  worstPasses: number;
}

function hav(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Distinct places the route returns to.
 *
 * `originGraceM` suppresses the start/finish neighbourhood: a loop is SUPPOSED
 * to come back to where it began, and counting that as a defect would fire on
 * every correct route.
 */
export function revisitPlaces(
  geometry: LineString,
  origin?: { lat: number; lng: number },
  originGraceM = 1_500,
): RevisitResult {
  const c = geometry.coordinates as Array<[number, number]>;
  if (c.length < 8) return { places: [], worstPasses: 0 };

  const cum: number[] = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1]! + hav(c[i - 1]!, c[i]!));

  const o: [number, number] | null = origin ? [origin.lng, origin.lat] : null;
  const places: RevisitPlace[] = [];

  for (let i = 0; i < c.length; i += STRIDE) {
    const p = c[i]!;
    if (o !== null && hav(p, o) <= originGraceM) continue; // the loop closing is not a defect
    // already covered by an accepted place?
    let covered = false;
    for (const s of places) {
      if (hav(p, s.point) <= REVISIT_NEAR_M) {
        covered = true;
        break;
      }
    }
    if (covered) continue;

    let passes = 0;
    let lastAt = -Infinity;
    for (let j = 0; j < c.length; j += STRIDE) {
      if (hav(p, c[j]!) <= REVISIT_NEAR_M && cum[j]! - lastAt > REVISIT_APART_M) {
        passes++;
        lastAt = cum[j]!;
      }
    }
    if (passes >= 2) places.push({ point: [+p[0].toFixed(5), +p[1].toFixed(5)], passes });
  }

  return {
    places,
    worstPasses: places.reduce((m, s) => Math.max(m, s.passes), 0),
  };
}

/** Convenience count for the offence/reject paths. */
export function revisitCount(geometry: LineString, origin?: { lat: number; lng: number }): number {
  return revisitPlaces(geometry, origin).places.length;
}
