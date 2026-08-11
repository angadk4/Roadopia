/**
 * R25-U14 — the v2 Discover: browse pre-MEASURED drive cores + build fresh
 * get-there / get-home connectors per request (ACP-001).
 *
 * One GiST bbox+quality query (the SECURITY DEFINER `discover_drive_cores`,
 * migration 0016 — pins generator_version + highway_share=0 INSIDE the
 * definer) replaces the isochrone + 5,000-row scan; ONE travelMatrix with the
 * realized commute costing prices reachability; drives that would be
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

import { selfIntersections, summarizeCrossings } from './crossings';
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
export /** BD-146: the get-there/get-home legs are COMMUTE — direct costing, how a
 *  person actually drives to the fun road. BACKROADS costing here was the
 *  measured 'random neighbourhood' defect (hood share to 16.8 %, detour
 *  factor 1.8x) and inflated every card's honest times. */
const COMMUTE_COSTING = {} as const; // engine-default fastest — nothing else

/** Overlap above this labels the card "same way there and back" — a LABEL,
 *  never a retry (BD-149). */
const SAME_WAY_LABEL = 0.5;
/** A retried home leg may cost at most this over the direct one. */
/**
 * The sweep build tag this deployment serves (flips only after a verified load).
 *
 * R29 (Unit A blocker): this defaulted to 'r25-dev' while the loaded index is
 * 'r31-rib' — so every v2 browse returned an empty menu against a 1,544-core
 * index. drive_first.ts read the SAME env var with a different default, which
 * is exactly how the two paths silently diverged; there is now ONE constant.
 */
// r35-rib (BD-167/170): the LAYERED sweep index — structural bars absolute,
// sanity floors catastrophic-only, quality RANKS what a cell keeps. 393
// distinct-standing loops after global dedup (+125 % vs r34's 175), ids
// version-namespaced, provenance-stamped (migration 0021); r34's ribbons
// carried. Flipped after all four frozen BD-167 bars passed, incl. the
// owner's blind review (1-1-14 tie; Uxbridge-90 residual named in BD-170).
export const DRIVE_CORES_VERSION = process.env['DRIVE_CORES_VERSION'] ?? 'r35-rib';

export interface CoreRowRead {
  id: string;
  kind: 'loop' | 'ribbon';
  name: string;
  bar_profile: 'strict' | 'cell_relaxed';
  geom_simplified: LineString;
  /** R34-U9: FULL-resolution measured geometry (migration 0020; `select *`
   *  carries it automatically). Routing truth — `geom_simplified` is
   *  display-only. Optional so pre-0020 fixtures stay valid. */
  geometry?: LineString;
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
  kind?: 'loop' | 'ribbon' | null,
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

/**
 * The definer read (0016/0019): bad/stale rows are unreturnable by construction.
 * `kind` filters SQL-side (0019) — necessary, not cosmetic: the definer caps at
 * 50 rows ordered by quality, and 1,114 max-quality ribbons otherwise swamp the
 * cap so loop cores never leave the database (measured: 0/8 origins got a menu).
 */
export async function readDriveCores(
  db: Client,
  bbox: [number, number, number, number],
  version: string,
  limit: number,
  kind: 'loop' | 'ribbon' | null = null,
): Promise<CoreRowRead[]> {
  const res = await db.query<CoreRowRead>(
    'select * from discover_drive_cores($1, $2, $3, $4, $5, $6, $7)',
    [bbox[0], bbox[1], bbox[2], bbox[3], version, limit, kind],
  );
  return res.rows;
}

/**
 * BD-162 (owner, 2026-08-11): "getting to the drive and back should be the
 * easiest routes there are — essentially what Google Maps would show; there
 * and back can be the same route." The stored entry/exit vertex is an
 * ARBITRARY sweep artifact — routing a fastest path to a far ring vertex is
 * exactly the weirdness he saw. A loop core is a RING: meet it at the vertex
 * nearest the user and drive it around from there. Non-ring rows (open
 * fixtures, legacy kinds) keep their stored endpoints.
 */
function rotateRingToNearest(
  ring: LineString,
  origin: LatLng,
): { rotated: LineString; join: LatLng } | null {
  const raw = ring.coordinates as Array<[number, number]>;
  if (raw.length < 8) return null;
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const first = raw[0]!;
  const last = raw[raw.length - 1]!;
  const gapM = Math.hypot((last[1] - first[1]) * latM, (last[0] - first[0]) * lngM);
  if (gapM > 2_000) return null; // not a closed ring
  const pts = gapM < 1 ? raw.slice(0, -1) : raw.slice();
  let j = 0;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot((pts[i]![1] - origin.lat) * latM, (pts[i]![0] - origin.lng) * lngM);
    if (d < best) {
      best = d;
      j = i;
    }
  }
  const rotated = [...pts.slice(j), ...pts.slice(0, j), pts[j]!];
  return {
    rotated: { type: 'LineString', coordinates: rotated },
    join: { lat: pts[j]![1], lng: pts[j]![0] },
  };
}

function legOf(route: RouteThroughOutput): CoreLeg {
  return {
    geometry: route.geometry,
    distance_m: route.distance_m,
    duration_s: Math.round(route.duration_s),
  };
}

/** Deterministic perpendicular offset point for the one home-leg retry. */

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
  const fetched = await cores(
    deps.db,
    [origin.lng - dLng, origin.lat - dLat, origin.lng + dLng, origin.lat + dLat],
    DRIVE_CORES_VERSION,
    CORES_BROWSE_LIMIT * 2,
    'loop',
  );
  // R29 Unit A: a CARD must be worth the trip to it. The definer ranks by
  // QUALITY, and the r31 index's 100 %-backroad 9-minute ribbons swept every
  // top-20 — then all failed the connector-share drop ("mostly getting-there"),
  // leaving EVERY menu empty while 430 loop cores averaging 63 min sat unread.
  // Measured: 0/8 sample origins produced a menu. So the menu prefers the
  // LONGEST drives (they are what survives the share test); short ribbons are
  // the live planner's chaining material, not cards.
  const rows = fetched
    .slice()
    .sort((a, b) => b.duration_s - a.duration_s || a.id.localeCompare(b.id))
    .slice(0, CORES_BROWSE_LIMIT);
  if (rows.length === 0) {
    return {
      v: 2,
      drives: [],
      reachMinutes,
      disclosures: ['No measured drives near here yet — try a different start point.'],
    };
  }

  // ONE matrix: origin + every core's entry + exit (≤ 41 locations), priced on
  // the same DIRECT commute costing the connectors use (BD-146).
  // BD-162: per-row JOIN = origin-nearest ring vertex (falls back to the
  // stored entry for non-ring rows). Both commute legs use the join.
  const joins = rows.map((r) => {
    const rot = rotateRingToNearest(r.geometry ?? r.geom_simplified, origin);
    return rot ? rot.join : r.entry;
  });
  const locations: Array<[number, number]> = [[origin.lng, origin.lat]];
  for (const j of joins) {
    locations.push([j.lng, j.lat], [j.lng, j.lat]);
  }
  const cells = await matrix(deps.valhallaUrl, {
    locations,
    costingOptions: COMMUTE_COSTING,
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
  // DEDUP BY GEOMETRY (BD-150): overlapping sweep cells store the SAME
  // physical ring many times — measured region-wide: 270 loop cores, 82
  // distinct names; a live Southfields menu showed "8th Line" twice. Name is
  // the wrong key (same-name rings of different sizes exist), so a card is a
  // duplicate when its ring substantially overlaps an already-kept one.
  const distinct: typeof reachable = [];
  for (const cand of reachable) {
    const dup = distinct.some(
      (k) =>
        // same physical ring under another cell …
        edgeOverlapRatio(cand.row.geom_simplified, k.row.geom_simplified) > 0.5 ||
        // … or a different ring with the SAME HEADLINE NAME — measured live:
        // a menu of six read "8th Line, 8th Line, Fallbrook Trail, Fallbrook
        // Trail, King-Vaughan Road, Fallbrook Trail". Distinct geometry is
        // not distinct ENOUGH for a menu; nobody wants three cards with one
        // name. (Plan keeps geometry-only dedup — same-name size variants
        // legitimately fit different asks.)
        cand.row.name === k.row.name,
    );
    if (!dup) distinct.push(cand);
    if (distinct.length >= CORES_MENU_MAX) break;
  }
  const menu = distinct;

  const drives = (
    await Promise.all(
      menu.map(async ({ row }): Promise<CoreDrive | null> => {
        try {
          // BD-165 belt: a crossed ring is not a drive we show, whatever the
          // index says (71 bowties were stored ungated; the sweep now bars
          // them, this guards every future load too). ~1 ms per card.
          const ringGeom = row.geometry ?? row.geom_simplified;
          const xs = summarizeCrossings(selfIntersections(ringGeom, undefined, 0, 500));
          if (xs.knots + xs.pierces > 0) return null;
          const rot = rotateRingToNearest(ringGeom, origin);
          const join = rot ? rot.join : row.entry;
          const homeFrom = rot ? rot.join : row.exit;
          const [out, homeDirect] = await Promise.all([
            buildRoute(deps.valhallaUrl, {
              waypoints: [
                [origin.lng, origin.lat],
                [join.lng, join.lat],
              ],
              costingOptions: COMMUTE_COSTING,
            }),
            buildRoute(deps.valhallaUrl, {
              waypoints: [
                [homeFrom.lng, homeFrom.lat],
                [origin.lng, origin.lat],
              ],
              costingOptions: COMMUTE_COSTING,
            }),
          ]);
          // BD-149 (owner, 2026-08-09): the commute is NOT engineered. "It
          // should genuinely just take the easiest and fastest way to get to
          // the drive then get back" — no retry ladders, no overlap steering,
          // no guards. The R30 offset-via ladder was HIS "getting there is
          // absolutely terrible". sameWayHome stays as an honest LABEL only.
          const home = homeDirect;
          // A card that is mostly commute is still never shown (menu quality,
          // not connector engineering).
          const builtShare =
            (out.duration_s + home.duration_s) /
            (out.duration_s + home.duration_s + row.duration_s);
          if (builtShare > CORE_CONNECTOR_SHARE_MAX) return null;
          const sameWayHome = edgeOverlapRatio(home.geometry, out.geometry) >= SAME_WAY_LABEL;
          return {
            id: row.id,
            kind: row.kind,
            name: row.name,
            barProfile: row.bar_profile,
            core: {
              // the MEASURED ring, rotated to start at the user's join — the
              // roads/length/duration are untouched (BD-162); display uses the
              // simplified line rotated the same way.
              geometry:
                rotateRingToNearest(row.geom_simplified, origin)?.rotated ?? row.geom_simplified,
              distance_m: row.distance_m,
              duration_s: row.duration_s,
              entry: join,
              exit: homeFrom,
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
