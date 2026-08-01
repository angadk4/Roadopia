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
 * the mapper emits `false` and ASSEMBLY overrides it from the trace's per-edge
 * `unpaved` flags (R16-2 — probed live 2026-07-16; the honest measurement).
 *
 * R16-2 legs: per-leg summaries are preserved. Valhalla legs exist only between
 * break/break_through locations ('through' middles never split) — so STOP
 * waypoints are routed as 'break_through' (a stop IS a stop; no U-turn) and
 * arrival-at-stop = cumulative leg durations. Probed live: 3 locations with a
 * break_through middle → 2 legs, each with summary.time.
 */

import { RouteThroughOutputSchema, type Maneuver, type RouteThroughOutput } from '@shared/types';
import { z } from 'zod';

import { decodePolyline } from './polyline';

// --- request ---

/**
 * Costing options Roadopia actually uses (soft use_* weights + hard
 * exclusions). Keep this interface TIGHT: Valhalla silently ignores unknown
 * keys AND silently clamps out-of-range values (probed on 3.7.0, round 7) —
 * a typo here would fail without any signal.
 */
export interface AutoCostingOptions {
  /** ⚠️ R25-U2: VERIFIED NO-OP on the pinned 3.7.0 (probed 2026-07-26 —
   *  byte-identical route/time/shape to a deliberately bogus control key).
   *  Kept as the caller-facing INTENT flag; realizeCostingOptions() translates
   *  it into the lever that works (use_highways: 0, and dropping `shortest`,
   *  which bypasses every soft factor). Never trust it alone again. */
  exclude_highways?: boolean;
  /** Same probe caveat as exclude_highways (unproven either way on a toll-free
   *  pair) — realizeCostingOptions() adds use_tolls: 0 alongside it. */
  exclude_tolls?: boolean;
  /** Same — realizeCostingOptions() adds use_ferry: 0 alongside it. */
  exclude_ferries?: boolean;
  /** Best-effort steering only (BD-16): Valhalla permits unpaved at the path's
   *  start/end and keeps it where no paved alternative exists (probed: option
   *  present in the 3.7 binary; a gravel-belt corridor kept its gravel). The
   *  TRACE result-scan is the guarantee; validation gates on the measurement. */
  exclude_unpaved?: boolean;
  /** Soft preference 0..1 (Valhalla default 1). THE working highway lever
   *  (probed: use_highways: 0 removed 64 % highway; exclude_highways removed
   *  0 %) — but BYPASSED under `shortest`. */
  use_highways?: number;
  use_tolls?: number;
  /** Soft ferry preference 0..1 (Valhalla auto option `use_ferry`). */
  use_ferry?: number;
  /** 0..1; near 0 avoids living_street edges (Valhalla default 0.1). */
  use_living_streets?: number;
  /** 0..1; near 0 avoids `track` edges (farm/forestry tracks). Probed at
   *  R26-B1 as a guard on the country tier's new material. */
  use_tracks?: number;
  /** km/h ceiling the router costs against. R26-B1 probes this as the
   *  road-CLASS proxy nobody had tried: a low ceiling makes fast roads
   *  unattractive without a hard exclusion. Like every soft factor it is
   *  BYPASSED under `shortest` — which is precisely why the fun profile has
   *  never honoured one. */
  top_speed?: number;
  /** Seconds added at transitions between unlike-named roads (default 5) —
   *  discourages subdivision rat-runs (round 7). */
  maneuver_penalty?: number;
  /** DISTANCE-optimal routing (R18-1, probed live 2026-07-16): removes the
   *  speed advantage that makes arterials win every connector — measured
   *  arterial share 99 %→5 % (Waterdown–Campbellville) and 81 %→34 %
   *  (Larson–Belfountain) for ~+5 min per 23 km hop. NOTE: shortest BYPASSES
   *  the soft use_* factors (probed: maneuver_penalty added nothing on top);
   *  hard exclude_* filters still apply. */
  shortest?: boolean;
}

/**
 * R25-U2 kill switch — `AVOID_REAL_LEVERS=off` restores the (inert) legacy
 * pass-through byte-identically. Default ON: an avoid toggle that does nothing
 * is a defect, not a baseline worth preserving.
 */
export const AVOID_REAL_LEVERS_ON = process.env['AVOID_REAL_LEVERS'] !== 'off';

/**
 * R25-U2 — translate the documented avoid INTENT into levers the pinned
 * Valhalla actually honours. Probe (2026-07-26, kimberley→markdale, traced):
 *
 *   {} baseline                      38.48 km · 2232 s · 64 % highway
 *   {exclude_highways: true}         38.48 km · 2232 s · 64 % — BYTE-IDENTICAL
 *   {roadopia_bogus_control: true}   38.48 km · 2232 s · identical (control)
 *   {use_highways: 0}                45.01 km · 2949 s · **0 % highway**
 *   {shortest: true, use_highways:0} unchanged — `shortest` BYPASSES use_*
 *
 * So: a hard highway avoid emits `use_highways: 0` AND drops `shortest` (the
 * two are mutually exclusive); tolls/ferries get their soft levers alongside
 * the exclude_* keys (kept — zero cost, future engines may honour them). The
 * trace result-scan stays the truth for validation either way.
 */
export function realizeCostingOptions(opts: AutoCostingOptions): AutoCostingOptions {
  if (!AVOID_REAL_LEVERS_ON) return opts;
  const out: AutoCostingOptions = { ...opts };
  if (opts.exclude_highways === true) {
    out.use_highways = 0;
    delete out.shortest; // shortest bypasses every soft factor — the avoid wins
  }
  if (opts.exclude_tolls === true) out.use_tolls = 0;
  if (opts.exclude_ferries === true) out.use_ferry = 0;
  return out;
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
  middleType?: 'break' | 'through' | 'via';
  /**
   * Indices into `waypoints` that are REAL STOPS (R16-2): routed as
   * 'break_through' (stop without U-turn) regardless of middleType — the only
   * location type that SPLITS legs, making per-stop arrival times measurable.
   */
  stopIndices?: ReadonlyArray<number>;
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

const ValhallaLegSummarySchema = z.object({
  time: z.number().nonnegative(), // seconds
  length: z.number().nonnegative(), // kilometres
});

const ValhallaLegSchema = z.object({
  shape: z.string(),
  summary: ValhallaLegSummarySchema, // 3.7 always emits it (fixture + probe)
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
    legs: legs.map((l) => ({ duration_s: l.summary.time, distance_m: l.summary.length * 1000 })),
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
  result: Pick<RouteThroughOutput, 'has_highway' | 'has_toll' | 'has_ferry' | 'has_unpaved'>,
): string[] {
  const violations: string[] = [];
  if (requested?.exclude_highways && result.has_highway) violations.push('highway');
  if (requested?.exclude_tolls && result.has_toll) violations.push('toll');
  if (requested?.exclude_ferries && result.has_ferry) violations.push('ferry');
  if (requested?.exclude_unpaved && result.has_unpaved) violations.push('unpaved');
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
  const stopSet = new Set(request.stopIndices ?? []);
  const payload = {
    locations: request.waypoints.map(([lon, lat], i) => {
      const isEndpoint = i === 0 || i === last;
      return {
        lat,
        lon,
        type: isEndpoint ? 'break' : stopSet.has(i) ? 'break_through' : middleType,
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
    // R25-U2: translate avoid INTENT into levers the engine honours
    ...(request.costingOptions
      ? { costing_options: { auto: realizeCostingOptions(request.costingOptions) } }
      : {}),
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
