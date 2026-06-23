import { z } from 'zod';

import { CharacterTagSchema, LatLngSchema } from './route';
import { SpotTypeSchema } from './spot';

/**
 * Parsed-brief constraint model (M0-T06). Authority: Master Spec §28 (three-tier
 * constraint model) + §50 (the `ParsedConstraints` LLM-output schema).
 *
 * This is the parse step's structured output — schema-validated before the
 * deterministic pipeline uses it. The LLM emits NO geography beyond echoing the
 * supplied origin/destination coordinates.
 */

export const RouteShapeSchema = z.enum(['loop', 'a_to_b']);
export type RouteShape = z.infer<typeof RouteShapeSchema>;

/** Tier-2 hard-by-default exclusions (relax-only-with-disclosure, §28). */
export const HardConstraintsSchema = z.object({
  no_highways: z.boolean(),
  no_tolls: z.boolean(),
  no_ferries: z.boolean(),
  no_unpaved: z.boolean(),
});
export type HardConstraints = z.infer<typeof HardConstraintsSchema>;

export const DesiredStopSchema = z.object({
  type: SpotTypeSchema,
  count: z.number().int().positive(),
});
export type DesiredStop = z.infer<typeof DesiredStopSchema>;

/**
 * Soft-objective weights. Keys are intentionally open (a record) pending the
 * deterministic scoring design frozen at M3/M4 ([GATE-W]); values are weights.
 */
export const WeightsSchema = z.record(z.string(), z.number());
export type Weights = z.infer<typeof WeightsSchema>;

export const ParsedConstraintsSchema = z.object({
  origin_area: LatLngSchema,
  duration_target_s: z.number().int().positive(),
  duration_tolerance: z.number().min(0).max(1),
  shape: RouteShapeSchema,
  destination: LatLngSchema.optional(), // required only for a_to_b
  character_prefs: z.array(CharacterTagSchema),
  hard_constraints: HardConstraintsSchema,
  desired_stops: z.array(DesiredStopSchema),
  weights: WeightsSchema,
});
export type ParsedConstraints = z.infer<typeof ParsedConstraintsSchema>;
