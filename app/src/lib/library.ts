/**
 * Favourites + preferences + route ops (M8-T05/06/07/08/09/10) — thin,
 * PURE PostgREST/RPC wrappers with zod (Hard rule K). RLS is the boundary;
 * these present credentials and surface honest errors.
 *
 * T07 note: the DATA capability for sharing is complete (unlisted-by-link
 * policy + fetchRouteById below feed the shared-route screen, FR-074); the
 * user-facing link/deep-link surface rides M13's linking config as specced
 * (§20.4) — recorded, not invented early.
 */

import { RouteSchema, type Route } from '@shared/types';
import { z } from 'zod';

import { boundedFetch, transportMessage, type FetchLike } from './api';
import { DataError, type SupabaseConfig } from './data';

async function rest(
  cfg: SupabaseConfig,
  path: string,
  init: {
    method: string;
    body?: unknown;
    accessToken?: string;
    headers?: Record<string, string>;
  },
  fetchImpl?: FetchLike,
): Promise<{ status: number; text: string }> {
  const f = fetchImpl ?? boundedFetch();
  let res;
  try {
    res = await f(`${cfg.url}/rest/v1${path}`, {
      method: init.method,
      headers: {
        apikey: cfg.anonKey,
        authorization: `Bearer ${init.accessToken ?? cfg.anonKey}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (err) {
    throw new DataError(
      transportMessage(err, 'Could not reach the data service — check your connection.'),
      null,
      { cause: err },
    );
  }
  return { status: res.status, text: await res.text() };
}

function guard(status: number, friendly: string): void {
  if (status < 200 || status >= 300) {
    throw new DataError(
      status === 401 || status === 403 ? 'Sign in to use this.' : friendly,
      status,
    );
  }
}

// ---------- T06: favourites (idempotent per PK; RLS = own rows only) ----------

export async function favouriteRoute(
  cfg: SupabaseConfig,
  accessToken: string,
  userId: string,
  routeId: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const { status } = await rest(
    cfg,
    '/route_favourites',
    {
      method: 'POST',
      body: { user_id: userId, route_id: routeId },
      accessToken,
      // idempotent: a repeat tap is a no-op, not an error
      headers: { prefer: 'resolution=ignore-duplicates' },
    },
    fetchImpl,
  );
  guard(status, 'Could not favourite that drive right now.');
}

export async function unfavouriteRoute(
  cfg: SupabaseConfig,
  accessToken: string,
  userId: string,
  routeId: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const { status } = await rest(
    cfg,
    `/route_favourites?user_id=eq.${encodeURIComponent(userId)}&route_id=eq.${encodeURIComponent(routeId)}`,
    { method: 'DELETE', accessToken },
    fetchImpl,
  );
  guard(status, 'Could not remove the favourite right now.');
}

export async function listFavouriteRouteIds(
  cfg: SupabaseConfig,
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<string[]> {
  const { status, text } = await rest(
    cfg,
    '/route_favourites?select=route_id',
    { method: 'GET', accessToken },
    fetchImpl,
  );
  guard(status, 'Could not load favourites.');
  const rows = z.array(z.object({ route_id: z.string().uuid() })).safeParse(JSON.parse(text));
  if (!rows.success) throw new DataError('Favourites came back malformed.', status);
  return rows.data.map((r) => r.route_id);
}

// ---------- T05/T07/T08/T09: route ops ----------

/** Fetch one route by id — the shared-link path (public/unlisted/own via RLS). */
export async function fetchRouteById(
  cfg: SupabaseConfig,
  routeId: string,
  accessToken: string | null,
  fetchImpl?: FetchLike,
): Promise<Route | null> {
  const { status, text } = await rest(
    cfg,
    `/routes?id=eq.${encodeURIComponent(routeId)}&select=*`,
    { method: 'GET', ...(accessToken ? { accessToken } : {}) },
    fetchImpl,
  );
  guard(status, 'Could not load that drive.');
  const raw: unknown = JSON.parse(text);
  const rows = z.array(z.unknown()).safeParse(raw);
  if (!rows.success || rows.data.length === 0) return null;
  const parsed = RouteSchema.safeParse(rows.data[0]);
  if (!parsed.success) throw new DataError('That drive came back malformed.', status);
  return parsed.data;
}

/** Fork a visible route into an independent private copy (FR-081). */
export async function forkRoute(
  cfg: SupabaseConfig,
  accessToken: string,
  routeId: string,
  fetchImpl?: FetchLike,
): Promise<string> {
  const { status, text } = await rest(
    cfg,
    '/rpc/fork_route',
    { method: 'POST', body: { p_route_id: routeId }, accessToken },
    fetchImpl,
  );
  guard(status, 'Could not fork that drive right now.');
  const id = z.string().uuid().safeParse(JSON.parse(text));
  if (!id.success) throw new DataError('Fork returned an unexpected response.', status);
  return id.data;
}

export type Visibility = 'public' | 'private' | 'unlisted';

/** Plain words for a visibility value — the raw enum used to reach the list
 *  and the chips as "private"/"unlisted" (device pass copy audit). */
export function visibilityLabel(v: string): string {
  if (v === 'public') return 'Public';
  if (v === 'unlisted') return 'Link only';
  return 'Private';
}

/** Longest name the DB keeps (0025 save_route: left(name, 80)). */
export const ROUTE_NAME_MAX = 80;

/** Owner-only rename (device pass: every loop was "42-minute loop" forever —
 *  the rename path a code comment promised did not exist). */
export async function renameRoute(
  cfg: SupabaseConfig,
  accessToken: string,
  routeId: string,
  name: string,
  fetchImpl?: FetchLike,
): Promise<string> {
  const clean = name.trim().slice(0, ROUTE_NAME_MAX);
  if (clean === '') throw new DataError('Give the drive a name.', null);
  const { status, text } = await rest(
    cfg,
    `/routes?id=eq.${encodeURIComponent(routeId)}`,
    {
      method: 'PATCH',
      body: { name: clean },
      accessToken,
      headers: { prefer: 'return=representation' },
    },
    fetchImpl,
  );
  guard(status, 'Could not rename the drive right now.');
  const rows = z.array(z.unknown()).safeParse(JSON.parse(text));
  if (!rows.success || rows.data.length === 0) {
    throw new DataError('That drive isn’t yours to change.', status);
  }
  return clean;
}

/** Owner-only delete. RLS decides; a zero-row result is surfaced honestly
 *  rather than reported as done. */
export async function deleteRoute(
  cfg: SupabaseConfig,
  accessToken: string,
  routeId: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const { status, text } = await rest(
    cfg,
    `/routes?id=eq.${encodeURIComponent(routeId)}`,
    { method: 'DELETE', accessToken, headers: { prefer: 'return=representation' } },
    fetchImpl,
  );
  guard(status, 'Could not delete the drive right now.');
  const rows = z.array(z.unknown()).safeParse(JSON.parse(text));
  if (!rows.success || rows.data.length === 0) {
    throw new DataError('That drive isn’t yours to delete.', status);
  }
}

/** Owner-only visibility change (T08; RLS zero-row = not yours, surfaced). */
export async function updateVisibility(
  cfg: SupabaseConfig,
  accessToken: string,
  routeId: string,
  visibility: 'public' | 'private' | 'unlisted',
  fetchImpl?: FetchLike,
): Promise<void> {
  const { status, text } = await rest(
    cfg,
    `/routes?id=eq.${encodeURIComponent(routeId)}`,
    {
      method: 'PATCH',
      body: { visibility },
      accessToken,
      headers: { prefer: 'return=representation' },
    },
    fetchImpl,
  );
  guard(status, 'Could not change visibility right now.');
  const rows = z.array(z.unknown()).safeParse(JSON.parse(text));
  if (!rows.success || rows.data.length === 0) {
    throw new DataError('That drive isn’t yours to change.', status);
  }
}

/** Irreversible account + data deletion (T09; server deletes only auth.uid()). */
/**
 * Account deletion goes through the BACKEND (M10 revision): the 0029 RPC
 * deletes rows only, and the backend sweeps the user's photo blobs via the
 * Storage API first — SQL cannot touch storage.objects (protect_delete).
 */
export async function deleteAccount(
  apiBaseUrl: string,
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const f = fetchImpl ?? boundedFetch();
  let res;
  try {
    res = await f(`${apiBaseUrl}/account`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new DataError(
      transportMessage(err, 'Could not reach the server — check your connection.'),
      null,
      { cause: err },
    );
  }
  guard(res.status, 'Could not delete the account right now — try again.');
}

// ---------- T10: user_preferences (stored settings; no learning, §35) ----------

const PrefsSchema = z.object({ weights: z.record(z.string(), z.unknown()) });

export async function getPreferences(
  cfg: SupabaseConfig,
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<Record<string, unknown>> {
  const { status, text } = await rest(
    cfg,
    '/user_preferences?select=weights',
    { method: 'GET', accessToken },
    fetchImpl,
  );
  guard(status, 'Could not load preferences.');
  const rows = z.array(PrefsSchema).safeParse(JSON.parse(text));
  if (!rows.success) throw new DataError('Preferences came back malformed.', status);
  return rows.data[0]?.weights ?? {};
}

export async function setPreferences(
  cfg: SupabaseConfig,
  accessToken: string,
  userId: string,
  weights: Record<string, unknown>,
  fetchImpl?: FetchLike,
): Promise<void> {
  const { status } = await rest(
    cfg,
    '/user_preferences?on_conflict=user_id',
    {
      method: 'POST',
      body: { user_id: userId, weights, updated_at: new Date().toISOString() },
      accessToken,
      headers: { prefer: 'resolution=merge-duplicates' },
    },
    fetchImpl,
  );
  guard(status, 'Could not save preferences.');
}
