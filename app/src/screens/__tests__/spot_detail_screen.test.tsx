import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { DataError } from '../../lib/data';
import { memorySessionStore } from '../../lib/session_store';
import type { SpotDetail } from '../../lib/spots';
import { AuthProvider } from '../../lib/use_auth';
import { confirmDialog, dialogPresented } from '../../test/dialog';
import SpotDetailScreen from '../SpotDetailScreen';

/**
 * Review (2026-09-04): the row reloads on focus, and a refresh that FAILS
 * must not replace a spot that is on screen with an error page — the spot
 * was there a second ago; say the refresh failed and keep it.
 *
 * Redesign (SPEC "SpotDetail"): the name is the NATIVE large title, handed
 * to the header through `navigation.setTitle` (the adapter SavedRoute uses),
 * so "the name is on the page" reads as "the header was titled with it". The
 * header menu lives in the header — a bare render has none — and Delete asks
 * through a native dialog whose destructive action is the only thing that
 * runs the op.
 */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };
// owned by someone else: readable, not editable (keeps the photo grid out
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
/** The signed-in user's own spot: editable, so the owner controls mount. The
 *  photo list is injected empty so nothing reaches a backend. */
const OWN: SpotDetail = { ...SPOT, id: 's2', owner_id: 'u1' };

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

interface Rendered {
  tree: ReactTestRenderer;
  focus: () => Promise<void>;
  setTitle: ReturnType<typeof vi.fn>;
  setHeaderRight: ReturnType<typeof vi.fn>;
  goBack: ReturnType<typeof vi.fn>;
  deleteFn: ReturnType<typeof vi.fn>;
}

async function render(
  fetchFn: () => Promise<SpotDetail | null>,
  opts: { withHeaderSlot?: boolean } = {},
): Promise<Rendered> {
  let focusCb: (() => void) | null = null;
  let tree!: ReactTestRenderer;
  const setTitle = vi.fn();
  const setHeaderRight = vi.fn();
  const goBack = vi.fn();
  const deleteFn = vi.fn(async () => undefined);
  await act(async () => {
    tree = create(
      (
        <AuthProvider engine={signedIn()}>
          <SpotDetailScreen
            navigation={{
              goBack,
              addFocusListener: (cb) => {
                focusCb = cb;
                return () => undefined;
              },
              setTitle,
              ...(opts.withHeaderSlot ? { setHeaderRight } : {}),
            }}
            route={{ params: { id: 's1', name: 'Ridge Lookout' } }}
            cfg={CFG}
            fetchFn={fetchFn as never}
            updateFn={vi.fn(async () => true) as never}
            deleteFn={deleteFn as never}
            photoProps={{ listFn: async () => [] }}
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
    setTitle,
    setHeaderRight,
    goBack,
    deleteFn,
  };
}

const textOf = (t: ReactTestRenderer): string => JSON.stringify(t.toJSON());

function pressable(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (n) => n.props['accessibilityLabel'] === label && !!n.props['onPress'],
  )[0]!;
}

describe('SpotDetailScreen refresh honesty', () => {
  it('a failed background refresh keeps the loaded spot and says the refresh failed', async () => {
    let calls = 0;
    const { tree, focus, setTitle } = await render(async () => {
      calls += 1;
      if (calls > 1) throw new DataError('Could not reach the data service.', null);
      return SPOT;
    });
    // the name lives in the native header — the loaded row titled it
    expect(setTitle).toHaveBeenCalledWith('Ridge Lookout');
    expect(textOf(tree)).toContain('Big view over the valley');
    await focus();
    const text = textOf(tree);
    expect(text).toContain('Big view over the valley'); // the loaded spot stays
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
    expect(text).toContain('Big view over the valley');
    expect(text).not.toContain('may have been removed');
  });

  it('a first load that fails shows the honest error with a Retry that recovers', async () => {
    let calls = 0;
    const { tree, setTitle } = await render(async () => {
      calls += 1;
      if (calls === 1) throw new DataError('down', null);
      return SPOT;
    });
    expect(textOf(tree)).toContain('Could not load that spot right now');
    expect(setTitle).not.toHaveBeenCalled(); // nothing loaded, nothing to title
    const retry = pressable(tree, 'Retry');
    await act(async () => {
      (retry.props['onPress'] as () => void)();
    });
    await act(async () => {});
    expect(setTitle).toHaveBeenCalledWith('Ridge Lookout');
    expect(textOf(tree)).toContain('Big view over the valley');
  });
});

describe('SpotDetailScreen owner actions (redesign)', () => {
  it('a bare render has no header menu — the in-page Edit and Delete stay', async () => {
    const { tree } = await render(async () => OWN);
    expect(tree.root.findAll((n) => n.type === ('expo-ui-menu' as never))).toHaveLength(0);
    expect(textOf(tree)).not.toContain('More actions');
    expect(pressable(tree, 'Edit spot')).toBeDefined();
    expect(pressable(tree, 'Delete spot')).toBeDefined();
    // nothing is armed, nothing asks for a second tap
    expect(textOf(tree)).not.toContain('Tap again');
    expect(dialogPresented(tree)).toBe(false);
  });

  it('Delete presents a native dialog; the spot is deleted only from its destructive action', async () => {
    const { tree, deleteFn, goBack } = await render(async () => OWN);
    await act(async () => {
      (pressable(tree, 'Delete spot').props['onPress'] as () => void)();
    });
    expect(dialogPresented(tree)).toBe(true);
    expect(textOf(tree)).toContain('Delete this spot?');
    expect(deleteFn).not.toHaveBeenCalled(); // asked, not deleted
    await confirmDialog(tree, 'Delete');
    await act(async () => {});
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('hands the header its menu: Edit / Report this / Delete for the owner, Report this alone otherwise', async () => {
    const own = await render(async () => OWN, { withHeaderSlot: true });
    const ownRender = own.setHeaderRight.mock.calls.at(-1)?.[0] as (() => ReactElement) | null;
    expect(typeof ownRender).toBe('function');
    let menu!: ReactTestRenderer;
    await act(async () => {
      menu = create(ownRender!());
    });
    const ownMenu = JSON.stringify(menu.toJSON());
    expect(ownMenu).toContain('"label":"Edit"');
    expect(ownMenu).toContain('"label":"Report this"');
    expect(ownMenu).toContain('"label":"Delete"');
    expect(ownMenu).toContain('"role":"destructive"');
    expect(ownMenu).not.toContain('down');

    const theirs = await render(async () => SPOT, { withHeaderSlot: true });
    const theirRender = theirs.setHeaderRight.mock.calls.at(-1)?.[0] as (() => ReactElement) | null;
    await act(async () => {
      menu = create(theirRender!());
    });
    const theirMenu = JSON.stringify(menu.toJSON());
    expect(theirMenu).toContain('"label":"Report this"');
    expect(theirMenu).not.toContain('"label":"Edit"');
    expect(theirMenu).not.toContain('"label":"Delete"');
  });
});
