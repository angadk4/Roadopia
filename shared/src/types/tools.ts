import { z } from 'zod';

import { ElevationProfileSchema, LatLngSchema, LineStringSchema, BBoxSchema } from './route';
import { SpotSourceSchema, SpotTypeSchema } from './spot';

/**
 * Tool I/O + LLM decision I/O schemas (M0-T06). Authority: Master Spec §50.
 *
 * All tools are READ-ONLY and schema-validated; coordinates are bounded to the
 * region `.poly` at the call site. The LLM never returns coordinates or invented
 * names — malformed/out-of-range outputs are rejected and re-prompted (§36–§37).
 */

// --- find_spots ---
export const FindSpotsInputSchema = z.object({
  origin: LatLngSchema,
  radius_m: z.number().positive().optional(),
  polygon: z.array(LatLngSchema).optional(),
  types: z.array(SpotTypeSchema).optional(),
  limit: z.number().int().positive().optional(),
});
export type FindSpotsInput = z.infer<typeof FindSpotsInputSchema>;

export const FoundSpotSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: SpotTypeSchema,
  lat: z.number(),
  lng: z.number(),
  source: SpotSourceSchema,
});
export const FindSpotsOutputSchema = z.array(FoundSpotSchema);
export type FoundSpot = z.infer<typeof FoundSpotSchema>;
export type FindSpotsOutput = z.infer<typeof FindSpotsOutputSchema>;

// --- find_curvy_roads ---
export const FindCurvyRoadsInputSchema = z.object({
  bbox: BBoxSchema.optional(),
  polygon: z.array(LatLngSchema).optional(),
  min_curviness: z.number(),
  limit: z.number().int().positive().optional(),
});
export type FindCurvyRoadsInput = z.infer<typeof FindCurvyRoadsInputSchema>;

export const CurvySegmentSchema = z.object({
  id: z.string(),
  osm_way_id: z.string(), // OSM ids exceed safe-int range → string
  curviness: z.number().nonnegative(),
  road_class: z.string(),
  geometry: LineStringSchema,
});
export const FindCurvyRoadsOutputSchema = z.array(CurvySegmentSchema);
export type CurvySegment = z.infer<typeof CurvySegmentSchema>;
export type FindCurvyRoadsOutput = z.infer<typeof FindCurvyRoadsOutputSchema>;

// --- route_through ---
export const RouteThroughInputSchema = z.object({
  waypoints: z.array(LatLngSchema).min(2),
  costing_profile: z.string(),
});
export type RouteThroughInput = z.infer<typeof RouteThroughInputSchema>;

/** A single turn-by-turn maneuver. Starting shape; mapped from Valhalla at M2. */
export const ManeuverSchema = z.object({
  type: z.string(),
  instruction: z.string(),
  distance_m: z.number().nonnegative().optional(),
});
export type Maneuver = z.infer<typeof ManeuverSchema>;

/** One route leg between consecutive BREAK-type locations (R16-2).
 *  'through' middles never split legs — with S stop waypoints, S+1 legs. */
export const RouteLegSchema = z.object({
  duration_s: z.number().nonnegative(),
  distance_m: z.number().nonnegative(),
});
export type RouteLeg = z.infer<typeof RouteLegSchema>;

export const RouteThroughOutputSchema = z.object({
  geometry: LineStringSchema,
  distance_m: z.number().nonnegative(),
  duration_s: z.number().nonnegative(),
  /** Per-leg summaries in drive order — arrival-at-stop data (R16-2).
   *  Default [] keeps pre-R16 payloads/fixtures valid. */
  legs: z.array(RouteLegSchema).default([]),
  maneuvers: z.array(ManeuverSchema),
  has_highway: z.boolean(),
  has_toll: z.boolean(),
  has_ferry: z.boolean(),
  has_unpaved: z.boolean(),
});
export type RouteThroughOutput = z.infer<typeof RouteThroughOutputSchema>;

// --- get_elevation_profile ---
export const GetElevationProfileInputSchema = z.object({ geometry: LineStringSchema });
export const GetElevationProfileOutputSchema = ElevationProfileSchema;
export type GetElevationProfileInput = z.infer<typeof GetElevationProfileInputSchema>;
export type GetElevationProfileOutput = z.infer<typeof GetElevationProfileOutputSchema>;

// --- estimate_drive_time ---
export const EstimateDriveTimeInputSchema = z.object({ geometry: LineStringSchema });
export const EstimateDriveTimeOutputSchema = z.object({ duration_s: z.number().nonnegative() });
export type EstimateDriveTimeInput = z.infer<typeof EstimateDriveTimeInputSchema>;
export type EstimateDriveTimeOutput = z.infer<typeof EstimateDriveTimeOutputSchema>;

// --- get_isochrone ---
export const GetIsochroneInputSchema = z.object({
  origin: LatLngSchema,
  time_s: z.number().int().positive(),
  costing: z.string(),
});
export const GetIsochroneOutputSchema = z.object({
  /** Reachable-area polygon ring (SRID 4326). */
  polygon: z.array(LatLngSchema).min(3),
});
export type GetIsochroneInput = z.infer<typeof GetIsochroneInputSchema>;
export type GetIsochroneOutput = z.infer<typeof GetIsochroneOutputSchema>;

// --- optimize_waypoint_order (A→B multi-stop) ---
export const OptimizeWaypointOrderInputSchema = z.object({
  waypoints: z.array(LatLngSchema),
  costing: z.string(),
});
export const OptimizeWaypointOrderOutputSchema = z.object({
  ordered_indices: z.array(z.number().int().nonnegative()),
});
export type OptimizeWaypointOrderInput = z.infer<typeof OptimizeWaypointOrderInputSchema>;
export type OptimizeWaypointOrderOutput = z.infer<typeof OptimizeWaypointOrderOutputSchema>;

// --- LLM decision I/O (structured outputs, schema-validated before use, §50) ---

export const CandidateSelectionSchema = z.object({
  chosen_candidate_id: z.string(),
  rationale_short: z.string(),
});
export type CandidateSelection = z.infer<typeof CandidateSelectionSchema>;

export const CorrectionMoveSchema = z.object({
  move: z.enum(['drop_wp', 'relocate_wp', 'add_stop', 'reshape_sector', 'relax_soft']),
  params: z.record(z.string(), z.unknown()),
});
export type CorrectionMove = z.infer<typeof CorrectionMoveSchema>;

export const ExplanationSchema = z.object({
  text: z.string(),
  satisfied: z.array(z.string()),
  relaxed: z.array(z.string()),
});
export type Explanation = z.infer<typeof ExplanationSchema>;
