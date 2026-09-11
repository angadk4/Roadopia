/**
 * Spot-photo client (M10-T05; FR-035/036). Talks ONLY to the backend
 * pipeline — the app never touches Storage directly (the bucket is private
 * with zero app-role policies), and every URL it ever renders is a SIGNED
 * URL to a processed, EXIF-free artifact. The raw original leaves the phone
 * once, to the processing endpoint, and is never retrievable.
 */

import { z } from 'zod';

import { ApiError, boundedFetch, NetworkError, transportMessage } from './api';

/** A 10 MB photo on cellular legitimately takes longer than a JSON call. */
const UPLOAD_TIMEOUT_MS = 90_000;

/** fetch shape for this module — photo bodies are binary (Blob), and the
 *  local-file read needs a bare fetch(uri); api.ts's FetchLike is JSON-only. */
export type PhotoFetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

function apiError(status: number, message: string): ApiError {
  return new ApiError({ status, code: 'photo_api', message });
}

export interface PhotoRef {
  id: string;
  url: string;
  thumb_url: string;
}

const PhotoRefSchema = z.object({ id: z.string(), url: z.string(), thumb_url: z.string() });
const PhotoListSchema = z.object({ photos: z.array(PhotoRefSchema) });

export interface PhotoApiOptions {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: PhotoFetchLike;
}

function messageOf(status: number, fallback: string): string {
  return status === 401 || status === 403 ? 'Sign in to use this.' : fallback;
}

/**
 * The backend's error body (`{error:{code,message}}`, lib/errors.ts) → an
 * ApiError carrying its plain-words reason and code; a non-JSON body keeps
 * `fallback`. Review 2026-09-07: the message used to be read from the TOP
 * level, so "A spot holds up to 6 photos.", "That upload is too large." and
 * the 429's "try again in Ns" all collapsed to the generic line.
 */
function failure(status: number, text: string, fallback: string): ApiError {
  let message = fallback;
  let code = 'photo_api';
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim() !== '') {
      message = parsed.error.message;
    }
    if (typeof parsed.error?.code === 'string') code = parsed.error.code;
  } catch {
    // keep the fallback wording
  }
  return new ApiError({ status, code, message: messageOf(status, message) });
}

/** Read the picked image and stream it to the processing pipeline. */
export async function uploadSpotPhoto(
  opts: PhotoApiOptions,
  spotId: string,
  localUri: string,
): Promise<PhotoRef> {
  const f = opts.fetchImpl ?? (boundedFetch(UPLOAD_TIMEOUT_MS) as unknown as PhotoFetchLike);
  let blob: unknown;
  try {
    const local = await f(localUri, {});
    if (!local.ok) throw new Error(`local read ${local.status}`);
    blob = await (local as unknown as { blob(): Promise<unknown> }).blob();
  } catch {
    throw new NetworkError('Could not read that photo from the device.');
  }
  let res;
  try {
    res = await f(`${opts.baseUrl}/spots/${encodeURIComponent(spotId)}/photos`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.accessToken}`,
        'content-type': 'application/octet-stream',
      },
      body: blob,
    });
  } catch (err) {
    throw new NetworkError(
      transportMessage(err, 'Could not reach the server — check your connection.'),
    );
  }
  const text = await res.text();
  if (!res.ok) throw failure(res.status, text, 'Could not upload the photo.');
  const parsed = PhotoRefSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw apiError(res.status, 'The server sent an unreadable response.');
  return parsed.data;
}

export async function listSpotPhotos(opts: PhotoApiOptions, spotId: string): Promise<PhotoRef[]> {
  const f = opts.fetchImpl ?? (boundedFetch() as unknown as PhotoFetchLike);
  let res;
  try {
    res = await f(`${opts.baseUrl}/spots/${encodeURIComponent(spotId)}/photos`, {
      method: 'GET',
      headers: { authorization: `Bearer ${opts.accessToken}` },
    });
  } catch {
    throw new NetworkError('Could not reach the server — check your connection.');
  }
  const text = await res.text();
  if (!res.ok) throw failure(res.status, text, 'Could not load photos.');
  const parsed = PhotoListSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw apiError(res.status, 'The server sent an unreadable response.');
  return parsed.data.photos;
}

export async function deletePhoto(opts: PhotoApiOptions, photoId: string): Promise<void> {
  const f = opts.fetchImpl ?? (boundedFetch() as unknown as PhotoFetchLike);
  let res;
  try {
    res = await f(`${opts.baseUrl}/photos/${encodeURIComponent(photoId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${opts.accessToken}` },
    });
  } catch {
    throw new NetworkError('Could not reach the server — check your connection.');
  }
  if (!res.ok && res.status !== 404) {
    throw failure(res.status, await res.text(), 'Could not delete the photo.');
  }
}
