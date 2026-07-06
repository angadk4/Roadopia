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

import type { LatLng } from '@shared/types';

import { haversineMeters } from '../../../data/curvature/geometry';

import type { CandidateSegment, CandidateSpot } from './retrieve';

export const N_SECTORS_DEFAULT = 8;
export const K_CLUSTERS_DEFAULT = 8;
export const N_CANDIDATES_DEFAULT = 20;
/** Greedy cluster absorption radius (m) — segments this close join the seed's cluster. */
export const CLUSTER_RADIUS_M = 2_500;
/** Return anchor sits roughly at this fraction of the cluster distance from origin. */
export const RETURN_ANCHOR_DISTANCE_FRACTION = 0.6;

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
  /** Spot ids anchored into this candidate (real spots only). */
  spotIds: string[];
  /** Σ length·curviness of the backing cluster — the deterministic rank key. */
  clusterWeight: number;
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
  switch (highway) {
    case 'unclassified':
      return 1.0;
    case 'tertiary':
      return 0.95;
    case 'secondary':
      return 0.5; // round 4: arterials pushed down further ("even more country")
    case 'primary':
      return 0.15;
    case 'residential':
    case 'service':
    case 'living_street':
      return 0.15;
    default:
      return 0.5;
  }
}

/** Deterministic rank value of a segment: curviness · length · class factor. */
function segValue(seg: CandidateSegment): number {
  return seg.curviness * seg.lengthM * countryClassFactor(seg.highway);
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

export interface GenerateOptions {
  nCandidates?: number;
  nSectors?: number;
  kClusters?: number;
  /** Whether stop anchoring should be attempted (requested stops exist). */
  anchorSpots?: boolean;
  /** A→B: the destination (required for kind 'atob'). */
  destination?: LatLng;
  /** Loop duration target (s) — sizes cluster choice to the budget (SPK-15 fix). */
  durationS?: number;
  /** Assumed average speed for sizing (km/h; M4 calibrates). */
  avgSpeedKmh?: number;
  /**
   * Return-anchor pool: road points of ANY curviness (SPK-15 run 7 — ordinary
   * parallel roads fix band-topology retrace). Falls back to curvy-segment
   * centroids when absent, synthetic bearing points as last resort.
   */
  anchorPoints?: LatLng[];
  /** Candidate-id prefix — keeps ids collision-free when passes merge (resize). */
  idPrefix?: string;
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
    usable =
      inBand.length >= 3
        ? inBand
        : [...clusters]
            .sort((a, b) => predictedErr(a) - predictedErr(b) || a.id - b.id)
            .slice(0, 3);
  }

  // rank clusters: duration-sized weight desc (SPK-15: cluster distance must fit
  // the budget), then id — round-robin across sectors so the presented set spans
  // ≥3 sectors even when one sector dominates (§9 diversity)
  const sized = (c: Cluster) =>
    c.weight * durationFitFactor(c.distanceM, options.durationS, options.avgSpeedKmh);
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

  const nearestSpotTo = (target: LatLng): CandidateSpot | null => {
    if (!options.anchorSpots || spots.length === 0) return null;
    return [...spots].sort(
      (a, b) =>
        distM({ lat: a.lat, lng: a.lng }, target) - distM({ lat: b.lat, lng: b.lng }, target) ||
        a.id.localeCompare(b.id),
    )[0]!;
  };

  // NOTE (SPK-15 run 14, tried + REVERTED): keying the return-anchor distance to
  // the duration budget forced every candidate onto the same far ring — curviness
  // collapsed ~35 % and self-overlap rejections exploded. Cluster-keyed anchors
  // stay; long-budget-in-dense-area remains an M4 calibration item (multi-cluster
  // chains are the promising lever, not far anchors).
  /** Vertex nearest a cumulative-length fraction along the segment — a real
   *  on-road point (owner round 2: off-road points snap badly). */
  const vertexAt = (seg: CandidateSegment, fraction: number): LatLng => {
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
  };
  /**
   * Traversal span: INSET vertices (~12 % / 88 % along the road), NOT the tips
   * (owner round 5: forcing the literal end vertex made routes drive to the
   * tip and double back when the natural connector leaves earlier — the
   * "enter and spin right back" spurs). The twisty middle is still fully
   * driven; the ends flex to natural junctions.
   */
  const TRAVERSAL_INSET = 0.12;
  const traversalSpanOf = (seg: CandidateSegment): [LatLng, LatLng] => [
    vertexAt(seg, TRAVERSAL_INSET),
    vertexAt(seg, 1 - TRAVERSAL_INSET),
  ];
  /**
   * Short segments get ONE touch at a tip. Mid-vertex touches were tried
   * (round 5) and CAUSED the very retraces they aimed to prevent: forcing the
   * middle of a road whose through-path passes its tips = drive in to the
   * midpoint and back out the same way (self_overlap rejections exploded,
   * pools collapsed 19→2). A tip touch just clips the corner.
   */
  const tipOf = (seg: CandidateSegment): LatLng => vertexAt(seg, 0);

  const makeCandidate = (
    id: string,
    primary: Cluster,
    extraCluster: Cluster | null,
    returnSector: number,
  ): WaypointCandidate => {
    // TRAVERSAL waypoints: both endpoints of the cluster's best segment — the
    // route must DRIVE the twisty road, not pass near its midpoint. A second
    // strong member (≥800 m away) adds one more on-road traversal point.
    const byValue = [...primary.members].sort((a, b) => {
      return segValue(b.segment) - segValue(a.segment) || a.segment.id.localeCompare(b.segment.id);
    });
    const best = byValue[0]!;
    const [bestA, bestB] = traversalSpanOf(best.segment);
    // Full spans only for LONG segments — forcing both ends of a short spur
    // demands a turn-back against the sweep (u-turn geometry, owner round 2).
    // Threshold 1.5→1.2 km (round 4): more forced curvy-road km per loop — the
    // anti-"square" lever, since connectors are straight concession grid.
    const TRAVERSE_MIN_M = 1_200;
    const traverseBest = best.segment.lengthM >= TRAVERSE_MIN_M;
    const second = byValue.find((m) => distM(m.centroid, best.centroid) > 800);

    const spot = nearestSpotTo(primary.centroid);
    const spotIds = spot ? [spot.id] : [];

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
    if (extraCluster) {
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
    if (spot) wps.push({ lat: spot.lat, lng: spot.lng });
    wps.push(anchor.centroid);

    // angular order around the origin (L4) so the loop sweeps one way round
    const ordered = wps
      .map((p) => ({ p, b: bearingDeg(origin, p) }))
      .sort((a, b) => {
        const rot = (x: number) => (x - (primary.sector * 360) / nSectors + 360) % 360;
        return rot(a.b) - rot(b.b);
      })
      .map(({ p }) => p);

    return {
      id,
      kind: 'loop',
      waypoints: ordered,
      sector: primary.sector,
      returnSector,
      clusterId: primary.id,
      spotIds,
      clusterWeight: primary.weight + (extraCluster?.weight ?? 0),
    };
  };

  // ROUND 1 — one candidate per cluster (distinct outbound corridors survive
  // dedup; SPK-15 run 7: 3 return-variants per cluster collapsed to ~1 kept).
  for (const cluster of roundRobin) {
    if (candidates.length >= nCandidates) break;
    const returnSector = (cluster.sector + halfTurn) % nSectors;
    candidates.push(
      makeCandidate(`${pfx}loop-c${cluster.id}-r${returnSector}`, cluster, null, returnSector),
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
      candidates.push(makeCandidate(`${pfx}loop-c${a.id}+c${b.id}`, a, b, returnSector));
    }
  }

  // ROUND 3 — extra return-sector variants for the top clusters.
  outer: for (const cluster of roundRobin) {
    for (const offset of [halfTurn + 1, halfTurn - 1]) {
      if (candidates.length >= nCandidates) break outer;
      const returnSector = (cluster.sector + offset + nSectors) % nSectors;
      const id = `${pfx}loop-c${cluster.id}-r${returnSector}`;
      if (candidates.some((c) => c.id === id)) continue;
      candidates.push(makeCandidate(id, cluster, null, returnSector));
    }
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

    const wps: Array<{ p: LatLng; prog: number }> = [
      { p: cluster.centroid, prog: progress(cluster.centroid) },
    ];
    const spotIds: string[] = [];
    if (options.anchorSpots && spots.length > 0) {
      const best = [...spots].sort((a, b) => {
        const da =
          distM(origin, { lat: a.lat, lng: a.lng }) +
          distM({ lat: a.lat, lng: a.lng }, destination);
        const db =
          distM(origin, { lat: b.lat, lng: b.lng }) +
          distM({ lat: b.lat, lng: b.lng }, destination);
        return da - db || a.id.localeCompare(b.id);
      })[0]!;
      wps.push({
        p: { lat: best.lat, lng: best.lng },
        prog: progress({ lat: best.lat, lng: best.lng }),
      });
      spotIds.push(best.id);
    }
    wps.sort((a, b) => a.prog - b.prog); // progress order (TSP only ≥4 — M3-T08)

    candidates.push({
      id: `atob-c${cluster.id}`,
      kind: 'atob',
      waypoints: wps.map((w) => w.p),
      sector: cluster.sector,
      returnSector: null,
      clusterId: cluster.id,
      spotIds,
      clusterWeight: cluster.weight,
    });
  }
  return candidates;
}
