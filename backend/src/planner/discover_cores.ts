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
 * BD-203 (planner audit) — what the menu IS:
 *   - the definer's QUALITY order is the menu order (the R29 longest-first
 *     re-sort made the six cards the six LONGEST reachable rings);
 *   - a 3 h door-to-door ceiling (CORES_TRIP_TOTAL_MAX_S) and a reserved
 *     <= 75-min card (CORES_SHORT_CARD_MAX_S) are NEW PRODUCT BARS — v1 had a
 *     2.5 h ceiling that v2 silently lost, and a 140-min core with 55-min
 *     commutes each way was being shown as a 4 h 10 trip with no total;
 *   - dedup is the index's own frozen rule (eval/dedup_index.ts): SYMMETRIC
 *     overlap > 0.5 AND durations within 15 % — a 45-min sub-ring of a
 *     120-min ring serves a different ask and is NOT a duplicate;
 *   - CORES_BUILD_MAX candidates are built and the menu is trimmed to
 *     CORES_MENU_MAX AFTER the per-card drops, so a drop is refilled;
 *   - the ring itself is routed ONCE through <= 15 of its own vertices; when
 *     the engine reproduces the stored ring (cell overlap >= 0.95) the card
 *     serves that routed geometry WITH maneuvers (follow-mode guidance), the
 *     stored distance/duration untouched — the drive-first provenance rule.
 *
 * BD-149 (owner): the commute is NEVER engineered — no retries, no second-road
 * search, no overlap steering. `sameWayHome` is a label. BD-162: the join is
 * the origin-nearest ring vertex, both commute legs use it.
 *
 * Browsing-class: <= 1 DB read + 1 matrix + 3 x CORES_BUILD_MAX routeThrough —
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

import { LEGACY } from './costing';
import { selfIntersections, summarizeCrossings } from './crossings';
import { DISCOVER_REACH_S } from './discover';
import { edgeOverlapRatio, pairOverlap } from './overlap';

/** Browse window half-size (m) — everything a ~60-min reach could touch. */
export const CORES_BROWSE_HALF_M = 45_000;
/** Core-seed read size for the live planner (run.ts) — unchanged by BD-203. */
export const CORES_BROWSE_LIMIT = 20;
/** BD-203: rows the browse reads by quality (the RPC caps at 50). Origin +
 *  one join per row = 41 matrix locations, inside the engine's 50x50 cap. */
export const CORES_FETCH_LIMIT = 40;
/** Menu size (v1 precedent: a hand-picked few, not a wall). */
export const CORES_MENU_MAX = 6;
/** BD-203: candidates BUILT per browse; the menu is trimmed to CORES_MENU_MAX
 *  after the per-card drops (crossing belt, built share, route failure). */
export const CORES_BUILD_MAX = 9;
/** Hard pre-build drop: matrix-estimated connector share of the whole trip. */
export const CORE_CONNECTOR_SHARE_MAX = 0.6;
/** BD-203 product bar: door-to-door ceiling (out + core + home). */
export const CORES_TRIP_TOTAL_MAX_S = 3 * 3600;
/** BD-203 product bar: one card with a core <= this is reserved when reachable. */
export const CORES_SHORT_CARD_MAX_S = 75 * 60;
/** Band diversity: one card with a core in (75, 120] min when reachable. */
export const CORES_MID_CARD_MAX_S = 120 * 60;
/** Duplicate ring: SYMMETRIC cell overlap above this (eval/dedup_index.ts). */
export const CORES_DUP_OVERLAP = 0.5;
/** ... AND durations within this band (TRIP_EXACT_BAND) — same ask only. */
export const CORES_DUP_DURATION_BAND = 0.15;
/** Cards per headline name in one menu (BD-203; the name is a cell artifact). */
export const CORES_SAME_NAME_MAX = 2;
/** Serve the ROUTED ring (with maneuvers) only at/above this mutual overlap
 *  with the stored ring; below it the stored line ships, maneuvers null. */
export const CORE_ROUTE_FIDELITY_MIN = 0.95;
/** Ring pass: <= this many through-points, >= this far apart (the
 *  drive_first_trip arcSamples pattern; the /route 20-location cap rules). */
const CORE_RING_SAMPLE_MAX = 15;
const CORE_RING_SAMPLE_MIN_M = 1_500;

/** BD-146: the get-there/get-home legs are COMMUTE — direct costing, how a
 *  person actually drives to the fun road. BACKROADS costing here was the
 *  measured 'random neighbourhood' defect (hood share to 16.8 %, detour
 *  factor 1.8x) and inflated every card's honest times. */
export const COMMUTE_COSTING = {} as const; // engine-default fastest — nothing else

/** The ring pass uses the drive-first commute profile (LEGACY: use_highways
 *  0.2, no living streets) — the same options under which the index's rings
 *  were swept, so a faithful ring reproduces byte-for-byte. */
export const CORE_RING_COSTING = LEGACY.options;

/** Overlap above this labels the card "same way there and back" — a LABEL,
 *  never a retry (BD-149). */
const SAME_WAY_LABEL = 0.5;

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
export function rotateRingToNearest(
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

/**
 * BD-203: <= CORE_RING_SAMPLE_MAX through-points along the ROTATED ring —
 * the join first, then vertices >= CORE_RING_SAMPLE_MIN_M apart walking the
 * ring round (the closing join is appended by the caller). A sample is never
 * placed inside the last half-spacing before the close, so the final leg
 * back to the join is a real leg, not a stub.
 */
export function ringSamples(rotated: LineString): Array<[number, number]> {
  const c = rotated.coordinates as Array<[number, number]>;
  const latM = 111_320;
  const step = (a: [number, number], b: [number, number]): number =>
    Math.hypot((b[1] - a[1]) * latM, (b[0] - a[0]) * latM * Math.cos((a[1] * Math.PI) / 180));
  let totalM = 0;
  for (let i = 1; i < c.length; i++) totalM += step(c[i - 1]!, c[i]!);
  const spacing = Math.max(CORE_RING_SAMPLE_MIN_M, totalM / CORE_RING_SAMPLE_MAX);
  const out: Array<[number, number]> = [c[0]!];
  let acc = 0;
  let cum = 0;
  for (let i = 1; i < c.length - 1 && out.length < CORE_RING_SAMPLE_MAX; i++) {
    const d = step(c[i - 1]!, c[i]!);
    acc += d;
    cum += d;
    if (acc >= spacing && totalM - cum >= spacing / 2) {
      out.push(c[i]!);
      acc = 0;
    }
  }
  return out;
}

/**
 * BD-203: how faithfully the routed ring reproduces the stored one — the
 * MUTUAL cell overlap (min of both directions), so a shortcut (stored edges
 * missing from the routed line) and a detour (routed edges the stored ring
 * never had) both lower it. Served numbers stay the stored measurement only
 * while the served line IS the measured line.
 */
export function ringFidelity(stored: LineString, routed: LineString): number {
  return Math.min(edgeOverlapRatio(stored, routed), edgeOverlapRatio(routed, stored));
}

/** BD-203: a routed leg carries the engine's flags + maneuvers, not just its line. */
function legOf(route: RouteThroughOutput): CoreLeg {
  return {
    geometry: route.geometry,
    distance_m: route.distance_m,
    duration_s: Math.round(route.duration_s),
    has_highway: route.has_highway,
    has_toll: route.has_toll,
    has_ferry: route.has_ferry,
    has_unpaved: route.has_unpaved,
    maneuvers: route.maneuvers,
  };
}

/** Same ask: durations within CORES_DUP_DURATION_BAND of the longer one. */
function sameAsk(a: CoreRowRead, b: CoreRowRead): boolean {
  const longer = Math.max(a.duration_s, b.duration_s);
  if (longer <= 0) return true;
  return Math.abs(a.duration_s - b.duration_s) / longer <= CORES_DUP_DURATION_BAND;
}

/**
 * Take up to `max` items in list order, guaranteeing every `reserved` index
 * gets in (a later reserved item holds a slot open for itself). Order is the
 * list's own order, so quality rank is preserved among what is taken.
 */
function pickInOrder<T>(items: readonly T[], max: number, reserved: ReadonlySet<number>): T[] {
  const out: T[] = [];
  for (let i = 0; i < items.length && out.length < max; i++) {
    let pending = 0;
    for (const r of reserved) if (r > i) pending++;
    if (reserved.has(i) || out.length < max - pending) out.push(items[i]!);
  }
  return out;
}

/** Index of the first item in each duration band, when one exists. */
function bandReservations(
  durations: readonly number[],
  bands: ReadonlyArray<(s: number) => boolean>,
): Set<number> {
  const reserved = new Set<number>();
  for (const inBand of bands) {
    const i = durations.findIndex(inBand);
    if (i >= 0) reserved.add(i);
  }
  return reserved;
}

const isShortCore = (s: number): boolean => s <= CORES_SHORT_CARD_MAX_S;
const isMidCore = (s: number): boolean => s > CORES_SHORT_CARD_MAX_S && s <= CORES_MID_CARD_MAX_S;

export async function discoverCores(
  origin: LatLng,
  deps: DiscoverCoresDeps,
): Promise<DiscoverResultV2> {
  const cores = deps.coresFn ?? readDriveCores;
  const matrix = deps.matrixFn ?? travelMatrix;
  const buildRoute = deps.routeFn ?? routeThrough;
  const reachMinutes = Math.round(DISCOVER_REACH_S / 60);

  const dLat = CORES_BROWSE_HALF_M / 111_320;
  const dLng = CORES_BROWSE_HALF_M / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  // The definer ranks by QUALITY (strict first, backroad x curvature, id
  // tiebreak server-side) — BD-203: that order IS the menu order. The R29
  // longest-first re-sort is gone: it made every menu the six longest
  // reachable rings; length is a band to diversify over, not a rank.
  const rows = await cores(
    deps.db,
    [origin.lng - dLng, origin.lat - dLat, origin.lng + dLng, origin.lat + dLat],
    DRIVE_CORES_VERSION,
    CORES_FETCH_LIMIT,
    'loop',
  );
  if (rows.length === 0) {
    return {
      v: 2,
      drives: [],
      reachMinutes,
      disclosures: ['No measured drives near here yet — try a different start point.'],
    };
  }

  // BD-162: per-row JOIN = origin-nearest ring vertex (falls back to the
  // stored entry/exit for non-ring rows). Both commute legs use the join.
  interface Candidate {
    row: CoreRowRead;
    /** Routing truth (full-res when the row carries it). */
    ringGeom: LineString;
    rot: ReturnType<typeof rotateRingToNearest>;
    join: LatLng;
    homeFrom: LatLng;
  }
  const prepared: Candidate[] = rows.map((row) => {
    const ringGeom = row.geometry ?? row.geom_simplified;
    const rot = rotateRingToNearest(ringGeom, origin);
    return {
      row,
      ringGeom,
      rot,
      join: rot ? rot.join : row.entry,
      homeFrom: rot ? rot.join : row.exit,
    };
  });

  // ONE matrix: origin + every row's join (<= 41 locations), priced on the
  // same DIRECT commute costing the connectors use (BD-146).
  const locations: Array<[number, number]> = [
    [origin.lng, origin.lat],
    ...prepared.map((p): [number, number] => [p.join.lng, p.join.lat]),
  ];
  const cells = await matrix(deps.valhallaUrl, {
    locations,
    costingOptions: COMMUTE_COSTING,
  });

  interface Reachable extends Candidate {
    tOutS: number;
    tHomeS: number;
  }
  const reachable: Reachable[] = [];
  let droppedCommute = 0;
  let droppedFar = 0;
  let droppedLong = 0;
  for (let i = 0; i < prepared.length; i++) {
    const cand = prepared[i]!;
    const loc = 1 + i;
    const tOutS = cells[0]?.[loc]?.timeS ?? null;
    const tHomeS = cells[loc]?.[0]?.timeS ?? null;
    if (tOutS === null || tHomeS === null) continue; // unroutable
    if (tOutS > DISCOVER_REACH_S) {
      droppedFar++;
      continue;
    }
    // drop on connector share BEFORE building anything
    const coreS = cand.row.duration_s;
    const share = (tOutS + tHomeS) / (tOutS + tHomeS + coreS);
    if (share > CORE_CONNECTOR_SHARE_MAX) {
      droppedCommute++;
      continue;
    }
    // BD-203: a door-to-door ceiling — the card never shows its total, so
    // the total has to be one a person would actually set out on.
    if (tOutS + coreS + tHomeS > CORES_TRIP_TOTAL_MAX_S) {
      droppedLong++;
      continue;
    }
    reachable.push({ ...cand, tOutS, tHomeS });
  }

  // DEDUP BY GEOMETRY (BD-150), the index's frozen rule (BD-168 / BD-203):
  // overlapping sweep cells store the SAME physical ring many times, so two
  // rows are one card when their rings mutually overlap > 0.5 AND they serve
  // the same ask (durations within 15 %). The old asymmetric test, applied
  // longest-first, deleted every shorter sub-ring of a kept big ring — the
  // 45-min lap inside a 120-min ring is a different drive, it stays.
  // Secondary rule, same band only: one headline NAME per ask — a menu read
  // "8th Line, 8th Line, Fallbrook Trail, Fallbrook Trail ..." live; but
  // same-name rings of different sizes are legitimate different asks.
  // Third rule: at most CORES_SAME_NAME_MAX cards per headline name across
  // ALL asks — a core's name is its sweep cell's top road, so one road can
  // label four different rings; a menu reading "Fallbrook Trail ×4" is the
  // BD-150 complaint in a new form (measured live at Southfields, BD-203).
  const distinct: Reachable[] = [];
  for (const cand of reachable) {
    const dup = distinct.some(
      (k) =>
        sameAsk(cand.row, k.row) &&
        (cand.row.name === k.row.name ||
          pairOverlap(cand.row.geom_simplified, k.row.geom_simplified) > CORES_DUP_OVERLAP),
    );
    const sameName = distinct.filter((k) => k.row.name === cand.row.name).length;
    if (!dup && sameName < CORES_SAME_NAME_MAX) distinct.push(cand);
  }

  // Band diversity (BD-203): among the deduped, quality-ordered candidates,
  // hold a slot for the first <= 75-min core and the first (75, 120]-min core
  // when they exist; the rest fill in quality order. Built candidates exceed
  // the menu so a per-card drop is refilled, never a hole.
  const toBuild = pickInOrder(
    distinct,
    CORES_BUILD_MAX,
    bandReservations(
      distinct.map((c) => c.row.duration_s),
      [isShortCore, isMidCore],
    ),
  );

  const routeRing = (rotated: LineString): Promise<RouteThroughOutput> => {
    const samples = ringSamples(rotated);
    return buildRoute(deps.valhallaUrl, {
      // join -> through-points round the ring -> join; endpoints 'break'
      waypoints: [...samples, samples[0]!],
      costingOptions: CORE_RING_COSTING,
      middleType: 'through',
    });
  };

  const built = (
    await Promise.all(
      toBuild.map(async (cand): Promise<CoreDrive | null> => {
        const { row, join, homeFrom } = cand;
        try {
          // BD-165 belt: a crossed ring is not a drive we show, whatever the
          // index says (71 bowties were stored ungated; the sweep now bars
          // them, this guards every future load too). ~1 ms per card.
          const xs = summarizeCrossings(selfIntersections(cand.ringGeom, undefined, 0, 500));
          if (xs.knots + xs.pierces > 0) return null;
          const commute = (from: LatLng, to: LatLng): Promise<RouteThroughOutput> =>
            buildRoute(deps.valhallaUrl, {
              waypoints: [
                [from.lng, from.lat],
                [to.lng, to.lat],
              ],
              costingOptions: COMMUTE_COSTING,
            });
          // BD-149 (owner, 2026-08-09): the commute is NOT engineered. "It
          // should genuinely just take the easiest and fastest way to get to
          // the drive then get back" — no retry ladders, no overlap steering,
          // no guards. sameWayHome stays as an honest LABEL only.
          // BD-203: the ring pass rides alongside — a best effort per card; a
          // failed or unfaithful ring pass never drops the card.
          const [out, home, ring] = await Promise.all([
            commute(origin, join),
            commute(homeFrom, origin),
            cand.rot ? routeRing(cand.rot.rotated).catch(() => null) : Promise.resolve(null),
          ]);
          // A card that is mostly commute is still never shown (menu quality,
          // not connector engineering).
          const builtShare =
            (out.duration_s + home.duration_s) /
            (out.duration_s + home.duration_s + row.duration_s);
          if (builtShare > CORE_CONNECTOR_SHARE_MAX) return null;
          const sameWayHome = edgeOverlapRatio(home.geometry, out.geometry) >= SAME_WAY_LABEL;
          // Provenance (the drive-first rule): the routed ring is served only
          // when it IS the measured ring; distance/duration are ALWAYS the
          // stored measurement, never the engine's re-price.
          const faithful =
            ring !== null &&
            cand.rot !== null &&
            ringFidelity(cand.rot.rotated, ring.geometry) >= CORE_ROUTE_FIDELITY_MIN
              ? ring
              : null;
          return {
            id: row.id,
            kind: row.kind,
            name: row.name,
            barProfile: row.bar_profile,
            core: {
              // the MEASURED ring rotated to start at the user's join (BD-162):
              // the engine's line when it reproduced the ring, else the
              // simplified stored line rotated the same way.
              geometry: faithful
                ? faithful.geometry
                : (rotateRingToNearest(row.geom_simplified, origin)?.rotated ??
                  row.geom_simplified),
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
              maneuvers: faithful ? faithful.maneuvers : null,
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

  // Trim to the menu in quality order, keeping the short card if it survived.
  const drives = pickInOrder(
    built,
    CORES_MENU_MAX,
    bandReservations(
      built.map((d) => d.core.duration_s),
      [isShortCore],
    ),
  );

  // Disclosures: the empty-state line comes FIRST when there is no menu (the
  // screen leads with it); the counts stay honest either way.
  const disclosures: string[] = [];
  if (drives.length === 0) {
    disclosures.push('No measured drives fit from here — try a different start point.');
  }
  const more = drives.length > 0 ? 'more ' : '';
  if (droppedCommute > 0) {
    disclosures.push(
      `${droppedCommute} ${more}${droppedCommute > 1 ? 'were' : 'was'} mostly getting-there from here — not shown.`,
    );
  }
  if (droppedLong > 0) {
    disclosures.push(
      `${droppedLong} ${more}would be more than ${CORES_TRIP_TOTAL_MAX_S / 3600} hours door to door — not shown.`,
    );
  }
  if (droppedFar > 0) {
    disclosures.push('Some measured drives sit beyond a sensible reach from this start.');
  }
  if (drives.some((d) => d.sameWayHome)) {
    // Both legs are the fastest route to/from one join vertex (BD-149);
    // nothing measured whether a second road exists, so nothing claims it.
    disclosures.push("on some of these you'll take the same fastest road there and back.");
  }
  if (drives.some((d) => d.barProfile === 'cell_relaxed')) {
    disclosures.push(
      'some cards are the best drives around here rather than region-grade — their numbers say so honestly.',
    );
  }
  return { v: 2, drives, reachMinutes, disclosures };
}
