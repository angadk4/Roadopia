/**
 * Spot creation + editing (M10-T01/T03/T04; FR-030..034) — pure validation
 * and thin authed RPC/REST wrappers. RLS + the 0027 RPCs are the enforcement
 * (owner forced server-side, source='user' forced, OSM rows immutable);
 * this layer bounds input EARLY (Hard rule K) and words problems plainly.
 *
 * FR-033 proximity nudge is computed CLIENT-side against the already-loaded
 * map_spots rows: a warn-not-block hint needs no server round-trip, and the
 * nudge's job is "you may be duplicating" — not an integrity constraint.
 */

import { z } from 'zod';

import type { FetchLike } from './api';
import { DataError, type SpotRow, type SupabaseConfig } from './data';

export const SPOT_NAME_MAX = 80;
export const SPOT_DESC_MAX = 500;
export const SPOT_TAGS_MAX = 10;
export const SPOT_TAG_LEN_MAX = 24;
export const NUDGE_RADIUS_M = 150;

/** Display order + labels for the 7 spot types (§22 + R16-1 'food'). */
export const SPOT_TYPES: Array<{ type: string; label: string }> = [
  { type: 'great_road', label: 'Great road' },
  { type: 'viewpoint', label: 'Viewpoint' },
  { type: 'coffee', label: 'Coffee' },
  { type: 'food', label: 'Food' },
  { type: 'fuel', label: 'Fuel' },
  { type: 'rest', label: 'Rest' },
  { type: 'meetup', label: 'Meetup' },
];

export interface SpotDraft {
  lat: number;
  lng: number;
  type: string;
  name: string;
  description: string;
  tags: string[];
}

/** "quiet, gravel lot,," → ['quiet', 'gravel lot'] (bounded). */
export function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, SPOT_TAGS_MAX)
    .map((t) => t.slice(0, SPOT_TAG_LEN_MAX));
}

/** FR-031: pin + type + name required; everything else optional. */
export function validateSpotDraft(d: SpotDraft): string | null {
  if (!SPOT_TYPES.some((t) => t.type === d.type)) return 'Pick a spot type.';
  if (d.name.trim().length === 0) return 'Give the spot a name.';
  if (d.name.trim().length > SPOT_NAME_MAX) return `Name must fit ${SPOT_NAME_MAX} characters.`;
  return null;
}

const LAT_M = 111_320;

export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const lngM = LAT_M * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lat - a.lat) * LAT_M, (b.lng - a.lng) * lngM);
}

/**
 * FR-033: the nearest SAME-TYPE spot within NUDGE_RADIUS_M, for the
 * warn-not-block nudge — null when the pin is comfortably alone.
 */
export function nearestSameType(
  spots: SpotRow[],
  point: { lat: number; lng: number },
  type: string,
): { name: string; distanceM: number } | null {
  let best: { name: string; distanceM: number } | null = null;
  for (const s of spots) {
    if (s.type !== type) continue;
    const d = distanceM(point, s);
    if (d <= NUDGE_RADIUS_M && (best === null || d < best.distanceM)) {
      best = { name: s.name || 'an unnamed spot', distanceM: d };
    }
  }
  return best;
}

async function authedRpc(
  cfg: SupabaseConfig,
  fn: string,
  args: Record<string, unknown>,
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<unknown> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    res = await f(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
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
        ? 'Sign in to use this.'
        : 'Could not save the spot.',
      res.status,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError('The data service sent an unreadable response.', res.status);
  }
}

/** Create via the 0027 RPC (owner + source forced server-side). Returns id. */
export async function createSpot(
  cfg: SupabaseConfig,
  accessToken: string,
  draft: SpotDraft,
  fetchImpl?: FetchLike,
): Promise<string> {
  const problem = validateSpotDraft(draft);
  if (problem !== null) throw new DataError(problem, null);
  const raw = await authedRpc(
    cfg,
    'create_spot',
    {
      p: {
        lat: draft.lat,
        lng: draft.lng,
        type: draft.type,
        name: draft.name.trim(),
        description: draft.description.slice(0, SPOT_DESC_MAX),
        tags: draft.tags.slice(0, SPOT_TAGS_MAX).map((t) => t.slice(0, SPOT_TAG_LEN_MAX)),
      },
    },
    accessToken,
    fetchImpl,
  );
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) throw new DataError('The data service sent an unreadable response.', null);
  return parsed.data;
}

/** A full spot row for the detail screen (RLS-scoped: OSM for all, own rows for owners). */
export const SpotDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  source: z.string(),
  owner_id: z.string().nullable(),
});
export type SpotDetail = z.infer<typeof SpotDetailSchema>;

export async function fetchSpotById(
  cfg: SupabaseConfig,
  id: string,
  accessToken: string | null,
  fetchImpl?: FetchLike,
): Promise<SpotDetail | null> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    res = await f(
      `${cfg.url}/rest/v1/spots?id=eq.${encodeURIComponent(id)}&select=id,name,type,description,tags,source,owner_id`,
      {
        method: 'GET',
        headers: {
          apikey: cfg.anonKey,
          authorization: `Bearer ${accessToken ?? cfg.anonKey}`,
        },
      },
    );
  } catch (err) {
    throw new DataError('Could not reach the data service — check your connection.', null, {
      cause: err,
    });
  }
  if (!res.ok) throw new DataError('Could not load that spot.', res.status);
  const rows = z.array(SpotDetailSchema).safeParse(JSON.parse(await res.text()));
  if (!rows.success) throw new DataError('Spot data did not match the expected shape.');
  return rows.data[0] ?? null; // null = gone or not visible to you (RLS)
}

/** Edit own user spot via the 0027 RPC. False = not yours / OSM / gone. */
export async function updateSpot(
  cfg: SupabaseConfig,
  accessToken: string,
  id: string,
  patch: { name?: string; description?: string; tags?: string[] },
  fetchImpl?: FetchLike,
): Promise<boolean> {
  if (patch.name !== undefined && patch.name.trim().length === 0) {
    throw new DataError('Give the spot a name.', null);
  }
  const raw = await authedRpc(
    cfg,
    'update_spot',
    {
      p_id: id,
      p: {
        ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, SPOT_NAME_MAX) } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description.slice(0, SPOT_DESC_MAX) }
          : {}),
        ...(patch.tags !== undefined
          ? { tags: patch.tags.slice(0, SPOT_TAGS_MAX).map((t) => t.slice(0, SPOT_TAG_LEN_MAX)) }
          : {}),
      },
    },
    accessToken,
    fetchImpl,
  );
  return raw === true;
}

/**
 * Delete own user spot — via the BACKEND (not PostgREST): photo rows cascade
 * in SQL but their Storage blobs can only be removed through the Storage API
 * (0029), so the backend endpoint owns the whole cascade.
 */
export async function deleteSpot(
  apiBaseUrl: string,
  accessToken: string,
  id: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    res = await f(`${apiBaseUrl}/spots/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new DataError('Could not reach the server — check your connection.', null, {
      cause: err,
    });
  }
  if (!res.ok) throw new DataError('Could not delete the spot.', res.status);
}
