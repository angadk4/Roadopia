/**
 * R29 — the DRIVE-FIRST TRIP: Plan = constrained Discover, for real this time.
 *
 * THE PATTERN THIS BREAKS (BD-130, BD-136, BD-139, and the r33 chain probes):
 * every prior drive-first attempt piped measured cores INTO THE OLD BLOB
 * ASSEMBLY — seeds, single-ribbon candidates, ribbon chains all went through
 * `assembleLoop`, whose whole-trip gates (out-and-back, self-overlap,
 * revisits) exist to police a planner that INVENTS a blob. A trip built from a
 * pre-measured core plus two disclosed connectors is not that blob: the core
 * was hard-rejected clean offline, each connector is a simple best path, and
 * "you'll come home the way you went out" is a DISCLOSURE (with a two-sided
 * retry), not a defect to reject. Discover v2 ships exactly this shape and
 * measures PASS on every bar (BD-137). So the loop planner, when a measured
 * core FITS THE ASK, returns exactly a Discover trip — and only falls back to
 * blob generation when the index has nothing that fits.
 *
 * The ask means THE DRIVE (BD-135): a core fits when ITS duration is within
 * DRIVE_FIT of the request; connectors are extra, shown separately, and
 * judged as commute.
 */
import type { LatLng, LineString, RouteThroughOutput } from '@shared/types';
import type { Client } from 'pg';

import { routeThrough } from '../valhalla/route';

import { BACKROADS } from './costing';
import { DRIVE_CORES_VERSION, readDriveCores, type CoreRowRead } from './discover_cores';
import { edgeOverlapRatio } from './overlap';

/** How far (fraction) a core's DRIVE may miss the ask. Wider than the chain's
 *  0.35: a measured 70-min drive is an honest answer to "90 minutes" when it
 *  is the best that exists, and the card SAYS the real number. */
export const TRIP_FIT_TOLERANCE = Number(process.env['TRIP_FIT_TOLERANCE'] ?? 0.25);
/** Reach budget for the commute, as a fraction of the ask (each way). */
export const TRIP_REACH_FRAC = Number(process.env['TRIP_REACH_FRAC'] ?? 0.3);
/** Same-way-home overlap threshold + retry cost cap (mirrors discover_cores). */
const HOME_OVERLAP = 0.5;
const HOME_RETRY_FACTOR = 1.35;
const LINK_COSTING = { ...BACKROADS.options, exclude_highways: true } as const;

export interface DriveFirstTrip {
  core: CoreRowRead;
  out: RouteThroughOutput;
  home: RouteThroughOutput;
  sameWayHome: boolean;
  /** Concatenated out+core+home geometry — ONE renderable route. */
  geometry: LineString;
  distanceM: number;
  durationS: number;
}

function offsetVia(exit: LatLng, origin: LatLng, offsetM: number): [number, number] {
  const mid = { lat: (exit.lat + origin.lat) / 2, lng: (exit.lng + origin.lng) / 2 };
  const dx = (origin.lng - exit.lng) * Math.cos((mid.lat * Math.PI) / 180);
  const dy = origin.lat - exit.lat;
  const len = Math.hypot(dx, dy) || 1;
  const latM = 111_320;
  return [
    mid.lng + (-dy / len) * (offsetM / (latM * Math.cos((mid.lat * Math.PI) / 180))),
    mid.lat + (dx / len) * (offsetM / latM),
  ];
}

/**
 * Pick the best-fitting measured core and build its trip. Null when nothing
 * fits — the caller falls back to blob generation WITH a disclosure.
 *
 * Selection: duration-fit first (the ask IS the drive), then measured backroad,
 * then curviness, then id. Loop cores and ribbons both qualify — a loop core's
 * entry==exit makes sameWayHome likelier, which the retry ladder and the
 * disclosure handle, exactly as Discover does.
 */
export async function driveFirstTrip(
  db: Client,
  valhallaUrl: string,
  origin: LatLng,
  durationTargetS: number | null,
): Promise<DriveFirstTrip | null> {
  if (durationTargetS === null || durationTargetS <= 0) return null;
  const reachM = Math.max(10_000, (durationTargetS * TRIP_REACH_FRAC * 55_000) / 3600);
  const half = reachM / 111_320;
  let rows: CoreRowRead[];
  try {
    rows = await readDriveCores(
      db,
      [origin.lng - half, origin.lat - half, origin.lng + half, origin.lat + half],
      DRIVE_CORES_VERSION,
      50,
      // LOOP CORES ONLY. kind=null re-created the ribbon swamp the 0019
      // migration exists to prevent: top-50-by-quality = 6-9 min ribbons, so
      // the 42-156 min cores the fit needs never left the database (measured:
      // 6/60 briefs served). Ribbons top out at 52 min — they cannot fit these
      // asks alone; they are chaining material, not trips.
      'loop',
    );
  } catch {
    return null; // the legacy planner must never be hostage to the index
  }
  const fit = (r: CoreRowRead): number =>
    Math.abs(r.duration_s - durationTargetS) / durationTargetS;
  const hv = (a: LatLng, b: LatLng): number => {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  // Rank inside 0.1-wide fit bands by DISTANCE, then quality: among cores that
  // fit the ask about equally, the NEAR one wins — less commute, less shared
  // funnel, smaller same-way stretch. (Measured before this: ask 90 → trip
  // 148-218 min with 4-13 km of commute doubling; far cores with marginally
  // better fit were beating near ones.)
  const candidates = rows
    .filter((r) => fit(r) <= TRIP_FIT_TOLERANCE)
    .sort((a, b) => {
      const fa = Math.floor(fit(a) * 10);
      const fb = Math.floor(fit(b) * 10);
      if (fa !== fb) return fa - fb;
      const da = hv(origin, a.entry);
      const dbd = hv(origin, b.entry);
      if (Math.abs(da - dbd) > 2000) return da - dbd;
      return (
        b.backroad_share - a.backroad_share || b.curviness - a.curviness || a.id.localeCompare(b.id)
      );
    })
    .slice(0, 3); // up to 3 build attempts, deterministic

  // Build all viable candidates, then PREFER one whose different-way-home
  // retry succeeded: a strictly-less-overlap acceptance still shipped trips
  // with 4.4-9.9 km doubled on the commute (measured). A same-way trip is
  // served only when no candidate found a second road, and says so.
  const built: DriveFirstTrip[] = [];
  for (const row of candidates) {
    try {
      const [out, homeDirect] = await Promise.all([
        routeThrough(valhallaUrl, {
          waypoints: [
            [origin.lng, origin.lat],
            [row.entry.lng, row.entry.lat],
          ],
          costingOptions: LINK_COSTING,
        }),
        routeThrough(valhallaUrl, {
          waypoints: [
            [row.exit.lng, row.exit.lat],
            [origin.lng, origin.lat],
          ],
          costingOptions: LINK_COSTING,
        }),
      ]);
      // the commute must not dwarf the drive (Discover's own bar)
      const share =
        (out.duration_s + homeDirect.duration_s) /
        (out.duration_s + homeDirect.duration_s + row.duration_s);
      if (share > 0.6) continue;

      let home = homeDirect;
      let sameWayHome = false;
      if (edgeOverlapRatio(homeDirect.geometry, out.geometry) >= HOME_OVERLAP) {
        sameWayHome = true;
        for (const side of [4000, -4000, 7000, -7000]) {
          try {
            const retry = await routeThrough(valhallaUrl, {
              waypoints: [
                [row.exit.lng, row.exit.lat],
                offsetVia(row.exit, origin, side),
                [origin.lng, origin.lat],
              ],
              costingOptions: LINK_COSTING,
            });
            if (
              retry.duration_s <= homeDirect.duration_s * HOME_RETRY_FACTOR &&
              edgeOverlapRatio(retry.geometry, out.geometry) <
                edgeOverlapRatio(homeDirect.geometry, out.geometry)
            ) {
              home = retry;
              sameWayHome = false;
              break;
            }
          } catch {
            /* next side */
          }
        }
      }

      const coords = [
        ...(out.geometry.coordinates as Array<[number, number]>),
        ...(row.geom_simplified.coordinates as Array<[number, number]>).slice(1),
        ...(home.geometry.coordinates as Array<[number, number]>).slice(1),
      ];
      built.push({
        core: row,
        out,
        home,
        sameWayHome,
        geometry: { type: 'LineString', coordinates: coords },
        distanceM: out.distance_m + row.distance_m + home.distance_m,
        durationS: out.duration_s + row.duration_s + home.duration_s,
      });
      if (!sameWayHome) break; // best fit with a real second road home — done
    } catch {
      /* next candidate */
    }
  }
  return built.find((t) => !t.sameWayHome) ?? built[0] ?? null;
}
