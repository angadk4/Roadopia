/**
 * Valhalla /trace_attributes client — per-edge road classes for a route shape.
 *
 * Purpose (owner round 7): the ROUTE legs Valhalla builds between waypoints
 * carry no road-class constraint, so a connector can cut through a residential
 * subdivision even though retrieval + waypoints exclude the class. Valhalla
 * 3.7 auto costing has NO residential knob (verified against source: no
 * `use_residential`, no per-class factor) — so exposure is MEASURED here
 * instead and gated by the planner (loop.ts two-tier).
 *
 * Round 15 (M7-T09/FB-5): the same trace now also feeds CLASS-AWARE route
 * curviness — `edge.use` ('ramp'/'turn_channel' — Valhalla never emits *_link
 * road classes; ramps carry the parent class), `edge.roundabout`, and the
 * begin/end shape indices into the response's matched `shape` (encoded
 * polyline, precision 6). Junction wiggle is thereby excludable from the
 * twistiness measurement (Protocol §12.1, the deferred maneuver-aware
 * exclusion).
 *
 * Verified against the local 3.7.0 container (probe 2026-07-16): request takes
 * the decoded shape as {lat,lon} points, `shape_match: 'walk_or_snap'`
 * (edge-walk first — our shapes ARE Valhalla routes — snap fallback); response
 * edges carry UNPREFIXED `road_class` + `length` in the response's `units`
 * (default kilometres) + `use` + `roundabout` + `begin/end_shape_index`;
 * partial first/last edges report their FULL length plus
 * `source_percent_along`/`target_percent_along` to trim by.
 */

import type { LineString } from '@shared/types';
import { z } from 'zod';

import { decodePolyline } from './polyline';

const TraceEdgeSchema = z.object({
  road_class: z.string(),
  length: z.number().nonnegative(),
  use: z.string().optional(),
  roundabout: z.boolean().optional(),
  unpaved: z.boolean().optional(), // R16-2 (probed live: true on gravel edges)
  begin_shape_index: z.number().int().nonnegative().optional(),
  end_shape_index: z.number().int().nonnegative().optional(),
  source_percent_along: z.number().min(0).max(1).optional(),
  target_percent_along: z.number().min(0).max(1).optional(),
});

const TraceResponseSchema = z.object({
  units: z.string().optional(),
  shape: z.string().optional(),
  edges: z.array(TraceEdgeSchema).default([]),
});

export interface TraceEdge {
  roadClass: string;
  /** Trimmed matched length in metres (partial edges scaled by percent_along). */
  lengthM: number;
  /** Valhalla edge use — 'ramp' | 'turn_channel' | 'road' | … (round 15). */
  use?: string;
  roundabout?: boolean;
  /** Surface honesty (R16-2): true on gravel/dirt edges. */
  unpaved?: boolean;
  /** Indices into TraceResult.matchedShape (NOT the input geometry). */
  beginShapeIndex?: number;
  endShapeIndex?: number;
}

export interface TraceResult {
  edges: TraceEdge[];
  /** Decoded matched-path shape the edge indices refer to; null if absent. */
  matchedShape: LineString | null;
}

export class ValhallaTraceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(`trace_attributes failed (HTTP ${statusCode}): ${message}`);
    this.name = 'ValhallaTraceError';
  }
}

/** Map a route geometry to its per-edge road classes + the matched shape. */
export async function traceRoadClasses(
  baseUrl: string,
  geometry: LineString,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<TraceResult> {
  const payload = {
    shape: geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    costing: 'auto',
    shape_match: 'walk_or_snap',
    filters: {
      attributes: [
        'edge.road_class',
        'edge.length',
        'edge.use',
        'edge.roundabout',
        'edge.unpaved',
        'edge.begin_shape_index',
        'edge.end_shape_index',
        'shape',
      ],
      action: 'include',
    },
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/trace_attributes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `unexpected error shape`;
    throw new ValhallaTraceError(res.status, msg);
  }
  const parsed = TraceResponseSchema.parse(body);
  const toMetres = parsed.units === 'miles' ? 1609.344 : 1000;
  const edges = parsed.edges.map((e) => {
    const from = e.source_percent_along ?? 0;
    const to = e.target_percent_along ?? 1;
    return {
      roadClass: e.road_class,
      lengthM: e.length * toMetres * Math.max(0, to - from),
      ...(e.use !== undefined ? { use: e.use } : {}),
      ...(e.roundabout !== undefined ? { roundabout: e.roundabout } : {}),
      ...(e.unpaved !== undefined ? { unpaved: e.unpaved } : {}),
      ...(e.begin_shape_index !== undefined ? { beginShapeIndex: e.begin_shape_index } : {}),
      ...(e.end_shape_index !== undefined ? { endShapeIndex: e.end_shape_index } : {}),
    };
  });
  let matchedShape: LineString | null = null;
  if (parsed.shape) {
    try {
      const coordinates = decodePolyline(parsed.shape);
      if (coordinates.length >= 2) matchedShape = { type: 'LineString', coordinates };
    } catch {
      matchedShape = null; // fallback stays tag-blind — never throw here
    }
  }
  return { edges, matchedShape };
}

// --- R37-U13 (BD-178): DIRECTED EDGE IDENTITY capture -----------------------

const EdgeIdSchema = z.object({
  id: z.number().optional(), // GraphId value (tileset-scoped!)
  way_id: z.number().optional(),
  length: z.number().nonnegative(),
  forward: z.boolean().optional(),
  source_percent_along: z.number().min(0).max(1).optional(),
  target_percent_along: z.number().min(0).max(1).optional(),
});
const EdgeIdResponseSchema = z.object({
  units: z.string().optional(),
  edges: z.array(EdgeIdSchema).default([]),
});

/** One matched directed edge: OSM way + travel direction + trimmed metres.
 *  GraphIds are NEVER stored without tileset identity (Recovery §6.1) —
 *  callers persist them alongside `tileset_id`. */
export interface DirectedEdge {
  /** Valhalla GraphId value — valid ONLY for the tileset it was traced on. */
  graphId: number | null;
  wayId: number | null;
  forward: boolean;
  lengthM: number;
}

/** Map a route geometry to its DIRECTED EDGE sequence (way ids + direction).
 *  Same walk_or_snap contract as traceRoadClasses; throws on engine error. */
export async function traceEdgeIds(
  baseUrl: string,
  geometry: LineString,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<DirectedEdge[]> {
  const payload = {
    shape: geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    costing: 'auto',
    shape_match: 'walk_or_snap',
    filters: {
      attributes: ['edge.id', 'edge.way_id', 'edge.length', 'edge.forward'],
      action: 'include',
    },
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/trace_attributes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'unexpected error shape';
    throw new ValhallaTraceError(res.status, msg);
  }
  const parsed = EdgeIdResponseSchema.parse(body);
  const toMetres = parsed.units === 'miles' ? 1609.344 : 1000;
  return parsed.edges.map((e) => {
    const from = e.source_percent_along ?? 0;
    const to = e.target_percent_along ?? 1;
    return {
      graphId: e.id ?? null,
      wayId: e.way_id ?? null,
      forward: e.forward ?? true,
      lengthM: e.length * toMetres * Math.max(0, to - from),
    };
  });
}

/** Compact directed-road signature: consecutive same-(way,dir) edges coalesce
 *  to runs; the signature is the run sequence. Stable across shape resampling;
 *  survives tileset rebuilds (way ids are OSM identity, not GraphIds). */
export function edgeSignature(edges: readonly DirectedEdge[]): string {
  const runs: string[] = [];
  let prev: string | null = null;
  for (const e of edges) {
    if (e.wayId === null) continue;
    const key = `${e.wayId}${e.forward ? '+' : '-'}`;
    if (key !== prev) {
      runs.push(key);
      prev = key;
    }
  }
  return runs.join(',');
}
