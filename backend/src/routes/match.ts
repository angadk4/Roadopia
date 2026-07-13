/**
 * POST /match — recorded-trace map matching (M6-T03; Spec §49.2 "recorded
 * trace → Valhalla map-match → road-snapped geometry"; §24.1; FR-061).
 * Powers record-a-drive (M9). Same honest failure mapping as /route.
 */

import type { LatLng, LineString, RouteThroughOutput } from '@shared/types';
import type { FastifyInstance } from 'fastify';

import type { RegionBoundary } from '../lib/region';
import { traceRoute } from '../valhalla/match';

import { assertInRegion, toEngineError } from './route';

export const MAX_TRACE_POINTS = 5000;

export interface MatchEndpointDeps {
  valhallaUrl: string;
  region: RegionBoundary;
  /** DI for tests. */
  matchFn?: typeof traceRoute;
}

interface MatchBody {
  trace: LatLng[];
  shape_match?: 'map_snap' | 'edge_walk' | 'walk_or_snap';
}

export function registerMatchEndpoint(app: FastifyInstance, deps: MatchEndpointDeps): void {
  const matchFn = deps.matchFn ?? traceRoute;

  app.post<{ Body: MatchBody }>(
    '/match',
    {
      schema: {
        body: {
          type: 'object',
          required: ['trace'],
          additionalProperties: false,
          properties: {
            trace: {
              type: 'array',
              minItems: 2,
              maxItems: MAX_TRACE_POINTS,
              items: {
                type: 'object',
                required: ['lat', 'lng'],
                additionalProperties: false,
                properties: {
                  lat: { type: 'number', minimum: -90, maximum: 90 },
                  lng: { type: 'number', minimum: -180, maximum: 180 },
                },
              },
            },
            shape_match: { type: 'string', enum: ['map_snap', 'edge_walk', 'walk_or_snap'] },
          },
        },
      },
    },
    async (request): Promise<RouteThroughOutput> => {
      const { trace, shape_match } = request.body;
      assertInRegion(trace, deps.region);

      const geometry: LineString = {
        type: 'LineString',
        coordinates: trace.map((p) => [p.lng, p.lat]),
      };

      try {
        return await matchFn(deps.valhallaUrl, {
          geometry,
          ...(shape_match ? { shapeMatch: shape_match } : {}),
        });
      } catch (err) {
        throw toEngineError(err);
      }
    },
  );
}
