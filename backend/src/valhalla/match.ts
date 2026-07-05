/**
 * Typed Valhalla `/trace_route` client — map matching for record-a-drive (M2-T05).
 *
 * Snaps a recorded GPS trace (or any LineString) to the road network. The response
 * body has the same `trip` shape as `/route`, so it reuses M2-T04's validated
 * mapper and returns the same shared §50 route shape.
 *
 * SPK-07 note: API-level matching is proven here (fixtures from a real route shape);
 * the real-GPS quality check needs an owner drive on a device → rides M9.
 */

import type { LineString, RouteThroughOutput } from '@shared/types';

import { mapRouteResponse } from './route';

export interface TraceRouteRequest {
  /** The trace to snap: a GeoJSON LineString ([lon, lat] positions). */
  geometry: LineString;
  /** Matching mode: map_snap for recorded drives (default), edge_walk for exact replays. */
  shapeMatch?: 'map_snap' | 'edge_walk' | 'walk_or_snap';
}

/** Snap a trace to the network; returns matched geometry + distance/duration/maneuvers. */
export async function traceRoute(
  baseUrl: string,
  request: TraceRouteRequest,
  { timeoutMs = 20_000 }: { timeoutMs?: number } = {},
): Promise<RouteThroughOutput> {
  const payload = {
    shape: request.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    costing: 'auto',
    shape_match: request.shapeMatch ?? 'map_snap',
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/trace_route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await res.json();
  if (!res.ok) throw new Error(`Valhalla /trace_route failed (HTTP ${res.status})`);
  return mapRouteResponse(body);
}
