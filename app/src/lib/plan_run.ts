/**
 * Generation-run state (M7-T04; FR-041, §27.3). A PURE reducer over the SSE
 * GenerationEvents so every transition — step start/complete, per-iteration
 * repeats, tool grounding rows, friendly errors, guard rejections, cancel,
 * backgrounding — is unit-tested without a device.
 *
 * The timeline entries double as the reasoning-view source (M7-T06): pipeline
 * steps + tool calls + grounded result counts + validated outputs ONLY — the
 * wire schema has no channel for model reasoning, and off-schema frames are
 * dropped before they ever reach this reducer (Hard rule I).
 */

import type { GenerationEvent, ParsedConstraints, PipelineStep, Route } from '@shared/types';

import type { ApiError } from './api';
import type { DoneStatus } from './plan_stream';

export interface StepEntry {
  kind: 'step';
  step: PipelineStep;
  status: 'started' | 'completed';
  detail: string | null;
}

export interface ToolEntry {
  kind: 'tool';
  tool: string;
  /** null while in flight; then the grounded outcome. */
  ok: boolean | null;
  count: number | null;
}

export type TimelineEntry = StepEntry | ToolEntry;

export interface Explanation {
  text: string;
  satisfied: string[];
  relaxed: string[];
}

export type RunPhase =
  | 'streaming'
  | 'succeeded' // route delivered (done ok | relaxed | best_so_far)
  | 'no_route' // done unavailable — errorMessage says why, honestly
  | 'guard_rejected' // pre-stream 429/503/400 JSON
  | 'network_failed' // could not reach / connection lost mid-run
  | 'cancelled'; // user cancel or backgrounding

export interface PlanRunState {
  phase: RunPhase;
  timeline: TimelineEntry[];
  route: Route | null;
  /** Feasible runner-up options (FB-4) — best-first, no elevation/LLM enrich. */
  alternates: Route[];
  explanation: Explanation | null;
  /** The effective running `c` (constraints event) — held client-side for
   *  conversational refinement (Spec §34). */
  constraints: ParsedConstraints | null;
  /** Friendly error-event text (clarify questions arrive here too). */
  errorMessage: string | null;
  done: DoneStatus | null;
  /** Set when phase === 'guard_rejected'. */
  guard: { code: string; message: string; retryAfterS: number | null } | null;
  /** True when the app was backgrounded mid-run (the §14 design: cancel +
   *  offer retry — no fetch-later store exists before M8). */
  wentToBackground: boolean;
}

export const INITIAL_RUN: PlanRunState = {
  phase: 'streaming',
  timeline: [],
  route: null,
  alternates: [],
  explanation: null,
  constraints: null,
  errorMessage: null,
  done: null,
  guard: null,
  wentToBackground: false,
};

export type RunAction =
  | { type: 'reset' } // new attempt starts (retry) — back to a clean run
  | { type: 'event'; event: GenerationEvent }
  | { type: 'stream_end'; done: DoneStatus | null; aborted: boolean }
  | { type: 'guard_rejected'; error: Pick<ApiError, 'code' | 'message' | 'retryAfterS'> }
  | { type: 'network_failed' }
  | { type: 'cancelled' }
  | { type: 'backgrounded' };

function applyEvent(state: PlanRunState, event: GenerationEvent): PlanRunState {
  switch (event.type) {
    case 'step': {
      const timeline = [...state.timeline];
      if (event.status === 'completed') {
        // Complete the LAST open row for this step (iterations may repeat steps).
        for (let i = timeline.length - 1; i >= 0; i--) {
          const e = timeline[i]!;
          if (e.kind === 'step' && e.step === event.step && e.status === 'started') {
            timeline[i] = { ...e, status: 'completed', detail: event.detail ?? null };
            return { ...state, timeline };
          }
        }
      }
      timeline.push({
        kind: 'step',
        step: event.step,
        status: event.status,
        detail: event.detail ?? null,
      });
      return { ...state, timeline };
    }
    case 'tool_call':
      return {
        ...state,
        timeline: [...state.timeline, { kind: 'tool', tool: event.tool, ok: null, count: null }],
      };
    case 'tool_result': {
      const timeline = [...state.timeline];
      for (let i = timeline.length - 1; i >= 0; i--) {
        const e = timeline[i]!;
        if (e.kind === 'tool' && e.tool === event.tool && e.ok === null) {
          timeline[i] = { ...e, ok: event.ok, count: event.count ?? null };
          return { ...state, timeline };
        }
      }
      timeline.push({
        kind: 'tool',
        tool: event.tool,
        ok: event.ok,
        count: event.count ?? null,
      });
      return { ...state, timeline };
    }
    case 'route':
      return { ...state, route: event.route };
    case 'alternate':
      return { ...state, alternates: [...state.alternates, event.route] };
    case 'constraints':
      return { ...state, constraints: event.constraints };
    case 'explanation':
      return { ...state, explanation: event.explanation };
    case 'error':
      return { ...state, errorMessage: event.message };
    case 'done':
      return { ...state, done: event.status };
  }
}

export function runReducer(state: PlanRunState, action: RunAction): PlanRunState {
  switch (action.type) {
    case 'reset':
      return INITIAL_RUN;
    case 'event':
      return applyEvent(state, action.event);
    case 'stream_end': {
      if (state.phase !== 'streaming') return state; // cancel/guard already settled it
      if (action.aborted) return { ...state, phase: 'cancelled' };
      if (action.done === null) return { ...state, phase: 'network_failed' };
      if (action.done === 'unavailable') return { ...state, phase: 'no_route', done: action.done };
      // done promised a route but none decoded (schema skew / dropped frame):
      // an honest connection-style failure beats a dead-end 'succeeded'.
      if (state.route === null) return { ...state, phase: 'network_failed', done: action.done };
      return { ...state, phase: 'succeeded', done: action.done };
    }
    case 'guard_rejected':
      if (state.phase !== 'streaming') return state; // late settlement never overrides
      return {
        ...state,
        phase: 'guard_rejected',
        guard: {
          code: action.error.code,
          message: action.error.message,
          retryAfterS: action.error.retryAfterS,
        },
      };
    case 'network_failed':
      if (state.phase !== 'streaming') return state; // late settlement never overrides
      return { ...state, phase: 'network_failed' };
    case 'cancelled':
      return { ...state, phase: 'cancelled' };
    case 'backgrounded':
      return { ...state, phase: 'cancelled', wentToBackground: true };
  }
}

/** Honest, human labels for the pipeline steps (Hard rule D: no speed talk). */
export const STEP_LABELS: Record<PipelineStep, string> = {
  parse: 'Understanding your brief',
  validate_constraints: 'Checking the request',
  drive_first_trip: 'Trying measured drives near you',
  scope: 'Scoping the reachable area',
  retrieve: 'Finding curvy roads and spots',
  generate_candidates: 'Sketching candidate drives',
  diversify: 'Keeping distinct options',
  route_candidates: 'Routing on real roads',
  score_rank: 'Scoring the options',
  select: 'Picking the front-runner',
  validate_route: 'Validating against your constraints',
  self_correct: 'Repairing shortcomings',
  enrich: 'Adding elevation and stops',
  explain: 'Writing the explanation',
  persist: 'Saving',
};

export const TOOL_LABELS: Record<string, string> = {
  get_isochrone: 'Reachable area',
  find_curvy_roads: 'Curvy roads',
  find_spots: 'Car spots',
  get_elevation_profile: 'Elevation profile',
  route_through: 'Road routing',
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/_/g, ' ');
}
