/**
 * Least-privilege planner DB reads (M6-T02; Master Spec §55/§37; SPK-13).
 *
 * The planner's ONLY spatial reads go through the SECURITY DEFINER
 * `planner_find_curvy_roads` / `planner_find_spots` functions (migration
 * 0005), which are scoped to public/OSM data BY CONSTRUCTION — they cannot
 * return a private route/spot no matter which DB role the backend connects
 * as. The SPK-13 leakage test (db/tests/rls_planner.test.ts) asserts this as
 * the anon role. Keep every planner read in this module: adding a direct
 * table read here is a security regression, not a refactor.
 */

import type { Client } from 'pg';

export interface CurvySegmentRow {
  id: string;
  osm_way_id: string;
  name: string;
  highway: string;
  length_m: number;
  curviness: number;
  /** R19: fraction of segment length inside built-up landuse (0 = country). */
  urban_share: number;
  geometry: string; // GeoJSON text (st_asgeojson)
}

export interface SpotReadRow {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  source: string;
}

export async function plannerFindCurvyRoads(
  db: Client,
  params: {
    polygonGeoJson: string; // stringified GeoJSON Polygon
    minCurviness: number;
    limit: number;
    excludeHighway: string[];
    /** R19: exclude segments whose built-up share exceeds this (1 = off). */
    maxUrbanShare?: number;
  },
): Promise<CurvySegmentRow[]> {
  const res = await db.query<CurvySegmentRow>(
    `select id::text, osm_way_id, name, highway, length_m,
            circum_curvature_per_km as curviness, urban_share,
            st_asgeojson(geom) as geometry
     from planner_find_curvy_roads(p_west := 0, p_south := 0, p_east := 0, p_north := 0,
                                   p_polygon := $1::jsonb, p_min_curviness := $2, p_limit := $3,
                                   p_exclude_highway := $4, p_max_urban_share := $5)`,
    [
      params.polygonGeoJson,
      params.minCurviness,
      params.limit,
      params.excludeHighway,
      params.maxUrbanShare ?? 1.0,
    ],
  );
  return res.rows;
}

/** Vertex points of segments in Ω at any curviness (return-anchor material). */
export async function plannerFindAnchorPoints(
  db: Client,
  params: {
    polygonGeoJson: string;
    limit: number;
    excludeHighway: string[];
    maxUrbanShare?: number;
  },
): Promise<Array<{ lat: number; lng: number }>> {
  const res = await db.query<{ lat: number; lng: number }>(
    `select st_y(st_pointn(geom, 1))::float8 as lat, st_x(st_pointn(geom, 1))::float8 as lng
     from planner_find_curvy_roads(p_west := 0, p_south := 0, p_east := 0, p_north := 0,
                                   p_polygon := $1::jsonb, p_min_curviness := 0, p_limit := $2,
                                   p_exclude_highway := $3, p_max_urban_share := $4)`,
    [params.polygonGeoJson, params.limit, params.excludeHighway, params.maxUrbanShare ?? 1.0],
  );
  return res.rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng) }));
}

export async function plannerFindSpots(
  db: Client,
  params: {
    lat: number;
    lng: number;
    polygonGeoJson: string;
    types: string[];
    limit: number;
  },
): Promise<SpotReadRow[]> {
  const res = await db.query<SpotReadRow>(
    `select id::text, name, type, lat, lng, source
     from planner_find_spots(p_lat := $1, p_lng := $2, p_polygon := $3::jsonb,
                             p_types := $4, p_limit := $5)`,
    [params.lat, params.lng, params.polygonGeoJson, params.types, params.limit],
  );
  return res.rows;
}

/** Named-road lookup (R18-4, migration 0010): trigram-fuzzy, deterministic
 *  order (exact > similarity > curviness > id), bbox-bounded. */
export async function plannerFindSegmentsByName(
  db: Client,
  params: {
    name: string;
    west: number;
    south: number;
    east: number;
    north: number;
    minSimilarity?: number;
    limit?: number;
  },
): Promise<CurvySegmentRow[]> {
  const res = await db.query<CurvySegmentRow>(
    `select id::text, osm_way_id, name, highway, length_m,
            circum_curvature_per_km as curviness,
            st_asgeojson(geom) as geometry
     from planner_find_segments_by_name(p_name := $1, p_west := $2, p_south := $3,
                                        p_east := $4, p_north := $5,
                                        p_min_similarity := $6, p_limit := $7)`,
    [
      params.name,
      params.west,
      params.south,
      params.east,
      params.north,
      params.minSimilarity ?? 0.35,
      params.limit ?? 40,
    ],
  );
  return res.rows;
}

/** R19: simplified built-up landuse polygons for a bbox (migration 0011) —
 *  feeds the backend's in-memory point-in-polygon index (urban.ts). */
export async function plannerBuiltAreas(
  db: Client,
  params: { west: number; south: number; east: number; north: number; limit?: number },
): Promise<string[]> {
  const res = await db.query<{ geojson: string }>(
    `select geojson from planner_built_areas(p_west := $1, p_south := $2,
                                             p_east := $3, p_north := $4, p_limit := $5)`,
    [params.west, params.south, params.east, params.north, params.limit ?? 20000],
  );
  return res.rows.map((r) => r.geojson);
}
