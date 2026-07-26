/**
 * R25-U14 — the v2 Discover: browse pre-MEASURED drive cores + build fresh
 * get-there / get-home connectors per request (ACP-001).
 *
 * One GiST bbox+quality query (the SECURITY DEFINER `discover_drive_cores`,
 * migration 0016 — pins generator_version + highway_share=0 INSIDE the
 * definer) replaces the isochrone + 5,000-row scan; ONE travelMatrix with the
 * realized no-highway costing prices reachability; drives that would be
 * mostly getting-there are dropped BEFORE any build (never spend a build on a
 * card we can't show); connectors build in parallel.
 *
 * Measurement discipline (enforced by shape): core metrics are measured
 * OFFLINE ON THE CORE and served as stored — this path has NO recompute path
 * for them. Trip metrics are PER-LEG. `loopiness` ships for loop cores only.
 *
 * Different way home: if the home connector rides the out connector
 * (edge overlap ≥ 0.5), ONE deterministic retry via a perpendicular offset
 * point — kept only if the overlap drops AND the leg stays ≤ 1.35× direct;
 * otherwise `sameWayHome: true` is disclosed honestly ("there isn't a good
 * second road from here"). One retry, never a search loop.
 * (Deviation from ACP-001 recorded in BUILD_LOG: the retry uses a geometric
 * offset, not a corpus-span lookup — the corpus-aware retry lands with U19's
 * connector work.)
 *
 * Browsing-class: ≤ 1 DB read + 1 matrix + ~2×6 routeThrough + ≤6 retries —
 * bounded, no LLM, no cost guard (Hard rule F). Cheaper than the v1 path.
 */

import type {
  CoreDrive,
  CoreLeg,
  DiscoverResultV2,
  LatLng,
  LineString,
  RouteThroughOutput,
} from '@shared/types';
import type { Client } from 'pg';

import type { MatrixCell, MatrixRequest } from '../valhalla/matrix';
import { travelMatrix } from '../valhalla/matrix';
import { routeThrough, type RouteThroughRequest } from '../valhalla/route';

import { BACKROADS } from './costing';
import { DISCOVER_REACH_S } from './discover';
import { edgeOverlapRatio } from './overlap';

/** Browse window half-size (m) — everything a ~60-min reach could touch. */
export const CORES_BROWSE_HALF_M = 45_000;
/** Cores fetched per browse (the RPC caps at 50). */
export const CORES_BROWSE_LIMIT = 20;
/** Menu size (v1 precedent: a hand-picked few, not a wall). */
export const CORES_MENU_MAX = 6;
/** Hard pre-build drop: matrix-estimated connector share of the whole trip. */
export const CORE_CONNECTOR_SHARE_MAX = 0.6;
/** Same-way-home: overlap at/over this triggers the ONE retry. */
export const HOME_OVERLAP_RETRY = 0.5;
/** A retried home leg may cost at most this over the direct one. */
export const HOME_RETRY_MAX_FACTOR = 1.35;
/** The sweep build tag this deployment serves (flips only after a verified load). */
export const DRIVE_CORES_VERSION = process.env['DRIVE_CORES_VERSION'] ?? 'r25-dev';

export interface CoreRowRead {
  id: string;
  kind: 'loop' | 'ribbon';
  name: string;
  bar_profile: 'strict' | 'cell_relaxed';
  geom_simplified: LineString;
  entry: LatLng;
  exit: LatLng;
  distance_m: number;
  duration_s: number;
  curviness: number;
  backroad_share: number;
  main_share: number;
  highway_share: number;
  hood_share: number;
  turns_per_10min: number;
  loopiness: number | null;
}

type CoresFn = (
  db: Client,
  bbox: [number, number, number, number],
  version: string,
  limit: number,
) => Promise<CoreRowRead[]>;
type MatrixFn = (baseUrl: string, req: MatrixRequest) => Promise<MatrixCell[][]>;
type RouteFn = (baseUrl: string, req: RouteThroughRequest) => Promise<RouteThroughOutput>;

export interface DiscoverCoresDeps {
  db: Client;
  valhallaUrl: string;
  coresFn?: CoresFn;
  matrixFn?: MatrixFn;
  routeFn?: RouteFn;
}

/** The definer read (0016): bad/stale rows are unreturnable by construction. */
export async function readDriveCores(
  db: Client,
  bbox: [number, number, number, number],
  version: string,
  limit: number,
): Promise<CoreRowRead[]> {
  const res = await db.query<CoreRowRead>(
    'select * from discover_drive_cores($1, $2, $3, $4, $5, $6)',
    [bbox[0], bbox[1], bbox[2], bbox[3], version, limit],
  );
  return res.rows;
}

function legOf(route: RouteThroughOutput): CoreLeg {
  return {
    geometry: route.geometry,
    distance_m: route.distance_m,
    duration_s: Math.round(route.duration_s),
  };
}

/** Deterministic perpendicular offset point for the one home-leg retry. */
function offsetVia(exit: LatLng, origin: LatLng, offsetM: number): [number, number] {
  const mid = { lat: (exit.lat + origin.lat) / 2, lng: (exit.lng + origin.lng) / 2 };
  const dx = (origin.lng - exit.lng) * Math.cos((mid.lat * Math.PI) / 180);
  const dy = origin.lat - exit.lat;
  const len = Math.hypot(dx, dy) || 1;
  // rotate 90°: (-dy, dx), scaled to offsetM
  const latM = 111_320;
  const oLat = mid.lat + (dx / len) * (offsetM / latM);
  const oLng = mid.lng + (-dy / len) * (offsetM / (latM * Math.cos((mid.lat * Math.PI) / 180)));
  return [oLng, oLat];
}

export async function discoverCores(
  origin: LatLng,
  deps: DiscoverCoresDeps,
): Promise<DiscoverResultV2> {
  const cores = deps.coresFn ?? readDriveCores;
  const matrix = deps.matrixFn ?? travelMatrix;
  const buildRoute = deps.routeFn ?? routeThrough;
  const reachMinutes = Math.round(DISCOVER_REACH_S / 60);
  const disclosures: string[] = [];

  const dLat = CORES_BROWSE_HALF_M / 111_320;
  const dLng = CORES_BROWSE_HALF_M / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  const rows = await cores(
    deps.db,
    [origin.lng - dLng, origin.lat - dLat, origin.lng + dLng, origin.lat + dLat],
    DRIVE_CORES_VERSION,
    CORES_BROWSE_LIMIT,
  );
  if (rows.length === 0) {
    return {
      v: 2,
      drives: [],
      reachMinutes,
      disclosures: ['No measured drives near here yet — try a different start point.'],
    };
  }

  // ONE matrix: origin + every core's entry + exit (≤ 41 locations), priced on
  // the same no-highway costing the connectors will use (U2 realizes it).
  const locations: Array<[number, number]> = [[origin.lng, origin.lat]];
  for (const r of rows) {
    locations.push([r.entry.lng, r.entry.lat], [r.exit.lng, r.exit.lat]);
  }
  const cells = await matrix(deps.valhallaUrl, {
    locations,
    costingOptions: { ...BACKROADS.options, exclude_highways: true },
  });

  interface Reachable {
    row: CoreRowRead;
    tOutS: number;
    tHomeS: number;
  }
  const reachable: Reachable[] = [];
  let droppedCommute = 0;
  let droppedFar = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const entryLoc = 1 + 2 * i;
    const exitLoc = 2 + 2 * i;
    const tOutS = cells[0]?.[entryLoc]?.timeS ?? null;
    const tHomeS = cells[exitLoc]?.[0]?.timeS ?? null;
    if (tOutS === null || tHomeS === null) continue; // unroutable
    if (tOutS > DISCOVER_REACH_S) {
      droppedFar++;
      continue;
    }
    // drop on connector share BEFORE building anything
    const share = (tOutS + tHomeS) / (tOutS + tHomeS + row.duration_s);
    if (share > CORE_CONNECTOR_SHARE_MAX) {
      droppedCommute++;
      continue;
    }
    reachable.push({ row, tOutS, tHomeS });
  }
  // RPC order is the quality order (strict first, backroad·curv) — keep it,
  // deterministic id tiebreak already applied server-side.
  const menu = reachable.slice(0, CORES_MENU_MAX);

  const drives = (
    await Promise.all(
      menu.map(async ({ row }): Promise<CoreDrive | null> => {
        try {
          const [out, homeDirect] = await Promise.all([
            buildRoute(deps.valhallaUrl, {
              waypoints: [
                [origin.lng, origin.lat],
                [row.entry.lng, row.entry.lat],
              ],
              costingOptions: { ...BACKROADS.options, exclude_highways: true },
            }),
            buildRoute(deps.valhallaUrl, {
              waypoints: [
                [row.exit.lng, row.exit.lat],
                [origin.lng, origin.lat],
              ],
              costingOptions: { ...BACKROADS.options, exclude_highways: true },
            }),
          ]);
          let home = homeDirect;
          let sameWayHome = false;
          if (edgeOverlapRatio(homeDirect.geometry, out.geometry) >= HOME_OVERLAP_RETRY) {
            sameWayHome = true;
            try {
              // ONE deterministic retry via a perpendicular offset (never a loop)
              const retry = await buildRoute(deps.valhallaUrl, {
                waypoints: [
                  [row.exit.lng, row.exit.lat],
                  offsetVia(row.exit, origin, 4000),
                  [origin.lng, origin.lat],
                ],
                costingOptions: { ...BACKROADS.options, exclude_highways: true },
              });
              if (
                retry.duration_s <= homeDirect.duration_s * HOME_RETRY_MAX_FACTOR &&
                edgeOverlapRatio(retry.geometry, out.geometry) <
                  edgeOverlapRatio(homeDirect.geometry, out.geometry)
              ) {
                home = retry;
                sameWayHome = false;
              }
            } catch {
              /* keep the direct leg; sameWayHome stays true */
            }
          }
          return {
            id: row.id,
            kind: row.kind,
            name: row.name,
            barProfile: row.bar_profile,
            core: {
              geometry: row.geom_simplified, // served as stored — NEVER re-routed
              distance_m: row.distance_m,
              duration_s: row.duration_s,
              entry: row.entry,
              exit: row.exit,
              curviness: row.curviness,
              backroadShare: row.backroad_share,
              mainShare: row.main_share,
              hoodShare: row.hood_share,
              turnsPer10min: row.turns_per_10min,
              loopiness: row.kind === 'loop' ? row.loopiness : null,
            },
            connectorOut: legOf(out),
            connectorHome: legOf(home),
            sameWayHome,
          };
        } catch {
          return null; // a failed connector build drops the card (never a fake)
        }
      }),
    )
  ).filter((d): d is CoreDrive => d !== null);

  if (droppedCommute > 0) {
    disclosures.push(
      `${droppedCommute} more ${droppedCommute > 1 ? 'were' : 'was'} mostly getting-there from here — not shown.`,
    );
  }
  if (droppedFar > 0) {
    disclosures.push('Some measured drives sit beyond a sensible reach from this start.');
  }
  if (drives.some((d) => d.sameWayHome)) {
    disclosures.push(
      "you'll come home the way you went out on some of these — there isn't a good second road from here.",
    );
  }
  if (drives.some((d) => d.barProfile === 'cell_relaxed')) {
    disclosures.push(
      'some cards are the best drives around here rather than region-grade — their numbers say so honestly.',
    );
  }
  if (drives.length === 0) {
    disclosures.push('No measured drives fit from here — try a different start point.');
  }
  return { v: 2, drives, reachMinutes, disclosures };
}
