/**
 * Profile data access (M8-T02; FR-090/091) — PostgREST over the same
 * FetchLike as data.ts, zod-validated (Hard rule K), PURE (node-tested).
 *
 * Reads are anon-capable (profiles front public content); updates carry the
 * user's Bearer token — RLS owner-update policies enforce identity server-side
 * (migration 0023), the client just presents credentials.
 */

import { z } from 'zod';

import type { FetchLike } from './api';
import { DataError, type SupabaseConfig } from './data';

const ProfileSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().min(1).max(40),
  avatar_url: z.string().nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Display-name cap — mirrors the DB check in migration 0023 (server wins). */
export const DISPLAY_NAME_MAX = 40;

async function rest(
  cfg: SupabaseConfig,
  path: string,
  init: { method: string; body?: unknown; accessToken?: string; headers?: Record<string, string> },
  fetchImpl?: FetchLike,
): Promise<{ status: number; text: string }> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
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
    throw new DataError('Could not reach the data service — check your connection.', null, {
      cause: err,
    });
  }
  return { status: res.status, text: await res.text() };
}

/** Fetch one profile (anon-readable). Null when it does not exist. */
export async function fetchProfile(
  cfg: SupabaseConfig,
  userId: string,
  fetchImpl?: FetchLike,
): Promise<Profile | null> {
  const { status, text } = await rest(
    cfg,
    `/profiles?id=eq.${encodeURIComponent(userId)}&select=id,display_name,avatar_url`,
    { method: 'GET' },
    fetchImpl,
  );
  if (status < 200 || status >= 300) {
    throw new DataError('Could not load the profile right now.', status);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DataError('Profile data came back malformed.', status);
  }
  const rows = z.array(ProfileSchema).safeParse(raw);
  if (!rows.success) throw new DataError('Profile data came back malformed.', status);
  return rows.data[0] ?? null;
}

/** Update the signed-in user's display name (RLS enforces ownership). */
export async function updateDisplayName(
  cfg: SupabaseConfig,
  accessToken: string,
  userId: string,
  displayName: string,
  fetchImpl?: FetchLike,
): Promise<Profile> {
  const name = displayName.trim();
  if (name.length === 0 || name.length > DISPLAY_NAME_MAX) {
    throw new DataError(`Display names are 1–${DISPLAY_NAME_MAX} characters.`, null);
  }
  const { status, text } = await rest(
    cfg,
    `/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      body: { display_name: name },
      accessToken,
      headers: { prefer: 'return=representation' },
    },
    fetchImpl,
  );
  if (status < 200 || status >= 300) {
    throw new DataError('Could not save the name right now.', status);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DataError('Profile data came back malformed.', status);
  }
  const rows = z.array(ProfileSchema).safeParse(raw);
  // RLS silently matches zero rows when the token's uid ≠ row id — surface
  // that honestly instead of pretending the write happened.
  if (!rows.success || rows.data.length === 0) {
    throw new DataError('That profile isn’t yours to change.', status);
  }
  return rows.data[0]!;
}
