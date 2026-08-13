/**
 * Supabase Storage REST client (M10-T05) — hand-rolled, service-role only
 * (repo philosophy: raw, transparent HTTP; no SDK dependency). The 'photos'
 * bucket is PRIVATE with zero app-role policies, so every byte in or out
 * goes through here: upload after processing, time-limited signed URLs for
 * display, removal on delete. The service key never leaves this process
 * (Hard rule H) and never appears in errors or logs.
 */

export interface StorageConfig {
  /** Project base URL (no trailing slash). */
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export type FetchLike = (
  url: string,
  init?: Record<string, unknown>,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

function authHeaders(cfg: StorageConfig): Record<string, string> {
  return { apikey: cfg.serviceRoleKey, authorization: `Bearer ${cfg.serviceRoleKey}` };
}

export async function uploadObject(
  cfg: StorageConfig,
  path: string,
  body: Buffer,
  contentType: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<void> {
  const res = await fetchImpl(`${cfg.url}/storage/v1/object/${cfg.bucket}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(cfg), 'content-type': contentType, 'x-upsert': 'false' },
    body,
  });
  if (!res.ok) throw new StorageError('storage upload failed', res.status);
}

/** Time-limited signed URL for a private object (absolute URL). */
export async function signObjectUrl(
  cfg: StorageConfig,
  path: string,
  expiresInS: number,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<string> {
  const res = await fetchImpl(`${cfg.url}/storage/v1/object/sign/${cfg.bucket}/${path}`, {
    method: 'POST',
    headers: { ...authHeaders(cfg), 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: expiresInS }),
  });
  if (!res.ok) throw new StorageError('storage sign failed', res.status);
  const parsed = JSON.parse(await res.text()) as { signedURL?: string };
  if (typeof parsed.signedURL !== 'string')
    throw new StorageError('unreadable sign response', null);
  return `${cfg.url}/storage/v1${parsed.signedURL}`;
}

export async function removeObject(
  cfg: StorageConfig,
  path: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<void> {
  const res = await fetchImpl(`${cfg.url}/storage/v1/object/${cfg.bucket}/${path}`, {
    method: 'DELETE',
    headers: authHeaders(cfg),
  });
  // 404 = already gone — removal is idempotent, not an error
  if (!res.ok && res.status !== 404) throw new StorageError('storage remove failed', res.status);
}
