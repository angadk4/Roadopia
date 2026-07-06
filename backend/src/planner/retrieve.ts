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
 * Takes a pg Client so the planner runs on the server's least-privilege read path
 * (SPK-13 definer variants swap in pre-release without changing this module).
 */

import type { LineString, StopType } from '@shared/types';
import type { Client } from 'pg';

import { ringToGeoJsonPolygon, type Scope } from './scope';

/** Candidate curvature θ (SPK-10; frozen at M4 [GATE-C]). */
export const THETA_CURVY_DEFAULT = 0.6;
export const SEGMENT_LIMIT_PER_RING = 300;
export const SPOT_LIMIT_PER_RING = 100;

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

interface SegmentRow {
  id: string;
  osm_way_id: string;
  name: string;
  highway: string;
  length_m: number;
  curviness: number;
  geometry: string; // GeoJSON text from st_asgeojson
}

interface SpotRow {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  source: string;
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
    const rows = await db.query<{ lat: number; lng: number }>(
      `select st_y(st_centroid(geom))::float8 as lat, st_x(st_centroid(geom))::float8 as lng
       from find_curvy_roads(p_west := 0, p_south := 0, p_east := 0, p_north := 0,
                             p_polygon := $1::jsonb, p_min_curviness := 0, p_limit := $2)
       where highway <> 'residential'`,
      [polygon, limit],
    );
    for (const r of rows.rows) points.push({ lat: Number(r.lat), lng: Number(r.lng) });
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

    const seg = await db.query<SegmentRow>(
      `select id::text, osm_way_id, name, highway, length_m,
              circum_curvature_per_km as curviness,
              st_asgeojson(geom) as geometry
       from find_curvy_roads(p_west := 0, p_south := 0, p_east := 0, p_north := 0,
                             p_polygon := $1::jsonb, p_min_curviness := $2, p_limit := $3)`,
      [polygon, theta, segmentLimit],
    );
    for (const row of seg.rows) {
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
      const sp = await db.query<SpotRow>(
        `select id::text, name, type, lat, lng, source
         from find_spots(p_lat := $1, p_lng := $2, p_polygon := $3::jsonb,
                         p_types := $4, p_limit := $5)`,
        [cLat, cLng, polygon, spotTypes, spotLimit],
      );
      for (const row of sp.rows) {
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
