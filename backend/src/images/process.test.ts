import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { hasExif, ImageRejectedError, MAX_IMAGE_BYTES, processImage } from './process';

/**
 * M10-T05 / SPK-18 — the AC verbatim: a GPS-tagged upload yields an output
 * with no EXIF/GPS; bad types rejected. The fixture is BUILT with real GPS
 * EXIF and the test first proves the input carries it (no vacuous pass).
 */

async function gpsTaggedJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 900, height: 600, channels: 3, background: { r: 40, g: 90, b: 60 } },
  })
    .jpeg()
    .withExif({
      IFD0: {
        ImageDescription: 'taken at a secret driveway',
        Make: 'TestCam',
        Software: 'roadopia-fixture',
      },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '43/1 18/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '79/1 54/1 0/1',
      },
    })
    .toBuffer();
}

describe('processImage (SPK-18: strip + re-encode before anything is served)', () => {
  it('a GPS-tagged JPEG comes out with ZERO EXIF — and the input really had it', async () => {
    const tagged = await gpsTaggedJpeg();
    expect(await hasExif(tagged)).toBe(true); // fixture is genuinely poisoned
    const out = await processImage(tagged);
    expect(await hasExif(out.full)).toBe(false);
    expect(await hasExif(out.thumb)).toBe(false);
    const meta = await sharp(out.full).metadata();
    expect(meta.format).toBe('jpeg'); // re-encoded, not passed through
  });

  it('resizes oversized dimensions and never enlarges small ones', async () => {
    const big = await sharp({
      create: { width: 4000, height: 2000, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const out = await processImage(big);
    expect(out.width).toBeLessThanOrEqual(2048);
    const small = await processImage(
      await sharp({
        create: { width: 300, height: 200, channels: 3, background: { r: 9, g: 9, b: 9 } },
      })
        .png()
        .toBuffer(),
    );
    expect(small.width).toBe(300);
  });

  it('rejects by MAGIC BYTES, size and corruption — never serves the original', async () => {
    await expect(processImage(Buffer.from('GIF89a not really an image'))).rejects.toThrow(
      ImageRejectedError,
    );
    await expect(processImage(Buffer.from('%PDF-1.4 sneaky'))).rejects.toThrow(
      'Only JPEG, PNG or WebP',
    );
    await expect(processImage(Buffer.alloc(0))).rejects.toThrow('empty');
    await expect(processImage(Buffer.alloc(MAX_IMAGE_BYTES + 1))).rejects.toThrow('too large');
    // valid JPEG magic bytes, garbage body
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    await expect(processImage(fake)).rejects.toThrow('could not be read');
  });
});
