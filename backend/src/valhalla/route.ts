/**
 * Typed Valhalla `/route` client — the `route_through` tool backend (M2-T04).
 *
 * Maps a Valhalla route response onto the shared §50 `RouteThroughOutput` shape
 * (geometry + distance + duration + maneuvers + has_* flags). Design rules:
 *   - The Valhalla response is EXTERNAL INPUT → zod-validated before use (rule K).
 *   - Result-scan caveat (Dependency Verification §11 / BD-16): callers must never
 *     trust request flags blindly — `scanConstraintViolations` compares what was
 *     REQUESTED against what the result ACTUALLY contains.
 *   - No secrets involved; base URL comes from config (VALHALLA_URL), never env here.
 *
 * SPK-05 note (2026-07-05, fixtures from Valhalla 3.7.0): the route summary exposes
 * has_highway / has_toll / has_ferry (+has_time_restrictions) but NO has_unpaved —
 * the §50 `has_unpaved` slot is therefore a documented constant `false` until an
 * edge-attribute scan lands (M3+, if unpaved handling needs more than the soft cost).
 */

import { RouteThroughOutputSchema, type Maneuver, type RouteThroughOutput } from '@shared/types';
import { z } from 'zod';

import { decodePolyline } from './polyline';

// --- request ---

/** Costing options Roadopia actually uses (soft use_* weights + hard exclusions). */
export interface AutoCostingOptions {
  exclude_highways?: boolean;
  exclude_tolls?: boolean;
  exclude_ferries?: boolean;
  /** Soft preference 0..1 (Valhalla default 1). */
  use_highways?: number;
  use_tolls?: number;
}

export interface RouteThroughRequest {
  /** Ordered waypoints, [lon, lat] GeoJSON order, ≥ 2. */
  waypoints: ReadonlyArray<readonly [number, number]>;
  costingOptions?: AutoCostingOptions;
  /**
   * Valhalla location type for the MIDDLE waypoints (first/last stay 'break').
   * 'through' = pass through without stopping or U-turning — the planner's
   * default for search waypoints (SPK-15 run 8: 'break' middles made every
   * waypoint an in-and-out spur when it landed on a minor street).
   */
  middleType?: 'break' | 'through';
}

// --- Valhalla response (subset we consume; external input → validated) ---

const ValhallaManeuverSchema = z.object({
  type: z.number(),
  instruction: z.string(),
  length: z.number().nonnegative().optional(), // km
});

const ValhallaSummarySchema = z.object({
  time: z.number().nonnegative(), // seconds
  length: z.number().nonnegative(), // kilometres
  has_highway: z.boolean().optional(),
  has_toll: z.boolean().optional(),
  has_ferry: z.boolean().optional(),
});

const ValhallaLegSchema = z.object({
  shape: z.string(),
  maneuvers: z.array(ValhallaManeuverSchema).optional(),
});

const ValhallaRouteResponseSchema = z.object({
  trip: z.object({
    legs: z.array(ValhallaLegSchema).min(1),
    summary: ValhallaSummarySchema,
  }),
});

const ValhallaErrorSchema = z.object({
  error_code: z.number(),
  error: z.string(),
  status_code: z.number(),
});

/** Typed failure — M3's relaxation ladder branches on `noRoute`. */
export class ValhallaRouteError extends Error {
  /** Valhalla error_code: 442 = no route found; 171 = no edges near a location. */
  readonly errorCode: number;
  readonly statusCode: number;
  /** True when the network simply has no path (triggers relaxation, not retry). */
  readonly noRoute: boolean;

  constructor(errorCode: number, statusCode: number, message: string) {
    super(`Valhalla /route failed (${errorCode}): ${message}`);
    this.name = 'ValhallaRouteError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.noRoute = errorCode === 442 || errorCode === 171;
  }
}

/** Valhalla numeric maneuver types → stable string names (§50 Maneuver.type). */
const MANEUVER_TYPES: Record<number, string> = {
  0: 'none',
  1: 'start',
  2: 'start_right',
  3: 'start_left',
  4: 'destination',
  5: 'destination_right',
  6: 'destination_left',
  7: 'becomes',
  8: 'continue',
  9: 'slight_right',
  10: 'right',
  11: 'sharp_right',
  12: 'uturn_right',
  13: 'uturn_left',
  14: 'sharp_left',
  15: 'left',
  16: 'slight_left',
  17: 'ramp_straight',
  18: 'ramp_right',
  19: 'ramp_left',
  20: 'exit_right',
  21: 'exit_left',
  22: 'stay_straight',
  23: 'stay_right',
  24: 'stay_left',
  25: 'merge',
  26: 'roundabout_enter',
  27: 'roundabout_exit',
  28: 'ferry_enter',
  29: 'ferry_exit',
  37: 'merge_right',
  38: 'merge_left',
};

/** Map a raw (already-validated) Valhalla response body → shared §50 output. */
export function mapRouteResponse(body: unknown): RouteThroughOutput {
  const parsed = ValhallaRouteResponseSchema.parse(body);
  const { legs, summary } = parsed.trip;

  const coordinates = legs.flatMap((leg, i) => {
    const pts = decodePolyline(leg.shape);
    return i === 0 ? pts : pts.slice(1); // legs share boundary vertices
  });

  const maneuvers: Maneuver[] = legs.flatMap(
    (leg) =>
      leg.maneuvers?.map((m) => ({
        type: MANEUVER_TYPES[m.type] ?? `type_${m.type}`,
        instruction: m.instruction,
        ...(m.length !== undefined ? { distance_m: m.length * 1000 } : {}),
      })) ?? [],
  );

  return RouteThroughOutputSchema.parse({
    geometry: { type: 'LineString', coordinates },
    distance_m: summary.length * 1000, // km → m
    duration_s: summary.time,
    maneuvers,
    has_highway: summary.has_highway ?? false,
    has_toll: summary.has_toll ?? false,
    has_ferry: summary.has_ferry ?? false,
    // Valhalla 3.7 route summaries expose no unpaved flag (see header note).
    has_unpaved: false,
  });
}

/**
 * Result-scan (mandatory caveat): compare REQUESTED exclusions to what the routed
 * result actually contains. Returns the violated constraint names (empty = clean).
 * Callers surface violations honestly (three-tier model, Spec §28).
 */
export function scanConstraintViolations(
  requested: AutoCostingOptions | undefined,
  result: Pick<RouteThroughOutput, 'has_highway' | 'has_toll' | 'has_ferry'>,
): string[] {
  const violations: string[] = [];
  if (requested?.exclude_highways && result.has_highway) violations.push('highway');
  if (requested?.exclude_tolls && result.has_toll) violations.push('toll');
  if (requested?.exclude_ferries && result.has_ferry) violations.push('ferry');
  return violations;
}

/**
 * Call Valhalla `/route` through the typed mapping. Throws `ValhallaRouteError`
 * on engine errors (incl. no-route) and `z.ZodError` on malformed responses.
 */
export async function routeThrough(
  baseUrl: string,
  request: RouteThroughRequest,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<RouteThroughOutput> {
  const middleType = request.middleType ?? 'break';
  const last = request.waypoints.length - 1;
  const payload = {
    locations: request.waypoints.map(([lon, lat], i) => {
      const isEndpoint = i === 0 || i === last;
      return {
        lat,
        lon,
        type: isEndpoint ? 'break' : middleType,
        // Middle SEARCH waypoints refuse to snap below 'unclassified' (rural
        // unclassified roads stay in; residential crescents/service roads are
        // out) — SPK-15 owner finding: routes ducked into subdivisions because
        // waypoints snapped onto neighbourhood streets. Endpoints keep full
        // snapping (a user's own start IS often residential).
        ...(isEndpoint || middleType === 'break'
          ? {}
          : { search_filter: { min_road_class: 'unclassified' } }),
      };
    }),
    costing: 'auto',
    ...(request.costingOptions ? { costing_options: { auto: request.costingOptions } } : {}),
  };

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body: unknown = await res.json();
  if (!res.ok) {
    const err = ValhallaErrorSchema.safeParse(body);
    if (err.success) {
      throw new ValhallaRouteError(err.data.error_code, err.data.status_code, err.data.error);
    }
    throw new ValhallaRouteError(-1, res.status, `unexpected error shape (HTTP ${res.status})`);
  }
  return mapRouteResponse(body);
}
