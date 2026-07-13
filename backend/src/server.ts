/**
 * Fastify service shell (M6-T01; Spec §43/§49). Exported as a factory so
 * tests `inject()` against it and later units (auth, /route, /match, /plan)
 * register onto it. JSON-schema validation is Fastify-native and ON for
 * every route that declares a schema (§49.3/§57 input bounds).
 *
 * Error model: EVERY non-2xx body is the §49.3 consistent shape
 * (lib/errors.ts). Unexpected errors log fully server-side but reach the
 * client as a generic line — never a stack, never internals.
 */

import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuth, type JwtVerifier } from './auth/jwt';
import { AppError, errorBody, INTERNAL_ERROR_MESSAGE } from './lib/errors';
import { loggerOptions } from './lib/logger';
import type { RegionBoundary } from './lib/region';
import { registerMatchEndpoint, type MatchEndpointDeps } from './routes/match';
import { registerPlanEndpoint, type PlanEndpointDeps } from './routes/plan';
import { registerRouteEndpoint, type RouteEndpointDeps } from './routes/route';

export interface BuildServerOptions {
  /** Test hook: capture structured log lines. */
  logStream?: NodeJS.WritableStream;
  /** Supabase JWT verifier; null/omitted = tokens rejected as unavailable. */
  verifier?: JwtVerifier | null;
  /** Valhalla base URL + region boundary — /route + /match register only
   *  when both are present (M6-T03). */
  valhallaUrl?: string;
  region?: RegionBoundary;
  /** DI for tests. */
  routeFn?: RouteEndpointDeps['routeFn'];
  matchFn?: MatchEndpointDeps['matchFn'];
  /** /plan wiring (M6-T04/T05) — registers only when present. */
  plan?: PlanEndpointDeps;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: loggerOptions(opts.logStream),
    genReqId: () => randomUUID(),
    // consistent input bound: reject huge bodies before any handler runs
    bodyLimit: 1_048_576,
  });

  // trace ID back to the caller on every response (matches the log's reqId)
  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-trace-id', request.id);
  });

  registerAuth(app, opts.verifier ?? null);

  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(errorBody('not_found', `No route ${request.method} ${request.url}`, request.id));
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      void reply.status(err.statusCode).send(errorBody(err.code, err.message, request.id));
      return;
    }
    // Fastify schema-validation failures: safe to echo (they describe the
    // request shape, not our internals)
    const fe = err as { validation?: unknown; message?: string };
    if (fe.validation) {
      void reply
        .status(400)
        .send(errorBody('bad_request', fe.message ?? 'invalid request', request.id));
      return;
    }
    // unexpected: full detail to the log, generic line to the client
    request.log.error({ err }, 'unhandled error');
    void reply.status(500).send(errorBody('internal', INTERNAL_ERROR_MESSAGE, request.id));
  });

  app.get('/health', async () => ({ status: 'ok' }));

  if (opts.valhallaUrl && opts.region) {
    const base = { valhallaUrl: opts.valhallaUrl, region: opts.region };
    registerRouteEndpoint(app, { ...base, ...(opts.routeFn ? { routeFn: opts.routeFn } : {}) });
    registerMatchEndpoint(app, { ...base, ...(opts.matchFn ? { matchFn: opts.matchFn } : {}) });
  }

  if (opts.plan) {
    registerPlanEndpoint(app, opts.plan);
  }

  return app;
}
