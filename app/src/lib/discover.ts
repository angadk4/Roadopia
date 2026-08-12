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

/**
 * App-side switch for the v2 browse. ON since R29 Unit A: the r31 ribbon index
 * (1,544 cores) is loaded and the backend serves {core, connectorOut,
 * connectorHome} with per-leg times. The screen still falls back to v1 when a
 * v2 menu comes back EMPTY (index gaps, e.g. Collingwood/Cobourg until the
 * next sweep) — no origin loses its menu.
 */
export const DISCOVER_V2 = true;

/**
 * U12c / BD-180 — the v1 FALLBACK switch. Recovery §15: never silently
 * downgrade a premium surface; a true desert deserves the honest "no measured
 * drives here" state, not a lower-quality out-and-back lookalike wearing the
 * same UI. Measured before flipping (rq40, 2026-08-12): **0 of 27 gold +
 * holdout origins** — including Cobourg, the known supply desert — return an
 * empty v2 menu, so retiring the fallback costs no menu anywhere we measure.
 * Set true to restore the old behavior.
 */
export const DISCOVER_V1_FALLBACK = false;

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

/** Union bounds over ALL THREE legs of v2 core drives ([lng,lat]).
 *  The camera must fit the connectors too — a drive 20 km away with a tight
 *  core-only fit would render as a line leaving the screen. */
export function coreDrivesBounds(drives: CoreDrive[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const eat = (g: { coordinates: unknown }): void => {
    for (const [lng, lat] of g.coordinates as Array<[number, number]>) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  };
  for (const d of drives) {
    eat(d.core.geometry);
    eat(d.connectorOut.geometry);
    eat(d.connectorHome.geometry);
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return { sw: [west, south], ne: [east, north] };
}

/**
 * Map a tapped v2 core drive into the shared `Route` the Result screen renders —
 * the three legs concatenated into one geometry, WITH `Route.legs` filled from
 * the three MEASURED legs. RouteDetail's R28 three-leg bar then shows
 * "getting there X · the drive Y · home Z" on the result for free, and the
 * road-class number shown for the drive is the CORE's measured share — not a
 * blob average.
 */
export function coreDriveToRoute(d: CoreDrive): Route {
  const coords = [
    ...(d.connectorOut.geometry.coordinates as Array<[number, number]>),
    ...(d.core.geometry.coordinates as Array<[number, number]>).slice(1),
    ...(d.connectorHome.geometry.coordinates as Array<[number, number]>).slice(1),
  ];
  const totalM = d.connectorOut.distance_m + d.core.distance_m + d.connectorHome.distance_m;
  const totalS = coreTripDurationS(d);
  const pct = (m: number): number => Math.round((m / Math.max(1, totalM)) * 100);
  return {
    geometry: { type: 'LineString', coordinates: coords },
    is_loop: d.kind === 'loop',
    waypoints: [d.core.entry, d.core.exit],
    distance_m: totalM,
    duration_s: totalS,
    curviness: Math.max(0, d.core.curviness),
    elevation_profile: null,
    climb_m: null,
    highway_flag: false, // cores are highway-free by the index bars; connectors exclude highways
    toll_flag: false,
    ferry_flag: false,
    unpaved_flag: false,
    character_tags: [],
    intensity: 'moderate',
    free_tags: d.barProfile === 'cell_relaxed' ? ['discover', 'best-around-here'] : ['discover'],
    visibility: 'private',
    owner_id: null,
    origin_type: 'ai',
    forked_from: null,
    name: d.name,
    stops: [],
    legs: {
      there_pct: pct(d.connectorOut.distance_m),
      drive_pct: pct(d.core.distance_m),
      home_pct: pct(d.connectorHome.distance_m),
      there_m: Math.round(d.connectorOut.distance_m),
      drive_m: Math.round(d.core.distance_m),
      home_m: Math.round(d.connectorHome.distance_m),
      drive_backroad_pct: Math.round(d.core.backroadShare * 100),
      drive_main_pct: Math.round(d.core.mainShare * 100),
    },
  };
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
