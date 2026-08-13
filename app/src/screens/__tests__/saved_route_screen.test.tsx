import type { Route } from '@shared/types';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import SavedRouteScreen, { visibilityBlurb } from '../SavedRouteScreen';

/**
 * M8 — reopening a saved drive (FR-074: the shared RouteDetail renders it) and
 * the owner's visibility control (T08). A listed row that opens nothing is a
 * dead end; a row that opens a blank screen is worse.
 */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };
const ROUTE = {
  id: '9f0403ea-65db-4f11-938c-d567a8033c2b',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.9, 43.2],
      [-79.89, 43.21],
    ],
  },
  is_loop: true,
  waypoints: [],
  distance_m: 40000,
  duration_s: 3600,
  curviness: 1.2,
  elevation_profile: null,
  climb_m: null,
  highway_flag: false,
  toll_flag: false,
  ferry_flag: false,
  unpaved_flag: false,
  character_tags: [],
  intensity: 'chill',
  free_tags: [],
  visibility: 'private',
  owner_id: 'u1',
  origin_type: 'ai',
  forked_from: null,
  stops: [],
} as unknown as Route;

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
  engine: AuthEngine,
  fetchRouteFn: () => Promise<Route | null>,
  setVisibilityFn = vi.fn(async () => undefined),
): Promise<{ tree: ReactTestRenderer; setVisibilityFn: typeof setVisibilityFn }> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      (
        <AuthProvider engine={engine}>
          <SavedRouteScreen
            navigation={{ goBack: () => undefined, navigate: () => undefined }}
            route={{ params: { id: ROUTE.id!, name: 'My loop', visibility: 'private' } }}
            cfg={CFG}
            fetchRouteFn={fetchRouteFn as never}
            setVisibilityFn={setVisibilityFn as never}
          />
        </AuthProvider>
      ) as ReactElement,
    );
  });
  await act(async () => {});
  return { tree, setVisibilityFn };
}

describe('SavedRouteScreen', () => {
  it('renders the saved drive through the shared detail component', async () => {
    const { tree } = await render(signedIn(), async () => ROUTE);
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Who can see this');
    expect(text).toContain('Only you can see this drive');
  });

  it('a deleted/invisible drive gets an honest state, not a blank screen', async () => {
    const { tree } = await render(signedIn(), async () => null);
    expect(JSON.stringify(tree.toJSON())).toContain('isn’t available any more');
  });

  it('changing visibility calls through and updates the blurb', async () => {
    const { tree, setVisibilityFn } = await render(signedIn(), async () => ROUTE);
    const chip = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Set visibility unlisted' && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (chip.props['onPress'] as () => void)();
    });
    expect(setVisibilityFn).toHaveBeenCalledWith(CFG, 'at', ROUTE.id, 'unlisted');
    expect(JSON.stringify(tree.toJSON())).toContain('Anyone with the link');
  });

  it('a rejected visibility change reverts the control (no false claim)', async () => {
    const failing = vi.fn(async () => {
      throw new Error('nope');
    });
    const { tree } = await render(signedIn(), async () => ROUTE, failing as never);
    const chip = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Set visibility public' && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (chip.props['onPress'] as () => void)();
    });
    await act(async () => {});
    expect(JSON.stringify(tree.toJSON())).toContain('Only you can see this drive');
  });

  it('visibility copy is plain and truthful', () => {
    expect(visibilityBlurb('unlisted')).toContain('never shows up in browse');
  });
});
