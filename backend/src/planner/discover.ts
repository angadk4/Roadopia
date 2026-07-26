/**
 * "Great Drives Near You" — the discovery pipeline (R23; R24 curated + pre-built).
 *
 * Given an origin, rank the region's best driving roads reachable from it and
 * hand back a small CURATED menu of OUT-AND-BACK drives, each with its route
 * PRE-BUILT so a tap opens the result instantly with a REAL measured time. R24
 * decisions: Discover is out-and-back-only (predictable, uniform, pre-buildable —
 * a loop would need the money-spending planner behind this unauthenticated browse
 * endpoint), it BLENDS the hand-picked classic drives with the auto-ranked
 * corpus, and the ranking is ORIGIN-RELATIVE (a proximity tier) so nearby doors
 * see different, personal menus instead of the same top road.
 *
 * Built entirely on existing primitives (Hard rule A — 100% corpus + Valhalla,
 * no LLM geography): getIsochrone (reach) → retrieveCandidates (curvy corpus) +
 * classic seed drives → mergeRoadPieces → de-switchback value rank → bearing
 * spread → ONE travelMatrix (REAL drive-times, ≤49 locations) → origin-relative
 * menuScore → trim to ~5-6 → routeThrough pre-build (out-and-back per drive).
 *
 * Deterministic: no RNG; every sort carries an id tiebreak. Browsing-class — two
 * bounded Valhalla calls (isochrone, matrix) plus the per-drive out-and-back
 * builds, no LLM, no cost guard (Hard rule F). Engine/DB/route calls are injected
 * so the whole pipeline is unit-testable against a golden fixture.
 */

import type { DiscoverResult, LatLng, NearbyDrive, RouteThroughOutput } from '@shared/types';
import type { Client } from 'pg';

import { haversineMeters } from '../../../data/curvature/geometry';
import { plannerFindSeedDrives, type SeedDriveRow } from '../db/planner_reads';
import type { MatrixCell, MatrixRequest } from '../valhalla/matrix';
import { travelMatrix } from '../valhalla/matrix';
import { routeThrough, type RouteThroughRequest } from '../valhalla/route';
import { traceRoadClasses } from '../valhalla/trace';

import { bearingDeg, countryClassFactor, sectorOf, traversalSpanOf } from './candidates';
import {
  chainMatrixLocations,
  mergeRoadPieces,
  M_SPAN_POOL,
  SPAN_MIN_SEPARATION_M,
  type ChainSpan,
} from './chain';
import { BACKROADS, FUN_EXCLUDE_HIGHWAYS_ON } from './costing';
import { measureCurvature } from './curvature';
import { microloopEvents, selfOverlapRatio, spurPositions } from './overlap';
import { residentialShareOf } from './residential';
import { retrieveCandidates, type CandidateSegment } from './retrieve';
import { TRACE_HIGHWAY_FLOOR_M, tracedHighwayM } from './roadclass';
import { buildScope, type IsochroneFn, type Scope } from './scope';
import { uturnCount } from './score';

// --- tunables (pre-registered; frozen into params-frozen.json at U18) --------
/** 60-min reach → a sensible ≤~2.5 h half-day round trip; under MAX_TAU_S. */
export const DISCOVER_REACH_S = 3600;
/** Retrieval depth (R23-U4 live smoke): a 60-min reach near the GTA floods the
 *  curviness-DESC top-N with tight park/subdivision roads, so the moderate
 *  country drives need a DEEP retrieve to appear. 5000 surfaces them at ~2-4s. */
export const DISCOVER_SEGMENT_LIMIT = 5000;
/** Half-day plausibility budget for the pool's straight-line reach cull. */
export const DISCOVER_SPAN_DURATION_S = 9000;
/** Full-span "great drive" floor — no 0.5 km touch fragments as fake drives. */
export const DISCOVER_MIN_ROAD_M = 2000;
/** Curviness saturation for RANKING (same idea as the loop's CURV_SATURATION):
 *  a great DRIVE is "curvy enough" past this; beyond it a road is a switchback /
 *  park path, not a drive. Displayed curviness stays the real value (honesty). */
export const DISCOVER_CURV_SATURATION = 3.0;
/** Bearing sectors for the pre-matrix spread (not one massif). */
export const DISCOVER_SECTOR_COUNT = 8;
/** Max auto spans admitted per sector before the pool cap (spread-first).
 *  R24: 3 → 2 so the menu leans on quality + proximity, not one direction. */
export const DISCOVER_SECTOR_QUOTA = 2;
/** Auto pool cap. R24: ≤16 so the ONE matrix has room for the ≤8 classics
 *  (origin + 16×2 + 8×2 = 49 ≤ the 50-loc engine cap). */
export const DISCOVER_AUTO_POOL_CAP = Math.min(16, M_SPAN_POOL);
/** Curated menu size (R24: 8/12 → 5/6 — a hand-picked few, not a wall). */
export const DISCOVER_MENU_MIN = 5;
export const DISCOVER_MENU_MAX = 6;
/** Menu-level geographic spread so two cards are never the same road. */
export const DISCOVER_MENU_SEP_M = 4000;
/** menuScore reach penalty — tuned so a far GREAT road still beats a near
 *  mediocre one (else the discount defeats the whole reframe). */
export const DISCOVER_REACH_DISCOUNT_K = 0.5;
/** R24 repetition fix — an ORIGIN-RELATIVE proximity tier (bounded 1.0–1.15) on
 *  the REAL per-origin drive-time, so nearby doors reorder (the closest excellent
 *  road leads, feeling personal) while a far great road still wins where it
 *  should. Bounded so it nudges, never dominates. */
export const DISCOVER_PROX_NEAR_S = 720; // <12 min out → ×1.15
export const DISCOVER_PROX_MID_S = 1440; // <24 min out → ×1.07
export const DISCOVER_PROX_NEAR_MULT = 1.15;
export const DISCOVER_PROX_MID_MULT = 1.07;
/** R24 classic blend — a bounded bonus so the hand-picked classics surface
 *  reliably without steamrolling a genuinely-better nearby auto road. Live smoke:
 *  1.3 let the classics crowd the menu (3-4 of 6) and pin #1 across nearby
 *  origins; 1.15 blends 2-3 classics while letting the near, origin-relative auto
 *  roads compete at the top — and lets an honestly-low-curviness classic (a long
 *  drive that averages gentle) self-correct downward instead of being force-fed. */
export const DISCOVER_CLASSIC_BONUS = 1.15;
/** Out-and-back estimate slack over 2·driveOut + road (near-direct; U6 replaces
 *  it with the REAL measured total on the pre-build). */
export const TAP_OAB_SLACK = 1.15;
export const TAP_DURATION_MIN_S = 2700;
/** Half-day ceiling: a drive whose estimate exceeds this is DROPPED, not offered
 *  with a false clamp (R23 owner: "only offer drives that fit"). */
export const TAP_DURATION_MAX_S = 9000;
/** Per-drive pre-build budget — parallel, so /discover ≈ the slowest build. */
export const DISCOVER_PREBUILD_TIMEOUT_MS = 8000;

// --- R25-U11 Discover Stage 1: gates (audit-v11 issue #4 — 180 pre-built
// routes, ZERO validations; 110/180 exceeded the loop planner's own hard
// self-overlap bar). Two modes, one code path: production candidate 'report'
// (hard defects DROP; shape/commute facts DISCLOSE + DEMOTE), eval 'strict'
// (everything drops). 'off' = today, byte-identical (BD-40).
export type DiscoverGatesMode = 'off' | 'report' | 'strict';
export const DISCOVER_GATES: DiscoverGatesMode =
  process.env['DISCOVER_GATES'] === 'report' || process.env['DISCOVER_GATES'] === 'strict'
    ? (process.env['DISCOVER_GATES'] as DiscoverGatesMode)
    : 'off';
/** Gated "great road" floor. The plan's ~8 km was written for the CORE-INDEX
 *  era (U13 ribbons); measured on the CURRENT out-and-back corpus it empties
 *  every origin (DQ 2026-07-26: 0 drives at 7/7 origins — median merged road
 *  4.6 km). Env-swept for Stage 1; 8 km returns with the core index. */
export const DISCOVER_GATED_MIN_ROAD_M = Number(process.env['DISCOVER_MIN_ROAD'] ?? 5000);
/** Hard residential ceiling on the whole trip — both modes drop. */
export const DISCOVER_RESIDENTIAL_MAX = 0.2;
/** The loop planner's own hard self-overlap bar — strict drops; report
 *  discloses + demotes (an out-and-back's overlap IS its shape, not a defect
 *  of that particular drive — hard-dropping it today would empty the menu;
 *  the U13 core index is the shape fix). */
export const DISCOVER_SELF_OVERLAP_MAX = 0.3;
/** PROVISIONAL pre-U11a (probe table re-baselines it): strict-mode connector
 *  ceiling. Report mode only disclose+demotes — a cap chosen under the broken
 *  costing would empty every origin (audit median 0.79 connector). */
export const DISCOVER_CONNECTOR_SHARE_MAX = 0.85;

const NO_DRIVES = 'No standout drives within reach of here — try a different start point.';

type RetrieveFn = typeof retrieveCandidates;
type MatrixFn = (baseUrl: string, req: MatrixRequest) => Promise<MatrixCell[][]>;
type SeedDrivesFn = (db: Client) => Promise<SeedDriveRow[]>;
type RouteFn = (
  baseUrl: string,
  req: RouteThroughRequest,
  opts?: { timeoutMs?: number },
) => Promise<RouteThroughOutput>;

export interface DiscoverDeps {
  db: Client;
  valhallaUrl: string;
  /** Injected for tests; default to the live engine/DB reads. */
  isochroneFn?: IsochroneFn;
  matrixFn?: MatrixFn;
  retrieveFn?: RetrieveFn;
  seedDrivesFn?: SeedDrivesFn;
  routeFn?: RouteFn;
  /** R25-U11: gates trace each SURVIVING pre-built route once. */
  traceFn?: typeof traceRoadClasses;
}

/** Origin-relative proximity multiplier (bounded) — the R24 repetition fix. */
function proximityTier(driveTimeToStartS: number): number {
  if (driveTimeToStartS < DISCOVER_PROX_NEAR_S) return DISCOVER_PROX_NEAR_MULT;
  if (driveTimeToStartS < DISCOVER_PROX_MID_S) return DISCOVER_PROX_MID_MULT;
  return 1.0;
}

/** A merged whole road → value-scored ChainSpan (full traversal, never a touch). */
function rankedSpans(
  origin: LatLng,
  segments: readonly CandidateSegment[],
  gates: DiscoverGatesMode,
): ChainSpan[] {
  const vMs = BACKROADS.sizingSpeedKmh / 3.6;
  const maxRoundTripS = DISCOVER_SPAN_DURATION_S;
  // R25-U11: under gates the "great road" floor rises — a 2 km fragment is
  // not a destination drive (median featured road today: 4.6 km)
  const minRoadM = gates === 'off' ? DISCOVER_MIN_ROAD_M : DISCOVER_GATED_MIN_ROAD_M;
  return mergeRoadPieces(segments)
    .filter((m) => m.lengthM >= minRoadM && m.name !== '') // full spans, labelled
    .map((segment) => {
      const [a, b] = traversalSpanOf(segment);
      const centroid: LatLng = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
      const distanceM = haversineMeters([origin.lng, origin.lat], [centroid.lng, centroid.lat]);
      return {
        segment,
        a,
        b,
        touch: false,
        centroid,
        bearing: bearingDeg(origin, centroid),
        distanceM,
        value:
          Math.min(segment.curviness, DISCOVER_CURV_SATURATION) *
          segment.lengthM *
          countryClassFactor(segment.highway) *
          (1 - 0.7 * (segment.urbanShare ?? 0)),
      } satisfies ChainSpan;
    })
    .filter((s) => (2 * s.distanceM + s.segment.lengthM) / vMs <= maxRoundTripS)
    .sort((x, y) => y.value - x.value || x.segment.id.localeCompare(y.segment.id));
}

/** Spread-first selection down to `cap`: a bearing-sector quota so the pool isn't
 *  all in one massif, then refill by value. */
function spreadPool(ranked: readonly ChainSpan[], cap: number): ChainSpan[] {
  const pool: ChainSpan[] = [];
  const perSector = new Map<number, number>();
  const tooClose = (s: ChainSpan): boolean =>
    pool.some(
      (p) =>
        haversineMeters([p.centroid.lng, p.centroid.lat], [s.centroid.lng, s.centroid.lat]) <
        SPAN_MIN_SEPARATION_M,
    );
  for (const s of ranked) {
    if (pool.length >= cap) break;
    const sec = sectorOf(s.bearing, DISCOVER_SECTOR_COUNT);
    if ((perSector.get(sec) ?? 0) >= DISCOVER_SECTOR_QUOTA) continue;
    if (tooClose(s)) continue;
    pool.push(s);
    perSector.set(sec, (perSector.get(sec) ?? 0) + 1);
  }
  if (pool.length < cap) {
    for (const s of ranked) {
      if (pool.length >= cap) break;
      if (pool.includes(s) || tooClose(s)) continue;
      pool.push(s);
    }
  }
  return pool;
}

/** The classic id-prefix — tags a synthesized span as a hand-picked seed drive. */
const CLASSIC_PREFIX = 'classic:';
/** Interior points sampled along a classic to TRACE it on the pre-build (an
 *  entry→exit route alone finds its own path and drifts off the curated line). */
export const DISCOVER_CLASSIC_TRACE_POINTS = 3;

/** Ordered interior [lng,lat] points that force the pre-built route to follow a
 *  classic's curated geometry from `entry` toward its far end. */
function classicThroughPoints(
  geometry: CandidateSegment['geometry'],
  entry: LatLng,
  n = DISCOVER_CLASSIC_TRACE_POINTS,
): Array<[number, number]> {
  const c = geometry.coordinates as Array<[number, number]>;
  if (c.length <= 2) return [];
  const first = c[0]!;
  const last = c[c.length - 1]!;
  // orient the samples from the nearer end (entry) toward the far end
  const entryNearFirst =
    haversineMeters([entry.lng, entry.lat], first) <= haversineMeters([entry.lng, entry.lat], last);
  const ordered = entryNearFirst ? c : [...c].reverse();
  const out: Array<[number, number]> = [];
  for (let k = 1; k <= n; k++) {
    const idx = Math.round((k / (n + 1)) * (ordered.length - 1));
    const p = ordered[Math.min(ordered.length - 2, Math.max(1, idx))];
    if (p) out.push(p);
  }
  return out;
}

/** Map the hand-picked seed drives into span-shaped entries, curviness MEASURED
 *  from the real geometry (the seeds store 0). Endpoints come from the drive's
 *  waypoints; the id carries the routes-row id for provenance. */
function buildClassicSpans(origin: LatLng, rows: readonly SeedDriveRow[]): ChainSpan[] {
  const spans: ChainSpan[] = [];
  for (const r of rows) {
    if (r.waypoints.length < 2 || r.distance_m < DISCOVER_MIN_ROAD_M) continue;
    const a = r.waypoints[0]!;
    const b = r.waypoints[r.waypoints.length - 1]!;
    if (a.lat === b.lat && a.lng === b.lng) continue;
    const curviness = measureCurvature(r.geometry).curviness;
    const centroid: LatLng = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    const segment: CandidateSegment = {
      id: `${CLASSIC_PREFIX}${r.id}`,
      osmWayId: '',
      name: r.name,
      highway: 'tertiary', // curated country drive — a neutral country class
      lengthM: r.distance_m,
      curviness,
      urbanShare: 0,
      geometry: r.geometry,
    };
    spans.push({
      segment,
      a,
      b,
      touch: false,
      centroid,
      bearing: bearingDeg(origin, centroid),
      distanceM: haversineMeters([origin.lng, origin.lat], [centroid.lng, centroid.lat]),
      value:
        Math.min(curviness, DISCOVER_CURV_SATURATION) *
        r.distance_m *
        countryClassFactor('tertiary'),
    });
  }
  return spans;
}

/**
 * Rank the region's best drives reachable from `origin` and return the menu —
 * curated, out-and-back, pre-built.
 */
export async function discoverDrives(
  origin: LatLng,
  deps: DiscoverDeps,
  opts?: { gates?: DiscoverGatesMode }, // test seam; production uses the env flag
): Promise<DiscoverResult> {
  const gates = opts?.gates ?? DISCOVER_GATES;
  const retrieve = deps.retrieveFn ?? retrieveCandidates;
  const matrix = deps.matrixFn ?? travelMatrix;
  const seedDrives = deps.seedDrivesFn ?? plannerFindSeedDrives;
  const buildRoute = deps.routeFn ?? routeThrough;
  const reachMinutes = Math.round(DISCOVER_REACH_S / 60);
  const empty = (): DiscoverResult => ({ drives: [], reachMinutes, disclosures: [NO_DRIVES] });

  // reach: a 60-min isochrone (alpha 1 → tau = DISCOVER_REACH_S), one call
  const scope: Scope = await buildScope(
    deps.valhallaUrl,
    { origin, shape: 'loop', durationS: DISCOVER_REACH_S, alpha: 1 },
    deps.isochroneFn,
  );
  const retrieved = await retrieve(deps.db, scope, { segmentLimit: DISCOVER_SEGMENT_LIMIT });
  const autoPool = spreadPool(
    rankedSpans(origin, retrieved.segments, gates),
    DISCOVER_AUTO_POOL_CAP,
  );

  // Blend the hand-picked classics into the SAME matrix (never fatal — a seed
  // read failure just means an all-auto menu). R25-U11: under gates the
  // classics leave the RANKED menu entirely (owner decision — no
  // hand-curation; the audit measured the classics as the highway offenders).
  // Their seed rows stay (migrations are additive); an unranked "Editor's
  // picks" surface returns with the U14/U15 rewrite.
  let classicSpans: ChainSpan[] = [];
  if (gates === 'off') {
    try {
      classicSpans = buildClassicSpans(origin, await seedDrives(deps.db));
    } catch {
      classicSpans = [];
    }
  }
  const pool = [...autoPool, ...classicSpans];
  if (pool.length === 0) return empty();

  // ONE real travel matrix over [origin, span0.a, span0.b, …] (≤49 locations)
  // R25-U3: Discover is fun-by-definition — the no-highway rule rides along
  // (U2 translates it into use_highways:0 + shortest dropped), so the budget
  // is costed on the same roads the drive is allowed to use.
  const cells = await matrix(deps.valhallaUrl, {
    locations: chainMatrixLocations(origin, pool),
    costingOptions: {
      ...BACKROADS.options,
      ...(FUN_EXCLUDE_HIGHWAYS_ON ? { exclude_highways: true } : {}),
    },
  });

  const roadV = BACKROADS.sizingSpeedNoHighwayKmh / 3.6; // curvy-road pace for the traverse
  const drives: NearbyDrive[] = [];
  let droppedFar = 0; // drives dropped because a half-day out-and-back can't reach them
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i]!;
    const entryLoc = 1 + 2 * i;
    const exitLoc = 2 + 2 * i;
    const tA = cells[0]?.[entryLoc]?.timeS ?? null;
    const tB = cells[0]?.[exitLoc]?.timeS ?? null;
    if (tA === null && tB === null) continue; // unroutable both ends → drop
    const aNearer = (tA ?? Infinity) <= (tB ?? Infinity);
    const driveTimeToStartS = (aNearer ? tA : tB) as number;
    if (driveTimeToStartS > DISCOVER_REACH_S) continue; // beyond the honest reach
    const nearerLoc = aNearer ? entryLoc : exitLoc;
    const driveTimeToStartM =
      cells[0]?.[nearerLoc]?.distanceM ??
      (driveTimeToStartS / 3600) * BACKROADS.sizingSpeedKmh * 1000;
    const entry = aNearer ? s.a : s.b;
    const exit = aNearer ? s.b : s.a;
    const roadTraverseS = s.segment.lengthM / roadV; // from geometry, NOT matrix a→b
    // Out-and-back for ALL Discover drives (R24): 2·driveOut + road, near-direct.
    const roundTripLowerS = 2 * driveTimeToStartS + roadTraverseS;
    const estS = Math.round(roundTripLowerS * TAP_OAB_SLACK);
    if (estS > TAP_DURATION_MAX_S) {
      droppedFar++;
      continue;
    }
    const suggestedDurationS = Math.max(TAP_DURATION_MIN_S, estS);
    const isClassic = s.segment.id.startsWith(CLASSIC_PREFIX);
    const score =
      s.value *
      (1 - DISCOVER_REACH_DISCOUNT_K * Math.min(1, driveTimeToStartS / DISCOVER_REACH_S)) *
      proximityTier(driveTimeToStartS) *
      (isClassic ? DISCOVER_CLASSIC_BONUS : 1);
    drives.push({
      segmentId: s.segment.id,
      name: s.segment.name,
      entry,
      exit,
      curviness: s.segment.curviness,
      length_m: s.segment.lengthM,
      class: s.segment.highway,
      urbanShare: s.segment.urbanShare ?? 0,
      driveTimeToStartS,
      driveTimeToStartM,
      roadTraverseS,
      suggestedDurationS,
      score,
      geometry: s.segment.geometry,
      source: isClassic ? 'classic' : 'auto',
      durationSource: 'estimated',
      ...(isClassic ? { classicRouteId: s.segment.id.slice(CLASSIC_PREFIX.length) } : {}),
    });
  }

  // menu rank → geographic spread → trim (deterministic tiebreaks)
  drives.sort(
    (a, b) =>
      b.score - a.score ||
      a.driveTimeToStartS - b.driveTimeToStartS ||
      a.segmentId.localeCompare(b.segmentId),
  );
  const drivesMenu: NearbyDrive[] = [];
  const farEnough = (d: NearbyDrive): boolean =>
    drivesMenu.every(
      (m) =>
        haversineMeters([m.entry.lng, m.entry.lat], [d.entry.lng, d.entry.lat]) >=
        DISCOVER_MENU_SEP_M,
    );
  for (const d of drives) {
    if (drivesMenu.length >= DISCOVER_MENU_MAX) break;
    if (farEnough(d)) drivesMenu.push(d);
  }
  // R25-U11: the refill loop is DELETED under gates — it re-added drives
  // while ignoring the separation rule (two cards, same road). A short menu
  // with honest copy beats a padded one; DISCOVER_MENU_MIN is a disclosure
  // trigger below, never a target.
  if (gates === 'off' && drivesMenu.length < DISCOVER_MENU_MIN) {
    for (const d of drives) {
      if (drivesMenu.length >= DISCOVER_MENU_MAX) break;
      if (!drivesMenu.includes(d)) drivesMenu.push(d);
    }
  }
  if (drivesMenu.length === 0) return empty();

  // U6: PRE-BUILD each drive's out-and-back (origin → entry → exit → origin) in
  // parallel — a tap opens the result instantly with a REAL measured total. A
  // per-drive failure keeps the card with the estimate (the app builds on tap).
  const built = await Promise.all(
    drivesMenu.map(async (d): Promise<NearbyDrive> => {
      try {
        // Auto drives are a single corpus road (entry→exit traces it). Classics
        // span a curated route, so trace it with interior through-points — one
        // roughly every 2.5 km so a long classic is followed faithfully.
        const mids =
          d.source === 'classic'
            ? classicThroughPoints(
                d.geometry,
                d.entry,
                Math.max(3, Math.min(8, Math.round(d.length_m / 2500))),
              )
            : [];
        const route = await buildRoute(
          deps.valhallaUrl,
          {
            waypoints: [
              [origin.lng, origin.lat],
              [d.entry.lng, d.entry.lat],
              ...mids,
              [d.exit.lng, d.exit.lat],
              [origin.lng, origin.lat],
            ],
            // R25-U3: no highway on a Discover drive (audit-v11: 18/30 tapped
            // drives contained highway, worst 65 %). U2's translation makes
            // the connector fastest+use_highways:0 — which also stops
            // `shortest` cutting through subdivisions on the commute legs.
            costingOptions: {
              ...BACKROADS.options,
              ...(FUN_EXCLUDE_HIGHWAYS_ON ? { exclude_highways: true } : {}),
            },
            middleType: 'through',
          },
          { timeoutMs: DISCOVER_PREBUILD_TIMEOUT_MS },
        );
        const measured = Math.round(route.duration_s);
        return {
          ...d,
          route,
          measuredDurationS: measured,
          suggestedDurationS: Math.max(TAP_DURATION_MIN_S, measured),
          durationSource: 'measured',
        };
      } catch {
        return d; // keep the estimate; the app falls back to building on tap
      }
    }),
  );

  const disclosures: string[] = [];
  if (built.length < DISCOVER_MENU_MIN && droppedFar > 0) {
    disclosures.push(
      'The good roads near here are a fair drive out — showing the ones that fit a half-day.',
    );
  }
  if (gates === 'off') {
    return { drives: built, reachMinutes, disclosures };
  }

  // --- R25-U11 gates: cheap pure detectors first, ONE trace on survivors ---
  // (audit-v11 issue #4: 180 routes, zero validations). Hard road defects
  // DROP in both modes; shape/commute facts DISCLOSE + DEMOTE in 'report'
  // (an out-and-back's overlap is its shape) and DROP in 'strict' (eval).
  const trace = deps.traceFn ?? traceRoadClasses;
  let droppedOffence = 0;
  let droppedHighway = 0;
  let droppedHood = 0;
  let demotedCommute = 0;
  const keptClean: NearbyDrive[] = [];
  const demoted: NearbyDrive[] = [];
  await Promise.all(
    built.map(async (d) => {
      if (!d.route) {
        // unmeasured: report keeps it honestly-estimated (the app builds on
        // tap); strict drops — eval judges measured drives only
        if (gates === 'report') demoted.push(d);
        return;
      }
      // cheap gates (engine-free) — hard drops in both modes
      const uturns = uturnCount(d.route);
      const spurs = spurPositions(d.route.geometry, origin).length;
      const microloops = microloopEvents(d.route.geometry, origin);
      if (uturns > 0 || spurs > 0 || microloops > 0) {
        droppedOffence++;
        return;
      }
      // one trace per survivor — road-class truth on the WHOLE trip
      let highwayM = 0;
      let resShare = 0;
      try {
        const traced = await trace(deps.valhallaUrl, d.route.geometry);
        highwayM = tracedHighwayM(traced.edges);
        resShare = residentialShareOf(traced.edges, d.route.geometry, [origin]);
      } catch {
        // trace down: unknown is never sold as clean — treat like unmeasured
        if (gates === 'report') demoted.push(d);
        return;
      }
      if (highwayM > TRACE_HIGHWAY_FLOOR_M) {
        droppedHighway++;
        return;
      }
      if (resShare > DISCOVER_RESIDENTIAL_MAX) {
        droppedHood++;
        return;
      }
      // shape/commute facts: disclose + demote (report) / drop (strict)
      const selfOverlap = selfOverlapRatio(d.route.geometry, undefined, origin);
      const connectorShare = 1 - Math.min(1, d.roadTraverseS / d.route.duration_s);
      if (
        selfOverlap > DISCOVER_SELF_OVERLAP_MAX ||
        connectorShare > DISCOVER_CONNECTOR_SHARE_MAX
      ) {
        if (gates === 'report') {
          demotedCommute++;
          demoted.push(d);
        }
        return;
      }
      keptClean.push(d);
    }),
  );
  // deterministic re-assembly: clean first, then demoted, original order within
  const orderOf = new Map(built.map((d, i) => [d.segmentId, i]));
  const byMenuOrder = (a: NearbyDrive, b: NearbyDrive): number =>
    (orderOf.get(a.segmentId) ?? 0) - (orderOf.get(b.segmentId) ?? 0);
  keptClean.sort(byMenuOrder);
  demoted.sort(byMenuOrder);
  const gated = [...keptClean, ...demoted];
  const droppedTotal = droppedOffence + droppedHighway + droppedHood;
  if (droppedHighway > 0) {
    disclosures.push(
      `${droppedHighway} drive${droppedHighway > 1 ? 's' : ''} near here had highway on the way — not shown.`,
    );
  }
  if (droppedHood > 0) {
    disclosures.push(`${droppedHood} dove through neighbourhood streets — not shown.`);
  }
  if (droppedOffence > 0) {
    disclosures.push(
      `${droppedOffence} doubled back on ${droppedOffence > 1 ? 'themselves' : 'itself'} — not shown.`,
    );
  }
  if (demotedCommute > 0) {
    disclosures.push(
      `${demotedCommute} ${demotedCommute > 1 ? 'are' : 'is'} mostly getting-there — shown last.`,
    );
  }
  if (gated.length === 0) {
    return {
      drives: [],
      reachMinutes,
      disclosures: droppedTotal > 0 ? disclosures : [...disclosures, NO_DRIVES],
    };
  }
  return { drives: gated, reachMinutes, disclosures };
}
