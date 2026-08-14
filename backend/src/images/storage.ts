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
    options?: { cause?: unknown },
  ) {
    super(message, options);
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

/** Object keys are ours (uuid segments), but encoding them keeps a future
 *  writer's `?`/`#`/`..` from becoming URL injection carrying the service key. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * A connection-level failure (DNS, ECONNREFUSED, TLS) is the MOST likely
 * outage shape and must present as StorageError like an HTTP failure does —
 * otherwise it escapes as a raw 500 and the fail-closed promise only holds
 * for the tidier half of outages.
 */
async function call(
  fetchImpl: FetchLike,
  url: string,
  init: Record<string, unknown>,
  what: string,
): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  try {
    return await fetchImpl(url, init);
  } catch (err) {
    throw new StorageError(`storage ${what} unreachable`, null, { cause: err });
  }
}

export async function uploadObject(
  cfg: StorageConfig,
  path: string,
  body: Buffer,
  contentType: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<void> {
  const res = await call(
    fetchImpl,
    `${cfg.url}/storage/v1/object/${cfg.bucket}/${encodePath(path)}`,
    {
      method: 'POST',
      headers: { ...authHeaders(cfg), 'content-type': contentType, 'x-upsert': 'false' },
      body,
    },
    'upload',
  );
  if (!res.ok) throw new StorageError('storage upload failed', res.status);
}

/** Time-limited signed URL for a private object (absolute URL). */
export async function signObjectUrl(
  cfg: StorageConfig,
  path: string,
  expiresInS: number,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<string> {
  const res = await call(
    fetchImpl,
    `${cfg.url}/storage/v1/object/sign/${cfg.bucket}/${encodePath(path)}`,
    {
      method: 'POST',
      headers: { ...authHeaders(cfg), 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInS }),
    },
    'sign',
  );
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
  const res = await call(
    fetchImpl,
    `${cfg.url}/storage/v1/object/${cfg.bucket}/${encodePath(path)}`,
    { method: 'DELETE', headers: authHeaders(cfg) },
    'remove',
  );
  // 404 = already gone — removal is idempotent, not an error
  if (!res.ok && res.status !== 404) throw new StorageError('storage remove failed', res.status);
}

/**
 * Delete EVERY object under a key prefix. Rows and blobs live in different
 * systems, so a crash between them can orphan blobs; because our keys are
 * `<owner>/<spot>/<photo>.jpg`, a prefix sweep is a complete, retryable
 * cleanup rather than a best-effort one (Hard rule E: deletion is real).
 */
export async function removeByPrefix(
  cfg: StorageConfig,
  prefix: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<number> {
  const res = await call(
    fetchImpl,
    `${cfg.url}/storage/v1/object/list/${cfg.bucket}`,
    {
      method: 'POST',
      headers: { ...authHeaders(cfg), 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
    },
    'list',
  );
  if (!res.ok) throw new StorageError('storage list failed', res.status);
  let names: string[];
  try {
    names = (JSON.parse(await res.text()) as Array<{ name?: string }>)
      .map((o) => o.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
  } catch {
    throw new StorageError('unreadable list response', null);
  }
  for (const name of names) {
    await removeObject(cfg, `${prefix}${name}`, fetchImpl);
  }
  return names.length;
}
