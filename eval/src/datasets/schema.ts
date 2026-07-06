/**
 * Request-dataset schema (M4-T01; Protocol §6).
 *
 * Six splits: DEV (tune everything here), VAL (read often, never tune), TEST
 * (LOCKED — final numbers only, once per frozen config), ADV (unsafe/injection/
 * impossible/out-of-region/contradictory), REF (multi-turn refinement, §17),
 * PFR (production-failure regression — append-only, starts empty).
 *
 * Leakage rules (§6.4): the same (origin, brief) never appears in two splits;
 * DEV/VAL/TEST use disjoint phrasings and disjoint origins where possible.
 * Versioning (§6.5): the dataset carries a semantic version (`reqset-vN`)
 * recorded with every experiment manifest; additions bump the version with a
 * changelog line — the dataset only grows.
 *
 * Gold labels (§7, authored at M4-T02) are nullable HERE so the scaffold can
 * exist before labeling; the harness validates with `requireGold` once T02
 * lands. Gold encodes INTENT, not a route (bands, not points), and is authored
 * before any model output is seen for that example.
 */

import { ParsedConstraintsSchema } from '@shared/types';
import { z } from 'zod';

export const SplitSchema = z.enum(['dev', 'val', 'test', 'adv', 'ref', 'pfr']);
export type Split = z.infer<typeof SplitSchema>;

/** §5 origin archetypes — at least one pinned origin per archetype. */
export const OriginArchetypeSchema = z.enum([
  'dense_urban',
  'suburban_edge',
  'rural_twisty_rich',
  'sparse',
  'water_adjacent',
  'escarpment',
]);
export type OriginArchetype = z.infer<typeof OriginArchetypeSchema>;

/** §6.1 duration bands: short ≤45 min · medium 46–120 · long >120. */
export const DurationBandSchema = z.enum(['short', 'medium', 'long']);
export type DurationBand = z.infer<typeof DurationBandSchema>;

export const TractabilitySchema = z.enum(['clearly_feasible', 'borderline', 'impossible']);
export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export const CompositionSchema = z.enum(['single', 'combined']);
export const SpecialTagSchema = z.enum([
  'refinement',
  'contradictory',
  'unsupported_region',
  'unsafe',
  'prompt_injection',
]);
export type SpecialTag = z.infer<typeof SpecialTagSchema>;

/** Pinned, versioned origins (§5/§6.3) — real gazetteer coordinates. */
export const PinnedOriginSchema = z.object({
  id: z.string().regex(/^org-[a-z0-9-]+$/),
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  archetype: OriginArchetypeSchema,
});
export type PinnedOrigin = z.infer<typeof PinnedOriginSchema>;

/** §3.5 dispositions the gold may expect. */
export const ExpectedDispositionSchema = z.enum([
  'proceed',
  'refuse_unsafe',
  'redirect_out_of_region',
  'clarify',
]);

/**
 * Gold label (§7): the PARSE gold is a full ParsedConstraints object ("what a
 * reasonable enthusiast would understand the brief to require"); the OUTCOME
 * gold adds the expected disposition + acceptable relaxations. Kept together
 * per example, used separately by the metrics (§7.4).
 */
export const GoldLabelSchema = z.object({
  constraints: ParsedConstraintsSchema,
  expected_disposition: ExpectedDispositionSchema,
  /** For impossible/borderline briefs: which relaxations gold accepts. */
  acceptable_relaxations: z.array(z.string()),
  /** One-line auditability rationale (§7.2). */
  rationale: z.string().min(1),
});
export type GoldLabel = z.infer<typeof GoldLabelSchema>;

const TagsSchema = z.object({
  shape: z.enum(['loop', 'a_to_b']),
  duration_band: DurationBandSchema,
  archetype: OriginArchetypeSchema,
  /** Free-form constraint markers, e.g. 'no_highway', 'stops_coffee', 'twistiness'. */
  constraints: z.array(z.string()),
  composition: CompositionSchema,
  tractability: TractabilitySchema,
  special: z.array(SpecialTagSchema),
});

/** One single-turn dataset example. Id prefix must match its split. */
export const RequestExampleSchema = z
  .object({
    id: z.string().regex(/^(dev|val|test|adv|pfr)-\d{3}$/),
    split: SplitSchema.exclude(['ref']),
    brief: z.string().min(1),
    /** Pinned-origin ref; null when the brief itself carries (or omits) the origin. */
    origin_id: z.string().nullable(),
    tags: TagsSchema,
    difficulty: DifficultySchema,
    gold: GoldLabelSchema.nullable(),
    added_in: z.string().regex(/^reqset-v\d+$/),
  })
  .superRefine((ex, ctx) => {
    if (!ex.id.startsWith(`${ex.split}-`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: `id prefix must match split '${ex.split}'`,
      });
    }
  });
export type RequestExample = z.infer<typeof RequestExampleSchema>;

/** Multi-turn refinement example (REF split; §17 merge semantics). */
export const RefExampleSchema = z
  .object({
    id: z.string().regex(/^ref-\d{3}$/),
    split: z.literal('ref'),
    /** ≥2 user turns; turn 1 is the initial brief, later turns refine it. */
    turns: z.array(z.string().min(1)).min(2),
    origin_id: z.string().nullable(),
    tags: TagsSchema,
    difficulty: DifficultySchema,
    /** Gold = constraints AFTER the final merge + per-turn merge rationale. */
    gold: z
      .object({
        final_constraints: ParsedConstraintsSchema,
        expected_disposition: ExpectedDispositionSchema,
        merge_rationale: z.string().min(1),
      })
      .nullable(),
    added_in: z.string().regex(/^reqset-v\d+$/),
  })
  .superRefine((ex, ctx) => {
    if (!ex.tags.special.includes('refinement')) {
      ctx.addIssue({
        code: 'custom',
        path: ['tags'],
        message: "REF examples must carry special tag 'refinement'",
      });
    }
  });
export type RefExample = z.infer<typeof RefExampleSchema>;

/** §6.2 split-size targets (single-turn counts; REF is multi-turn). */
export const SPLIT_TARGETS: Record<Exclude<Split, 'pfr'>, { min: number; max: number }> = {
  dev: { min: 40, max: 50 },
  val: { min: 20, max: 25 },
  test: { min: 25, max: 30 },
  adv: { min: 15, max: 20 },
  ref: { min: 15, max: 20 },
};

export const ReqsetManifestSchema = z.object({
  version: z.string().regex(/^reqset-v\d+$/),
  created: z.string().min(1),
  counts: z.object({
    dev: z.number().int().nonnegative(),
    val: z.number().int().nonnegative(),
    test: z.number().int().nonnegative(),
    adv: z.number().int().nonnegative(),
    ref: z.number().int().nonnegative(),
    pfr: z.number().int().nonnegative(),
  }),
  origins_file: z.string().min(1),
  changelog: z.array(z.string().min(1)).min(1),
});
export type ReqsetManifest = z.infer<typeof ReqsetManifestSchema>;

export interface Reqset {
  manifest: ReqsetManifest;
  origins: PinnedOrigin[];
  dev: RequestExample[];
  val: RequestExample[];
  test: RequestExample[];
  adv: RequestExample[];
  ref: RefExample[];
  pfr: RequestExample[];
}
