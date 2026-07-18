import { z } from 'zod';

import {
  CharacterTagSchema,
  IntensitySchema,
  LatLngSchema,
  StopFractionSchema,
  StopTypeSchema,
} from './route';

/**
 * `ParsedConstraints` — the typed object the planner consumes (M3-T01).
 * Authority: Experimental Protocol §3.4 (schema), §3.5 (clarify-vs-best-effort +
 * unsafe/injection/out-of-region dispositions), §3.6 (constraint tiers);
 * Master Spec §28. Evolved from the M0-T06 stub to the full protocol shape.
 *
 * Parser-agnostic by design: the rules parser (M3-T02) and the LLM parser (M5-T03)
 * both emit exactly this schema, validated before the pipeline touches it. Unknown/
 * missing fields carry EXPLICIT nulls — never guesses (§3.4). The parser emits no
 * geography beyond echoing/geocoding the user's own origin/destination.
 */

export const RouteShapeSchema = z.enum(['loop', 'a_to_b']);
export type RouteShape = z.infer<typeof RouteShapeSchema>;

/**
 * Where a drive starts: coordinates, the literal 'current' (device location), or a
 * place-name string awaiting geocoding. Null = unresolvable → the ONE clarify case
 * (a) of §3.5 (and 'origin' must appear in `missing`).
 */
export const OriginSchema = z.union([LatLngSchema, z.literal('current'), z.string().min(1)]);
export type Origin = z.infer<typeof OriginSchema>;

/** Destination: coords or place-name; null ⇒ loop (§3.4). */
export const DestinationSchema = z.union([LatLngSchema, z.string().min(1)]);
export type Destination = z.infer<typeof DestinationSchema>;

// StopType/StopFraction moved to route.ts (R16-3 — cycle avoidance); re-exported
// here so every existing importer keeps working.
export { StopTypeSchema, StopFractionSchema };
export type { StopType, StopFraction } from './route';

export const StopImportanceSchema = z.enum(['nice_to_have', 'required']);
export type StopImportance = z.infer<typeof StopImportanceSchema>;

export const StopRequestSchema = z.object({
  type: StopTypeSchema,
  count: z.number().int().positive(),
  importance: StopImportanceSchema,
  /** Aim the stop at this fraction of the drive; null = anytime. Soft
   *  (tier-3), disclosed when missed. `.default(null)` keeps pre-R16 payloads
   *  (refine round-trips, eval gold) valid. */
  at_fraction: StopFractionSchema.nullable().default(null),
});
export type StopRequest = z.infer<typeof StopRequestSchema>;

/** Tier-2 hard-relaxable exclusions (§3.6): enforced hard, relaxed only with disclosure. */
export const AvoidSchema = z.object({
  highways: z.boolean(),
  tolls: z.boolean(),
  ferries: z.boolean(),
  unpaved: z.boolean(),
});
export type Avoid = z.infer<typeof AvoidSchema>;

export const SurfacePrefSchema = z.enum(['paved', 'any']);
export type SurfacePref = z.infer<typeof SurfacePrefSchema>;

/** §3.4 preset list (Hard rule D: engagement/character framing, never speed).
 *  'simple' (R16-4) = the owner-facing relabel of chill's FROZEN vector
 *  (minimal turns, mostly straight roads); 'chill' stays a recognized alias. */
export const PresetSchema = z.enum([
  'scenic',
  'twisty',
  'chill',
  'simple',
  'backroads',
  'coffee_stop',
  'avoid_highways',
]);
export type Preset = z.infer<typeof PresetSchema>;

/**
 * Soft-objective weights (advanced sliders; override the preset where set).
 * Keys stay an open record until M3-T10/[GATE-W] freezes the vector.
 */
export const WeightsSchema = z.record(z.string(), z.number());
export type Weights = z.infer<typeof WeightsSchema>;

/** "near X" / "through X" / "avoid X" location constraints, resolved later to
 *  geometry (§3.4; R18-4 adds 'through' — "through Forks of the Credit" is a
 *  distinct intent: DRIVE it, not just pass nearby). */
export const LocationConstraintSchema = z.object({
  kind: z.enum(['near', 'avoid', 'through']),
  text: z.string().min(1),
});
export type LocationConstraint = z.infer<typeof LocationConstraintSchema>;

/** Detected conflicts (§3.5); `shape` conflicts are the ONE clarify case (b). */
export const ContradictionSchema = z.object({
  kind: z.enum(['shape', 'duration_vs_stops', 'character', 'other']),
  description: z.string(),
});
export type Contradiction = z.infer<typeof ContradictionSchema>;

export const ConfidenceSchema = z.object({
  overall: z.number().min(0).max(1),
  /** Optional per-field confidences, 0–1 each. */
  fields: z.record(z.string(), z.number().min(0).max(1)).default({}),
});
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ClarificationSchema = z.object({
  needed: z.boolean(),
  question: z.string().nullable(),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

/** Sanity ceiling for a day drive; "out-of-range duration rejected" (M3-T01 AC). */
export const MAX_DURATION_S = 12 * 3600;
export const MAX_DISTANCE_M = 1_000_000;

const ParsedConstraintsBase = z.object({
  origin: OriginSchema.nullable(),
  destination: DestinationSchema.nullable(),
  shape: RouteShapeSchema,
  duration_target_s: z.number().int().positive().max(MAX_DURATION_S).nullable(),
  distance_target_m: z.number().int().positive().max(MAX_DISTANCE_M).nullable(),
  stops: z.array(StopRequestSchema),
  avoid: AvoidSchema,
  surface_pref: SurfacePrefSchema,
  character: z.array(CharacterTagSchema),
  scenic_pref: z.number().min(0).max(1).nullable(),
  twistiness_pref: z.number().min(0).max(1).nullable(),
  intensity: IntensitySchema.nullable(),
  preset: PresetSchema.nullable(),
  weights: WeightsSchema.nullable(),
  location_constraints: z.array(LocationConstraintSchema),
  ambiguous_terms: z.array(z.string()),
  missing: z.array(z.string()),
  contradictions: z.array(ContradictionSchema),
  confidence: ConfidenceSchema,
  clarification: ClarificationSchema,
  unsafe_flag: z.boolean(),
  out_of_region_flag: z.boolean(),
  prompt_injection_flag: z.boolean(),
});

/**
 * Full schema with the §3.4/§3.5 cross-field rules:
 *  - a_to_b needs a destination (or 'destination' listed in `missing`);
 *  - a null origin must be declared in `missing` (explicit, not a guess);
 *  - clarification only for the two §3.5-sanctioned cases (no origin / shape
 *    contradiction), and it must carry a question.
 */
export const ParsedConstraintsSchema = ParsedConstraintsBase.superRefine((pc, ctx) => {
  if (pc.shape === 'a_to_b' && pc.destination === null && !pc.missing.includes('destination')) {
    ctx.addIssue({
      code: 'custom',
      path: ['destination'],
      message: "shape 'a_to_b' requires a destination (or list 'destination' in missing)",
    });
  }
  if (pc.origin === null && !pc.missing.includes('origin')) {
    ctx.addIssue({
      code: 'custom',
      path: ['origin'],
      message: 'a null origin must be declared in missing (explicit nulls, not guesses)',
    });
  }
  if (pc.clarification.needed) {
    const originCase = pc.origin === null;
    const shapeCase = pc.contradictions.some((c) => c.kind === 'shape');
    if (!originCase && !shapeCase) {
      ctx.addIssue({
        code: 'custom',
        path: ['clarification'],
        message: 'clarification allowed only for no-origin or shape-contradiction (§3.5)',
      });
    }
    if (pc.clarification.question === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['clarification', 'question'],
        message: 'clarification.needed requires a question',
      });
    }
  }
});
export type ParsedConstraints = z.infer<typeof ParsedConstraintsSchema>;

/** Validate raw parser output; throws ZodError with field paths on violation. */
export function validateParsedConstraints(raw: unknown): ParsedConstraints {
  return ParsedConstraintsSchema.parse(raw);
}

/** The §3.5 decision outcomes, in precedence order. */
export type Disposition = 'refuse_unsafe' | 'redirect_out_of_region' | 'clarify' | 'proceed';

/**
 * Apply the §3.5 decision rule. Precedence: unsafe → out-of-region → clarify →
 * proceed. Prompt injection does NOT change the disposition — the injected
 * instruction is ignored and the surrounding brief proceeds normally (§3.5 rule 2);
 * the flag rides along for logging/trace honesty.
 */
export function resolveDisposition(pc: ParsedConstraints): Disposition {
  if (pc.unsafe_flag) return 'refuse_unsafe';
  if (pc.out_of_region_flag) return 'redirect_out_of_region';
  if (pc.clarification.needed) return 'clarify';
  return 'proceed';
}
