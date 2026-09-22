import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { DataError } from '../../lib/data';
import type { Profile } from '../../lib/profile';
import type { SavedRow } from '../../lib/saves';
import { memorySessionStore, type SessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import { confirmDialog, dialogPresented } from '../../test/dialog';
import { __haptics, __resetHaptics } from '../../test/expo-haptics-stub';
import {
  __clearMountedGestures,
  __fireGesture,
  __mountedGesture,
} from '../../test/gesture-handler-stub';
import { font } from '../../theme';
import SavedScreen, { actionTestId, swipeTestId } from '../SavedScreen';

/**
 * M8-T02 — the Saved/profile surface (FR-090/091). Anonymous shows the honest
 * explainer + a gate-driven sign-in; signed-in loads the profile and shows the
 * honest "saving arrives next build" section (T04 wires real content).
 */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

async function renderWith(engine: AuthEngine, profile: Profile | null): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  const fetchProfileFn = vi.fn(async (): Promise<Profile | null> => profile);
  const listRoutesFn = vi.fn(async () => []);
  await act(async () => {
    tree = create(
      (
        <AuthProvider engine={engine}>
          <SavedScreen cfg={CFG} fetchProfileFn={fetchProfileFn} listRoutesFn={listRoutesFn} />
        </AuthProvider>
      ) as ReactElement,
    );
  });
  await act(async () => {}); // settle init() + the profile fetch
  return tree;
}

describe('SavedScreen (M8-T02)', () => {
  it('anonymous: honest explainer + sign-in via the gate (no profile fetch)', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
    const tree = await renderWith(engine, null);
    const text = textOf(tree);
    expect(text).toContain('never need an account');
    expect(text).toContain('Sign in');
    expect(engine.getState().sheetOpen).toBe(false);
  });

  it('signed-in: shows the profile name, email, and the honest saves section', async () => {
    const engine = new AuthEngine({
      cfg: CFG,
      store: memorySessionStore({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: 9_999_999_999,
        user: { id: 'u1', email: 'driver@roadopia.dev' },
      }),
    });
    const tree = await renderWith(engine, {
      id: 'u1',
      display_name: 'driver',
      avatar_url: null,
    });
    const text = textOf(tree);
    expect(text).toContain('driver@roadopia.dev');
    expect(text).toContain('driver');
    expect(text).toContain('Saved drives');
    expect(text).toContain('No saved drives yet');
    expect(text).toContain('Sign out');
  });
});

describe('SavedScreen list honesty (device pass, 2026-09-04)', () => {
  const SESSION = {
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: 9_999_999_999,
    user: { id: 'u1', email: 'a@b.co' },
  };
  const PROFILE: Profile = { id: 'u1', display_name: 'driver', avatar_url: null };
  const ROW: SavedRow = {
    id: '9f0403ea-65db-4f11-938c-d567a8033c2b',
    name: 'Sunday ridge loop',
    visibility: 'private',
    is_loop: true,
    distance_m: 42_000,
    duration_s: 3_000,
    created_at: '2026-09-04T00:00:00Z',
  };

  async function renderList(
    engine: AuthEngine,
    listRoutesFn: () => Promise<SavedRow[]>,
    navigation?: {
      navigate: (screen: string, params?: Record<string, unknown>) => void;
      addFocusListener?: (cb: () => void) => () => void;
    },
  ): Promise<ReactTestRenderer> {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        (
          <AuthProvider engine={engine}>
            <SavedScreen
              cfg={CFG}
              fetchProfileFn={async () => PROFILE}
              listRoutesFn={listRoutesFn as never}
              {...(navigation ? { navigation } : {})}
            />
          </AuthProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {});
    return tree;
  }

  it('a failed list load says so and offers Retry — never "no saved drives yet"', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(SESSION) });
    let attempts = 0;
    const tree = await renderList(engine, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('down');
      return [ROW];
    });
    let text = textOf(tree);
    expect(text).toContain('Couldn’t load your drives');
    expect(text).not.toContain('No saved drives yet');
    expect(text).not.toContain('down'); // never the raw error
    const retry = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Retry loading drives' && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (retry.props['onPress'] as () => void)();
    });
    await act(async () => {});
    text = textOf(tree);
    expect(text).toContain('Sunday ridge loop');
    expect(text).toContain('Private'); // plain words, not the raw enum
    expect(text).not.toContain('Couldn’t load your drives');
  });

  it('regaining focus reloads the list, so a drive saved on another tab appears', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(SESSION) });
    const rows: SavedRow[] = [];
    let focusCb: (() => void) | null = null;
    const tree = await renderList(engine, async () => [...rows], {
      navigate: () => undefined,
      addFocusListener: (cb) => {
        focusCb = cb;
        return () => {
          focusCb = null;
        };
      },
    });
    expect(textOf(tree)).toContain('No saved drives yet');
    rows.push(ROW); // saved from Result while this tab was away
    await act(async () => {
      focusCb!();
    });
    await act(async () => {});
    expect(textOf(tree)).toContain('Sunday ridge loop');
  });

  it('while the persisted session is still being read: a spinner, not the anonymous screen', async () => {
    const pendingStore: SessionStore = {
      load: () => new Promise(() => {}),
      save: async () => undefined,
      clear: async () => undefined,
    };
    const engine = new AuthEngine({ cfg: CFG, store: pendingStore });
    const tree = await renderList(engine, async () => []);
    const text = textOf(tree);
    expect(text).toContain('rn-activityindicator');
    expect(text).not.toContain('never need an account');
  });
});

describe('SavedScreen loads belong to the identity that started them (review, 2026-09-04)', () => {
  const PROFILE_A: Profile = { id: 'u1', display_name: 'alice', avatar_url: null };
  const PROFILE_B: Profile = { id: 'u2', display_name: 'bob', avatar_url: null };
  const ROW_A: SavedRow = {
    id: '9f0403ea-65db-4f11-938c-d567a8033c2b',
    name: 'Alice secret loop',
    visibility: 'private',
    is_loop: true,
    distance_m: 42_000,
    duration_s: 3_000,
    created_at: '2026-09-04T00:00:00Z',
  };
  const SESSION_A = {
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: 9_999_999_999,
    user: { id: 'u1', email: 'a@b.co' },
  };

  /** An engine whose OTP verify signs in user u2. */
  function engineVerifyingAsB(): AuthEngine {
    const fetchImpl = (async (url: string) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify(
          url.includes('/verify')
            ? {
                access_token: 'at2',
                refresh_token: 'rt2',
                expires_in: 3600,
                user: { id: 'u2', email: 'b@b.co' },
              }
            : {},
        ),
    })) as never;
    return new AuthEngine({ cfg: CFG, store: memorySessionStore(SESSION_A), fetchImpl });
  }

  it('a list still loading for one account never lands on the next account', async () => {
    const engine = engineVerifyingAsB();
    let resolveA!: (rows: SavedRow[]) => void;
    const listRoutesFn = vi.fn((_cfg: unknown, _token: string, uid: string) =>
      uid === 'u1'
        ? new Promise<SavedRow[]>((r) => {
            resolveA = r;
          })
        : Promise.resolve([]),
    );
    const fetchProfileFn = vi.fn(async (_cfg: unknown, uid: string) =>
      uid === 'u1' ? PROFILE_A : PROFILE_B,
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        (
          <AuthProvider engine={engine}>
            <SavedScreen
              cfg={CFG}
              fetchProfileFn={fetchProfileFn as never}
              listRoutesFn={listRoutesFn as never}
            />
          </AuthProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {});
    expect(textOf(tree)).toContain('Loading your drives'); // A is still pending
    await act(async () => {
      await engine.signOut();
    });
    await act(async () => {
      await engine.verifyCode('b@b.co', '123456');
    });
    await act(async () => {});
    expect(listRoutesFn).toHaveBeenCalledWith(CFG, 'at2', 'u2'); // B was requested
    await act(async () => {
      resolveA([ROW_A]); // A's stalled answer finally arrives
    });
    await act(async () => {});
    const text = textOf(tree);
    expect(text).not.toContain('Alice secret loop');
    expect(text).not.toContain('alice');
    expect(text).toContain('bob');
    expect(text).toContain('No saved drives yet');
  });

  it('a focus while a load is still pending asks again instead of being swallowed', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(SESSION_A) });
    const listRoutesFn = vi.fn(() => new Promise<SavedRow[]>(() => {}));
    let focusCb: (() => void) | null = null;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        (
          <AuthProvider engine={engine}>
            <SavedScreen
              cfg={CFG}
              fetchProfileFn={async () => PROFILE_A}
              listRoutesFn={listRoutesFn as never}
              navigation={{
                navigate: () => undefined,
                addFocusListener: (cb) => {
                  focusCb = cb;
                  return () => undefined;
                },
              }}
            />
          </AuthProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {});
    expect(listRoutesFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      focusCb!();
    });
    expect(listRoutesFn).toHaveBeenCalledTimes(2);
    expect(textOf(tree)).toContain('Loading your drives');
  });
});

/**
 * Redesign (SPEC "SavedHome", "Test changes"): the page is a large-title
 * FlatList; a row's swipe reveals Delete, which asks through a native
 * `ConfirmDialog` and runs the owner op ONLY from its destructive action; the
 * account delete asks the same way; the list phases and the anonymous page
 * are the platform's empty state with the copy verbatim. Every case above is
 * unchanged.
 */
describe('SavedScreen redesign structure (SPEC "SavedHome")', () => {
  const SESSION = {
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: 9_999_999_999,
    user: { id: 'u1', email: 'a@b.co' },
  };
  const PROFILE: Profile = { id: 'u1', display_name: 'driver', avatar_url: null };
  const ROW: SavedRow = {
    id: '9f0403ea-65db-4f11-938c-d567a8033c2b',
    name: 'Sunday ridge loop',
    visibility: 'private',
    is_loop: true,
    distance_m: 42_000,
    duration_s: 3_000,
    created_at: '2026-09-04T00:00:00Z',
  };
  const FLATLIST: string = 'rn-flatlist';
  const EMPTY_STATE: string = 'expo-ui-contentunavailableview';
  const PRESSABLE: string = 'rn-pressable';
  const VIEW: string = 'rn-view';

  afterEach(() => {
    __resetHaptics();
    __clearMountedGestures();
  });

  async function renderSigned(over: {
    rows?: () => Promise<SavedRow[]>;
    deleteFn?: ReturnType<typeof vi.fn>;
    deleteAccountFn?: ReturnType<typeof vi.fn>;
  }): Promise<{
    tree: ReactTestRenderer;
    deleteFn: ReturnType<typeof vi.fn>;
    deleteAccountFn: ReturnType<typeof vi.fn>;
  }> {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(SESSION) });
    const deleteFn = over.deleteFn ?? vi.fn(async () => undefined);
    const deleteAccountFn = over.deleteAccountFn ?? vi.fn(async () => undefined);
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        (
          <AuthProvider engine={engine}>
            <SavedScreen
              cfg={CFG}
              fetchProfileFn={async () => PROFILE}
              listRoutesFn={(over.rows ?? (async () => [ROW])) as never}
              deleteFn={deleteFn as never}
              deleteAccountFn={deleteAccountFn as never}
            />
          </AuthProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {});
    return { tree, deleteFn, deleteAccountFn };
  }

  /** The row's Delete — the one host pressable — findable open or closed. */
  function rowAction(tree: ReactTestRenderer): ReactTestInstance {
    const nodes = tree.root.findAll(
      (n) =>
        n.type === PRESSABLE &&
        n.props['accessibilityLabel'] === 'Delete Sunday ridge loop' &&
        !!n.props['onPress'],
    );
    expect(nodes).toHaveLength(1);
    return nodes[0]!;
  }

  /** The one view the revealed Delete sits in. Asked for by test id, not
   *  counted over the tree: every unlabelled `Symbol` on the page is also
   *  (correctly) hidden from assistive tech, so a count answers a different
   *  question than "is this row's action reachable". */
  function actionSlot(tree: ReactTestRenderer): ReactTestInstance {
    const slots = tree.root.findAll(
      (n) => n.type === VIEW && n.props['testID'] === actionTestId(ROW.id),
    );
    expect(slots).toHaveLength(1);
    return slots[0]!;
  }

  /** Reachable means all three channels agree: it takes touches, it is not
   *  hidden from assistive tech, and its subtree is not excluded. A closed
   *  row must fail every one of them. */
  const actionReachable = (tree: ReactTestRenderer): boolean => {
    const slot = actionSlot(tree);
    const reachable =
      slot.props['pointerEvents'] === 'auto' &&
      slot.props['accessibilityElementsHidden'] === false &&
      slot.props['importantForAccessibility'] === 'auto';
    if (!reachable) {
      // the closed state is not "some channel off" — it is all of them
      expect(slot.props['pointerEvents']).toBe('none');
      expect(slot.props['accessibilityElementsHidden']).toBe(true);
      expect(slot.props['importantForAccessibility']).toBe('no-hide-descendants');
    }
    return reachable;
  };

  /** One finger on the row: land, move, let go. `dx` is screen translation
   *  (left is negative); `velocityX` in pt/s. */
  const swipe = async (dx: number, velocityX: number): Promise<void> => {
    const pan = __mountedGesture(swipeTestId(ROW.id));
    await act(async () => {
      __fireGesture(pan, 'start');
      __fireGesture(pan, 'update', { translationX: dx });
      __fireGesture(pan, 'end', { translationX: dx, velocityX });
      __fireGesture(pan, 'finalize', { translationX: dx, velocityX });
    });
  };

  it('is a FlatList page under the native large title: no page title, inset-adjusting, rows virtualised', async () => {
    const { tree } = await renderSigned({});
    const lists = tree.root.findAll((n) => n.type === FLATLIST);
    expect(lists).toHaveLength(1);
    expect(lists[0]!.props['contentInsetAdjustmentBehavior']).toBe('automatic');
    const text = textOf(tree);
    // no display-role title drawn by the page — "Saved" is the header's
    expect(text).not.toContain(`"fontSize":${font.display.fontSize}`);
    // the profile and the chapter the rows belong to, in source case
    expect(text).toContain('driver');
    expect(text).toContain('Saved drives');
    expect(text).toContain('Sunday ridge loop');
    expect(text).toContain('Private');
    expect(text).not.toContain('"entering"'); // never on a virtualised row
    expect(text).not.toContain('down');
  });

  it('a swiped row reveals Delete, which asks through a native dialog; the op runs only from its destructive action', async () => {
    const { tree, deleteFn } = await renderSigned({});
    // closed: the action exists under the row but is reachable by nothing
    rowAction(tree);
    expect(actionReachable(tree)).toBe(false);

    // the recipe's axis is declared, so the list keeps its vertical scroll
    const pan = __mountedGesture(swipeTestId(ROW.id));
    expect(pan.__config['activeOffsetX']).toEqual([-10, 10]);
    expect(pan.__config['failOffsetY']).toEqual([-10, 10]);

    await swipe(-60, -900); // a short, fast flick to the left
    expect(actionReachable(tree)).toBe(true); // open: reachable now
    expect(__haptics).toEqual([]); // nothing on the swipe itself

    await act(async () => {
      (rowAction(tree).props['onPress'] as () => void)();
    });
    expect(dialogPresented(tree)).toBe(true);
    expect(textOf(tree)).toContain('Delete “Sunday ridge loop”?');
    expect(deleteFn).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('Sunday ridge loop'); // still there

    await confirmDialog(tree, 'Delete');
    await act(async () => {});
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(deleteFn).toHaveBeenCalledWith(CFG, 'at', ROW.id);
    expect(textOf(tree)).not.toContain('Sunday ridge loop'); // the row left
    expect(dialogPresented(tree)).toBe(false);
    expect(__haptics).toEqual(['impact:Medium']); // one, from the destructive action
  });

  it('a slow short drag does not open the row; a refused delete keeps the row and says so', async () => {
    const refusing = vi.fn(async () => {
      throw new DataError('That drive isn’t yours to delete.', 200);
    });
    const { tree, deleteFn } = await renderSigned({ deleteFn: refusing });
    await swipe(-20, 0);
    expect(actionReachable(tree)).toBe(false); // still closed

    await swipe(-80, -1200);
    expect(actionReachable(tree)).toBe(true); // a fast flick opens it
    await act(async () => {
      (rowAction(tree).props['onPress'] as () => void)();
    });
    await confirmDialog(tree, 'Delete');
    await act(async () => {});
    expect(deleteFn).toHaveBeenCalledTimes(1);
    const text = textOf(tree);
    expect(text).toContain('Sunday ridge loop'); // nothing was deleted
    expect(text).toContain('isn’t yours to delete');
  });

  it('Delete account asks through a native dialog; the op runs only from its destructive action', async () => {
    const { tree, deleteAccountFn } = await renderSigned({});
    const row = tree.root.findAll(
      (n) =>
        n.type === PRESSABLE &&
        n.props['accessibilityLabel'] === 'Delete account' &&
        !!n.props['onPress'],
    );
    expect(row).toHaveLength(1);
    expect(dialogPresented(tree)).toBe(false);
    await act(async () => {
      (row[0]!.props['onPress'] as () => void)();
    });
    expect(dialogPresented(tree)).toBe(true);
    expect(textOf(tree)).toContain('Permanently delete your account and all saved data?');
    expect(textOf(tree)).not.toContain('Tap again');
    expect(deleteAccountFn).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('Sign out'); // still signed in

    await confirmDialog(tree, 'Delete account');
    await act(async () => {});
    expect(deleteAccountFn).toHaveBeenCalledTimes(1);
    expect(deleteAccountFn.mock.calls[0]?.[1]).toBe('at');
    expect(__haptics).toEqual(['impact:Medium']);
    // the local session went with the account: the anonymous page
    expect(textOf(tree)).toContain('never need an account');
    expect(textOf(tree)).not.toContain('Sign out');
  });

  it("the three list phases and the anonymous page are the platform's empty state, copy verbatim", async () => {
    const failed = await renderSigned({
      rows: async () => {
        throw new Error('offline');
      },
    });
    let empties = failed.tree.root.findAll((n) => n.type === EMPTY_STATE);
    expect(empties).toHaveLength(1);
    expect(empties[0]!.props['title']).toBe('Couldn’t load your drives — check your connection.');
    expect(textOf(failed.tree)).not.toContain('No saved drives yet');
    expect(textOf(failed.tree)).not.toContain('offline');
    expect(
      failed.tree.root.findAll(
        (n) =>
          n.type === PRESSABLE &&
          n.props['accessibilityLabel'] === 'Retry loading drives' &&
          !!n.props['onPress'],
      ),
    ).toHaveLength(1);

    const none = await renderSigned({ rows: async () => [] });
    empties = none.tree.root.findAll((n) => n.type === EMPTY_STATE);
    expect(empties).toHaveLength(1);
    expect(empties[0]!.props['title']).toBe(
      'No saved drives yet — plan one and tap “Save this drive”.',
    );
    expect(textOf(none.tree)).not.toContain('Retry loading drives');

    const anonymous = await renderWith(
      new AuthEngine({ cfg: CFG, store: memorySessionStore(null) }),
      null,
    );
    empties = anonymous.root.findAll((n) => n.type === EMPTY_STATE);
    expect(empties).toHaveLength(1);
    expect(empties[0]!.props['title']).toBe('Saved');
    expect(empties[0]!.props['description']).toContain('never need an account');
    expect(textOf(anonymous)).not.toContain('down');
  });
});
