import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { DataError } from '../../lib/data';
import { memorySessionStore } from '../../lib/session_store';
import type { SpotDetail } from '../../lib/spots';
import { AuthProvider } from '../../lib/use_auth';
import SpotDetailScreen from '../SpotDetailScreen';

/**
 * Review (2026-09-04): the row reloads on focus, and a refresh that FAILS
 * must not replace a spot that is on screen with an error page — the spot
 * was there a second ago; say the refresh failed and keep it.
 */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };
// owned by someone else: readable, not editable (keeps the photo strip out
// of this test — its list would otherwise reach for a live backend)
const SPOT: SpotDetail = {
  id: 's1',
  name: 'Ridge Lookout',
  type: 'viewpoint',
  description: 'Big view over the valley',
  tags: ['view'],
  source: 'user',
  owner_id: 'u9',
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

async function render(fetchFn: () => Promise<SpotDetail | null>): Promise<{
  tree: ReactTestRenderer;
  focus: () => Promise<void>;
}> {
  let focusCb: (() => void) | null = null;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      (
        <AuthProvider engine={signedIn()}>
          <SpotDetailScreen
            navigation={{
              goBack: () => undefined,
              addFocusListener: (cb) => {
                focusCb = cb;
                return () => undefined;
              },
            }}
            route={{ params: { id: 's1', name: 'Ridge Lookout' } }}
            cfg={CFG}
            fetchFn={fetchFn as never}
            updateFn={vi.fn(async () => true) as never}
            deleteFn={vi.fn(async () => undefined) as never}
          />
        </AuthProvider>
      ) as ReactElement,
    );
  });
  await act(async () => {});
  return {
    tree,
    focus: async () => {
      await act(async () => {
        focusCb!();
      });
      await act(async () => {});
    },
  };
}

const textOf = (t: ReactTestRenderer): string => JSON.stringify(t.toJSON());

describe('SpotDetailScreen refresh honesty', () => {
  it('a failed background refresh keeps the loaded spot and says the refresh failed', async () => {
    let calls = 0;
    const { tree, focus } = await render(async () => {
      calls += 1;
      if (calls > 1) throw new DataError('Could not reach the data service.', null);
      return SPOT;
    });
    expect(textOf(tree)).toContain('Ridge Lookout');
    await focus();
    const text = textOf(tree);
    expect(text).toContain('Ridge Lookout');
    expect(text).toContain('Couldn’t refresh this spot');
    expect(text).not.toContain('Could not load that spot right now');
  });

  it('a refresh that returns nothing while a spot is loaded does not turn it into "removed"', async () => {
    let calls = 0;
    const { tree, focus } = await render(async () => {
      calls += 1;
      return calls > 1 ? null : SPOT;
    });
    await focus();
    const text = textOf(tree);
    expect(text).toContain('Ridge Lookout');
    expect(text).not.toContain('may have been removed');
  });

  it('a first load that fails shows the honest error with a Retry that recovers', async () => {
    let calls = 0;
    const { tree } = await render(async () => {
      calls += 1;
      if (calls === 1) throw new DataError('down', null);
      return SPOT;
    });
    expect(textOf(tree)).toContain('Could not load that spot right now');
    const retry = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Retry' && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (retry.props['onPress'] as () => void)();
    });
    await act(async () => {});
    expect(textOf(tree)).toContain('Ridge Lookout');
  });
});
