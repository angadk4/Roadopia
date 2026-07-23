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

import {
  CharacterTagSchema,
  LocationConstraintSchema,
  ParsedConstraintsSchema,
  PresetSchema,
  StopRequestSchema,
  StopTypeSchema,
} from '@shared/types';
import type {
  CharacterTag,
  GenerationEvent,
  LatLng,
  LocationConstraint,
  ParsedConstraints,
  Preset,
  Route,
  StopRequest,
  Weights,
} from '@shared/types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Client } from 'pg';
import { z } from 'zod';

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
import { buildOutAndBack } from '../planner/out_and_back';
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
  outAndBackFn?: typeof buildOutAndBack;
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
  /** Structured stop rows from the Plan screen's stops builder (R16-4).
   *  Zod-revalidated in-handler (Hard rule K). Per-TYPE override: a body entry
   *  replaces the brief's ask for that type; brief-only types ride along. */
  stops?: unknown;
  /** Hard-avoid toggles (On the route section) — only the keys sent override. */
  avoid?: Partial<ParsedConstraints['avoid']>;
  /** Character tags to add (e.g. scenic from the Scenery toggle) — unioned. */
  character?: CharacterTag[];
  /** Twistiness preference 0..1 (Drive style selection). */
  twistiness_pref?: number;
  /** R23 discovery tap: structured 'through <road>' pins, each with an optional
   *  near_point disambiguation hint. REPLACES parsed location constraints;
   *  re-validated in-handler (Hard rule K). */
  location_constraints?: unknown;
  /** R23 discovery tap: the computed loop budget (s), bounded [2700, 9000]
   *  server-side (Hard rule K — the client's number is never trusted).
   *  Overrides the parsed/brief duration. */
  duration_target_s?: number;
  /** R23 discovery tap: a FAR drive builds a direct OUT-AND-BACK instead of the
   *  loop planner (its loop would balloon). Carries the road's endpoints + name;
   *  region-checked (Hard rule K). When present, replaces the whole plan run. */
  out_and_back?: { entry: LatLng; exit: LatLng; name: string };
}

/** Stops-builder rows cap (sanity bound, Hard rule K). */
export const MAX_STOP_ROWS = 6;
const StopOverridesSchema = z.array(StopRequestSchema).max(MAX_STOP_ROWS);
/** Structured 'through <road>' pins from the discovery tap (R23) — re-validated
 *  in-handler (Hard rule K). Small cap: a tap sends one; allow a few. */
export const MAX_LOCATION_OVERRIDES = 4;
const LocationConstraintsOverridesSchema = z
  .array(LocationConstraintSchema)
  .max(MAX_LOCATION_OVERRIDES);

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
    // real stops + MEASURED arrivals (R16-3) — "Ridge Café (coffee, ≈40 min in)"
    stops: result.stops.map((s) => ({
      name: s.name,
      type: s.type,
      arrival_min: s.arrival_s !== null ? s.arrival_s / 60 : null,
    })),
    satisfied,
    relaxed,
    viewpointCount: result.stops.filter((s) => s.type === 'viewpoint').length,
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
    waypoints: result.waypoints,
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
    stops: result.stops, // grounded spots + MEASURED arrivals (R16-3)
    country_score: result.countryScore, // measured road-class honesty (R18-1)
    arterial_share: result.arterialShare,
    urban_share: result.urbanShare, // R19: measured urban-context honesty
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
    waypoints: alt.waypoints,
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
    stops: alt.stops, // alternates carry stops too (R16-3)
    country_score: alt.countryScore,
    arterial_share: alt.arterialShare,
    urban_share: alt.urbanShare,
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
  const outAndBackFn = deps.outAndBackFn ?? buildOutAndBack;

  app.post<{ Body: PlanBody }>(
    '/plan',
    {
      schema: {
        body: {
          type: 'object',
          required: ['brief'],
          additionalProperties: false,
          properties: {
            // R24-U12: the brief is optional content (places + time); a
            // buttons-only plan sends '' — minLength 0 accepts it.
            brief: { type: 'string', minLength: 0, maxLength: MAX_BRIEF_CHARS },
            origin: LATLNG_SCHEMA,
            destination: LATLNG_SCHEMA,
            shape: { type: 'string', enum: ['loop', 'a_to_b'] },
            preset: { type: 'string', enum: [...PresetSchema.options] },
            weights: { type: 'object', additionalProperties: { type: 'number' } },
            constraints: { type: 'object' },
            followUp: { type: 'string', minLength: 1, maxLength: MAX_BRIEF_CHARS },
            stops: {
              type: 'array',
              maxItems: MAX_STOP_ROWS,
              items: {
                type: 'object',
                required: ['type', 'count', 'importance'],
                additionalProperties: false,
                properties: {
                  type: { type: 'string', enum: [...StopTypeSchema.options] },
                  count: { type: 'integer', minimum: 1, maximum: 5 },
                  importance: { type: 'string', enum: ['nice_to_have', 'required'] },
                  at_fraction: { enum: [0.25, 0.5, 0.75, null] },
                },
              },
            },
            avoid: {
              type: 'object',
              additionalProperties: false,
              properties: {
                highways: { type: 'boolean' },
                tolls: { type: 'boolean' },
                ferries: { type: 'boolean' },
                unpaved: { type: 'boolean' },
              },
            },
            character: {
              type: 'array',
              maxItems: 9,
              items: { type: 'string', enum: [...CharacterTagSchema.options] },
            },
            twistiness_pref: { type: 'number', minimum: 0, maximum: 1 },
            location_constraints: {
              type: 'array',
              maxItems: MAX_LOCATION_OVERRIDES,
              items: {
                type: 'object',
                required: ['kind', 'text'],
                additionalProperties: false,
                properties: {
                  // the tap pins by traversal only ('through'); near/avoid stay
                  // brief-parsed. Tighter enum = safer (Hard rule K).
                  kind: { type: 'string', enum: ['through'] },
                  text: { type: 'string', minLength: 1, maxLength: 120 },
                  near_point: LATLNG_SCHEMA,
                },
              },
            },
            duration_target_s: { type: 'integer', minimum: 2700, maximum: 9000 },
            out_and_back: {
              type: 'object',
              required: ['entry', 'exit', 'name'],
              additionalProperties: false,
              properties: {
                entry: LATLNG_SCHEMA,
                exit: LATLNG_SCHEMA,
                name: { type: 'string', minLength: 1, maxLength: 120 },
              },
            },
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
        stops: rawStops,
        avoid: avoidOverrides,
        character: characterOverrides,
        twistiness_pref: twistinessOverride,
        location_constraints: rawLocationConstraints,
        duration_target_s: durationTargetOverride,
        out_and_back: outAndBack,
      } = request.body;

      // structured stop rows re-validate through the SHARED zod schema before
      // any use (Hard rule K — the Fastify schema is transport-shape only)
      let stopOverrides: StopRequest[] | null = null;
      if (rawStops !== undefined) {
        const parsed = StopOverridesSchema.safeParse(rawStops);
        if (!parsed.success) {
          void reply
            .status(400)
            .send(errorBody('bad_request', 'The stop rows were not recognizable.', request.id));
          return;
        }
        stopOverrides = parsed.data;
      }

      // R23 discovery tap: structured 'through <road>' pins re-validate through
      // the SHARED zod schema before use (Hard rule K); they REPLACE the
      // brief-parsed location constraints in the merge below.
      let locationOverrides: LocationConstraint[] | null = null;
      if (rawLocationConstraints !== undefined) {
        const parsed = LocationConstraintsOverridesSchema.safeParse(rawLocationConstraints);
        if (!parsed.success) {
          void reply
            .status(400)
            .send(errorBody('bad_request', 'The location pins were not recognizable.', request.id));
          return;
        }
        locationOverrides = parsed.data;
      }

      // R23 out-and-back tap needs a start point (buildOutAndBack routes from it)
      if (outAndBack && !origin) {
        void reply
          .status(400)
          .send(errorBody('bad_request', 'A drive needs a start point.', request.id));
        return;
      }

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
      // near_point hints are coords arriving in the body → region-check too (K)
      const nearPointCoords = (locationOverrides ?? [])
        .map((c) => c.near_point)
        .filter((v): v is LatLng => v !== undefined);
      const oabCoords = outAndBack ? [outAndBack.entry, outAndBack.exit] : [];
      for (const p of [origin, destination, ...refineCoords, ...nearPointCoords, ...oabCoords]) {
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
        // R16-4 structured overrides (the Plan screen's sections):
        // stops — per-TYPE override: a builder row replaces the brief's ask for
        // that type (no accidental doubling when both name coffee); brief-only
        // types ride along.
        if (stopOverrides !== null) {
          const overrideTypes = new Set(stopOverrides.map((s) => s.type));
          constraints = {
            ...constraints,
            stops: [
              ...stopOverrides,
              ...constraints.stops.filter((s) => !overrideTypes.has(s.type)),
            ],
          };
        }
        // avoid — only the keys the client sent override (a toggle the user
        // never touched must not clear a brief-parsed avoid)
        if (avoidOverrides) {
          constraints = { ...constraints, avoid: { ...constraints.avoid, ...avoidOverrides } };
          if (avoidOverrides.unpaved === true) {
            constraints = { ...constraints, surface_pref: 'paved' };
          }
        }
        // character — union (the Scenery toggle adds 'scenic' without
        // clobbering brief-derived tags)
        if (characterOverrides && characterOverrides.length > 0) {
          constraints = {
            ...constraints,
            character: [...new Set([...constraints.character, ...characterOverrides])],
          };
        }
        if (twistinessOverride !== undefined) {
          constraints = { ...constraints, twistiness_pref: twistinessOverride };
        }
        // R23 discovery tap: the structured 'through' pin REPLACES parsed
        // location constraints (the tap knows the exact road + near_point); the
        // computed loop budget overrides the parsed duration. Both absent for a
        // normal Plan request → constraints unchanged (BD-40 byte-identical).
        if (locationOverrides !== null) {
          constraints = { ...constraints, location_constraints: locationOverrides };
        }
        if (durationTargetOverride !== undefined) {
          constraints = { ...constraints, duration_target_s: durationTargetOverride };
        }
        sse({
          type: 'step',
          step: 'parse',
          status: 'completed',
          detail: parserKind === 'refine-merge' ? 'refine-merge' : `parser=${parserKind}`,
        });
        // the effective running `c` — the client holds it for refinement (§34)
        sse({ type: 'constraints', constraints });

        if (aborter.signal.aborted) return; // disconnected during parse

        result =
          outAndBack && origin
            ? await outAndBackFn(origin, outAndBack, { valhallaUrl: deps.valhallaUrl })
            : await planFn(constraints, {
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
          // R18-4 honesty: an unrecognized place NAME is the user's to fix, not
          // a planner outage — pass the planner's specific "I don't recognize
          // 'X'" line through instead of the (dishonest here) unavailable copy.
          const unknownPlace =
            result.status === 'unavailable'
              ? result.events.find(
                  (e): e is Extract<typeof e, { type: 'error' }> =>
                    e.type === 'error' && e.message.startsWith("I don't recognize"),
                )
              : undefined;
          const message = [
            unknownPlace?.message ?? FRIENDLY[result.status] ?? FRIENDLY['unavailable']!,
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
