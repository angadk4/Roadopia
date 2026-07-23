/**
 * R23 Discover data layer (app side). POSTs /discover and zod-VALIDATES the
 * response (Hard rule K — malformed data never reaches the UI); builds the
 * tap's /plan request per drive kind (near → loop, far → out-and-back).
 *
 * PURE module (no Expo imports) — node-unit-testable.
 */

import {
  DiscoverResultSchema,
  type DiscoverResult,
  type LatLng,
  type LineString,
  type NearbyDrive,
  type Route,
} from '@shared/types';

import { ApiError, postDiscover, type ApiClientOptions, type PlanRequest } from './api';
import type { Bounds } from './data';

/** A friendly "Discover is unavailable" state (endpoint absent / off → 404). */
export class DiscoverUnavailableError extends Error {
  constructor() {
    super('Discover is not available right now.');
    this.name = 'DiscoverUnavailableError';
  }
}

/** POST /discover for `origin`, validated. 404 → DiscoverUnavailableError. */
export async function fetchDiscoverDrives(
  opts: ApiClientOptions,
  origin: LatLng,
  signal?: AbortSignal,
): Promise<DiscoverResult> {
  let raw: unknown;
  try {
    raw = await postDiscover(opts, { origin }, signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new DiscoverUnavailableError();
    throw err;
  }
  const parsed = DiscoverResultSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Discover returned an unexpected response.');
  return parsed.data;
}

/**
 * The FALLBACK tap request (R24): every Discover drive is an out-and-back, and
 * normally its route is PRE-BUILT (open Result directly — see nearbyDriveToRoute).
 * This builds the /plan out-and-back only when the pre-build was missing/failed.
 * Structured fields win over the plain brief (server precedence, plan.ts), so the
 * route is deterministic regardless of parse.
 */
export function buildDiscoverPlanRequest(drive: NearbyDrive, origin: LatLng): PlanRequest {
  return {
    brief: `Out and back to ${drive.name}`,
    origin,
    shape: 'loop',
    preset: 'backroads',
    out_and_back: { entry: drive.entry, exit: drive.exit, name: drive.name },
  };
}

// --- R24 (U7): map-first data layer — mirrors data.ts for Discover -----------

/** Feature props for the amber drive line (mirrors RouteFeatureProps + source). */
export interface DriveFeatureProps {
  id: string;
  name: string;
  distance_m: number;
  duration_s: number;
  is_loop: boolean;
  /** 'auto' | 'classic' — drives the classic badge; absent ⇒ auto. */
  source: NearbyDrive['source'];
}

export interface DriveFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: DriveFeatureProps;
    geometry: LineString;
  }>;
}

/** The best measured/estimated total to SHOW for a drive (s). */
export function driveDurationS(drive: NearbyDrive): number {
  return drive.measuredDurationS ?? drive.suggestedDurationS;
}

/**
 * Discovered drives → a GeoJSON FeatureCollection of their road spans (the amber
 * lines on the map). Only drives that carry `geometry` appear; the id is the
 * segmentId so a tap maps straight back to the drive.
 */
export function discoverDrivesToFeatureCollection(drives: NearbyDrive[]): DriveFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: drives
      .filter((d): d is NearbyDrive & { geometry: LineString } => d.geometry !== undefined)
      .map((d) => ({
        type: 'Feature',
        id: d.segmentId,
        properties: {
          id: d.segmentId,
          name: d.name,
          distance_m: d.length_m,
          duration_s: driveDurationS(d),
          is_loop: false,
          source: d.source,
        },
        geometry: d.geometry,
      })),
  };
}

/** Union bounds over the drives' road spans ([lng,lat]). Null when none have geometry. */
export function drivesBounds(drives: NearbyDrive[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const d of drives) {
    if (!d.geometry) continue;
    for (const [lng, lat] of d.geometry.coordinates as Array<[number, number]>) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return { sw: [west, south], ne: [east, north] };
}

/**
 * Map a PRE-BUILT discovered drive (U6 attaches `route`) into the shared `Route`
 * the Result screen renders — an instant tap with REAL geometry, no /plan call.
 * Returns null when the route wasn't pre-built (caller falls back to /plan).
 */
export function nearbyDriveToRoute(drive: NearbyDrive): Route | null {
  const r = drive.route;
  if (!r) return null;
  return {
    geometry: r.geometry,
    is_loop: false, // every Discover drive is an out-and-back (R24)
    waypoints: [drive.entry, drive.exit],
    distance_m: r.distance_m,
    duration_s: r.duration_s,
    curviness: Math.max(0, drive.curviness),
    elevation_profile: null,
    climb_m: null,
    highway_flag: r.has_highway,
    toll_flag: r.has_toll,
    ferry_flag: r.has_ferry,
    unpaved_flag: r.has_unpaved,
    character_tags: [],
    intensity: 'moderate',
    free_tags: drive.source === 'classic' ? ['discover', 'classic'] : ['discover'],
    visibility: 'private',
    owner_id: null,
    origin_type: 'ai', // planner-generated (the /plan taxonomy), not hand-drawn/recorded
    forked_from: null,
    name: drive.name,
    stops: [],
  };
}
