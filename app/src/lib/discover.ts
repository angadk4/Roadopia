/**
 * R23 Discover data layer (app side). POSTs /discover and zod-VALIDATES the
 * response (Hard rule K — malformed data never reaches the UI); builds the
 * tap's /plan request per drive kind (near → loop, far → out-and-back).
 *
 * PURE module (no Expo imports) — node-unit-testable.
 */

import {
  DiscoverResultSchema,
  DiscoverResultV2Schema,
  type CoreDrive,
  type DiscoverResult,
  type DiscoverResultV2,
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
 * R25-U15 — the v2 THREE-LEG browse (`v: 2` → pre-measured drive cores +
 * fresh connectors). Ships dark until the core index is swept + loaded
 * (DISCOVER_V2 below); the UI then reads "the drive 42 min · getting there
 * 18 · home 21" instead of one 118-minute blob.
 */
export async function fetchDiscoverCores(
  opts: ApiClientOptions,
  origin: LatLng,
  signal?: AbortSignal,
): Promise<DiscoverResultV2> {
  let raw: unknown;
  try {
    raw = await postDiscover(opts, { origin, v: 2 }, signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new DiscoverUnavailableError();
    throw err;
  }
  const parsed = DiscoverResultV2Schema.safeParse(raw);
  if (!parsed.success) throw new Error('Discover returned an unexpected response.');
  return parsed.data;
}

/** App-side switch for the v2 browse — flipped when the swept core index is
 *  LOADED at the deployment the app points at (an empty v2 menu on every
 *  browse would be a worse product than the honest v1 while the sweep runs). */
export const DISCOVER_V2 = false;

/** Total trip time (s) of a three-leg core drive. */
export function coreTripDurationS(d: CoreDrive): number {
  return d.core.duration_s + d.connectorOut.duration_s + d.connectorHome.duration_s;
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

// --- R25-U15: the v2 three-leg map layer + Remix ------------------------------

/** One trip's legs as separately-styled features: the DRIVE in amber, the
 *  get-there/get-home connectors in grey (`leg` drives the style). */
export interface CoreLegFeatureProps {
  id: string;
  name: string;
  leg: 'core' | 'out' | 'home';
  duration_s: number;
}

export interface CoreLegFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: CoreLegFeatureProps;
    geometry: LineString;
  }>;
}

/** Core drives → three features per drive (core amber, connectors grey). */
export function coreDrivesToFeatureCollection(drives: CoreDrive[]): CoreLegFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: drives.flatMap((d) => [
      {
        type: 'Feature' as const,
        id: `${d.id}:core`,
        properties: { id: d.id, name: d.name, leg: 'core' as const, duration_s: d.core.duration_s },
        geometry: d.core.geometry,
      },
      {
        type: 'Feature' as const,
        id: `${d.id}:out`,
        properties: {
          id: d.id,
          name: d.name,
          leg: 'out' as const,
          duration_s: d.connectorOut.duration_s,
        },
        geometry: d.connectorOut.geometry,
      },
      {
        type: 'Feature' as const,
        id: `${d.id}:home`,
        properties: {
          id: d.id,
          name: d.name,
          leg: 'home' as const,
          duration_s: d.connectorHome.duration_s,
        },
        geometry: d.connectorHome.geometry,
      },
    ]),
  };
}

/** The card's honest three-part label: "the drive 42 min · getting there 18 · home 21". */
export function coreTripLabel(d: CoreDrive): string {
  const m = (s: number): number => Math.round(s / 60);
  return `the drive ${m(d.core.duration_s)} min · getting there ${m(d.connectorOut.duration_s)} · home ${m(d.connectorHome.duration_s)}`;
}

/**
 * "Remix this drive" — seed the REAL planner from a core on the authenticated
 * /plan path (25 s budget, iteration cap, cost guard, kill switch — fresh
 * generation where it is allowed to be expensive). Rides the existing tap
 * contract: a through-pin at the core's entry + the trip's time budget
 * (clamped to the tap window plan.ts enforces).
 */
export function buildRemixRequest(core: CoreDrive, origin: LatLng): PlanRequest {
  const total = coreTripDurationS(core);
  return {
    brief: `A drive like ${core.name}`,
    origin,
    shape: 'loop',
    preset: 'backroads',
    location_constraints: [{ kind: 'through', text: core.name, near_point: core.core.entry }],
    duration_target_s: Math.max(2700, Math.min(9000, total)),
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
