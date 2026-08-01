/**
 * Candidate generation — the make-or-break module (M3-T06; Protocol §9, Spec §29).
 *
 * Implements the v2-default generator shape (G7 family): isochrone-bounded inputs
 * (Ω came from scope→retrieve), DIRECTIONAL SECTORS for diversity (G2), CURVATURE
 * CLUSTERS for character (G4), POI ANCHORS for requested stops (G5), and for loops
 * a RETURN-SECTOR anchor ≠ outbound sector (L3, the anti-retrace device), waypoints
 * angularly ordered (L4). 100 % deterministic: no RNG, ties broken by id; every
 * waypoint comes from REAL retrieved geometry (segments/spots) — nothing invented.
 *
 * Output is ordered waypoint SETS; routing them is M3-T07/T08's job. Tunables are
 * candidates (N_SECTORS/K_CLUSTERS/…) calibrated at M4 per §21.
 */

import type { LatLng, StopFraction, StopRequest, StopType } from '@shared/types';

import { haversineMeters } from '../../../data/curvature/geometry';

import { STOP_TO_SPOT_TYPE, type CandidateSegment, type CandidateSpot } from './retrieve';

// frozen M4-T12 (was 8): 4 sectors → +0.5 feasible/brief and −6pp med|dur err|
// on the DEV sweep, VAL-validated (eval/reports/params.md)
export const N_SECTORS_DEFAULT = 4;
export const K_CLUSTERS_DEFAULT = 8;
export const N_CANDIDATES_DEFAULT = 20;
/** Greedy cluster absorption radius (m) — segments this close join the seed's cluster. */
export const CLUSTER_RADIUS_M = 2_500;
/** Return anchor sits roughly at this fraction of the cluster distance from
 *  origin. R25-U20 (audit issue #8, loopiness mean 0.26): at 0.6 the single
 *  return anchor DRAWS a wedge by construction — env-swept {0.75, 0.85, 0.95}
 *  before any new code path (cheapest-first per the plan; sweep REFUSED,
 *  BD-92 — loopiness p20 flat, 0.85 traded backroad for AC). */
export const RETURN_ANCHOR_DISTANCE_FRACTION = Number(process.env['RETURN_ANCHOR_FRACTION'] ?? 0.6);

/**
 * R25-U20b — RING seeding (audit issue #8, the generation half BD-62 said the
 * problem always was): a loop seeded as ONE cluster + ONE opposed anchor is a
 * wedge by construction. Ring candidates seed THREE bearing-spread points —
 * the primary cluster's span plus two ANCHOR-POOL points near θ+120° and
 * θ+240° (BD-40's own post-mortem: pools hold clusters in ~2 of 4 sectors, so
 * rings CANNOT be built from clusters — `retrieveAnchorPoints` on-road
 * vertices are the material). No synthetic bearing points: a sparse ring is
 * honestly SKIPPED, never faked. Additive candidates behind RING_SEED
 * (default OFF; byte-identical off state; pre-registered A/B).
 */
export const RING_SEED_ON = process.env['RING_SEED'] === 'on';
/** Ring anchors must sit within this bearing window of their target spoke. */
export const RING_BEARING_WINDOW_DEG = 60;
/** …and within this fraction of the primary cluster's distance (round ring). */
export const RING_DISTANCE_TOLERANCE = 0.45;
/** Ring candidates appended per pool (small — additive, never crowding). */
export const RING_CANDIDATES_MAX = Number(process.env['RING_MAX'] ?? 6);
/** Ring anchors keep this separation from each other and the primary (m). */
export const RING_MIN_SEPARATION_M = 3000;

/**
 * R25-U20b — the FREE pre-routing shape gate: shoelace area of
 * [origin, …waypoints] before any Valhalla call. A candidate whose seed
 * polygon encloses ~nothing routes into an out-and-back sliver no matter what
 * the router does — drop it at zero cost. Threshold is a small fraction of
 * the ideal circle's area for the requested perimeter (fail-safe LOW so only
 * true degenerates die; starvation is the recorded risk, the A/B watches
 * no-route). Flag SHOELACE_GATE, default OFF.
 */
export const SHOELACE_GATE_ON = process.env['SHOELACE_GATE'] === 'on';
export const SHOELACE_MIN_AREA_FRACTION = Number(process.env['SHOELACE_FRACTION'] ?? 0.04);

/** Planar shoelace area (m²) of the polygon origin → pts… → origin. */
export function seedPolygonAreaM2(origin: LatLng, pts: readonly LatLng[]): number {
  const latM = 111_320;
  const lngScale = latM * Math.cos((origin.lat * Math.PI) / 180);
  const ring = [origin, ...pts];
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a.lng * lngScale * (b.lat * latM) - b.lng * lngScale * (a.lat * latM);
  }
  return Math.abs(s / 2);
}

// R16-fix: a DEFENSIVE sanity bound on how far an anchored stop may sit from its
// aim point — the stop-aware repair pass (loop.ts) is what actually keeps stopped
// loops clean (it removes the u-turns/overlaps a detour creates); this cap only
// stops a truly ABSURD anchor (a stop many times the loop's reach away) from
// wasting the candidate pool. Scaled to the loop's target perimeter with a floor
// so short loops can still reach a nearby town. Measured live: coffee/fuel/
// viewpoint stops 1–25 km out all produce clean loops well within this bound; an
// over-cap spot is simply not anchored and coverage discloses it honestly.
export const STOP_DETOUR_FLOOR_M = 10_000;
export const STOP_DETOUR_PERIMETER_FRACTION = 0.3;

export interface WaypointCandidate {
  id: string;
  kind: 'loop' | 'atob';
  /** Ordered intermediate waypoints (origin/destination are NOT included). */
  waypoints: LatLng[];
  /** Outbound sector index (0..nSectors-1). */
  sector: number;
  /** Return sector for loops (≠ sector when an anchor was available). */
  returnSector: number | null;
  clusterId: number | null;
  /** Anchored stops — one entry per included spot, typed + index-tracked
   *  (R16-3; replaces the old type-blind single spotIds). */
  stops: CandidateStop[];
  /** Chained traversal spans (R18-3) — segment identity per forced span so
   *  repair can move/drop spans ATOMICALLY (never leave a dangling endpoint).
   *  start/endIndex point into `waypoints`, maintained like stops[] indices.
   *  Legacy candidates carry []. */
  spans?: CandidateSpanRef[];
  /** Σ length·curviness of the backing cluster — the deterministic rank key. */
  clusterWeight: number;
}

/** One forced traversal span on a chain candidate (R18-3). */
export interface CandidateSpanRef {
  segmentId: string;
  startIndex: number;
  endIndex: number;
  /** R18-4: a user-intent span ("through Forks of the Credit") — repair may
   *  NEVER move or drop it; presentation may only disclose. */
  pinned?: boolean;
  /** R25-U6c: the span's chain value (curviness-priced) — value-aware repair
   *  drops the worst detour-PER-UNIT-VALUE, not the most off-corridor span
   *  (which is systematically the curviest: curvy roads are why you leave
   *  the corridor). Absent → repair treats it as 1 (neutral). */
  value?: number;
}

/** One anchored stop on a candidate (R16-3). waypointIndex points into
 *  WaypointCandidate.waypoints and is maintained through every reorder. */
export interface CandidateStop {
  spotId: string;
  name: string;
  /** DB spot type (CandidateSpot.type — 'coffee' | 'food' | 'fuel' | …). */
  spotType: string;
  /** Request-domain type this stop satisfies (§3.4). */
  requestedType: StopType;
  atFraction: StopFraction | null;
  waypointIndex: number;
}

interface SegmentInfo {
  segment: CandidateSegment;
  centroid: LatLng;
  bearing: number;
  distanceM: number;
  sector: number;
}

interface Cluster {
  id: number;
  members: SegmentInfo[];
  centroid: LatLng;
  sector: number;
  weight: number;
  distanceM: number;
}

/**
 * Country-road class preference (owner round 3 / BD-21): the fun target is the
 * township road and the county lane, not the arterial — main-road sweepers must
 * not outrank them just because they're long. Multiplies curviness·length
 * wherever segments are ranked. Residential/service should never arrive at all
 * (retrieval excludes them); the low factors are defense-in-depth. M4 calibrates.
 */
export function countryClassFactor(highway: string): number {
  if (highway.endsWith('_link')) return 0.15; // ramps are arterial-grade, never country (FB-5)
  switch (highway) {
    case 'unclassified':
      return 1.0;
    case 'tertiary':
      return 0.95;
    case 'secondary':
      return 0.5; // round 4: arterials pushed down further ("even more country")
    case 'primary':
    case 'motorway':
    case 'trunk':
      return 0.15;
    case 'residential':
    case 'service':
    case 'living_street':
      return 0.15;
    default:
      return 0.5; // unknown MINOR tags only (corpus strips links/arterials)
  }
}

/**
 * R24-U1 — de-switchback re-pricing (BD-40 lever, byte-identical OFF).
 *
 * The loop generator historically ranked road MATERIAL on RAW circum-curvature,
 * which rewards tight subdivision/park collectors (switchbacks) that cram many
 * hard turns into few metres — the "weaving into neighbourhoods for pointless
 * curviness" the audit found. Two BOUNDED rank multipliers fix it (never gates —
 * "preferences rank, hard caps starve"):
 *   1. curviness SATURATION min(curviness, CURV_SATURATION): a switchback's absurd
 *      raw curviness (5–8) stops out-scoring a flowing sweeper (curviness ~2–3).
 *   2. FLOW factor from significant_turns_per_km: clamp(τ_ref / max(τ, τ_ref), floor, 1)
 *      — a road with more hard turns/km than a flowing road warrants is discounted.
 *
 * Corpus-calibrated (moderate good drives ≈ 3 turns/km, p80 ≈ 6; switchbacks
 * curv>4 ≈ 13–21). τ_ref = 8, ADOPTED over 6 by the 48-brief A/B: τ_ref=6
 * over-penalized the fine 6–8 turns/km roads (urban UP vs baseline); τ_ref=8 keeps
 * every flowing road at full value and still discounts real switchbacks to
 * ~0.38–0.62, giving AC 16→20, urban DOWN below baseline, curvy up, microloops
 * 4→3. Discover does the same (DISCOVER_CURV_SATURATION).
 */
// BD-40: committed default ON at τ_ref=8 (R24-U1 adopt decision); CURV_SATURATION=off
// forces the byte-identical legacy baseline for the A/B (COSTING_MODE precedent), and
// CURV_TURN_REF overrides τ_ref for the parameter sweep.
export const CURV_SATURATION_ON = process.env['CURV_SATURATION'] !== 'off';
export const CURV_SATURATION = 3.0;
export const TURN_REF_PER_KM = Number(process.env['CURV_TURN_REF'] ?? 8.0);
export const FLOW_FACTOR_FLOOR = 0.3;

/** τ-density flow multiplier in [FLOW_FACTOR_FLOOR, 1]; fail-open (missing/low τ => 1). */
export function flowFactor(seg: CandidateSegment): number {
  const t = seg.significantTurnsPerKm;
  if (t === undefined || !Number.isFinite(t) || t <= TURN_REF_PER_KM) return 1;
  return Math.max(FLOW_FACTOR_FLOOR, TURN_REF_PER_KM / t);
}

/** Re-priced curviness used wherever road material is ranked. OFF => raw curviness. */
export function effectiveCurviness(seg: CandidateSegment): number {
  if (!CURV_SATURATION_ON) return seg.curviness;
  return Math.min(seg.curviness, CURV_SATURATION) * flowFactor(seg);
}

/** Deterministic rank value of a segment: curviness · length · class factor. */
/**
 * R26-A3 — the value function that can CHOOSE a country road.
 *
 * The legacy form is MULTIPLICATIVE in curviness, so a straight concession road
 * (curvature ~0.10, the class the owner keeps asking for) scores ~0 and can
 * never become a waypoint even once retrieval admits it (BD-97 gate 3). Under
 * COUNTRY_VALUE the shape becomes BASE + BONUS: class × length × rural-context
 * carries the base, and curviness adds a bounded multiplier on top. A twisty
 * road still beats an equally long straight one by up to (1 + COUNTRY_CURV_GAIN)×
 * — the ranking still prefers fun, it just stops scoring "country but straight"
 * as literally worthless.
 *
 * Deliberately a SHAPE change, not a scalar weight (BD-39 disproved scalars):
 * there is no new tunable in the scoring vector, and the curvature term keeps
 * the R24 de-switchback flow factor. OFF ⇒ byte-identical legacy value.
 */
/**
 * R27: DEFAULT FLIPPED TO OFF. audit-v13 measured 47/60 loops driving a stretch
 * of road twice. Root cause traced here: the `1 +` floor in the curvature bonus
 * collapses curvature's dynamic range over the band retrieval actually sees
 * (~8.6x -> ~2.4x), so LENGTH dominates segValue; `byValue[0]` then becomes a
 * FORCED end-to-end traversal span, and the longest country road gets driven to
 * its end and back. Retrieval admission (COUNTRY_TIER) was never the defect and
 * stays ON — BD-97's diagnosis holds; BD-98's value function does not.
 */
export const COUNTRY_VALUE_ON = (process.env['COUNTRY_VALUE'] ?? 'off') !== 'off'; // R26-A3 ADOPTED (BD-98)
/** How much a maximally-curvy road outscores an equally long straight one. */
export const COUNTRY_CURV_GAIN = Number(process.env['COUNTRY_CURV_GAIN'] ?? 2.0);
/** Curviness at which the bonus saturates (mirrors CURV_SATURATION intent). */
export const COUNTRY_CURV_REF = 3.0;

/** R26-A3 test seam: the value shape, callable with the flag forced either way
 *  so the OFF-identity and the base+bonus behaviour are both pinned. */
export function segValueOf(seg: CandidateSegment, countryValue: boolean): number {
  const ruralContext = 1 - 0.7 * (seg.urbanShare ?? 0);
  if (countryValue) {
    const curvBonus =
      1 + COUNTRY_CURV_GAIN * Math.min(1, effectiveCurviness(seg) / COUNTRY_CURV_REF);
    return seg.lengthM * countryClassFactor(seg.highway) * ruralContext * curvBonus;
  }
  return effectiveCurviness(seg) * seg.lengthM * countryClassFactor(seg.highway) * ruralContext;
}

function segValue(seg: CandidateSegment): number {
  // R19: town-context material is LAST-RESORT (refilled only when the area is
  // thin) — a curvy subdivision collector must never outrank a country road.
  // R24: effectiveCurviness saturates + flow-discounts switchbacks (OFF = raw).
  return segValueOf(seg, COUNTRY_VALUE_ON);
}

/**
 * Duration-resize support (owner round 3): when a routed pool's median duration
 * misses the target badly, the sizing speed was wrong for this terrain/costing —
 * scale it by the observed miss (clamped to sane driving speeds) and regenerate.
 */
export function resizedSpeed(avgSpeedKmh: number, targetS: number, medianRoutedS: number): number {
  if (medianRoutedS <= 0 || targetS <= 0) return avgSpeedKmh;
  // floor 15, not 25: dense/no-highway origins (Hamilton, Grimsby) need SIZING
  // speeds below any real driving speed — this is a cluster-distance knob, and
  // the 25 floor left their resized pools still 1.8× over target (36-brief run)
  return Math.min(90, Math.max(15, (avgSpeedKmh * targetS) / medianRoutedS));
}

function centroidOf(seg: CandidateSegment): LatLng {
  const coords = seg.geometry.coordinates;
  let lat = 0;
  let lng = 0;
  for (const [x, y] of coords) {
    lng += x;
    lat += y;
  }
  return { lat: lat / coords.length, lng: lng / coords.length };
}

/** Compass bearing origin→p in degrees [0, 360). */
export function bearingDeg(origin: LatLng, p: LatLng): number {
  const d2r = Math.PI / 180;
  const dLng = (p.lng - origin.lng) * d2r * Math.cos(((origin.lat + p.lat) / 2) * d2r);
  const dLat = (p.lat - origin.lat) * d2r;
  const deg = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function sectorOf(bearing: number, nSectors: number): number {
  return Math.floor((bearing / 360) * nSectors) % nSectors;
}

function distM(a: LatLng, b: LatLng): number {
  return haversineMeters([a.lng, a.lat], [b.lng, b.lat]);
}

/** Deterministic greedy clustering: seeds = most-curvy unassigned segments. */
export function clusterSegments(
  infos: SegmentInfo[],
  kClusters: number,
  radiusM: number = CLUSTER_RADIUS_M,
): Cluster[] {
  const byWeight = [...infos].sort((a, b) => {
    return segValue(b.segment) - segValue(a.segment) || a.segment.id.localeCompare(b.segment.id);
  });
  const assigned = new Set<string>();
  const clusters: Cluster[] = [];

  for (const seed of byWeight) {
    if (clusters.length >= kClusters) break;
    if (assigned.has(seed.segment.id)) continue;
    const members = byWeight.filter(
      (i) => !assigned.has(i.segment.id) && distM(i.centroid, seed.centroid) <= radiusM,
    );
    for (const m of members) assigned.add(m.segment.id);
    const weight = members.reduce((s, m) => s + segValue(m.segment), 0);
    const cLat = members.reduce((s, m) => s + m.centroid.lat, 0) / members.length;
    const cLng = members.reduce((s, m) => s + m.centroid.lng, 0) / members.length;
    clusters.push({
      id: clusters.length,
      members,
      centroid: { lat: cLat, lng: cLng },
      sector: seed.sector,
      weight,
      distanceM: seed.distanceM,
    });
  }
  return clusters;
}

/** Vertex nearest a cumulative-length fraction along the segment — a real
 *  on-road point (owner round 2: off-road points snap badly). Module-scope +
 *  exported since R18-3 (the chain generator and pinned spans reuse it). */
export function vertexAt(seg: CandidateSegment, fraction: number): LatLng {
  const coords = seg.geometry.coordinates;
  let total = 0;
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1]! as [number, number], coords[i]! as [number, number]);
    cum.push(total);
  }
  const target = total * fraction;
  let bestIdx = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < cum.length; i++) {
    const d = Math.abs(cum[i]! - target);
    if (d < bestDelta) {
      bestDelta = d;
      bestIdx = i;
    }
  }
  const [lng, lat] = coords[bestIdx]!;
  return { lat, lng };
}

/**
 * Traversal span: INSET vertices (~12 % / 88 % along the road), NOT the tips
 * (owner round 5: forcing the literal end vertex made routes drive to the tip
 * and double back — the "enter and spin right back" spurs). The twisty middle
 * is still fully driven; the ends flex to natural junctions.
 */
export const TRAVERSAL_INSET = 0.12;
export function traversalSpanOf(seg: CandidateSegment): [LatLng, LatLng] {
  return [vertexAt(seg, TRAVERSAL_INSET), vertexAt(seg, 1 - TRAVERSAL_INSET)];
}

/**
 * Short segments get ONE touch at a tip. Mid-vertex touches were tried
 * (round 5) and CAUSED the very retraces they aimed to prevent (self_overlap
 * rejections exploded, pools collapsed 19→2). A tip touch just clips the corner.
 */
export function tipOf(seg: CandidateSegment): LatLng {
  return vertexAt(seg, 0);
}

export interface GenerateOptions {
  nCandidates?: number;
  nSectors?: number;
  kClusters?: number;
  /** The effective stop requests to anchor (R16-3): one spot per requested
   *  type/count where data allows, typed + fraction-aimed. Empty/omitted = no
   *  anchoring. */
  stopRequests?: readonly StopRequest[];
  /** A→B: the destination (required for kind 'atob'). */
  destination?: LatLng;
  /** Loop duration target (s) — sizes cluster choice to the budget (SPK-15 fix). */
  durationS?: number;
  /** Assumed average speed for sizing (km/h; M4 calibrates). */
  avgSpeedKmh?: number;
  /** Round 12 (generation density): add cluster TRIPLES on rich budgets so
   *  three country corridors pin the loop and less connector length is left
   *  to the router's arterial preference. rq12 A/B decides the default. */
  tripleClusters?: boolean;
  /** R25-U20b test seams (call sites use the env flags). */
  ringSeed?: boolean;
  shoelaceGate?: boolean;
  /** R22-1b — the TWISTY generation lever ("prefer the twistiest roads"): rank
   *  clusters + the within-cluster driven road by CURVINESS instead of weight
   *  (curviness × length). The default seeks the most backroad-km; twisty seeks
   *  the twistiest road that still fits the budget. undefined/false → weight
   *  (byte-identical to the default generator). */
  curvyRank?: boolean;
  /**
   * Return-anchor pool: road points of ANY curviness (SPK-15 run 7 — ordinary
   * parallel roads fix band-topology retrace). Falls back to curvy-segment
   * centroids when absent, synthetic bearing points as last resort.
   */
  anchorPoints?: LatLng[];
  /** Candidate-id prefix — keeps ids collision-free when passes merge (resize). */
  idPrefix?: string;
  /** R18-4 location intents — "through <road>": whole-road segments whose
   *  traversal span is FORCED into every candidate (pinned span record;
   *  repair-immune). */
  pinnedSpans?: readonly CandidateSegment[];
  /** R18-4 — "near <town>": points forced into every candidate's sweep
   *  (caller anchor-snaps; never raw off-road centroids — round-2 lesson). */
  pinnedPoints?: readonly LatLng[];
}

/**
 * Duration fit of a cluster (SPK-15 finding): a loop through a cluster at distance
 * d runs ≈ LOOP_LENGTH_FACTOR·d total; the best cluster distance for target T* is
 * d* ≈ (T*·v)/LOOP_LENGTH_FACTOR. Fit decays linearly to 0 at ±100 % off d*.
 *
 * 2.4 was fit to the centroid-waypoint/highway-connector era; under BD-21
 * (end-to-end traversal forcing + use_highways 0.25 country connectors) the
 * 36-brief report showed first-pass durations at a consistent ~2.0× target
 * (ratios 1.4–2.9) — the same cluster distance now buys twice the driving.
 * 4.8 recentres the model; the resize retry absorbs per-terrain residuals.
 * M4 calibrates properly.
 */
export const LOOP_LENGTH_FACTOR = 4.8;

/**
 * R21-5 best-material floor (the "same-subdivision lottery" fix). The duration
 * BAND drops a cluster whose predicted loop duration falls outside [0.75, 1.5]·T
 * — but predictedS uses `distanceM`, which is ORIGIN-DEPENDENT, while a cluster's
 * `weight` (Σ segValue) is ORIGIN-INVARIANT. So the region's premier driving
 * area survives the band for a nearby origin (everyone there converges on it —
 * CORRECT) yet gets dropped for a ~1 km-farther neighbour, who then falls back
 * to suburbia — the audit's #7 "1 km apart = opposite drives". Fix: ALWAYS admit
 * the top-N clusters by weight as candidates, exempt from the band drop, so the
 * best material is on the menu for every origin (consistency, not variety —
 * owner's call). Duration is still controlled downstream: the re-admitted far
 * cluster is ranked by weight×durationFitFactor, then duration-prefiltered and
 * resized, so it only WINS where it genuinely fits. 0 = off (byte-identical).
 * Sized at 1 (not 2): the single premier cluster is the lottery fix, and +2
 * cost +58 % wall-time (candidate×chaining blowup) — pushing the canonical
 * e2e brief over the 25 s budget. 1 keeps the AC gain at ~half the latency.
 */
export const BEST_MATERIAL_FLOOR = 1;

/**
 * Minimum segment length to DRIVE end-to-end (traversal span). Shorter roads
 * get a single-tip touch — forcing both ends of a short spur demands a turn-back
 * (u-turn geometry, owner round 2/4). Hoisted to module scope (R22-1b) so the
 * twisty cluster ranker prefers twisty roads that are long enough to traverse.
 */
export const TRAVERSE_MIN_M = 1_200;

function durationFitFactor(clusterDistM: number, durationS?: number, avgSpeedKmh = 55): number {
  if (!durationS) return 1;
  const targetLoopM = (durationS / 3600) * avgSpeedKmh * 1000;
  const idealDistM = targetLoopM / LOOP_LENGTH_FACTOR;
  if (idealDistM <= 0) return 1;
  return Math.max(0.05, 1 - Math.abs(clusterDistM - idealDistM) / idealDistM);
}

/**
 * Generate loop waypoint candidates: per cluster × return-sector combinations,
 * angularly ordered, POI-anchored where available.
 */
export function generateLoopCandidates(
  origin: LatLng,
  segments: CandidateSegment[],
  spots: CandidateSpot[],
  options: GenerateOptions = {},
): WaypointCandidate[] {
  const nSectors = options.nSectors ?? N_SECTORS_DEFAULT;
  const kClusters = options.kClusters ?? K_CLUSTERS_DEFAULT;
  const nCandidates = options.nCandidates ?? N_CANDIDATES_DEFAULT;
  const pfx = options.idPrefix ?? '';

  // R16-fix: max distance an anchored stop may sit from its aim point, scaled to
  // the loop's target perimeter (same model as durationFitFactor) with a floor.
  const targetLoopM = ((options.durationS ?? 5400) / 3600) * (options.avgSpeedKmh ?? 55) * 1000;
  const maxStopDetourM = Math.max(
    STOP_DETOUR_FLOOR_M,
    STOP_DETOUR_PERIMETER_FRACTION * targetLoopM,
  );

  // Waypoint material NEVER includes residential fragments (owner rounds 2+3:
  // crescents/courts made waypoints in-and-out neighbourhood spurs). No sparse
  // fallback — a thin pool must not readmit subdivision streets; retrieval
  // excludes the class upstream anyway (BD-21), this is defense-in-depth.
  const allInfos: SegmentInfo[] = segments.map((segment) => {
    const centroid = centroidOf(segment);
    const bearing = bearingDeg(origin, centroid);
    return {
      segment,
      centroid,
      bearing,
      distanceM: distM(origin, centroid),
      sector: sectorOf(bearing, nSectors),
    };
  });
  const infos = allInfos.filter((i) => i.segment.highway !== 'residential');

  const clusters = clusterSegments(infos, kClusters);

  // R22-1b twisty lever: a CURVATURE-EMPHASIZED weight — Σ curviness²·length·class
  // vs the default Σ curviness·length·class. Keeps curvy-KM (the loop needs curvy
  // CONTENT, not one twisty road amid flat connectors — the mistake pure
  // max-curviness made: it dropped the route MEAN and spawned u-turns) but tilts
  // toward CURVIER roads over merely-longer ones. Off → weight, byte-identical.
  // Duration still governs via durationFitFactor below.
  const clusterEmph = (c: Cluster): number =>
    c.members.reduce((s, m) => s + effectiveCurviness(m.segment) * segValue(m.segment), 0);
  const rankVal = (c: Cluster): number => (options.curvyRank === true ? clusterEmph(c) : c.weight);

  // HARD duration-plausibility filter (owner round 3 / BD-21): the old
  // weight×fit RANKING could not control durations — round 1 emits one
  // candidate per cluster regardless of rank, and cluster weights are
  // heavy-tailed (a monster far escarpment band at fit 0.05 still beat a
  // modest right-distance cluster; 36-brief medians sat at ~2× target with
  // the fit factor changing nothing). Predicted loop duration = LLF·d/v;
  // clusters missing the target by >50 % are OUT. Floor: keep the 3
  // best-fitting when the band would leave fewer (material-poor areas).
  // Band is ASYMMETRIC [0.75, 1.5]·T (round 4: "routes stay inside cities") —
  // too-close clusters are dropped harder than too-far ones, so loops must
  // LEAVE town for their curvy material and come back.
  let usable = clusters;
  if (options.durationS) {
    const targetS = options.durationS;
    const vMs = (options.avgSpeedKmh ?? 55) / 3.6;
    const predictedS = (c: Cluster) => (LOOP_LENGTH_FACTOR * c.distanceM) / vMs;
    const predictedErr = (c: Cluster) => Math.abs(predictedS(c) - targetS) / targetS;
    const inBand = clusters.filter((c) => {
      const p = predictedS(c);
      return p >= 0.75 * targetS && p <= 1.5 * targetS;
    });
    const banded =
      inBand.length >= 3
        ? inBand
        : [...clusters]
            .sort((a, b) => predictedErr(a) - predictedErr(b) || a.id - b.id)
            .slice(0, 3);
    // R21-5: always keep the region's best MATERIAL on the menu (weight is
    // origin-invariant), so a farther-out neighbour isn't dropped from the
    // premier cluster the band admits for a closer one. 0 → byte-identical.
    const topByWeight = [...clusters]
      .sort((a, b) => rankVal(b) - rankVal(a) || a.id - b.id)
      .slice(0, BEST_MATERIAL_FLOOR);
    const seen = new Set(banded.map((c) => c.id));
    usable = [...banded, ...topByWeight.filter((c) => !seen.has(c.id))];
  }

  // rank clusters: duration-sized weight desc (SPK-15: cluster distance must fit
  // the budget), then id — round-robin across sectors so the presented set spans
  // ≥3 sectors even when one sector dominates (§9 diversity)
  const sized = (c: Cluster) =>
    rankVal(c) * durationFitFactor(c.distanceM, options.durationS, options.avgSpeedKmh);
  const bySector = new Map<number, Cluster[]>();
  for (const c of usable.sort((a, b) => sized(b) - sized(a) || a.id - b.id)) {
    const list = bySector.get(c.sector) ?? [];
    list.push(c);
    bySector.set(c.sector, list);
  }
  const sectorOrder = [...bySector.keys()].sort((a, b) => a - b);
  const roundRobin: Cluster[] = [];
  for (let round = 0; roundRobin.length < usable.length; round++) {
    for (const s of sectorOrder) {
      const c = bySector.get(s)![round];
      if (c) roundRobin.push(c);
    }
  }

  const candidates: WaypointCandidate[] = [];
  const halfTurn = Math.floor(nSectors / 2);
  const sectorDist = (a: number, b: number) => {
    const d = Math.abs(a - b) % nSectors;
    return Math.min(d, nSectors - d);
  };

  // Return-anchor pool (SPK-15 run 7): ANY-curviness road points when provided
  // (ordinary parallel roads — fixes band-topology retrace where all θ≥0.6 roads
  // form one band and out/return collapsed onto it), else curvy-segment centroids
  // (unit-test/back-compat path). Synthetic bearing point (Valhalla-snapped) as
  // the last resort. Deterministic throughout.
  const anchorPool: Array<{ centroid: LatLng; sector: number; distanceM: number; key: string }> =
    options.anchorPoints && options.anchorPoints.length > 0
      ? options.anchorPoints.map((p, i) => ({
          centroid: p,
          sector: sectorOf(bearingDeg(origin, p), nSectors),
          distanceM: distM(origin, p),
          key: `ap${i}`,
        }))
      : infos.map((i) => ({
          centroid: i.centroid,
          sector: i.sector,
          distanceM: i.distanceM,
          key: i.segment.id,
        }));

  const pickAnchor = (
    outboundSector: number,
    returnSector: number,
    targetDist: number,
  ): { centroid: LatLng; sector: number } => {
    const inSector = anchorPool.filter((a) => a.sector === returnSector);
    const pool =
      inSector.length > 0
        ? inSector
        : anchorPool.filter((a) => sectorDist(a.sector, outboundSector) >= 2);
    const found = pool.sort(
      (a, b) =>
        Math.abs(a.distanceM - targetDist) - Math.abs(b.distanceM - targetDist) ||
        a.key.localeCompare(b.key),
    )[0];
    if (found && found.sector !== outboundSector) {
      return { centroid: found.centroid, sector: found.sector };
    }
    const d2r = Math.PI / 180;
    const bearing = ((returnSector + 0.5) * 360) / nSectors;
    const distKm = (targetDist / 1000) * 1; // already fractioned by the caller
    return {
      centroid: {
        lat: origin.lat + (distKm / 111.32) * Math.cos(bearing * d2r),
        lng:
          origin.lng + ((distKm / 111.32) * Math.sin(bearing * d2r)) / Math.cos(origin.lat * d2r),
      },
      sector: returnSector,
    };
  };

  // R16-3: per-type, per-unit anchoring. A request expands into units
  // (count copies); each unit gets the nearest UNUSED spot of ITS type.
  const nearestOfType = (
    dbType: string | null,
    target: LatLng,
    used: Set<string>,
    maxDetourM?: number,
  ): CandidateSpot | null => {
    if (dbType === null || spots.length === 0) return null;
    return (
      [...spots]
        .filter(
          (sp) =>
            sp.type === dbType &&
            !used.has(sp.id) &&
            // R16-fix: reject a spot too far from the aim to keep the loop sane
            (maxDetourM === undefined || distM({ lat: sp.lat, lng: sp.lng }, target) <= maxDetourM),
        )
        .sort(
          (a, b) =>
            distM({ lat: a.lat, lng: a.lng }, target) - distM({ lat: b.lat, lng: b.lng }, target) ||
            a.id.localeCompare(b.id),
        )[0] ?? null
    );
  };

  interface StopUnit {
    requestedType: StopType;
    dbType: string | null;
    atFraction: StopFraction | null;
  }
  const stopUnits = (): { anytime: StopUnit[]; fraction: StopUnit[] } => {
    const anytime: StopUnit[] = [];
    const fraction: StopUnit[] = [];
    for (const r of options.stopRequests ?? []) {
      for (let u = 0; u < r.count; u++) {
        const unit: StopUnit = {
          requestedType: r.type,
          dbType: STOP_TO_SPOT_TYPE[r.type],
          atFraction: r.at_fraction,
        };
        (r.at_fraction === null ? anytime : fraction).push(unit);
      }
    }
    // fraction units placed ascending so earlier insertions keep later slots stable
    fraction.sort((a, b) => (a.atFraction ?? 0) - (b.atFraction ?? 0));
    return { anytime, fraction };
  };

  // NOTE (SPK-15 run 14, tried + REVERTED): keying the return-anchor distance to
  // the duration budget forced every candidate onto the same far ring — curviness
  // collapsed ~35 % and self-overlap rejections exploded. Cluster-keyed anchors
  // stay; the multi-cluster-chains lever became R18-3's chain generator.
  // (vertexAt/traversalSpanOf/tipOf were hoisted to module scope for chain.ts.)

  const makeCandidate = (
    id: string,
    primary: Cluster,
    extraClusters: readonly Cluster[],
    returnSector: number,
    ringPoints?: readonly LatLng[], // R25-U20b: replace the single return anchor
  ): WaypointCandidate => {
    // TRAVERSAL waypoints: both endpoints of the cluster's best segment — the
    // route must DRIVE the twisty road, not pass near its midpoint. A second
    // strong member (≥800 m away) adds one more on-road traversal point.
    const byValue = [...primary.members].sort((a, b) => {
      if (options.curvyRank === true) {
        // R22-1b twisty: drive the curviest·longest road (curvature-emphasized —
        // curviness²·length keeps a traversable road preferred over a short spur).
        return (
          effectiveCurviness(b.segment) * segValue(b.segment) -
            effectiveCurviness(a.segment) * segValue(a.segment) ||
          a.segment.id.localeCompare(b.segment.id)
        );
      }
      return segValue(b.segment) - segValue(a.segment) || a.segment.id.localeCompare(b.segment.id);
    });
    const best = byValue[0]!;
    const [bestA, bestB] = traversalSpanOf(best.segment);
    // Full spans only for LONG segments — forcing both ends of a short spur
    // demands a turn-back against the sweep (u-turn geometry, owner round 2).
    // Threshold 1.5→1.2 km (round 4): more forced curvy-road km per loop — the
    // anti-"square" lever, since connectors are straight concession grid.
    const traverseBest = best.segment.lengthM >= TRAVERSE_MIN_M; // module const (R22-1b)
    const second = byValue.find((m) => distM(m.centroid, best.centroid) > 800);

    const anchor = pickAnchor(
      primary.sector,
      returnSector,
      primary.distanceM * RETURN_ANCHOR_DISTANCE_FRACTION,
    );

    const wps: LatLng[] = traverseBest ? [bestA, bestB] : [tipOf(best.segment)];
    const budgetS = options.durationS ?? 5400;
    if (second) {
      // round 4: traverse the SECOND road end-to-end too — but only on budgets
      // ≥ 75 min; on 45–60 min loops the extra traversal is a big fraction of
      // the whole drive and blew durations +31…+38 % (measured).
      const richBudget = budgetS >= 4500;
      if (second.segment.lengthM >= TRAVERSE_MIN_M && richBudget) {
        wps.push(...traversalSpanOf(second.segment));
      } else {
        wps.push(tipOf(second.segment));
      }
      // round 5, tried + REVERTED: chaining a THIRD member on ≥90 min budgets
      // over-constrained the path — self-overlap rejections spiked and clean
      // survivors were -48 % undershoots. Twistiness comes from the curv
      // weight + two full spans; richer chaining is an M4 candidate with
      // pool-health guards.
    }
    for (const extraCluster of extraClusters) {
      const extraBest = [...extraCluster.members].sort((a, b) => {
        return (
          segValue(b.segment) - segValue(a.segment) || a.segment.id.localeCompare(b.segment.id)
        );
      })[0]!;
      if (extraBest.segment.lengthM >= TRAVERSE_MIN_M) {
        wps.push(...traversalSpanOf(extraBest.segment));
      } else {
        wps.push(tipOf(extraBest.segment));
      }
    }
    // --- R16-3 stop anchoring: typed units, anytime + fraction-aimed ---
    const { anytime, fraction } = stopUnits();
    const used = new Set<string>();
    const stops: CandidateStop[] = [];

    // anytime units join the angular sweep like any other point (L4 preserved)
    interface Tagged {
      p: LatLng;
      stop?: Omit<CandidateStop, 'waypointIndex'>;
      /** R18-4 pinned-span membership ("through <road>"). */
      pin?: { segmentId: string; role: 'entry' | 'exit' | 'point' };
    }
    const tagged: Tagged[] = wps.map((p) => ({ p }));
    // R18-4 location intents: pinned roads join EVERY candidate as traversal
    // spans (repair-immune, span-recorded); pinned town points join the sweep.
    for (const seg of options.pinnedSpans ?? []) {
      if (seg.lengthM >= TRAVERSE_MIN_M) {
        const [pa, pb] = traversalSpanOf(seg);
        tagged.push({ p: pa, pin: { segmentId: seg.id, role: 'entry' } });
        tagged.push({ p: pb, pin: { segmentId: seg.id, role: 'exit' } });
      } else {
        tagged.push({ p: tipOf(seg), pin: { segmentId: seg.id, role: 'point' } });
      }
    }
    for (const p of options.pinnedPoints ?? []) tagged.push({ p });
    for (const unit of anytime) {
      const sp = nearestOfType(unit.dbType, primary.centroid, used, maxStopDetourM);
      if (!sp) continue; // unfillable (or too far): coverage records the shortfall honestly
      used.add(sp.id);
      tagged.push({
        p: { lat: sp.lat, lng: sp.lng },
        stop: {
          spotId: sp.id,
          name: sp.name,
          spotType: sp.type,
          requestedType: unit.requestedType,
          atFraction: null,
        },
      });
    }
    // R25-U20b ring candidates carry their own spread — the single return
    // anchor (the wedge-drawing geometry) is replaced by the ring points
    if (ringPoints && ringPoints.length > 0) {
      for (const p of ringPoints) tagged.push({ p });
    } else {
      tagged.push({ p: anchor.centroid });
    }

    // angular order around the origin (L4) so the loop sweeps one way round
    // (stable sort — equal bearings keep push order; determinism holds)
    const orderedTagged = tagged
      .map((t) => ({ t, b: bearingDeg(origin, t.p) }))
      .sort((a, b) => {
        const rot = (x: number) => (x - (primary.sector * 360) / nSectors + 360) % 360;
        return rot(a.b) - rot(b.b);
      })
      .map(({ t }) => t);
    const orderedPts: LatLng[] = orderedTagged.map((t) => t.p);
    orderedTagged.forEach((t, i) => {
      if (t.stop) stops.push({ ...t.stop, waypointIndex: i });
    });
    // pinned-span records (R18-4): indices into the ordered sweep, maintained
    // through the fraction-stop insertions below exactly like stop indices
    const spans: CandidateSpanRef[] = [];
    {
      const bySeg = new Map<string, { lo?: number; hi?: number }>();
      orderedTagged.forEach((t, i) => {
        if (!t.pin) return;
        const rec = bySeg.get(t.pin.segmentId) ?? {};
        if (t.pin.role === 'exit') rec.hi = i;
        else rec.lo = i;
        bySeg.set(t.pin.segmentId, rec);
      });
      for (const [segmentId, r] of bySeg) {
        const a = r.lo ?? r.hi!;
        const b = r.hi ?? r.lo!;
        spans.push({
          segmentId,
          startIndex: Math.min(a, b),
          endIndex: Math.max(a, b),
          pinned: true,
        });
      }
    }

    // fraction units: insert AFTER the sweep at sequence-position ≈ fraction.
    // Drive sequence = [origin, ...O, origin]: arrival at O[i] ≈ (i+1)/(n+1);
    // slot s = floor(f·(n+1)) puts the stop ≈ f of the way round. The spot is
    // chosen nearest the slot's bracketing vertices so the sweep is preserved;
    // genuine sweep breaks die in the assembly gates (overlap/spur/u-turn).
    for (const unit of fraction) {
      const n = orderedPts.length;
      const f = unit.atFraction ?? 0.5;
      const slot = Math.min(n, Math.max(0, Math.floor(f * (n + 1))));
      const before = slot === 0 ? origin : orderedPts[slot - 1]!;
      const after = slot >= n ? origin : orderedPts[slot]!;
      const aim: LatLng = {
        lat: (before.lat + after.lat) / 2,
        lng: (before.lng + after.lng) / 2,
      };
      const sp = nearestOfType(unit.dbType, aim, used, maxStopDetourM);
      if (!sp) continue;
      used.add(sp.id);
      orderedPts.splice(slot, 0, { lat: sp.lat, lng: sp.lng });
      for (const st of stops) if (st.waypointIndex >= slot) st.waypointIndex += 1;
      for (const sp2 of spans) {
        if (sp2.startIndex >= slot) sp2.startIndex += 1;
        if (sp2.endIndex >= slot) sp2.endIndex += 1;
      }
      stops.push({
        spotId: sp.id,
        name: sp.name,
        spotType: sp.type,
        requestedType: unit.requestedType,
        atFraction: unit.atFraction,
        waypointIndex: slot,
      });
    }

    return {
      id,
      kind: 'loop',
      waypoints: orderedPts,
      sector: primary.sector,
      returnSector,
      clusterId: primary.id,
      stops,
      // legacy candidates stay shape-identical (spans omitted) when no pins
      ...(spans.length > 0 ? { spans } : {}),
      clusterWeight: primary.weight + extraClusters.reduce((s, c) => s + c.weight, 0),
    };
  };

  // ROUND 1 — one candidate per cluster (distinct outbound corridors survive
  // dedup; SPK-15 run 7: 3 return-variants per cluster collapsed to ~1 kept).
  for (const cluster of roundRobin) {
    if (candidates.length >= nCandidates) break;
    const returnSector = (cluster.sector + halfTurn) % nSectors;
    candidates.push(
      makeCandidate(`${pfx}loop-c${cluster.id}-r${returnSector}`, cluster, [], returnSector),
    );
  }

  // ROUND 2 — cluster pairs in nearby-but-different sectors (chained corridors:
  // new distinct shapes + fills long duration budgets).
  for (let i = 0; i < roundRobin.length && candidates.length < nCandidates; i++) {
    for (let j = i + 1; j < roundRobin.length && candidates.length < nCandidates; j++) {
      const a = roundRobin[i]!;
      const b = roundRobin[j]!;
      const sd = sectorDist(a.sector, b.sector);
      if (sd < 1 || sd > 3) continue;
      const returnSector = (Math.max(a.sector, b.sector) + halfTurn) % nSectors;
      candidates.push(makeCandidate(`${pfx}loop-c${a.id}+c${b.id}`, a, [b], returnSector));
    }
  }

  // ROUND 2b (round 12, generation density): cluster TRIPLES on rich budgets —
  // three distinct-sector country corridors pinned around the loop, so less
  // connector length is left to the router's arterial preference. The duration
  // machinery built since round 5 (resize retry + prefilter + ±20 % tolerance)
  // carries the fit that sank the same-cluster third member back then.
  if (options.tripleClusters === true && (options.durationS ?? 5400) >= 5400) {
    for (let i = 0; i < roundRobin.length && candidates.length < nCandidates; i++) {
      for (let j = i + 1; j < roundRobin.length && candidates.length < nCandidates; j++) {
        for (let k = j + 1; k < roundRobin.length && candidates.length < nCandidates; k++) {
          const a = roundRobin[i]!;
          const b = roundRobin[j]!;
          const c = roundRobin[k]!;
          const ab = sectorDist(a.sector, b.sector);
          const bc = sectorDist(b.sector, c.sector);
          // any trio that is not all-in-one-sector (post-M4-T12 pools hold
          // 3-4 clusters across ~2 of the 4 sectors — demanding a 3-sector
          // spread made triples vacuous, probed rq12); assembly's overlap +
          // closure gates judge the actual shapes
          if (ab + bc < 1 || ab > 3 || bc > 3) continue;
          const returnSector = (Math.max(a.sector, b.sector, c.sector) + halfTurn) % nSectors;
          candidates.push(
            makeCandidate(`${pfx}loop-c${a.id}+c${b.id}+c${c.id}`, a, [b, c], returnSector),
          );
        }
      }
    }
  }

  // ROUND 3 — extra return-sector variants for the top clusters.
  outer: for (const cluster of roundRobin) {
    for (const offset of [halfTurn + 1, halfTurn - 1]) {
      if (candidates.length >= nCandidates) break outer;
      const returnSector = (cluster.sector + offset + nSectors) % nSectors;
      const id = `${pfx}loop-c${cluster.id}-r${returnSector}`;
      if (candidates.some((c) => c.id === id)) continue;
      candidates.push(makeCandidate(id, cluster, [], returnSector));
    }
  }

  // ROUND 4 (R25-U20b, flag RING_SEED) — ring candidates: the primary
  // cluster's span + two anchor-pool points near θ+120° / θ+240°, ADDITIVE
  // beyond the nCandidates cap (like chains — never crowding the proven
  // rounds out). A sparse ring is skipped honestly, never synthesized.
  if (options.ringSeed ?? RING_SEED_ON) {
    const angDiff = (a: number, b: number): number => {
      const d = Math.abs(a - b) % 360;
      return Math.min(d, 360 - d);
    };
    const pickRingAnchor = (
      targetBearing: number,
      targetDist: number,
      taken: readonly LatLng[],
    ): LatLng | null => {
      const found = anchorPool
        .filter(
          (a) =>
            angDiff(bearingDeg(origin, a.centroid), (targetBearing + 360) % 360) <=
              RING_BEARING_WINDOW_DEG / 2 &&
            Math.abs(a.distanceM - targetDist) <= RING_DISTANCE_TOLERANCE * targetDist &&
            taken.every((t) => distM(t, a.centroid) >= RING_MIN_SEPARATION_M),
        )
        .sort(
          (x, y) =>
            angDiff(bearingDeg(origin, x.centroid), (targetBearing + 360) % 360) -
              angDiff(bearingDeg(origin, y.centroid), (targetBearing + 360) % 360) ||
            Math.abs(x.distanceM - targetDist) - Math.abs(y.distanceM - targetDist) ||
            x.key.localeCompare(y.key),
        )[0];
      return found ? found.centroid : null;
    };
    let ringBudget = RING_CANDIDATES_MAX;
    for (const cluster of roundRobin) {
      if (ringBudget <= 0) break;
      const b0 = bearingDeg(origin, cluster.centroid);
      const p1 = pickRingAnchor(b0 + 120, cluster.distanceM, [cluster.centroid]);
      if (p1 === null) continue;
      const p2 = pickRingAnchor(b0 + 240, cluster.distanceM, [cluster.centroid, p1]);
      if (p2 === null) continue;
      const id = `${pfx}loop-c${cluster.id}-ring`;
      if (candidates.some((c) => c.id === id)) continue;
      candidates.push(
        makeCandidate(id, cluster, [], (cluster.sector + halfTurn) % nSectors, [p1, p2]),
      );
      ringBudget--;
    }
  }

  // R25-U20b — the free pre-routing shape gate: drop seed polygons that
  // enclose ~nothing (they can only route into slivers). Zero engine cost.
  if (options.shoelaceGate ?? SHOELACE_GATE_ON) {
    const perimeterM = ((options.durationS ?? 5400) / 3600) * (options.avgSpeedKmh ?? 55) * 1000;
    const minAreaM2 = (SHOELACE_MIN_AREA_FRACTION * (perimeterM * perimeterM)) / (4 * Math.PI);
    return candidates.filter((c) => seedPolygonAreaM2(origin, c.waypoints) >= minAreaM2);
  }

  return candidates;
}

/** A→B: curvy clusters near the corridor + requested spots, progress-ordered. */
export function generateAtoBCandidates(
  origin: LatLng,
  destination: LatLng,
  segments: CandidateSegment[],
  spots: CandidateSpot[],
  options: GenerateOptions = {},
): WaypointCandidate[] {
  const nSectors = options.nSectors ?? N_SECTORS_DEFAULT;
  const kClusters = options.kClusters ?? K_CLUSTERS_DEFAULT;
  const nCandidates = options.nCandidates ?? N_CANDIDATES_DEFAULT;
  const directM = distM(origin, destination);

  const infos: SegmentInfo[] = segments.map((segment) => {
    const centroid = centroidOf(segment);
    const bearing = bearingDeg(origin, centroid);
    return {
      segment,
      centroid,
      bearing,
      distanceM: distM(origin, centroid),
      sector: sectorOf(bearing, nSectors),
    };
  });
  const clusters = clusterSegments(infos, kClusters).sort(
    (a, b) => b.weight - a.weight || a.id - b.id,
  );

  /** Progress of p along o→d (0 at origin, 1 at destination). */
  const progress = (p: LatLng) => {
    const od = distM(origin, destination);
    return (distM(origin, p) - distM(destination, p)) / (2 * od) + 0.5;
  };

  const candidates: WaypointCandidate[] = [];
  for (const cluster of clusters) {
    if (candidates.length >= nCandidates) break;
    // corridor sanity: skip clusters that would obviously blow the detour budget
    const via = distM(origin, cluster.centroid) + distM(cluster.centroid, destination);
    if (via > directM * 2.2) continue;

    // R18-3 parity: the candidate DRIVES the cluster's best road — traversal
    // span oriented by corridor progress (entry = smaller progress, monotone)
    // — instead of passing near an off-road cluster centroid (the audit's
    // "A→B forces ONE off-road centroid, ~100 % fastest-path" finding). Short
    // roads become single-point TOUCHES; both carry a span record so repair
    // can act span-atomically.
    const byValue = [...cluster.members].sort(
      (a, b) =>
        segValue(b.segment) - segValue(a.segment) || a.segment.id.localeCompare(b.segment.id),
    );
    const bestSeg = byValue[0]!.segment;
    const fullSpan = bestSeg.lengthM >= 1_200; // mirrors TRAVERSE_MIN_M
    const [pA, pB] = fullSpan
      ? traversalSpanOf(bestSeg)
      : ([tipOf(bestSeg), tipOf(bestSeg)] as [LatLng, LatLng]);
    const spanPts: LatLng[] =
      fullSpan && progress(pA) <= progress(pB) ? [pA, pB] : fullSpan ? [pB, pA] : [pA];
    const spanMid: LatLng = fullSpan
      ? { lat: (pA.lat + pB.lat) / 2, lng: (pA.lng + pB.lng) / 2 }
      : pA;

    // R16-3: per-unit typed anchoring along the corridor. Anytime units take
    // the min-detour spot of their type; fraction units first narrow to spots
    // whose corridor progress best matches f (argmin |progress−f|), then
    // detour, then id. A `used` set keeps two units off the same spot.
    // Units merge by PROGRESS; the span is one ATOMIC unit — a stop can sit
    // before or after it, never between its entry and exit.
    interface CorridorUnit {
      pts: LatLng[];
      prog: number;
      span?: { segmentId: string; pinned?: boolean };
      stop?: Omit<CandidateStop, 'waypointIndex'>;
    }
    const units: CorridorUnit[] = [
      { pts: spanPts, prog: progress(spanMid), span: { segmentId: bestSeg.id } },
    ];
    // R18-4 location intents: pinned roads join as ATOMIC repair-immune span
    // units; pinned town points as plain progress-ordered waypoints.
    for (const seg of options.pinnedSpans ?? []) {
      const full = seg.lengthM >= 1_200;
      const [qA, qB] = full ? traversalSpanOf(seg) : ([tipOf(seg), tipOf(seg)] as [LatLng, LatLng]);
      const pts = full ? (progress(qA) <= progress(qB) ? [qA, qB] : [qB, qA]) : [qA];
      const mid: LatLng = full ? { lat: (qA.lat + qB.lat) / 2, lng: (qA.lng + qB.lng) / 2 } : qA;
      units.push({ pts, prog: progress(mid), span: { segmentId: seg.id, pinned: true } });
    }
    for (const p of options.pinnedPoints ?? []) units.push({ pts: [p], prog: progress(p) });
    const used = new Set<string>();
    const detour = (p: LatLng) => distM(origin, p) + distM(p, destination) - directM;
    for (const r of options.stopRequests ?? []) {
      const dbType = STOP_TO_SPOT_TYPE[r.type];
      if (dbType === null) continue; // no spot corpus: coverage discloses
      for (let u = 0; u < r.count; u++) {
        const pool = spots.filter((sp) => sp.type === dbType && !used.has(sp.id));
        if (pool.length === 0) break;
        const best = pool.sort((a, b) => {
          const pa: LatLng = { lat: a.lat, lng: a.lng };
          const pb: LatLng = { lat: b.lat, lng: b.lng };
          if (r.at_fraction !== null) {
            const fa = Math.abs(progress(pa) - r.at_fraction);
            const fb = Math.abs(progress(pb) - r.at_fraction);
            if (Math.abs(fa - fb) > 1e-9) return fa - fb;
          }
          return detour(pa) - detour(pb) || a.id.localeCompare(b.id);
        })[0]!;
        used.add(best.id);
        units.push({
          pts: [{ lat: best.lat, lng: best.lng }],
          prog: progress({ lat: best.lat, lng: best.lng }),
          stop: {
            spotId: best.id,
            name: best.name,
            spotType: best.type,
            requestedType: r.type,
            atFraction: r.at_fraction,
          },
        });
      }
    }
    units.sort((a, b) => a.prog - b.prog); // progress order (TSP skipped — spans)
    const waypoints: LatLng[] = [];
    const stops: CandidateStop[] = [];
    const spans: CandidateSpanRef[] = [];
    for (const u of units) {
      if (u.span) {
        spans.push({
          segmentId: u.span.segmentId,
          startIndex: waypoints.length,
          endIndex: waypoints.length + u.pts.length - 1,
          ...(u.span.pinned ? { pinned: true } : {}),
        });
      } else if (u.stop) {
        stops.push({ ...u.stop, waypointIndex: waypoints.length });
      }
      waypoints.push(...u.pts);
    }

    candidates.push({
      id: `atob-c${cluster.id}`,
      kind: 'atob',
      waypoints,
      sector: cluster.sector,
      returnSector: null,
      clusterId: cluster.id,
      stops,
      spans,
      clusterWeight: cluster.weight,
    });
  }
  return candidates;
}
