import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import PhotoUpload from '../../components/PhotoUpload';
import { AuthEngine } from '../auth_state';
import { deletePhoto, listSpotPhotos, uploadSpotPhoto, type PhotoRef } from '../photos';
import { memorySessionStore } from '../session_store';
import { AuthProvider } from '../use_auth';

/**
 * M10-T05 (app side) — upload→display uses PROCESSED signed URLs only; the
 * raw local uri is sent to the pipeline and never rendered.
 */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };
const SIGNED: PhotoRef = {
  id: 'p1',
  url: 'http://sb.local/storage/v1/object/sign/photos/u/s/p1.jpg?token=x',
  thumb_url: 'http://sb.local/storage/v1/object/sign/photos/u/s/p1_thumb.jpg?token=x',
};

function signedIn(): AuthEngine {
  return new AuthEngine({
    cfg: CFG,
    store: memorySessionStore({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 9_999_999_999,
      user: { id: 'u1', email: 'a@b.co' },
    }),
  });
}

async function render(
  over: Partial<Parameters<typeof PhotoUpload>[0]>,
): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      (
        <AuthProvider engine={signedIn()}>
          <PhotoUpload
            spotId="spot-1"
            baseUrl="http://api.local"
            listFn={async () => []}
            {...over}
          />
        </AuthProvider>
      ) as ReactElement,
    );
  });
  await act(async () => {});
  return tree;
}

describe('uploadSpotPhoto (lib)', () => {
  it('reads the local file, posts bytes with the token, returns the signed refs', async () => {
    const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
    const fetchMock = (async (url: string, init?: Record<string, unknown>) => {
      calls.push({ url, ...(init !== undefined ? { init } : {}) });
      if (url.startsWith('file://')) {
        return { ok: true, status: 200, text: async () => '', blob: async () => 'BYTES' };
      }
      return { ok: true, status: 201, text: async () => JSON.stringify(SIGNED) };
    }) as never;
    const ref = await uploadSpotPhoto(
      { baseUrl: 'http://api.local', accessToken: 'tok', fetchImpl: fetchMock },
      'spot-1',
      'file://photo.jpg',
    );
    expect(ref.url).toContain('/object/sign/'); // only signed URLs come back
    const post = calls[1]!;
    expect(post.url).toBe('http://api.local/spots/spot-1/photos');
    expect((post.init!['headers'] as Record<string, string>)['authorization']).toBe('Bearer tok');
    expect(post.init!['body']).toBe('BYTES');
  });

  it('listSpotPhotos and deletePhoto hit the backend, never Storage', async () => {
    const urls: string[] = [];
    const fetchMock = (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ photos: [SIGNED] }) };
    }) as never;
    const opts = { baseUrl: 'http://api.local', accessToken: 'tok', fetchImpl: fetchMock };
    await listSpotPhotos(opts, 'spot-1');
    await deletePhoto(opts, 'p1');
    expect(urls).toEqual(['http://api.local/spots/spot-1/photos', 'http://api.local/photos/p1']);
    expect(urls.every((u) => !u.includes('storage'))).toBe(true);
  });
});

describe('PhotoUpload (component)', () => {
  it('renders ONLY the processed signed thumb, never the local uri', async () => {
    const tree = await render({
      pickFn: async () => 'file://raw-with-gps.jpg',
      uploadFn: vi.fn(async () => SIGNED),
    });
    const add = tree.root.findAll((n) => n.props['accessibilityLabel'] === 'Add a photo')[0]!;
    await act(async () => {
      (add.props['onPress'] as () => void)();
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('p1_thumb.jpg');
    expect(json).not.toContain('raw-with-gps'); // the raw original is never referenced
  });

  it('a cancelled picker is a quiet no-op; a rejected upload says why', async () => {
    const uploadFn = vi.fn(async () => {
      throw Object.assign(new Error('Only JPEG, PNG or WebP images are accepted.'), {
        name: 'ApiError',
      });
    });
    const cancelled = await render({ pickFn: async () => null, uploadFn: uploadFn as never });
    const add = cancelled.root.findAll((n) => n.props['accessibilityLabel'] === 'Add a photo')[0]!;
    await act(async () => {
      (add.props['onPress'] as () => void)();
    });
    expect(uploadFn).not.toHaveBeenCalled(); // nothing picked → nothing sent

    const failing = await render({
      pickFn: async () => 'file://x.gif',
      uploadFn: uploadFn as never,
    });
    const add2 = failing.root.findAll((n) => n.props['accessibilityLabel'] === 'Add a photo')[0]!;
    await act(async () => {
      (add2.props['onPress'] as () => void)();
    });
    expect(JSON.stringify(failing.toJSON())).toContain('Could not upload the photo');
  });
});
