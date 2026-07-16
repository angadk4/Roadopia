/**
 * POST /plan (SSE) — the hero endpoint (M6-T04/T05/T06; Spec §49.2, §27.3,
 * §40 ladder, FR-040/041/047/048/204/260-263).
 *
 * Flow: guards (rate limit → kill switch → spend cap, JSON pre-SSE) →
 * region-check any provided coords → SSE stream: parse (Haiku primary /
 * rules fallback, M5-T03) → deterministic planner with LIVE events →
 * grounded explanation (M5-T04) → route + done → FR-049 generation row.
 *
 * Honesty rails baked in:
 *  - client disconnect aborts the loop + all further model spend (SPK-03
 *    backend half: "cancel stops spend");
 *  - every failure lands as a FRIENDLY error event + done, never a raw
 *    error or a fake route (§40; §18);
 *  - the stream carries GenerationEvents ONLY — pipeline steps, tool calls,
 *    validated outputs. No raw model reasoning exists anywhere in the
 *    payload path (Hard rule I).
 */

import { ParsedConstraintsSchema, PresetSchema } from '@shared/types';
import type {
  GenerationEvent,
  LatLng,
  ParsedConstraints,
  Preset,
  Route,
  Weights,
} from '@shared/types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Client } from 'pg';

import type { AiClient } from '../ai/client';
import type { CostGuard } from '../ai/cost_guard';
import { HARD_CAP_USD } from '../ai/cost_guard';
import { explainRoute, type RouteFacts } from '../ai/explain';
import type { LedgerSink } from '../ai/ledger';
import { parseBrief } from '../ai/parse_llm';
import { logGeneration, toDbStatus } from '../db/generation_log';
import { errorBody } from '../lib/errors';
import type { RateLimiter } from '../lib/rate_limit';
import type { RegionBoundary } from '../lib/region';
import { refineConstraints } from '../planner/refine';
import { runPlanner, type PlannerResult } from '../planner/run';

export const MAX_BRIEF_CHARS = 500;
export const HEARTBEAT_MS = 15_000;

export interface PlanEndpointDeps {
  db: Client;
  valhallaUrl: string;
  region: RegionBoundary;
  /** null = AI off entirely (rules parse + template explanation). */
  aiClient: AiClient | null;
  /** Cost guard for the cap pre-check (same instance the AiClient uses). */
  guard: CostGuard | null;
  /** Ledger the per-request cost delta is read from. */
  ledger: LedgerSink | null;
  /** FR-262: flip to disable the money-spending endpoint immediately. */
  killSwitch?: () => boolean;
  rateLimiter?: RateLimiter;
  /** DI seams for tests. */
  planFn?: typeof runPlanner;
  parseFn?: typeof parseBrief;
  explainFn?: typeof explainRoute;
  logFn?: typeof logGeneration;
}

interface PlanBody {
  brief: string;
  origin?: LatLng;
  destination?: LatLng;
  shape?: 'loop' | 'a_to_b';
  /** Preset chip from the Plan screen (M7-T03) — resolved to the FROZEN
   *  PRESET_WEIGHTS server-side (BD-30; vectors never live in the client). */
  preset?: Preset;
  weights?: Record<string, number>;
  /** Conversational refinement (M7-T07; Spec §34): the running ParsedConstraints
   *  from the previous run (zod-validated in-handler — Hard rule K) ... */
  constraints?: unknown;
  /** ... plus the follow-up to merge deterministically (RF6, M5-T06). Both or
   *  neither — the pair replaces the parse step with refine-merge. */
  followUp?: string;
}

const LATLNG_SCHEMA = {
  type: 'object',
  required: ['lat', 'lng'],
  additionalProperties: false,
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
  },
} as const;

/** Road names cited by the explanation — extracted from the VALIDATED
 *  maneuver instructions (tool output), never from the model. */
export function roadNamesFromManeuvers(
  maneuvers: Array<{ instruction: string }>,
  cap = 6,
): string[] {
  const names: string[] = [];
  for (const m of maneuvers) {
    const hit = /\b(?:onto|on)\s+([A-Z][A-Za-z0-9' .-]*?)(?:[.,]|$)/.exec(m.instruction);
    const name = hit?.[1]?.trim();
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= cap) break;
  }
  return names;
}

function factsOf(constraints: ParsedConstraints, result: PlannerResult): RouteFacts {
  const route = result.route!;
  const results = result.validation?.results ?? [];
  const satisfied = results.filter((c) => c.status === 'satisfied').map((c) => c.constraint);
  const relaxed = [
    ...results
      .filter((c) => c.status === 'relaxed' || c.status === 'violated')
      .map((c) => c.constraint),
    ...result.disclosures,
  ];
  return {
    originName: typeof constraints.origin === 'string' ? constraints.origin : null,
    durationMin: route.duration_s / 60,
    distanceKm: route.distance_m / 1000,
    targetMin: constraints.duration_target_s !== null ? constraints.duration_target_s / 60 : null,
    curviness: result.curviness ?? 0,
    roadNames: roadNamesFromManeuvers(route.maneuvers),
    stops: [], // spot names join the facts when persistence lands (M8)
    satisfied,
    relaxed,
    viewpointCount: 0,
  };
}

function routePayload(
  constraints: ParsedConstraints,
  result: PlannerResult,
  generationRequestId: string | null,
): Route {
  const route = result.route!;
  return {
    geometry: route.geometry,
    geometry_simplified: null,
    bbox: null,
    is_loop: constraints.shape === 'loop',
    waypoints: [],
    distance_m: route.distance_m,
    duration_s: route.duration_s,
    curviness: result.curviness ?? 0,
    elevation_profile: null,
    climb_m: result.elevation?.climb_m ?? null,
    highway_flag: route.has_highway,
    toll_flag: route.has_toll,
    ferry_flag: route.has_ferry,
    unpaved_flag: route.has_unpaved,
    character_tags: constraints.character,
    intensity: constraints.intensity ?? 'moderate',
    free_tags: [],
    visibility: 'private',
    owner_id: null,
    origin_type: 'ai',
    forked_from: null,
    generation_request_id: generationRequestId,
    satisfied_constraints: result.validation?.results ?? null,
  };
}

/** Runner-up payload (FB-4): same wire shape as the best route, but no
 *  elevation (enrich runs best-only) — climb_m is honestly null. */
function alternatePayload(
  constraints: ParsedConstraints,
  alt: PlannerResult['alternates'][number],
  generationRequestId: string | null,
): Route {
  return {
    geometry: alt.route.geometry,
    geometry_simplified: null,
    bbox: null,
    is_loop: constraints.shape === 'loop',
    waypoints: [],
    distance_m: alt.route.distance_m,
    duration_s: alt.route.duration_s,
    curviness: alt.curviness,
    elevation_profile: null,
    climb_m: null,
    highway_flag: alt.route.has_highway,
    toll_flag: alt.route.has_toll,
    ferry_flag: alt.route.has_ferry,
    unpaved_flag: alt.route.has_unpaved,
    character_tags: constraints.character,
    intensity: constraints.intensity ?? 'moderate',
    free_tags: [],
    visibility: 'private',
    owner_id: null,
    origin_type: 'ai',
    forked_from: null,
    generation_request_id: generationRequestId,
    satisfied_constraints: alt.validation.results,
  };
}

const FRIENDLY: Record<string, string> = {
  refused:
    'Roadopia plans enjoyable drives, not fast ones — try describing the kind of roads you want instead.',
  redirect:
    'No good route came together from that start. Roadopia currently covers south-central Ontario — try a different starting point or a looser brief.',
  unavailable:
    'The planner is temporarily unavailable. Browsing and saved routes still work — please try again shortly.',
};

export function registerPlanEndpoint(app: FastifyInstance, deps: PlanEndpointDeps): void {
  const planFn = deps.planFn ?? runPlanner;
  const parseFn = deps.parseFn ?? parseBrief;
  const explainFn = deps.explainFn ?? explainRoute;
  const logFn = deps.logFn ?? logGeneration;

  app.post<{ Body: PlanBody }>(
    '/plan',
    {
      schema: {
        body: {
          type: 'object',
          required: ['brief'],
          additionalProperties: false,
          properties: {
            brief: { type: 'string', minLength: 1, maxLength: MAX_BRIEF_CHARS },
            origin: LATLNG_SCHEMA,
            destination: LATLNG_SCHEMA,
            shape: { type: 'string', enum: ['loop', 'a_to_b'] },
            preset: { type: 'string', enum: [...PresetSchema.options] },
            weights: { type: 'object', additionalProperties: { type: 'number' } },
            constraints: { type: 'object' },
            followUp: { type: 'string', minLength: 1, maxLength: MAX_BRIEF_CHARS },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: PlanBody }>, reply: FastifyReply) => {
      // --- guards: JSON responses BEFORE the stream starts (§40 rung 4) ---
      if (deps.rateLimiter) {
        const session = request.headers['x-session-id'];
        const decision = deps.rateLimiter.check(
          request.ip,
          typeof session === 'string' ? session : null,
        );
        if (!decision.allowed) {
          void reply
            .status(429)
            .header('retry-after', String(decision.retryAfterS))
            .send(
              errorBody(
                'rate_limited',
                `Too many plans at once — try again in ${decision.retryAfterS}s.`,
                request.id,
              ),
            );
          return;
        }
      }
      if (deps.killSwitch?.() === true) {
        void reply
          .status(503)
          .send(
            errorBody(
              'planner_disabled',
              'The AI planner is switched off right now. Browsing, saved routes, manual building and recording all still work.',
              request.id,
            ),
          );
        return;
      }
      if (deps.guard && deps.guard.monthUsd() >= HARD_CAP_USD) {
        void reply
          .status(503)
          .send(
            errorBody(
              'spend_cap_reached',
              'The planner hit its monthly budget and is paused. Browsing, saved routes, manual building and recording all still work.',
              request.id,
            ),
          );
        return;
      }

      const {
        brief,
        origin,
        destination,
        shape,
        preset,
        weights,
        constraints: rawConstraints,
        followUp,
      } = request.body;

      // refinement round-trip (M7-T07): both fields or neither; the previous
      // constraints re-validate through the SAME shared zod schema before any
      // use (Hard rule K — client JSON is data, never trusted).
      let refineBase: ParsedConstraints | null = null;
      if (rawConstraints !== undefined || followUp !== undefined) {
        if (rawConstraints === undefined || followUp === undefined) {
          void reply
            .status(400)
            .send(
              errorBody(
                'bad_request',
                'Refinement needs both the previous constraints and a follow-up.',
                request.id,
              ),
            );
          return;
        }
        const revalidated = ParsedConstraintsSchema.safeParse(rawConstraints);
        if (!revalidated.success) {
          void reply
            .status(400)
            .send(
              errorBody(
                'bad_request',
                'The refinement state was not recognizable — plan a fresh drive instead.',
                request.id,
              ),
            );
          return;
        }
        refineBase = revalidated.data;
      }

      // Hard rule K: the .poly guard must also cover coordinates ARRIVING
      // INSIDE the refine constraints (zod checks shape, not geography —
      // review finding 2026-07-16). Origin/destination may also be 'current'
      // or a place-name string there; only LatLng objects are checkable here.
      const refineCoords = [refineBase?.origin, refineBase?.destination].filter(
        (v): v is LatLng => v !== null && v !== undefined && typeof v === 'object',
      );
      for (const p of [origin, destination, ...refineCoords]) {
        if (p && !deps.region.contains(p)) {
          void reply
            .status(400)
            .send(
              errorBody(
                'out_of_region',
                `Roadopia currently covers south-central Ontario (region ${deps.region.id}); pick a start inside it.`,
                request.id,
              ),
            );
          return;
        }
      }

      // --- SSE stream ---
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-trace-id': String(request.id),
      });
      const sse = (e: GenerationEvent): void => {
        if (!raw.writableEnded) raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      };
      const heartbeat = setInterval(() => {
        if (!raw.writableEnded) raw.write(': ping\n\n');
      }, HEARTBEAT_MS);

      // client disconnect → abort the loop + all further model spend.
      // NB: watch the SOCKET — IncomingMessage 'close' fires once the request
      // body is consumed, which is immediately for a JSON POST.
      const aborter = new AbortController();
      const socket = request.raw.socket;
      const onSocketClose = (): void => {
        if (!raw.writableEnded) aborter.abort();
      };
      // detached in finally — keep-alive sockets are reused across requests,
      // so once() listeners would otherwise accumulate (review 2026-07-16)
      socket.once('close', onSocketClose);

      const t0 = performance.now();
      const entriesBefore = deps.ledger?.entries().length ?? 0;
      let constraints: ParsedConstraints | null = null;
      let result: PlannerResult | null = null;

      try {
        // parse (LLM primary, rules fallback — M5-T03), or the deterministic
        // refine-merge when a follow-up round-trip arrived (M7-T07; RF6 rules)
        sse({ type: 'step', step: 'parse', status: 'started' });
        let parserKind: string; // 'llm' | 'rules' | 'refine-merge' (FR-049 metric)
        if (refineBase !== null && followUp !== undefined) {
          const refined = refineConstraints(refineBase, followUp);
          if (!refined.recognized) {
            // honest no-op: nothing merged, nothing planned, zero spend
            sse({
              type: 'step',
              step: 'parse',
              status: 'completed',
              detail: 'refine-merge: unrecognized',
            });
            sse({
              type: 'error',
              message:
                "I couldn't apply that follow-up — try 'longer', 'shorter', 'more twisty', 'avoid highways', or ask for a stop like 'add a coffee stop'.",
            });
            sse({ type: 'done', status: 'unavailable' });
            return;
          }
          constraints = refined.merged;
          parserKind = 'refine-merge';
        } else {
          const outcome = await parseFn(brief, {
            client: aborter.signal.aborted ? null : deps.aiClient,
          });
          constraints = outcome.constraints;
          parserKind = outcome.parser;
        }
        // client-provided inputs override parsed guesses (§27.4: origin/shape
        // are INPUTS; the brief fills the rest)
        if (origin) {
          constraints = {
            ...constraints,
            origin,
            missing: constraints.missing.filter((m) => m !== 'origin'),
          };
          // a supplied origin resolves the §3.5 no-origin clarify case; only a
          // shape contradiction may still legitimately hold clarification open
          if (
            constraints.clarification.needed &&
            !constraints.contradictions.some((c) => c.kind === 'shape')
          ) {
            constraints = { ...constraints, clarification: { needed: false, question: null } };
          }
        }
        if (destination) {
          constraints = {
            ...constraints,
            destination,
            missing: constraints.missing.filter((m) => m !== 'destination'),
          };
        }
        if (shape) constraints = { ...constraints, shape };
        // preset override (M7-T03): the planner resolves it via weightsForPreset
        // at run.ts; explicit client weights still win key-by-key (mergeWeights).
        if (preset) constraints = { ...constraints, preset };
        if (weights) constraints = { ...constraints, weights: weights as Weights };
        sse({
          type: 'step',
          step: 'parse',
          status: 'completed',
          detail: parserKind === 'refine-merge' ? 'refine-merge' : `parser=${parserKind}`,
        });
        // the effective running `c` — the client holds it for refinement (§34)
        sse({ type: 'constraints', constraints });

        if (aborter.signal.aborted) return; // disconnected during parse

        result = await planFn(constraints, {
          db: deps.db,
          valhallaUrl: deps.valhallaUrl,
          onEvent: (e) => {
            if (e.type !== 'done') sse(e); // done is ours, after explanation
          },
          signal: aborter.signal,
        });

        if (result.status === 'clarify') {
          sse({
            type: 'error',
            message:
              result.clarificationQuestion ??
              'One thing to clear up before planning — where should the drive start?',
          });
          sse({ type: 'done', status: 'unavailable' });
          return;
        }
        if (result.route === null) {
          const message = [
            FRIENDLY[result.status] ?? FRIENDLY['unavailable']!,
            ...result.disclosures,
          ]
            .join(' ')
            .trim();
          sse({ type: 'error', message });
          sse({ type: 'done', status: 'unavailable' });
          return;
        }

        // grounded explanation (skipped if the client already left — no spend)
        let explanationText: { text: string; satisfied: string[]; relaxed: string[] } | null = null;
        if (!aborter.signal.aborted) {
          sse({ type: 'step', step: 'explain', status: 'started' });
          const explanation = await explainFn(factsOf(constraints, result), {
            client: deps.aiClient,
          });
          explanationText = {
            text: explanation.text,
            satisfied: explanation.satisfied,
            relaxed: explanation.relaxed,
          };
          sse({
            type: 'step',
            step: 'explain',
            status: 'completed',
            detail: `source=${explanation.source}`,
          });
        }

        // FR-049 row (before the route event so the payload carries the id)
        const entriesAfter = deps.ledger?.entries() ?? [];
        const costUsd = entriesAfter.slice(entriesBefore).reduce((s, e) => s + e.costUsd, 0);
        const generationRequestId = await logFn(deps.db, {
          userId: request.user?.sub ?? null,
          brief,
          parsedConstraints: constraints,
          status: toDbStatus(result.status),
          iterations: result.iterations,
          latencyMs: Math.round(performance.now() - t0),
          tokenCostUsd: costUsd,
          metrics: {
            planner_status: result.status,
            parser: parserKind,
            disclosures: result.disclosures,
            aborted: aborter.signal.aborted,
            events: result.events.length,
          },
        });

        sse({ type: 'route', route: routePayload(constraints, result, generationRequestId) });
        for (const alt of result.alternates) {
          sse({
            type: 'alternate',
            route: alternatePayload(constraints, alt, generationRequestId),
          });
        }
        if (explanationText) sse({ type: 'explanation', explanation: explanationText });
        sse({
          type: 'done',
          status:
            result.status === 'ok' || result.status === 'relaxed' || result.status === 'best_so_far'
              ? result.status
              : 'unavailable',
        });
      } catch (err) {
        // §40: NEVER a raw error. Full detail to the log; honest line downstream.
        request.log.error({ err }, '/plan failed');
        sse({ type: 'error', message: FRIENDLY['unavailable']! });
        sse({ type: 'done', status: 'unavailable' });
        // best-effort failure row (FR-049 counts failures too)
        await logFn(deps.db, {
          userId: request.user?.sub ?? null,
          brief,
          parsedConstraints: constraints,
          status: 'failed',
          iterations: result?.iterations ?? 0,
          latencyMs: Math.round(performance.now() - t0),
          tokenCostUsd: (deps.ledger?.entries() ?? [])
            .slice(entriesBefore)
            .reduce((s, e) => s + e.costUsd, 0),
          metrics: { error: err instanceof Error ? err.name : 'unknown' },
        }).catch(() => undefined);
      } finally {
        clearInterval(heartbeat);
        socket.removeListener('close', onSocketClose);
        if (!raw.writableEnded) raw.end();
      }
    },
  );
}
