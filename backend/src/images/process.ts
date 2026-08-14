/**
 * Image processing pipeline (M10-T05; FR-036/310-312; spec §56; SPK-18).
 *
 * THE privacy-critical path: no uploaded image may become retrievable before
 * EXIF/GPS strip + re-encode (Hard rule E). This module is the only place
 * bytes are accepted, and it is fail-closed: anything that isn't a valid,
 * size-bounded JPEG/PNG/WebP by MAGIC BYTES (never the client's claim —
 * Hard rule K) is rejected with a plain reason.
 *
 * sharp drops ALL metadata (EXIF, GPS, ICC, XMP) unless .withMetadata() is
 * called — it never is here. .rotate() applies the EXIF orientation to the
 * PIXELS first, so stripping the tag can't turn photos sideways.
 */

import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/**
 * Decode ceiling. A tiny file can carry an enormous canvas — a 197 KB solid
 * 8000×8000 PNG decodes to ~192 MB of pixels — so a byte cap alone lets a
 * handful of uploads pin the VPS. 40 MP still clears any phone camera
 * (a 48 MP sensor writes ~12 MP by default; 40 MP ≈ 8000×5000).
 */
export const MAX_IMAGE_PIXELS = 40_000_000;
/** iPhones shoot HEIC, but expo-image-picker transcodes to JPEG on pick;
 *  prebuilt sharp has no HEIF codecs, so HEIC here means a bypassed picker. */
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const FULL_MAX_PX = 2048;
export const THUMB_MAX_PX = 400;

export class ImageRejectedError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 413 = 400,
  ) {
    super(message);
    this.name = 'ImageRejectedError';
  }
}

export interface ProcessedImage {
  /** Re-encoded JPEG, metadata-free, ≤ FULL_MAX_PX on the long edge. */
  full: Buffer;
  /** Re-encoded JPEG thumbnail, ≤ THUMB_MAX_PX. */
  thumb: Buffer;
  width: number;
  height: number;
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageRejectedError('The upload was empty.');
  if (input.length > MAX_IMAGE_BYTES) {
    throw new ImageRejectedError('That image is too large — 10 MB is the limit.', 413);
  }
  const kind = await fileTypeFromBuffer(input);
  if (!kind || !(ALLOWED_MIME as readonly string[]).includes(kind.mime)) {
    throw new ImageRejectedError('Only JPEG, PNG or WebP images are accepted.');
  }

  let full: Buffer;
  let thumb: Buffer;
  let meta: { width?: number; height?: number };
  try {
    const oriented = sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).rotate();
    full = await oriented
      .clone()
      .resize(FULL_MAX_PX, FULL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    thumb = await oriented
      .clone()
      .resize(THUMB_MAX_PX, THUMB_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    meta = await sharp(full).metadata();
  } catch (err) {
    // Valid magic bytes but broken image data, or a decode bomb over the pixel
    // ceiling — either way a reject, never a serve.
    if (err instanceof Error && /pixel|dimensions|limitInputPixels/i.test(err.message)) {
      throw new ImageRejectedError('That image is too large to process — try a smaller one.', 413);
    }
    throw new ImageRejectedError('That image could not be read — it may be corrupted.');
  }
  return { full, thumb, width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** Test hook: does this buffer carry ANY EXIF payload? */
export async function hasExif(buf: Buffer): Promise<boolean> {
  const meta = await sharp(buf).metadata();
  return meta.exif !== undefined && meta.exif.length > 0;
}
