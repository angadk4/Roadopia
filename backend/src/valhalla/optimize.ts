/**
 * Typed Valhalla `/optimized_route` client — `optimize_waypoint_order` (M2-T05).
 *
 * TSP-orders intermediate stops (first/last stay fixed as start/end). GUARD
 * (M2-T05 guidance + Dependency Verification §11): Valhalla's optimizer needs a
 * meaningful problem — with fewer than 4 waypoints the wrapper NEVER calls the
 * engine and returns the deterministic identity order instead.
 */

import {
  OptimizeWaypointOrderOutputSchema,
  type OptimizeWaypointOrderInput,
  type OptimizeWaypointOrderOutput,
} from '@shared/types';
import { z } from 'zod';

export const MIN_TSP_WAYPOINTS = 4;

const OptimizedResponseSchema = z.object({
  trip: z.object({
    locations: z.array(z.object({ original_index: z.number().int().nonnegative() })).min(2),
  }),
});

/** Map a raw /optimized_route response → §50 ordered_indices (exported for tests). */
export function mapOptimizedResponse(body: unknown): OptimizeWaypointOrderOutput {
  const parsed = OptimizedResponseSchema.parse(body);
  return OptimizeWaypointOrderOutputSchema.parse({
    ordered_indices: parsed.trip.locations.map((l) => l.original_index),
  });
}

/** Deterministic fallback order (identity) — used below the TSP threshold. */
export function identityOrder(n: number): OptimizeWaypointOrderOutput {
  return { ordered_indices: Array.from({ length: n }, (_, i) => i) };
}

/**
 * TSP-order waypoints via Valhalla, or return identity order for < 4 points
 * (deterministic fallback — no engine call).
 */
export async function optimizeWaypointOrder(
  baseUrl: string,
  input: OptimizeWaypointOrderInput,
  { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
): Promise<OptimizeWaypointOrderOutput> {
  if (input.waypoints.length < MIN_TSP_WAYPOINTS) {
    return identityOrder(input.waypoints.length);
  }
  const payload = {
    locations: input.waypoints.map((w) => ({ lat: w.lat, lon: w.lng })),
    costing: input.costing,
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/optimized_route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await res.json();
  if (!res.ok) throw new Error(`Valhalla /optimized_route failed (HTTP ${res.status})`);
  return mapOptimizedResponse(body);
}
