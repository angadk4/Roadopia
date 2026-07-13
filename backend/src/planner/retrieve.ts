/**
 * Candidate retrieval within Ω (M3-T04; Protocol §3.3).
 *
 *   C_road = curvy segments inside Ω with curviness ≥ THETA_CURVY (M2-T08 RPC,
 *            GeoJSON polygon form — GiST-prefiltered).
 *   C_spot = find_spots over the requested stop types inside Ω — REAL spots only;
 *            the planner never invents a stop. Stop types with no DB spot type yet
 *            (currently 'food') are returned as `unavailableStopTypes` so the
 *            pipeline can disclose the gap honestly instead of faking coverage.
 *
 * Since M6-T02 every read goes through the SECURITY DEFINER planner path
 * (db/planner_reads.ts, migration 0005 — SPK-13 PASSED): scoped to public/OSM
 * data by construction, regardless of the connection's DB role.
 */

import type { LineString, StopType } from '@shared/types';
import type { Client } from 'pg';

import {
  plannerFindAnchorPoints,
  plannerFindCurvyRoads,
  plannerFindSpots,
} from '../db/planner_reads';

import { ringToGeoJsonPolygon, type Scope } from './scope';

/** Candidate curvature θ (SPK-10; frozen at M4 [GATE-C]). */
export const THETA_CURVY_DEFAULT = 0.6;
export const SEGMENT_LIMIT_PER_RING = 300;
export const SPOT_LIMIT_PER_RING = 100;

/**
 * Road classes the planner never retrieves (owner round 3 / BD-21): residential
 * is 66 % of the corpus and 98 % of the top-500 by per-km curvature — short
 * suburban curls buried every real country road under the old rank-and-limit.
 * The rest are defensive (absent from today's corpus but poison if a future
 * extract admits them: ramps read as "curvy", service/track aren't drives).
 * Excluded INSIDE the RPC (migration 0004) so the filter precedes the limit.
 */
export const EXCLUDED_HIGHWAY_CLASSES: string[] = [
  'residential',
  'service',
  'living_street',
  'track',
  'motorway',
  'trunk',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
];

/** §3.4 stop-type → DB spot-type mapping; null = no DB coverage yet (disclose). */
const STOP_TO_SPOT_TYPE: Record<StopType, string | null> = {
  coffee: 'coffee',
  food: null, // no seeded/DB spot type yet — disclosed via unavailableStopTypes
  fuel: 'fuel',
  viewpoint: 'viewpoint',
  rest: 'rest',
  great_road: 'great_road',
};

export interface CandidateSegment {
  id: string;
  osmWayId: string;
  name: string;
  highway: string;
  lengthM: number;
  curviness: number; // circum_curvature_per_km (C7 candidate metric)
  geometry: LineString;
}

export interface CandidateSpot {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  source: string;
}

export interface RetrievedCandidates {
  segments: CandidateSegment[];
  spots: CandidateSpot[];
  /** Requested stop types with no spot coverage in the region/data model. */
  unavailableStopTypes: StopType[];
}

/**
 * Return-anchor material (SPK-15 run 7): centroids of ALL segments in Ω at ANY
 * curviness (θ = 0) — ordinary roads included, so loop returns can ride parallel
 * concessions instead of doubling down the curvy band. Light query: points only.
 */
export async function retrieveAnchorPoints(
  db: Client,
  scope: Scope,
  limit = 4000,
): Promise<Array<{ lat: number; lng: number }>> {
  const points: Array<{ lat: number; lng: number }> = [];
  for (const ring of scope.rings) {
    const polygon = JSON.stringify(ringToGeoJsonPolygon(ring));
    // ST_PointN(geom, 1): a real on-road VERTEX, not a centroid — centroids of
    // curved roads sit off the roadway and snap badly (owner round 2). A
    // mid-vertex variant was tried (round 5) and REGRESSED: forcing interior
    // points creates in-and-back retraces when the through-path passes the
    // tips. Class exclusion lives INSIDE the RPC (BD-21), pre-limit.
    const rows = await plannerFindAnchorPoints(db, {
      polygonGeoJson: polygon,
      limit,
      excludeHighway: EXCLUDED_HIGHWAY_CLASSES,
    });
    points.push(...rows);
  }
  return points;
}

export async function retrieveCandidates(
  db: Client,
  scope: Scope,
  options: {
    stopTypes?: StopType[];
    thetaCurvy?: number;
    segmentLimit?: number;
    spotLimit?: number;
  } = {},
): Promise<RetrievedCandidates> {
  const theta = options.thetaCurvy ?? THETA_CURVY_DEFAULT;
  const segmentLimit = options.segmentLimit ?? SEGMENT_LIMIT_PER_RING;
  const spotLimit = options.spotLimit ?? SPOT_LIMIT_PER_RING;
  const stopTypes = options.stopTypes ?? [];

  const spotTypes = stopTypes
    .map((t) => STOP_TO_SPOT_TYPE[t])
    .filter((t): t is string => t !== null);
  const unavailableStopTypes = stopTypes.filter((t) => STOP_TO_SPOT_TYPE[t] === null);

  const segments = new Map<string, CandidateSegment>();
  const spots = new Map<string, CandidateSpot>();

  for (const ring of scope.rings) {
    const polygon = JSON.stringify(ringToGeoJsonPolygon(ring));

    const seg = await plannerFindCurvyRoads(db, {
      polygonGeoJson: polygon,
      minCurviness: theta,
      limit: segmentLimit,
      excludeHighway: EXCLUDED_HIGHWAY_CLASSES,
    });
    for (const row of seg) {
      segments.set(row.id, {
        id: row.id,
        osmWayId: row.osm_way_id,
        name: row.name,
        highway: row.highway,
        lengthM: Number(row.length_m),
        curviness: Number(row.curviness),
        geometry: JSON.parse(row.geometry) as LineString,
      });
    }

    if (spotTypes.length > 0) {
      // origin point for nearest-ordering: the ring centroid (Ω is origin-centred)
      const cLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
      const cLng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
      const sp = await plannerFindSpots(db, {
        lat: cLat,
        lng: cLng,
        polygonGeoJson: polygon,
        types: spotTypes,
        limit: spotLimit,
      });
      for (const row of sp) {
        spots.set(row.id, { ...row, lat: Number(row.lat), lng: Number(row.lng) });
      }
    }
  }

  return {
    segments: [...segments.values()],
    spots: [...spots.values()],
    unavailableStopTypes,
  };
}
