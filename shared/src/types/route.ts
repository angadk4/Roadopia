import { z } from 'zod';

/**
 * Route domain model + shared geo primitives + route enums (M0-T06).
 * Authority: Master Spec §21 (route), §94 (glossary/enums), §31 (curviness).
 *
 * Hard rule D: enums describe road *character* / *engagement* — NEVER speed/velocity.
 */

// --- Geo primitives (shared across the domain schemas) ---

/** A WGS84 (SRID 4326) coordinate. */
export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

/** GeoJSON position: `[lng, lat]`. */
export const PositionSchema = z.tuple([z.number(), z.number()]);
export type Position = z.infer<typeof PositionSchema>;

/** GeoJSON LineString (SRID 4326). */
export const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(PositionSchema).min(2),
});
export type LineString = z.infer<typeof LineStringSchema>;

/** Bounding box `[west, south, east, north]`. */
export const BBoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type BBox = z.infer<typeof BBoxSchema>;

// --- Route enums (single source of truth; non-speed per §59/§94) ---

/**
 * Enumerated descriptors of road *character* — never speed-related (§21/§94).
 * Seed set from §94's named examples + safe scenic/terrain descriptors; extensible.
 */
export const CharacterTagSchema = z.enum([
  'twisty',
  'flowing',
  'scenic',
  'backroad',
  'coastal',
  'forest',
  'mountain',
  'rural',
  'historic',
]);
export type CharacterTag = z.infer<typeof CharacterTagSchema>;

/** Single descriptor of *engagement* — never velocity (§59/§94). */
export const IntensitySchema = z.enum(['chill', 'moderate', 'spirited']);
export type Intensity = z.infer<typeof IntensitySchema>;

export const VisibilitySchema = z.enum(['public', 'private']);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const OriginTypeSchema = z.enum(['ai', 'manual', 'recorded']);
export type OriginType = z.infer<typeof OriginTypeSchema>;

// --- Elevation (computed; §31/§50) ---

export const ElevationPointSchema = z.object({
  dist_m: z.number().nonnegative(),
  elev_m: z.number(),
});
export type ElevationPoint = z.infer<typeof ElevationPointSchema>;

export const ElevationProfileSchema = z.object({
  series: z.array(ElevationPointSchema),
  climb_m: z.number().nonnegative(),
});
export type ElevationProfile = z.infer<typeof ElevationProfileSchema>;

// --- Constraint verdicts (M3 validate.ts produces; the M7 panel consumes) ---

/**
 * One validated constraint verdict (FR-042/FR-044: the panel reflects the
 * agent's ACTUAL satisfied/relaxed results, never fabricated). Tightened from
 * `z.unknown()` at M7-T05 — this is the exact wire shape the backend has
 * emitted since M3; now schema-checked end to end (backend imports this).
 */
export const ConstraintResultSchema = z.object({
  constraint: z.string(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  status: z.enum(['satisfied', 'violated', 'relaxed', 'not_applicable']),
  detail: z.string(),
});
export type ConstraintResult = z.infer<typeof ConstraintResultSchema>;
export type ConstraintStatus = ConstraintResult['status'];

// --- Route ---

/**
 * A saved drive (loop or A→B). Field set from Master Spec §21.
 * "Scenic" is a derived heuristic (§32) — intentionally NOT a stored field here.
 * There is no per-route danger/thrill field (safety pillar).
 */
export const RouteSchema = z.object({
  id: z.string().uuid().optional(), // assigned on persist
  geometry: LineStringSchema,
  /** Tolerance-reduced copy for map render / list payloads (egress control, §44). */
  geometry_simplified: LineStringSchema.nullable().optional(),
  bbox: BBoxSchema.nullable().optional(),
  is_loop: z.boolean(),
  waypoints: z.array(LatLngSchema),
  distance_m: z.number().nonnegative(),
  duration_s: z.number().nonnegative(),
  curviness: z.number().nonnegative(),
  elevation_profile: ElevationProfileSchema.nullable(),
  climb_m: z.number().nonnegative().nullable(),
  highway_flag: z.boolean(),
  toll_flag: z.boolean(),
  ferry_flag: z.boolean(),
  unpaved_flag: z.boolean(),
  character_tags: z.array(CharacterTagSchema),
  intensity: IntensitySchema,
  free_tags: z.array(z.string()),
  visibility: VisibilitySchema,
  owner_id: z.string().uuid().nullable(), // null = anonymous generation
  origin_type: OriginTypeSchema,
  forked_from: z.string().uuid().nullable(),
  // User-set metadata (§21):
  name: z.string().optional(),
  description: z.string().optional(),
  featured_spot_ids: z.array(z.string().uuid()).optional(),
  // AI-route-only provenance (§21):
  generation_request_id: z.string().uuid().nullable().optional(),
  satisfied_constraints: z.array(ConstraintResultSchema).nullable().optional(),
  agent_explanation: z.string().nullable().optional(),
});
export type Route = z.infer<typeof RouteSchema>;
