import type { Route } from '@shared/types';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { DataError } from '../../lib/data';
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

describe('SavedRouteScreen lapsed session (review, 2026-09-07)', () => {
  it('an empty answer with NO token says the session expired — not "deleted" — and offers sign-in', async () => {
    // the access token is inside the refresh window and GoTrue refuses the
    // refresh token (revoked elsewhere): the engine drops to anonymous
    const refused = (async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: async () => '{}',
    })) as never;
    const engine = new AuthEngine({
      cfg: CFG,
      store: memorySessionStore({
        accessToken: 'at',
        refreshToken: 'rt-revoked',
        expiresAt: 1000,
        user: { id: 'u1', email: 'a@b.co' },
      }),
      fetchImpl: refused,
      now: () => 1000,
    });
    const tokensSeen: Array<string | null> = [];
    const fetchRouteFn = async (_cfg: unknown, _id: unknown, token: string | null) => {
      tokensSeen.push(token);
      return null;
    };
    const { tree } = await render(engine, fetchRouteFn as never);
    await act(async () => {});
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('session expired');
    expect(text).not.toContain('isn’t available any more');
    expect(tokensSeen[0]).toBeNull(); // the read still ran, anonymously
    const signIn = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Sign in' && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (signIn.props['onPress'] as () => void)();
    });
    expect(engine.getState().sheetOpen).toBe(true); // the reload is parked behind the sheet
  });
});

describe('SavedRouteScreen rename + delete (device pass, 2026-09-04)', () => {
  async function renderOwner(over: { renameFn?: unknown; deleteFn?: unknown } = {}): Promise<{
    tree: ReactTestRenderer;
    goBack: ReturnType<typeof vi.fn>;
    setTitle: ReturnType<typeof vi.fn>;
    renameFn: ReturnType<typeof vi.fn>;
    deleteFn: ReturnType<typeof vi.fn>;
  }> {
    const goBack = vi.fn();
    const setTitle = vi.fn();
    const renameFn = (over.renameFn ??
      vi.fn(async (_c: unknown, _t: unknown, _id: unknown, name: string) =>
        name.trim(),
      )) as ReturnType<typeof vi.fn>;
    const deleteFn = (over.deleteFn ?? vi.fn(async () => undefined)) as ReturnType<typeof vi.fn>;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        (
          <AuthProvider engine={signedIn()}>
            <SavedRouteScreen
              navigation={{ goBack, navigate: () => undefined, setTitle }}
              route={{ params: { id: ROUTE.id!, name: 'My loop', visibility: 'private' } }}
              cfg={CFG}
              fetchRouteFn={(async () => ({ ...ROUTE, name: 'My loop' })) as never}
              setVisibilityFn={vi.fn(async () => undefined) as never}
              renameFn={renameFn as never}
              deleteFn={deleteFn as never}
            />
          </AuthProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {});
    return { tree, goBack, setTitle, renameFn, deleteFn };
  }

  async function press(tree: ReactTestRenderer, label: string): Promise<void> {
    const node = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === label && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (node.props['onPress'] as () => void)();
    });
  }

  it('renames through the owner op, updating the header title and the detail name', async () => {
    const { tree, setTitle, renameFn } = await renderOwner();
    expect(JSON.stringify(tree.toJSON())).toContain('My loop'); // the name is visible at all
    await press(tree, 'Rename drive');
    const input = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Drive name' && !!n.props['onChangeText'],
    )[0]!;
    await act(async () => {
      (input.props['onChangeText'] as (t: string) => void)('  Escarpment sweep ');
    });
    await press(tree, 'Save name');
    await act(async () => {});
    expect(renameFn).toHaveBeenCalledWith(CFG, 'at', ROUTE.id, 'Escarpment sweep');
    expect(setTitle).toHaveBeenLastCalledWith('Escarpment sweep');
    expect(JSON.stringify(tree.toJSON())).toContain('Escarpment sweep');
  });

  it('delete needs a second tap, then calls the owner op and leaves the screen', async () => {
    const { tree, goBack, deleteFn } = await renderOwner();
    await press(tree, 'Delete drive');
    expect(deleteFn).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Tap again to delete');
    await press(tree, 'Confirm delete drive');
    await act(async () => {});
    expect(deleteFn).toHaveBeenCalledWith(CFG, 'at', ROUTE.id);
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('a refused delete is said plainly and the screen stays', async () => {
    const refusing = vi.fn(async () => {
      throw new DataError('That drive isn’t yours to delete.', 200);
    });
    const { tree, goBack } = await renderOwner({ deleteFn: refusing });
    await press(tree, 'Delete drive');
    await press(tree, 'Confirm delete drive');
    await act(async () => {});
    expect(JSON.stringify(tree.toJSON())).toContain('isn’t yours to delete');
    expect(goBack).not.toHaveBeenCalled();
  });

  it('visibility chips show plain words, not the raw enum', async () => {
    const { tree } = await renderOwner();
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Link only');
    expect(text).toContain('Public');
    expect(text).not.toContain('"unlisted"]'); // the chip label is never the enum
  });
});
