import { z } from 'zod';

import { ParsedConstraintsSchema } from './constraints';
import { RouteSchema } from './route';
import { ExplanationSchema } from './tools';

/**
 * Planner generation events streamed to the UI over SSE (M0-T06).
 * Authority: Master Spec §27.3 (state machine) + FR-041 (stream steps over SSE).
 *
 * Hard rule I: the trace exposes pipeline steps + tool calls + grounded/validated
 * results ONLY — never raw model reasoning (no chain-of-thought).
 */

/** The deterministic pipeline's steps (§27.3 state machine). */
export const PipelineStepSchema = z.enum([
  'parse',
  'validate_constraints',
  'scope',
  'retrieve',
  'generate_candidates',
  'diversify',
  'route_candidates',
  'score_rank',
  'select',
  'validate_route',
  'self_correct',
  'enrich',
  'explain',
  'persist',
]);
export type PipelineStep = z.infer<typeof PipelineStepSchema>;

const StepEventSchema = z.object({
  type: z.literal('step'),
  step: PipelineStepSchema,
  status: z.enum(['started', 'completed']),
  detail: z.string().optional(),
});

const ToolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  tool: z.string(),
});

const ToolResultEventSchema = z.object({
  type: z.literal('tool_result'),
  tool: z.string(),
  ok: z.boolean(),
  count: z.number().int().nonnegative().optional(),
});

const RouteEventSchema = z.object({
  type: z.literal('route'),
  route: RouteSchema,
});

/**
 * A feasible runner-up option (M7-T09/FB-4, additive per BD-45(7)): the
 * diversify-kept candidates the presenter used to discard. Emitted after the
 * best `route` frame, best-first; no elevation/LLM enrichment (cost stays on
 * the recommended option).
 */
const AlternateEventSchema = z.object({
  type: z.literal('alternate'),
  route: RouteSchema,
});

const ExplanationEventSchema = z.object({
  type: z.literal('explanation'),
  explanation: ExplanationSchema,
});

const ErrorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
});

/**
 * The effective ParsedConstraints for this run (M7-T07, additive per BD-45(7)).
 * Emitted after parse/refine-merge so the client can hold the running `c` for
 * conversational refinement (Spec §34: "memory is session-scoped; the caller
 * holds the running c"). VALIDATED parse output only — never model reasoning.
 */
const ConstraintsEventSchema = z.object({
  type: z.literal('constraints'),
  constraints: ParsedConstraintsSchema,
});

const DoneEventSchema = z.object({
  type: z.literal('done'),
  status: z.enum(['ok', 'relaxed', 'best_so_far', 'unavailable']),
});

/** Discriminated union of everything the `/plan` SSE stream can emit. */
export const GenerationEventSchema = z.discriminatedUnion('type', [
  StepEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  RouteEventSchema,
  AlternateEventSchema,
  ExplanationEventSchema,
  ErrorEventSchema,
  ConstraintsEventSchema,
  DoneEventSchema,
]);
export type GenerationEvent = z.infer<typeof GenerationEventSchema>;
