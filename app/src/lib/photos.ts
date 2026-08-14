/**
 * Spot-photo client (M10-T05; FR-035/036). Talks ONLY to the backend
 * pipeline — the app never touches Storage directly (the bucket is private
 * with zero app-role policies), and every URL it ever renders is a SIGNED
 * URL to a processed, EXIF-free artifact. The raw original leaves the phone
 * once, to the processing endpoint, and is never retrievable.
 */

import { z } from 'zod';

import { ApiError, NetworkError } from './api';

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

/** Read the picked image and stream it to the processing pipeline. */
export async function uploadSpotPhoto(
  opts: PhotoApiOptions,
  spotId: string,
  localUri: string,
): Promise<PhotoRef> {
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as PhotoFetchLike);
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
  } catch {
    throw new NetworkError('Could not reach the server — check your connection.');
  }
  const text = await res.text();
  if (!res.ok) {
    let friendly = 'Could not upload the photo.';
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (typeof parsed.message === 'string') friendly = parsed.message;
    } catch {
      // keep the fallback wording
    }
    throw apiError(res.status, messageOf(res.status, friendly));
  }
  const parsed = PhotoRefSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw apiError(res.status, 'The server sent an unreadable response.');
  return parsed.data;
}

export async function listSpotPhotos(opts: PhotoApiOptions, spotId: string): Promise<PhotoRef[]> {
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as PhotoFetchLike);
  let res;
  try {
    res = await f(`${opts.baseUrl}/spots/${encodeURIComponent(spotId)}/photos`, {
      method: 'GET',
      headers: { authorization: `Bearer ${opts.accessToken}` },
    });
  } catch {
    throw new NetworkError('Could not reach the server — check your connection.');
  }
  if (!res.ok) throw apiError(res.status, messageOf(res.status, 'Could not load photos.'));
  const parsed = PhotoListSchema.safeParse(JSON.parse(await res.text()));
  if (!parsed.success) throw apiError(res.status, 'The server sent an unreadable response.');
  return parsed.data.photos;
}

export async function deletePhoto(opts: PhotoApiOptions, photoId: string): Promise<void> {
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as PhotoFetchLike);
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
    throw apiError(res.status, messageOf(res.status, 'Could not delete the photo.'));
  }
}
