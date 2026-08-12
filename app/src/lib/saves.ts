/**
 * Route persistence (M8-T04; FR-080/091) — the save_route RPC + the owner's
 * saved-drives list, PostgREST over FetchLike, zod-validated, PURE.
 *
 * Saves are PRIVATE by default (server enforces regardless of what a client
 * sends — migration 0025 forces owner + defaults). The list is scoped by RLS:
 * a filter on owner_id is a UX nicety; the policy is the boundary.
 */

import type { Route } from '@shared/types';
import { z } from 'zod';

import type { FetchLike } from './api';
import { DataError, type SupabaseConfig } from './data';

export interface SaveRouteInput {
  route: Route;
  name: string;
  visibility?: 'private' | 'public' | 'unlisted';
  agentExplanation?: string | null;
}

/** Build the bounded RPC payload from the in-app Route (pure; testable). */
export function buildSavePayload(input: SaveRouteInput): Record<string, unknown> {
  const r = input.route;
  return {
    name: input.name.trim().slice(0, 80) || 'Untitled drive',
    geometry: r.geometry,
    is_loop: r.is_loop,
    waypoints: r.waypoints,
    distance_m: r.distance_m,
    duration_s: Math.round(r.duration_s),
    curviness: r.curviness,
    elevation_profile: r.elevation_profile,
    climb_m: r.climb_m,
    character_tags: r.character_tags,
    intensity: r.intensity,
    free_tags: r.free_tags,
    highway_flag: r.highway_flag,
    toll_flag: r.toll_flag,
    ferry_flag: r.ferry_flag,
    unpaved_flag: r.unpaved_flag,
    visibility: input.visibility ?? 'private',
    origin_type: r.origin_type,
    generation_request_id: r.generation_request_id ?? null,
    satisfied_constraints: r.satisfied_constraints ?? null,
    agent_explanation: input.agentExplanation ?? null,
  };
}

/** Persist a route as the signed-in user; returns the new route id. */
export async function saveRoute(
  cfg: SupabaseConfig,
  accessToken: string,
  input: SaveRouteInput,
  fetchImpl?: FetchLike,
): Promise<string> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    res = await f(`${cfg.url}/rest/v1/rpc/save_route`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p: buildSavePayload(input) }),
    });
  } catch (err) {
    throw new DataError('Could not reach the data service — check your connection.', null, {
      cause: err,
    });
  }
  const text = await res.text();
  if (!res.ok) {
    throw new DataError(
      res.status === 401 || res.status === 403
        ? 'Sign in to save drives.'
        : 'Could not save the drive right now.',
      res.status,
    );
  }
  const id = z.string().uuid().safeParse(JSON.parse(text));
  if (!id.success) throw new DataError('Save returned an unexpected response.', res.status);
  return id.data;
}

const SavedRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  visibility: z.string(),
  is_loop: z.boolean(),
  distance_m: z.number(),
  duration_s: z.number(),
  created_at: z.string(),
});
export type SavedRow = z.infer<typeof SavedRowSchema>;

/** The signed-in user's saved drives, newest first (FR-091). */
export async function listMyRoutes(
  cfg: SupabaseConfig,
  accessToken: string,
  userId: string,
  fetchImpl?: FetchLike,
): Promise<SavedRow[]> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    res = await f(
      `${cfg.url}/rest/v1/routes?owner_id=eq.${encodeURIComponent(userId)}` +
        `&select=id,name,visibility,is_loop,distance_m,duration_s,created_at&order=created_at.desc&limit=100`,
      {
        method: 'GET',
        headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}` },
      },
    );
  } catch (err) {
    throw new DataError('Could not reach the data service — check your connection.', null, {
      cause: err,
    });
  }
  const text = await res.text();
  if (!res.ok) throw new DataError('Could not load saved drives.', res.status);
  const rows = z.array(SavedRowSchema).safeParse(JSON.parse(text));
  if (!rows.success) throw new DataError('Saved drives came back malformed.', res.status);
  return rows.data;
}
