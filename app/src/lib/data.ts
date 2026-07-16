/**
 * Direct-Supabase typed data layer (M7-T02; Spec §41/§49.1).
 *
 * The map home reads PUBLIC seed content straight from Supabase's Data API
 * (PostgREST) with the anon key — the sanctioned client path; the backend is
 * only for /plan, /route, /match (§49.2). Implemented as a thin typed fetch
 * over `/rest/v1/rpc/*` rather than @supabase/supabase-js: at M7 the app makes
 * exactly two anonymous RPC reads and carries no auth session — the JS client
 * (and its RN storage/polyfill baggage) earns its place at M8 when sign-in
 * lands (logged, BD-48).
 *
 * Every row is zod-validated before it reaches the UI (Hard rule K) — reads:
 *   - map_routes        (migration 0007; GeoJSON geometry, public rows only)
 *   - planner_find_spots (migration 0005; SECURITY DEFINER, OSM spots only)
 *
 * PURE module (no Expo imports) — fully unit-tested in node.
 */

import { LineStringSchema, type LatLng } from '@shared/types';
import { z } from 'zod';

import type { FetchLike } from './api';

/** Local `supabase start` API port (Kong gateway). */
export const SUPABASE_LOCAL_PORT = 54321;

/**
 * The supabase-cli DEMO anon key — the SAME well-known JWT for every local
 * stack on earth (published in Supabase's own docs; signed with the public
 * demo secret). NOT a secret (Hard rule H unaffected). Used ONLY as the
 * zero-config fallback when the Supabase URL was derived from the Metro host,
 * i.e. LAN development against `supabase start`. Hosted projects always get
 * their real anon key via EXPO_PUBLIC_SUPABASE_ANON_KEY.
 */
export const LOCAL_DEV_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/** Resolve the Supabase API base URL (same ladder as the backend URL). */
export function resolveSupabaseUrl(opts: {
  explicit?: string | null;
  hostUri?: string | null;
}): string {
  const explicit = opts.explicit?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const hostUri = opts.hostUri?.trim();
  if (hostUri) {
    const host = hostUri.replace(/^[a-z]+:\/\//i, '').split(/[:/?#]/)[0];
    if (host) return `http://${host}:${SUPABASE_LOCAL_PORT}`;
  }
  return `http://localhost:${SUPABASE_LOCAL_PORT}`;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** A Data-API failure with a friendly message (never a raw PostgREST dump). */
export class DataError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DataError';
    this.status = status;
  }
}

async function rpc(
  cfg: SupabaseConfig,
  fn: string,
  args: Record<string, unknown>,
  fetchImpl?: FetchLike,
): Promise<unknown> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    res = await f(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        authorization: `Bearer ${cfg.anonKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
    });
  } catch (err) {
    throw new DataError('Could not reach the map data service.', null, { cause: err });
  }
  const text = await res.text();
  if (!res.ok) {
    // PostgREST error bodies carry {message, code, details, hint} — log-safe,
    // but the UI gets a friendly line only (§18: never a raw error).
    throw new DataError('The map data service answered with an error.', res.status);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new DataError('The map data service sent an unreadable response.', res.status, {
      cause: err,
    });
  }
}

// --- map_routes rows (migration 0007) ---------------------------------------

export const MapRouteRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  geometry: LineStringSchema,
  bbox: z.unknown().nullable(),
  is_loop: z.boolean(),
  distance_m: z.number().nonnegative(),
  duration_s: z.number().nonnegative(),
  curviness: z.number(),
  climb_m: z.number().nullable(),
  character_tags: z.array(z.string()),
  intensity: z.string(),
  free_tags: z.array(z.string()),
  origin_type: z.string(),
  visibility: z.string(),
});
export type MapRouteRow = z.infer<typeof MapRouteRowSchema>;

export async function fetchMapRoutes(
  cfg: SupabaseConfig,
  fetchImpl?: FetchLike,
): Promise<MapRouteRow[]> {
  const raw = await rpc(cfg, 'map_routes', { p_limit: 50 }, fetchImpl);
  const parsed = z.array(MapRouteRowSchema).safeParse(raw);
  if (!parsed.success) throw new DataError('Route data did not match the expected shape.');
  return parsed.data;
}

// --- planner_find_spots rows (migration 0005; OSM-only by construction) -----

export const SpotRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  lat: z.number(),
  lng: z.number(),
  source: z.string(),
});
export type SpotRow = z.infer<typeof SpotRowSchema>;

/**
 * Spot budget per load — a safety valve ABOVE the region's OSM spot count
 * (5,040 as of region v5), never a truncator. M7-T09 finding: every
 * row-returning read is capped by PostgREST max-rows (1,000/response) AND
 * planner_find_spots is nearest-first, so pins truncated to a 22.8 km disc
 * around the Oakville shore. map_spots (migration 0008) returns ONE jsonb
 * aggregate — cap-proof, spatially unbiased. ~0.65 MB once per launch;
 * viewport-scoped loading is the M8 egress follow-up (§44).
 */
export const SPOTS_LIMIT = 6000;

export async function fetchMapSpots(
  cfg: SupabaseConfig,
  fetchImpl?: FetchLike,
): Promise<SpotRow[]> {
  const raw = await rpc(cfg, 'map_spots', { p_limit: SPOTS_LIMIT }, fetchImpl);
  const parsed = z.array(SpotRowSchema).safeParse(raw);
  if (!parsed.success) throw new DataError('Spot data did not match the expected shape.');
  return parsed.data;
}

// --- GeoJSON builders + bounds (pure, tested) --------------------------------

export interface RouteFeatureProps {
  id: string;
  name: string;
  distance_m: number;
  duration_s: number;
  is_loop: boolean;
  character_tags: string[];
}

export function routesToFeatureCollection(rows: MapRouteRow[]): {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: RouteFeatureProps;
    geometry: MapRouteRow['geometry'];
  }>;
} {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      id: r.id,
      properties: {
        id: r.id,
        name: r.name,
        distance_m: r.distance_m,
        duration_s: r.duration_s,
        is_loop: r.is_loop,
        character_tags: r.character_tags,
      },
      geometry: r.geometry,
    })),
  };
}

export interface SpotFeatureProps {
  id: string;
  name: string;
  type: string;
  /** One-letter marker label (type distinction pre-iconography). */
  label: string;
}

export function spotsToFeatureCollection(rows: SpotRow[]): {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: SpotFeatureProps;
    geometry: { type: 'Point'; coordinates: [number, number] };
  }>;
} {
  return {
    type: 'FeatureCollection',
    features: rows.map((s) => ({
      type: 'Feature',
      id: s.id,
      properties: {
        id: s.id,
        name: s.name,
        type: s.type,
        label: (s.type[0] ?? '?').toUpperCase(),
      },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    })),
  };
}

export interface Bounds {
  sw: [number, number];
  ne: [number, number];
}

/** Union bounds over route geometries ([lng,lat] positions). Null when empty. */
export function routesBounds(rows: MapRouteRow[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const r of rows) {
    for (const [lng, lat] of r.geometry.coordinates as Array<[number, number]>) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return { sw: [west, south], ne: [east, north] };
}

/** Centre of bounds — the spot-query anchor. */
export function boundsCenter(b: Bounds): LatLng {
  return { lat: (b.sw[1] + b.ne[1]) / 2, lng: (b.sw[0] + b.ne[0]) / 2 };
}
