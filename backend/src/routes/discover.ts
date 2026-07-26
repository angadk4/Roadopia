/**
 * POST /discover (R23) — "great drives near you". Given an origin, return a
 * ranked menu of the region's best driving roads reachable from it (U4's
 * discoverDrives). A plain JSON request/response — NOT SSE and NOT the
 * money-spending planner: two bounded Valhalla calls, no LLM (Hard rule F), so
 * no cost guard / kill switch. Browsing-class: it stays up even when /plan is
 * capped or killed.
 *
 * Registered only when its deps are present (server.ts) → absent ⇒ 404, the
 * honest byte-identical-off state (BD-40). Origin is region-checked (Hard
 * rule K); the response is the shared DiscoverResult shape.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Client } from 'pg';

import { errorBody } from '../lib/errors';
import type { RateLimiter } from '../lib/rate_limit';
import type { RegionBoundary } from '../lib/region';
import { discoverDrives } from '../planner/discover';
import { discoverCores } from '../planner/discover_cores';

export interface DiscoverEndpointDeps {
  db: Client;
  valhallaUrl: string;
  region: RegionBoundary;
  rateLimiter?: RateLimiter;
  /** DI seam for tests. */
  discoverFn?: typeof discoverDrives;
  /** R25-U14: the v2 drive-core browse (served only when the body carries
   *  `v: 2`). Absent body `v` ⇒ the v1 shape — installed apps can't be
   *  force-updated; the v1 branch is pinned by a test and its removal must be
   *  a deliberate, loud act (dated TODO: retire after the v2 app ships and
   *  v1 traffic reads zero — check server logs ≥ 2026-09-01). */
  discoverCoresFn?: typeof discoverCores;
}

interface DiscoverBody {
  origin: { lat: number; lng: number };
  v?: number;
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

export function registerDiscoverEndpoint(app: FastifyInstance, deps: DiscoverEndpointDeps): void {
  const discover = deps.discoverFn ?? discoverDrives;

  app.post<{ Body: DiscoverBody }>(
    '/discover',
    {
      schema: {
        body: {
          type: 'object',
          required: ['origin'],
          additionalProperties: false,
          properties: {
            origin: LATLNG_SCHEMA,
            // R25-U14 contract version: 2 = three-leg drive cores; absent = v1
            v: { type: 'integer', minimum: 1, maximum: 2 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: DiscoverBody }>, reply: FastifyReply) => {
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
                `Too many requests at once — try again in ${decision.retryAfterS}s.`,
                request.id,
              ),
            );
          return;
        }
      }

      const { origin } = request.body;
      if (!deps.region.contains(origin)) {
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

      try {
        // R25-U14: `v: 2` → the drive-core browse; ABSENT/1 → the v1 shape
        // (installed-app compatibility; branch pinned by discover-route.test)
        const result =
          request.body.v === 2
            ? await (deps.discoverCoresFn ?? discoverCores)(origin, {
                db: deps.db,
                valhallaUrl: deps.valhallaUrl,
              })
            : await discover(origin, { db: deps.db, valhallaUrl: deps.valhallaUrl });
        void reply.status(200).send(result);
      } catch (err) {
        request.log.error({ err }, '/discover failed');
        void reply
          .status(503)
          .send(
            errorBody(
              'discover_unavailable',
              "Couldn't scan for drives right now — try again in a moment.",
              request.id,
            ),
          );
      }
    },
  );
}
