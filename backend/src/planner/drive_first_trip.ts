/**
 * R30 (BD-146) — the DRIVE-FIRST TRIP, rebuilt on the owner's ruler.
 *
 * R29's version of this file fit the CORE to the ask ("the ask means the
 * drive", BD-135) and wrapped it in BACKROADS-costed connectors. Measured from
 * the owner's own areas (rq30, 36 production routes): every trip blew past the
 * ask (60 min asked → 106 min served, mean), the commute was 44 % of the
 * distance and routed through subdivisions (backroads costing on a COMMUTE),
 * out and home retraced each other for kilometres, and the whole shape scored
 * 0.14 loopiness — a lollipop. The owner drove it and said so (BD-146).
 *
 * This version:
 *   - FITS THE TRIP: candidate cores are ranked by predicted door-to-door
 *     duration against the ask, so a 60-minute ask near Southfields prefers
 *     the 32-minute core 8 km away over the 90-minute core 13 km away.
 *   - Commutes on DIRECT costing (the legacy default profile — how a person
 *     actually drives to the fun road), honouring only the user's own avoids.
 *   - Retry ladders steer connectors OFF the core's road and off each other.
 *   - `judgeTrip` (trip_gates.ts) then REJECTS anything that still misses the
 *     ask, doesn't look like a loop, doubles, stubs, or is mostly commute.
 *     No disclosures-instead-of-quality: a candidate passes or the next one is
 *     tried, and when none pass the caller falls back to the legacy planner
 *     and says so.
 */
import type { LatLng, LineString, RouteThroughOutput } from '@shared/types';
import type { Client } from 'pg';

import { travelMatrix } from '../valhalla/matrix';
import { routeThrough } from '../valhalla/route';

import { LEGACY } from './costing';
import { selfIntersections, summarizeCrossings } from './crossings';
import { DRIVE_CORES_VERSION, readDriveCores, type CoreRowRead } from './discover_cores';
import { edgeOverlapRatio } from './overlap';
import { uturnCount } from './score';
import {
  driveClosedLoopiness,
  judgeTrip,
  TRIP_DURATION_TOL,
  TRIP_EXACT_BAND,
  tripShapeMetrics,
  type TripMetrics,
} from './trip_gates';

/** Crow-flies → road factor for the commute predictor (pre-filter only; the
 *  real routes are measured before any gate decides). */
const COMMUTE_DETOUR_FACTOR = 1.3;
const COMMUTE_SPEED_MPS = 55_000 / 3600;
/** Reach for the candidate read, as a fraction of the ask (each way). */
export const TRIP_REACH_FRAC = Number(process.env['TRIP_REACH_FRAC'] ?? 0.3);
/** Build at most this many candidates with real routes (deterministic order).
 *  (No separate retry cost cap: a via rung that inflates the trip answers to
 *  the trip_duration gate like everything else.) */
const TRIP_BUILD_MAX = Number(process.env['TRIP_BUILD_MAX'] ?? 5);

/**
 * R35-U10 (BD-166) — J1/J2 MATRIX OPTIMIZATION (Recovery §7). The nearest-
 * vertex J1 + walk-to-target J2 heuristic threw away good candidates: at
 * funnel origins the ONE join interpretation forced crossing/doubling spokes,
 * and the perpendicular home-via ladder was a repair mechanism for a decision
 * that was never optimized. Now: ≤12 PORTS sampled around each ring, ONE
 * /sources_to_targets pricing origin↔every port with REAL network costs, all
 * feasible (J1, J2, direction) pairs enumerated and ranked by predicted
 * duration error then commute share, the top pairs BUILT — a different
 * legitimate ring exit beats an artificial via point (the ladder is gone
 * when this flag is on). Off = the pre-R35 heuristic, byte-identical.
 */
export const J1J2_MATRIX_OPT_ON = (process.env['J1J2_MATRIX_OPT'] ?? 'on') !== 'off';
const RING_PORTS_MAX = Number(process.env['RING_PORTS_MAX'] ?? 12);
const PORT_MIN_SEP_M = 800;
const TRIP_PAIRS_MAX = Number(process.env['TRIP_PAIRS_MAX'] ?? 3);
const PAIR_COMMUTE_PRED_MAX = 0.55;

export type ServeTier = 'exact' | 'alternate';

export interface DriveFirstTrip {
  core: CoreRowRead;
  /** The WHOLE trip as ONE routed request — seam-free geometry, real
   *  maneuvers, real duration, real has_* flags. */
  route: RouteThroughOutput;
  /** The ring arc the through-points followed (J1 → long way → J2). */
  drive: {
    entry: LatLng;
    mid: LatLng;
    exit: LatLng;
    frac: number;
  };
  /** Leg split measured on the ROUTED geometry (vertex indices + metres). */
  legs: {
    thereM: number;
    driveM: number;
    homeM: number;
    thereS: number;
    driveS: number;
    homeS: number;
  };
  geometry: LineString;
  distanceM: number;
  durationS: number;
  /** The as-driven metrics the trip PASSED on (for trace + disclosures). */
  metrics: TripMetrics;
  /** R34-U8: inside the ±TRIP_EXACT_BAND of the ask, or an honest alternate. */
  tier: ServeTier;
  /** R34-U9: routed-vs-measured arc fidelity; core stats are advertised only
   *  at ≥ STATS_PROVENANCE_MIN. */
  fidelity: number;
}

export interface DriveFirstOutcome {
  /** The BEST clean trip (exact band preferred; else nearest alternate). */
  trip: DriveFirstTrip | null;
  /** Up to 2 further clean trips at other durations (distinct rings). */
  alternates: DriveFirstTrip[];
  /** Why each tried candidate was rejected — the trace tells the truth. */
  rejected: Array<{ id: string; failures: string[] }>;
}

function hav(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function offsetVia(from: LatLng, to: LatLng, offsetM: number): [number, number] {
  const mid = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
  const dx = (to.lng - from.lng) * Math.cos((mid.lat * Math.PI) / 180);
  const dy = to.lat - from.lat;
  const len = Math.hypot(dx, dy) || 1;
  const latM = 111_320;
  return [
    mid.lng + (-dy / len) * (offsetM / (latM * Math.cos((mid.lat * Math.PI) / 180))),
    mid.lat + (dx / len) * (offsetM / latM),
  ];
}

/* ------------------------------------------------------------------ ring arc
 * THE geometric fix for the 153/156-spur histogram (rq30b): a loop core has
 * entry ≈ exit, so serving it whole forces the out and home connectors
 * through ONE junction — they share an approach road (the owner's u-turn
 * stub), the shape collapses to a lollipop (loopiness 0.14), and out/home
 * retrace (doubling). But a MEASURED LOOP IS A RING: enter at the vertex
 * nearest the origin, drive the ring THE LONG WAY round to a second vertex,
 * come home from there. Two spokes at different junctions — and the skipped
 * short arc makes the drive length a DIAL: J2 is chosen so the arc fits
 * (ask − commutes), never below RING_ARC_MIN_FRAC of the ring.
 */
export const RING_ARC_MIN_FRAC = Number(process.env['RING_ARC_MIN_FRAC'] ?? 0.6);
/** J1 and J2 must be different junctions, far enough apart to give the two
 *  connectors different roads (else the single-junction defect returns). */
const RING_JOIN_MIN_SEP_M = 1_500;
/** Through-point spacing along the arc; 20-location /route cap rules. */
const ARC_SAMPLE_MIN_M = 1_500;
/** ≤ 15 arc samples + origin×2 + ≤1 home via + J2 tail = 20-location cap. */
const ARC_SAMPLE_MAX_POINTS = 15;
/** The routed trip must actually FOLLOW the measured arc — below this cell
 *  overlap the engine shortcut the ring and the core's measured numbers no
 *  longer describe the drive (reject as arc_deviation, never serve).
 *  R34-U9: raised 0.6 → 0.85 with FULL-RES sampling (Recovery §9: a 0.6 bar
 *  let 40 % of an advertised "measured" ring be silently replaced). */
export const ARC_FIDELITY_MIN = Number(process.env['ARC_FIDELITY_MIN'] ?? 0.85);
/** Advertise the core's MEASURED stats (curviness, backroad) only at or above
 *  this fidelity; below it the words say "built around" and measured numbers
 *  are withheld rather than approximated (comparability to the frozen GATE-C
 *  formula beats a lookalike recompute — recorded in BD-160). */
export const STATS_PROVENANCE_MIN = Number(process.env['STATS_PROVENANCE_MIN'] ?? 0.95);

interface RingArc {
  entry: LatLng;
  mid: LatLng;
  exit: LatLng;
  geometry: LineString;
  distanceM: number;
  durationS: number;
  frac: number;
}

/** Cut the ring at the origin-nearest vertex J1, walk toward the target arc
 *  length (never under RING_ARC_MIN_FRAC of the ring), end at J2. Direction =
 *  whichever lands J2 nearer the origin (shorter home). Deterministic. */
export function ringArc(
  core: Pick<CoreRowRead, 'geom_simplified' | 'geometry' | 'duration_s'>,
  origin: LatLng,
  targetM: number | null,
): RingArc | null {
  // R34-U9: FULL-resolution geometry is routing truth; simplified is display.
  const raw = (core.geometry ?? core.geom_simplified).coordinates as Array<[number, number]>;
  if (raw.length < 8) return null;
  const first = raw[0]!;
  const last = raw[raw.length - 1]!;
  const closingGapM = hav({ lat: first[1], lng: first[0] }, { lat: last[1], lng: last[0] });
  if (closingGapM > 2_000) return null; // not a ring — caller skips the core
  const ring = closingGapM < 1 ? raw.slice(0, -1) : raw.slice();
  const n = ring.length;
  const at = (i: number): [number, number] => ring[((i % n) + n) % n]!;
  const ll = (c: [number, number]): LatLng => ({ lat: c[1], lng: c[0] });

  const segM: number[] = [];
  let totalM = 0;
  for (let i = 0; i < n; i++) {
    const m = hav(ll(at(i)), ll(at(i + 1)));
    segM.push(m);
    totalM += m;
  }
  if (totalM < 4_000) return null;

  let j1 = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = hav(origin, ll(at(i)));
    if (d < bestD) {
      bestD = d;
      j1 = i;
    }
  }

  const wantM = Math.min(totalM, Math.max(totalM * RING_ARC_MIN_FRAC, targetM ?? totalM));

  const walk = (dir: 1 | -1): { j2: number; arcM: number; coords: Array<[number, number]> } => {
    const coords: Array<[number, number]> = [at(j1)];
    let acc = 0;
    let i = j1;
    while (acc < wantM && coords.length < n) {
      const step = dir === 1 ? segM[((i % n) + n) % n]! : segM[(((i - 1) % n) + n) % n]!;
      i += dir;
      acc += step;
      coords.push(at(i));
    }
    return { j2: ((i % n) + n) % n, arcM: acc, coords };
  };
  const cw = walk(1);
  const ccw = walk(-1);
  const apart = (w: { j2: number }): boolean =>
    hav(ll(at(j1)), ll(at(w.j2))) >= RING_JOIN_MIN_SEP_M;
  const both = [cw, ccw].filter(apart);
  const chosen =
    both.sort(
      (a, b) => hav(origin, ll(at(a.j2))) - hav(origin, ll(at(b.j2))) || a.arcM - b.arcM,
    )[0] ?? (cw.arcM >= ccw.arcM ? cw : ccw);
  const frac = chosen.arcM / totalM;
  const midC = chosen.coords[Math.floor(chosen.coords.length / 2)]!;
  return {
    entry: ll(at(j1)),
    mid: ll(midC),
    exit: ll(at(chosen.j2)),
    geometry: { type: 'LineString', coordinates: chosen.coords },
    distanceM: Math.round(chosen.arcM),
    durationS: Math.round(core.duration_s * frac),
    frac,
  };
}

/** R35-U10: the ring's port scaffold — ≤RING_PORTS_MAX vertices evenly spaced
 *  by along-ring distance (≥PORT_MIN_SEP_M apart), with cumulative metres so
 *  any (i, j, direction) slice prices and cuts in O(1). */
interface RingPorts {
  ring: Array<[number, number]>;
  cum: number[]; // cumulative metres at each ring vertex
  totalM: number;
  ports: number[]; // ring vertex indices
}

export function ringPorts(
  core: Pick<CoreRowRead, 'geom_simplified' | 'geometry'>,
): RingPorts | null {
  const raw = (core.geometry ?? core.geom_simplified).coordinates as Array<[number, number]>;
  if (raw.length < 8) return null;
  const first = raw[0]!;
  const last = raw[raw.length - 1]!;
  const gapM = hav({ lat: first[1], lng: first[0] }, { lat: last[1], lng: last[0] });
  if (gapM > 2_000) return null;
  const ring = gapM < 1 ? raw.slice(0, -1) : raw.slice();
  const cum: number[] = [0];
  for (let i = 1; i < ring.length; i++) {
    cum.push(
      cum[i - 1]! +
        hav({ lat: ring[i - 1]![1], lng: ring[i - 1]![0] }, { lat: ring[i]![1], lng: ring[i]![0] }),
    );
  }
  const totalM =
    cum[cum.length - 1]! +
    hav(
      { lat: ring[ring.length - 1]![1], lng: ring[ring.length - 1]![0] },
      { lat: ring[0]![1], lng: ring[0]![0] },
    );
  if (totalM < 4_000) return null;
  const spacing = Math.max(PORT_MIN_SEP_M, totalM / RING_PORTS_MAX);
  const ports: number[] = [0];
  let nextAt = spacing;
  for (let i = 1; i < ring.length; i++) {
    if (cum[i]! >= nextAt) {
      ports.push(i);
      nextAt = cum[i]! + spacing;
      if (ports.length >= RING_PORTS_MAX) break;
    }
  }
  return { ring, cum, totalM, ports };
}

/** Cut the arc from port a to port b travelling `dir` (+1 = ascending ring
 *  indices). Returns the same RingArc shape ringArc() produces. */
export function ringArcBetween(
  rp: RingPorts,
  coreDurationS: number,
  aIdx: number,
  bIdx: number,
  dir: 1 | -1,
): RingArc {
  const n = rp.ring.length;
  const coords: Array<[number, number]> = [];
  let i = aIdx;
  coords.push(rp.ring[i]!);
  while (i !== bIdx) {
    i = (i + dir + n) % n;
    coords.push(rp.ring[i]!);
  }
  let arcM = 0;
  for (let k = 1; k < coords.length; k++) {
    arcM += hav(
      { lat: coords[k - 1]![1], lng: coords[k - 1]![0] },
      { lat: coords[k]![1], lng: coords[k]![0] },
    );
  }
  const frac = arcM / rp.totalM;
  const midC = coords[Math.floor(coords.length / 2)]!;
  return {
    entry: { lat: rp.ring[aIdx]![1], lng: rp.ring[aIdx]![0] },
    mid: { lat: midC[1], lng: midC[0] },
    exit: { lat: rp.ring[bIdx]![1], lng: rp.ring[bIdx]![0] },
    geometry: { type: 'LineString', coordinates: coords },
    distanceM: Math.round(arcM),
    durationS: Math.round(coreDurationS * frac),
    frac,
  };
}

/** Evenly-spaced through-points along the arc (J1 and J2 always included). */
function arcSamples(arc: RingArc): Array<[number, number]> {
  const c = arc.geometry.coordinates as Array<[number, number]>;
  const spacing = Math.max(ARC_SAMPLE_MIN_M, arc.distanceM / ARC_SAMPLE_MAX_POINTS);
  const out: Array<[number, number]> = [c[0]!];
  let acc = 0;
  const latM = 111_320;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1]!;
    const b = c[i]!;
    acc += Math.hypot(
      (b[1] - a[1]) * latM,
      (b[0] - a[0]) * latM * Math.cos((a[1] * Math.PI) / 180),
    );
    if (acc >= spacing) {
      out.push(b);
      acc = 0;
    }
  }
  const lastC = c[c.length - 1]!;
  if (out[out.length - 1] !== lastC) out.push(lastC);
  return out;
}

/** Vertex index of `geometry` nearest to `p`, searched in [from, to). */
function nearestIdx(coords: Array<[number, number]>, p: LatLng, from: number, to: number): number {
  let best = from;
  let bestD = Infinity;
  for (let i = from; i < to; i++) {
    const d = hav({ lat: coords[i]![1], lng: coords[i]![0] }, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Pick and build the best measured trip for the ask, judged AS DRIVEN.
 * The WHOLE trip is ONE /route call: origin → through-points along the ring
 * arc → origin. No connector/arc seams (the rq30c dissection: the "spur" and
 * a 310 m double sat exactly at the glued join of routed and simplified
 * geometry), real maneuvers everywhere, engine-priced duration. `trip: null`
 * when nothing passes — with the rejection list for the trace.
 */
export async function driveFirstTrip(
  db: Client,
  valhallaUrl: string,
  origin: LatLng,
  durationTargetS: number | null,
  opts: { avoidHighways?: boolean; deadlineMs?: number; oabGraceM?: number } = {},
): Promise<DriveFirstOutcome> {
  // Wall honesty (BD-119's lesson, re-learned live: a fallback-heavy origin
  // measured 25.8 s because the trip attempt STACKED on the legacy planner's
  // own budget). Past the deadline no NEW candidate is started; whatever was
  // tried is reported and the legacy planner gets the time that remains.
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;
  const outOfTime = (): boolean => Date.now() > deadline;
  const none: DriveFirstOutcome = { trip: null, alternates: [], rejected: [] };
  if (durationTargetS === null || durationTargetS <= 0) return none;
  const reachM = Math.max(12_000, durationTargetS * TRIP_REACH_FRAC * COMMUTE_SPEED_MPS);
  const half = reachM / 111_320;
  let rows: CoreRowRead[];
  try {
    rows = await readDriveCores(
      db,
      [origin.lng - half, origin.lat - half, origin.lng + half, origin.lat + half],
      DRIVE_CORES_VERSION,
      50,
      // LOOP CORES ONLY (BD-137's lesson): ribbons are chaining material, and
      // kind=null re-created the ribbon swamp the 0019 migration prevents.
      'loop',
    );
  } catch {
    return none; // the legacy planner must never be hostage to the index
  }

  // Predicted commute for a core: to its origin-NEAREST ring vertex (the real
  // join), not the stored entry. The arc is a dial from RING_ARC_MIN_FRAC×ring
  // to the full ring, so the predicted trip is an INTERVAL; fit = how far the
  // ask sits outside it (0 when the dial can hit the ask exactly).
  const nearestRingM = (r: CoreRowRead): number => {
    const c = r.geom_simplified.coordinates as Array<[number, number]>;
    let best = Infinity;
    for (const p of c) {
      const d = hav(origin, { lat: p[1], lng: p[0] });
      if (d < best) best = d;
    }
    return best;
  };
  const commutePredS = (r: CoreRowRead): number =>
    (2 * nearestRingM(r) * COMMUTE_DETOUR_FACTOR) / COMMUTE_SPEED_MPS;
  const fit = (r: CoreRowRead): number => {
    const lo = r.duration_s * RING_ARC_MIN_FRAC + commutePredS(r);
    const hi = r.duration_s + commutePredS(r);
    if (durationTargetS < lo) return (lo - durationTargetS) / durationTargetS;
    if (durationTargetS > hi) return (durationTargetS - hi) / durationTargetS;
    return 0;
  };

  const candidates = rows
    .filter((r) => fit(r) <= TRIP_DURATION_TOL + 0.1) // predictor slack; the real gate decides
    .sort((a, b) => {
      const fa = Math.floor(fit(a) * 10);
      const fb = Math.floor(fit(b) * 10);
      if (fa !== fb) return fa - fb;
      const da = nearestRingM(a);
      const dbd = nearestRingM(b);
      if (Math.abs(da - dbd) > 2000) return da - dbd;
      return (
        b.backroad_share - a.backroad_share || b.curviness - a.curviness || a.id.localeCompare(b.id)
      );
    })
    .slice(0, TRIP_BUILD_MAX * 3); // pre-slice, then geometric dedup below

  // DEDUP BY GEOMETRY (BD-150): the index stores the same physical ring under
  // many sweep cells (270 loop cores / 82 distinct names region-wide), so
  // without this the 5 build attempts can all be spent on copies of ONE road.
  const distinct: CoreRowRead[] = [];
  for (const cand of candidates) {
    const dup = distinct.some(
      (k) => edgeOverlapRatio(cand.geom_simplified, k.geom_simplified) > 0.5,
    );
    if (!dup) distinct.push(cand);
    if (distinct.length >= TRIP_BUILD_MAX) break;
  }

  // The commute legs are engine-chosen inside the one-shot route: direct
  // costing (how a person drives to the fun road), honouring only the user's
  // own avoids. BACKROADS costing on commutes was measured as the "random
  // neighbourhood" defect (hood share to 16.8 %, detour factor 1.8×).
  const costingOptions = {
    ...LEGACY.options,
    ...(opts.avoidHighways === true ? { exclude_highways: true } : {}),
  };

  const rejected: Array<{ id: string; failures: string[] }> = [];
  const candidatesFullRing: CoreRowRead[] = [];

  /** Route + judge one (core, arc): the bounded home-via ladder inside. */
  const buildAndJudge = async (
    row: CoreRowRead,
    arc: RingArc,
  ): Promise<{ trip: DriveFirstTrip | null; failures: string[] }> => {
    const samples = arcSamples(arc);
    const build = (homeVia: [number, number] | null): Promise<RouteThroughOutput> =>
      routeThrough(valhallaUrl, {
        waypoints: [
          [origin.lng, origin.lat],
          ...samples,
          ...(homeVia ? [homeVia] : []),
          [origin.lng, origin.lat],
        ],
        costingOptions,
        // 'through': no stop, no u-turn, unclassified-or-better snapping.
        // The default 'break' via was measured as the owner's "into a random
        // street, u-turn, back out" (rq30b).
        middleType: 'through',
      });

    let bestFailures: string[] = ['build_error'];
    // R35-U10: with pair optimization on, a different legitimate ring exit
    // replaces artificial perpendicular vias — the ladder survives only for
    // the heuristic fallback path (Recovery §7.4).
    const viaLadder: Array<[number, number] | null> = J1J2_MATRIX_OPT_ON
      ? [null]
      : [
          null,
          offsetVia(arc.exit, origin, 4000),
          offsetVia(arc.exit, origin, -4000),
          offsetVia(arc.exit, origin, 7000),
          offsetVia(arc.exit, origin, -7000),
        ];
    for (const via of viaLadder) {
      let route: RouteThroughOutput;
      try {
        route = await build(via);
      } catch {
        continue;
      }
      const coords = route.geometry.coordinates as Array<[number, number]>;
      if (coords.length < 8) continue;

      // split the routed geometry at the arc joins
      const j1i = nearestIdx(coords, arc.entry, 0, coords.length);
      const j2i = nearestIdx(coords, arc.exit, Math.min(j1i + 1, coords.length - 1), coords.length);
      if (j2i <= j1i) continue;
      const latM = 111_320;
      const cum: number[] = [0];
      for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1]!;
        const b = coords[i]!;
        cum.push(
          cum[i - 1]! +
            Math.hypot(
              (b[1] - a[1]) * latM,
              (b[0] - a[0]) * latM * Math.cos((a[1] * Math.PI) / 180),
            ),
        );
      }
      const totalM = cum[cum.length - 1]!;
      const thereM = cum[j1i]!;
      const driveM = cum[j2i]! - cum[j1i]!;
      const homeM = totalM - cum[j2i]!;
      // Honest leg TIMES: the drive at the core's own measured pace (twisty
      // rings are slower than arterial spokes — uniform pacing overpriced
      // the commute by ~30 % and tripped commute_majority falsely); the
      // spokes split the remaining engine-priced time by distance.
      const corePace = row.duration_s / Math.max(1, row.distance_m);
      const driveS = Math.min(Math.round(driveM * corePace), route.duration_s);
      const spokeS = route.duration_s - driveS;
      const spokeM = Math.max(1, thereM + homeM);
      const legs = {
        thereM: Math.round(thereM),
        driveM: Math.round(driveM),
        homeM: Math.round(homeM),
        thereS: Math.round((spokeS * thereM) / spokeM),
        driveS,
        homeS: Math.round((spokeS * homeM) / spokeM),
      };
      const outGeo: LineString = { type: 'LineString', coordinates: coords.slice(0, j1i + 1) };
      const driveGeo: LineString = { type: 'LineString', coordinates: coords.slice(j1i, j2i + 1) };
      const homeGeo: LineString = { type: 'LineString', coordinates: coords.slice(j2i) };

      // the routed drive must actually FOLLOW the measured ring
      const fidelity = edgeOverlapRatio(arc.geometry, driveGeo);
      const metrics: TripMetrics = {
        durationS: route.duration_s,
        targetS: durationTargetS,
        // BD-149 refined by measurement (rq30d): whole-shape isoperimetric
        // loopiness HALVED serving (22→11/36) by rejecting ELONGATION — a
        // perfect ring stretched 8:1 by distance-to-supply fails 0.25 — while
        // the owner's actual rule (a loop, not a lollipop) is structurally
        // enforced by out≠home + doubling + stub gates (a lollipop REQUIRES
        // the doubled stem those forbid). So the RING must be a real ring
        // (drive-closed, core bar) and the whole shape must have no stem;
        // elongation is where you live, not a defect.
        loopiness: driveClosedLoopiness(driveGeo),
        ...tripShapeMetrics(
          route.geometry,
          origin,
          opts.oabGraceM !== undefined ? { oabGraceM: opts.oabGraceM } : {},
        ),
        ...summarizeCrossings(selfIntersections(route.geometry, origin)),
        uturns: uturnCount(route),
        commuteShare: (legs.thereS + legs.homeS) / Math.max(1, route.duration_s),
        outHomeOverlap: edgeOverlapRatio(homeGeo, outGeo),
        outCoreOverlap: 0, // seam-free by construction (one routed request)
        homeCoreOverlap: 0,
      };
      // R34-U8: cleanliness is judged WITHOUT a duration cliff; the band
      // classifies the serving tier instead (exact vs honest alternate).
      const verdict = judgeTrip(metrics, { durationTol: Number.POSITIVE_INFINITY });
      const failures = [...verdict.failures];
      if (fidelity < ARC_FIDELITY_MIN) failures.push('arc_deviation');
      if (failures.length === 0) {
        const err = Math.abs(route.duration_s - durationTargetS) / durationTargetS;
        return {
          trip: {
            core: row,
            route,
            drive: { entry: arc.entry, mid: arc.mid, exit: arc.exit, frac: arc.frac },
            legs,
            geometry: route.geometry,
            distanceM: route.distance_m,
            durationS: route.duration_s,
            metrics,
            tier: err <= TRIP_EXACT_BAND ? 'exact' : 'alternate',
            fidelity,
          },
          failures: [],
        };
      }
      bestFailures = failures;
    }
    return { trip: null, failures: bestFailures };
  };

  // R34-U7 (QUALITY_RANKING_V2): build ALL viable candidates inside the wall
  // slice and serve the BEST clean one — not the first passer. Rank: exact
  // band first → |duration error| → measured backroad → curviness → commute
  // share → id (deterministic).
  const clean: DriveFirstTrip[] = [];
  for (const row of distinct) {
    if (outOfTime()) {
      rejected.push({ id: row.id, failures: ['time_budget'] });
      continue;
    }
    try {
      if (J1J2_MATRIX_OPT_ON) {
        // ---- R35-U10: matrix-priced (J1, J2, direction) pair optimization
        const rp = ringPorts(row);
        if (rp === null) {
          rejected.push({ id: row.id, failures: ['not_a_ring'] });
          continue;
        }
        let cells: Awaited<ReturnType<typeof travelMatrix>> | null = null;
        try {
          cells = await travelMatrix(valhallaUrl, {
            locations: [
              [origin.lng, origin.lat],
              ...rp.ports.map((pi) => [rp.ring[pi]![0], rp.ring[pi]![1]] as [number, number]),
            ],
            costingOptions,
          });
        } catch {
          cells = null; // matrix down → heuristic fallback below
        }
        if (cells !== null) {
          interface Pair {
            a: number; // index into rp.ports
            b: number;
            dir: 1 | -1;
            predS: number;
            commutePred: number;
          }
          const pairs: Pair[] = [];
          const pace = row.duration_s / Math.max(1, rp.totalM);
          for (let a = 0; a < rp.ports.length; a++) {
            const outS = cells[0]?.[1 + a]?.timeS ?? null;
            if (outS === null) continue;
            for (let b = 0; b < rp.ports.length; b++) {
              if (a === b) continue;
              const homeS = cells[1 + b]?.[0]?.timeS ?? null;
              if (homeS === null) continue;
              const sepM = hav(
                { lat: rp.ring[rp.ports[a]!]![1], lng: rp.ring[rp.ports[a]!]![0] },
                { lat: rp.ring[rp.ports[b]!]![1], lng: rp.ring[rp.ports[b]!]![0] },
              );
              if (sepM < RING_JOIN_MIN_SEP_M) continue;
              const fwdM = (rp.cum[rp.ports[b]!]! - rp.cum[rp.ports[a]!]! + rp.totalM) % rp.totalM;
              for (const dir of [1, -1] as const) {
                const arcM = dir === 1 ? fwdM : rp.totalM - fwdM;
                const frac = arcM / rp.totalM;
                if (frac < RING_ARC_MIN_FRAC || frac > 0.999) continue;
                const predS = outS + arcM * pace + homeS;
                const commutePred = (outS + homeS) / Math.max(1, predS);
                if (commutePred > PAIR_COMMUTE_PRED_MAX) continue;
                pairs.push({ a, b, dir, predS, commutePred });
              }
            }
          }
          const err = (x: Pair): number => Math.abs(x.predS - durationTargetS) / durationTargetS;
          pairs.sort(
            (x, y) =>
              (err(x) <= TRIP_EXACT_BAND ? 0 : 1) - (err(y) <= TRIP_EXACT_BAND ? 0 : 1) ||
              err(x) - err(y) ||
              x.commutePred - y.commutePred ||
              x.a - y.a ||
              x.b - y.b ||
              x.dir - y.dir,
          );
          let lastFailures: string[] = ['no_feasible_pair'];
          let served = false;
          for (const pr of pairs.slice(0, TRIP_PAIRS_MAX)) {
            if (outOfTime()) break;
            const arc = ringArcBetween(
              rp,
              row.duration_s,
              rp.ports[pr.a]!,
              rp.ports[pr.b]!,
              pr.dir,
            );
            const attempt = await buildAndJudge(row, arc);
            if (attempt.trip !== null) {
              clean.push(attempt.trip);
              served = true;
              break;
            }
            lastFailures = attempt.failures;
          }
          if (!served) rejected.push({ id: row.id, failures: lastFailures });
          continue;
        }
      }
      // ---- heuristic path (flag off, or matrix unavailable)
      const arc = ringArc(
        row,
        origin,
        ((durationTargetS - commutePredS(row)) / Math.max(1, row.duration_s)) * row.distance_m,
      );
      if (arc === null) {
        rejected.push({ id: row.id, failures: ['not_a_ring'] });
        continue;
      }
      const attempt = await buildAndJudge(row, arc);
      if (attempt.trip !== null) {
        clean.push(attempt.trip);
        continue;
      }
      rejected.push({ id: row.id, failures: attempt.failures });
      if (attempt.failures.includes('not_a_loop') && arc.frac < 0.97) {
        candidatesFullRing.push(row);
      }
    } catch {
      rejected.push({ id: row.id, failures: ['build_error'] });
    }
  }
  for (const row of candidatesFullRing) {
    if (outOfTime()) break;
    try {
      const arc = ringArc(row, origin, null); // the FULL ring
      if (arc === null) continue;
      const attempt = await buildAndJudge(row, arc);
      if (attempt.trip !== null) clean.push(attempt.trip);
      else rejected.push({ id: `${row.id}(full)`, failures: attempt.failures });
    } catch {
      /* recorded already at partial-arc */
    }
  }

  if (clean.length === 0) return { trip: null, alternates: [], rejected };
  const err = (t: DriveFirstTrip): number =>
    Math.abs(t.durationS - durationTargetS) / durationTargetS;
  clean.sort(
    (a, b) =>
      (a.tier === 'exact' ? 0 : 1) - (b.tier === 'exact' ? 0 : 1) ||
      err(a) - err(b) ||
      b.core.backroad_share - a.core.backroad_share ||
      b.core.curviness - a.core.curviness ||
      a.metrics.commuteShare - b.metrics.commuteShare ||
      a.core.id.localeCompare(b.core.id),
  );
  const best = clean[0]!;
  // alternates: further clean trips on DISTINCT rings, nearest-duration first
  const alternates: DriveFirstTrip[] = [];
  for (const t of clean.slice(1)) {
    if (alternates.length >= 2) break;
    const dupOfBest = edgeOverlapRatio(t.core.geom_simplified, best.core.geom_simplified) > 0.5;
    const dupOfAlt = alternates.some(
      (a) => edgeOverlapRatio(t.core.geom_simplified, a.core.geom_simplified) > 0.5,
    );
    if (!dupOfBest && !dupOfAlt) alternates.push(t);
  }
  return { trip: best, alternates, rejected };
}
