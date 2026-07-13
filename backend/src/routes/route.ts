/**
 * POST /route — manual-building snap (M6-T03; Spec §49.2: "ordered waypoints
 * → Valhalla route_through (costing profile) → geometry + distance + duration
 * + maneuvers + flags. Called as each waypoint drops"; FR-050).
 *
 * Middle waypoints use Valhalla type 'break': a user-dropped waypoint is a
 * real stop (unlike the planner's pass-through search waypoints). Failures
 * map honestly (§40 rung 5): no path → 422 `no_route`; engine down → 503
 * `route_engine_unavailable` — never a raw error, never a fake route.
 */

import type { LatLng, RouteThroughOutput } from '@shared/types';
import type { FastifyInstance } from 'fastify';

import { AppError } from '../lib/errors';
import type { RegionBoundary } from '../lib/region';
import { routeThrough, ValhallaRouteError, type AutoCostingOptions } from '../valhalla/route';

export const MAX_ROUTE_WAYPOINTS = 30;

export interface RouteEndpointDeps {
  valhallaUrl: string;
  region: RegionBoundary;
  /** DI for tests. */
  routeFn?: typeof routeThrough;
}

interface RouteBody {
  waypoints: LatLng[];
  avoid?: { highways?: boolean; tolls?: boolean; ferries?: boolean };
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

export function assertInRegion(points: LatLng[], region: RegionBoundary): void {
  if (points.some((p) => !region.contains(p))) {
    throw new AppError(
      400,
      'out_of_region',
      `Roadopia currently covers south-central Ontario (region ${region.id}); pick points inside it.`,
    );
  }
}

/** Map engine failures to the honest §40 shapes (shared with /match). */
export function toEngineError(err: unknown): AppError {
  if (err instanceof ValhallaRouteError && err.noRoute) {
    return new AppError(
      422,
      'no_route',
      'No drivable road connects those points; try moving them.',
    );
  }
  return new AppError(
    503,
    'route_engine_unavailable',
    'The route engine is temporarily unavailable; browsing and saved routes still work.',
  );
}

export function registerRouteEndpoint(app: FastifyInstance, deps: RouteEndpointDeps): void {
  const routeFn = deps.routeFn ?? routeThrough;

  app.post<{ Body: RouteBody }>(
    '/route',
    {
      schema: {
        body: {
          type: 'object',
          required: ['waypoints'],
          additionalProperties: false,
          properties: {
            waypoints: {
              type: 'array',
              minItems: 2,
              maxItems: MAX_ROUTE_WAYPOINTS,
              items: LATLNG_SCHEMA,
            },
            avoid: {
              type: 'object',
              additionalProperties: false,
              properties: {
                highways: { type: 'boolean' },
                tolls: { type: 'boolean' },
                ferries: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    async (request): Promise<RouteThroughOutput> => {
      const { waypoints, avoid } = request.body;
      assertInRegion(waypoints, deps.region);

      const costingOptions: AutoCostingOptions = {
        ...(avoid?.highways ? { exclude_highways: true } : {}),
        ...(avoid?.tolls ? { exclude_tolls: true } : {}),
        ...(avoid?.ferries ? { exclude_ferries: true } : {}),
      };

      try {
        return await routeFn(deps.valhallaUrl, {
          waypoints: waypoints.map((p) => [p.lng, p.lat] as const),
          costingOptions,
          middleType: 'break',
        });
      } catch (err) {
        throw toEngineError(err);
      }
    },
  );
}
