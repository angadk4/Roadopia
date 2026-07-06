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
export const N_CANDIDATES_DEFAULT = 14;
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
    const wa = a.segment.curviness * a.segment.lengthM;
    const wb = b.segment.curviness * b.segment.lengthM;
    return wb - wa || a.segment.id.localeCompare(b.segment.id);
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
    const weight = members.reduce((s, m) => s + m.segment.curviness * m.segment.lengthM, 0);
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
}

/**
 * Duration fit of a cluster (SPK-15 finding): a loop through a cluster at distance
 * d runs ≈ LOOP_LENGTH_FACTOR·d total; the best cluster distance for target T* is
 * d* ≈ (T*·v)/LOOP_LENGTH_FACTOR. Fit decays linearly to 0 at ±100 % off d*.
 */
export const LOOP_LENGTH_FACTOR = 2.4;

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

  // Waypoint material excludes residential fragments (SPK-15 run 8: crescents/
  // courts made waypoints in-and-out spurs); residential still counts in scoring —
  // just not as a place the route is steered through. Falls back when sparse.
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
  const nonResidential = allInfos.filter((i) => i.segment.highway !== 'residential');
  const infos = nonResidential.length >= 5 ? nonResidential : allInfos;

  const clusters = clusterSegments(infos, kClusters);
  // rank clusters: duration-sized weight desc (SPK-15: cluster distance must fit
  // the budget), then id — round-robin across sectors so the presented set spans
  // ≥3 sectors even when one sector dominates (§9 diversity)
  const sized = (c: Cluster) =>
    c.weight * durationFitFactor(c.distanceM, options.durationS, options.avgSpeedKmh);
  const bySector = new Map<number, Cluster[]>();
  for (const c of clusters.sort((a, b) => sized(b) - sized(a) || a.id - b.id)) {
    const list = bySector.get(c.sector) ?? [];
    list.push(c);
    bySector.set(c.sector, list);
  }
  const sectorOrder = [...bySector.keys()].sort((a, b) => a - b);
  const roundRobin: Cluster[] = [];
  for (let round = 0; roundRobin.length < clusters.length; round++) {
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

  const makeCandidate = (
    id: string,
    primary: Cluster,
    extraCluster: Cluster | null,
    returnSector: number,
  ): WaypointCandidate => {
    const members = [...primary.members].sort((a, b) => a.distanceM - b.distanceM);
    const entry = members[0]!.centroid;
    const far = members.length > 1 ? members[members.length - 1]!.centroid : null;

    const spot = nearestSpotTo(primary.centroid);
    const spotIds = spot ? [spot.id] : [];

    const anchor = pickAnchor(
      primary.sector,
      returnSector,
      primary.distanceM * RETURN_ANCHOR_DISTANCE_FRACTION,
    );

    const wps: LatLng[] = [entry];
    if (far && distM(entry, far) > 500) wps.push(far);
    if (extraCluster) wps.push(extraCluster.centroid);
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
      makeCandidate(`loop-c${cluster.id}-r${returnSector}`, cluster, null, returnSector),
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
      candidates.push(makeCandidate(`loop-c${a.id}+c${b.id}`, a, b, returnSector));
    }
  }

  // ROUND 3 — extra return-sector variants for the top clusters.
  outer: for (const cluster of roundRobin) {
    for (const offset of [halfTurn + 1, halfTurn - 1]) {
      if (candidates.length >= nCandidates) break outer;
      const returnSector = (cluster.sector + offset + nSectors) % nSectors;
      const id = `loop-c${cluster.id}-r${returnSector}`;
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
