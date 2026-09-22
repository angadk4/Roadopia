import type { Route } from '@shared/types';
import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { DataError } from '../../lib/data';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import { confirmDialog, dialogPresented } from '../../test/dialog';
import { __haptics, __resetHaptics } from '../../test/expo-haptics-stub';
import SavedRouteScreen, { visibilityBlurb } from '../SavedRouteScreen';

/**
 * M8 — reopening a saved drive (FR-074: the shared RouteDetail renders it) and
 * the owner's visibility control (T08). A listed row that opens nothing is a
 * dead end; a row that opens a blank screen is worse.
 *
 * Redesign (SPEC "SavedRoute", "Test changes"): the visibility control is the
 * platform's segmented control — one `expo-ui-picker` whose `selection` is the
 * chosen index and whose `onSelectionChange` calls the same handler the three
 * chips called (re-target to the successor, same contract); the delete asks
 * through a native `ConfirmDialog` and the op runs ONLY from its destructive
 * action (the old "Tap again" two-step, tightened onto the dialog); the drive's
 * name is the native header's AND stays on the page in the NAME chapter.
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

const PICKER: string = 'expo-ui-picker';
const MENU: string = 'expo-ui-menu';
const MENU_BUTTON: string = 'expo-ui-button';
const RN_TEXT: string = 'rn-text';
const PRESSABLE: string = 'rn-pressable';
const TEXT_INPUT: string = 'rn-textinput';

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

/** The visibility control: the one segmented picker labelled for its group. */
function visibilityPicker(tree: ReactTestRenderer): ReactTestInstance {
  const pickers = tree.root.findAll(
    (n) => n.type === PICKER && n.props['label'] === 'Who can see this',
  );
  expect(pickers).toHaveLength(1);
  return pickers[0]!;
}

/** Drive the picker the way native does: a new selection index. */
async function pick(tree: ReactTestRenderer, index: number): Promise<void> {
  const picker = visibilityPicker(tree);
  await act(async () => {
    (picker.props['onSelectionChange'] as (i: number) => void)(index);
  });
}

/** True when some `rn-text` in the tree has exactly this string as a child —
 *  the name drawn ON THE PAGE, not merely carried in a dialog's title prop. */
function drawsText(tree: ReactTestRenderer, text: string): boolean {
  return (
    tree.root.findAll((n) => {
      if (n.type !== RN_TEXT) return false;
      const children = n.props['children'];
      return Array.isArray(children) ? children.includes(text) : children === text;
    }).length > 0
  );
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
    // the platform's segmented control, on the current value, with the
    // announced name that carries the verb
    expect(visibilityPicker(tree).props['selection']).toBe(0);
    expect(JSON.stringify(tree.toJSON())).toContain('Set visibility unlisted');
    await pick(tree, 1);
    expect(setVisibilityFn).toHaveBeenCalledWith(CFG, 'at', ROUTE.id, 'unlisted');
    expect(JSON.stringify(tree.toJSON())).toContain('Anyone with the link');
    expect(visibilityPicker(tree).props['selection']).toBe(1);
  });

  it('a rejected visibility change reverts the control (no false claim)', async () => {
    const failing = vi.fn(async () => {
      throw new Error('nope');
    });
    const { tree } = await render(signedIn(), async () => ROUTE, failing as never);
    await pick(tree, 2);
    await act(async () => {});
    // the honest "refused" signal is the platform control snapping back —
    // and the blurb with it
    expect(visibilityPicker(tree).props['selection']).toBe(0);
    expect(JSON.stringify(tree.toJSON())).toContain('Only you can see this drive');
    expect(JSON.stringify(tree.toJSON())).not.toContain('Anyone can find');
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
  afterEach(() => {
    __resetHaptics();
  });

  async function renderOwner(
    over: { renameFn?: unknown; deleteFn?: unknown; withHeaderSlot?: boolean } = {},
  ): Promise<{
    tree: ReactTestRenderer;
    goBack: ReturnType<typeof vi.fn>;
    setTitle: ReturnType<typeof vi.fn>;
    setHeaderRight: ReturnType<typeof vi.fn>;
    renameFn: ReturnType<typeof vi.fn>;
    deleteFn: ReturnType<typeof vi.fn>;
  }> {
    const goBack = vi.fn();
    const setTitle = vi.fn();
    const setHeaderRight = vi.fn();
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
              navigation={{
                goBack,
                navigate: () => undefined,
                setTitle,
                ...(over.withHeaderSlot ? { setHeaderRight } : {}),
              }}
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
    return { tree, goBack, setTitle, setHeaderRight, renameFn, deleteFn };
  }

  async function press(tree: ReactTestRenderer, label: string): Promise<void> {
    const node = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === label && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (node.props['onPress'] as () => void)();
    });
  }

  /** Render the function the screen handed `setHeaderRight` last, as the
   *  stack would, and return the menu tree. */
  async function lastHeaderMenu(setHeaderRight: ReturnType<typeof vi.fn>): Promise<{
    menu: ReactTestRenderer;
    text: string;
  }> {
    const render = setHeaderRight.mock.calls.at(-1)?.[0] as (() => ReactElement) | null;
    expect(typeof render).toBe('function');
    let menu!: ReactTestRenderer;
    await act(async () => {
      menu = create(render!());
    });
    return { menu, text: JSON.stringify(menu.toJSON()) };
  }

  it('renames through the owner op, updating the header title and the detail name', async () => {
    const { tree, setTitle, renameFn } = await renderOwner();
    expect(JSON.stringify(tree.toJSON())).toContain('My loop'); // the name is visible at all
    expect(drawsText(tree, 'My loop')).toBe(true); // …drawn on the page, in the NAME chapter
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
    expect(drawsText(tree, 'Escarpment sweep')).toBe(true);
  });

  it('delete asks through a native dialog; the owner op runs only from its destructive action, then leaves the screen', async () => {
    const { tree, goBack, deleteFn } = await renderOwner();
    expect(dialogPresented(tree)).toBe(false);
    await press(tree, 'Delete drive');
    expect(deleteFn).not.toHaveBeenCalled();
    expect(dialogPresented(tree)).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain('Delete “My loop”?');
    expect(JSON.stringify(tree.toJSON())).not.toContain('Tap again');
    await confirmDialog(tree, 'Delete');
    await act(async () => {});
    expect(deleteFn).toHaveBeenCalledWith(CFG, 'at', ROUTE.id);
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(dialogPresented(tree)).toBe(false);
    // one Medium impact, the frame the destructive action fired — nothing else
    expect(__haptics).toEqual(['impact:Medium']);
  });

  it('a refused delete is said plainly and the screen stays', async () => {
    const refusing = vi.fn(async () => {
      throw new DataError('That drive isn’t yours to delete.', 200);
    });
    const { tree, goBack } = await renderOwner({ deleteFn: refusing });
    await press(tree, 'Delete drive');
    await confirmDialog(tree, 'Delete');
    await act(async () => {});
    expect(JSON.stringify(tree.toJSON())).toContain('isn’t yours to delete');
    expect(goBack).not.toHaveBeenCalled();
    // the row is pressable again — a refused delete is not a stuck "Deleting…"
    expect(JSON.stringify(tree.toJSON())).not.toContain('Deleting…');
  });

  it('visibility segments show plain words, not the raw enum', async () => {
    const { tree } = await renderOwner();
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Link only');
    expect(text).toContain('Public');
    expect(text).not.toContain('"unlisted"]'); // the segment label is never the enum
  });

  it('a bare render has no header menu; the in-page Rename and Delete controls stay', async () => {
    const { tree } = await renderOwner();
    expect(tree.root.findAll((n) => n.type === MENU)).toHaveLength(0);
    const text = JSON.stringify(tree.toJSON());
    expect(text).not.toContain('More actions');
    expect(text).not.toContain('down');
    // exactly one HOST pressable each (composites carry the same props)
    expect(
      tree.root.findAll(
        (n) =>
          n.type === PRESSABLE &&
          n.props['accessibilityLabel'] === 'Rename drive' &&
          !!n.props['onPress'],
      ),
    ).toHaveLength(1);
    expect(
      tree.root.findAll(
        (n) =>
          n.type === PRESSABLE &&
          n.props['accessibilityLabel'] === 'Delete drive' &&
          !!n.props['onPress'],
      ),
    ).toHaveLength(1);
  });

  it('hands the header its menu: Rename opens the in-page field, Delete drive presents the same dialog', async () => {
    const { tree, setHeaderRight, deleteFn } = await renderOwner({ withHeaderSlot: true });
    const { menu, text } = await lastHeaderMenu(setHeaderRight);
    expect(text).toContain('"label":"Rename"');
    expect(text).toContain('"label":"Delete drive"');
    expect(text).toContain('"role":"destructive"');
    expect(text).not.toContain('down');

    // Delete drive → the dialog on the page; nothing deleted yet
    const del = menu.root.find(
      (n) => n.type === MENU_BUTTON && n.props['label'] === 'Delete drive',
    );
    await act(async () => {
      (del.props['onPress'] as () => void)();
    });
    expect(dialogPresented(tree)).toBe(true);
    expect(deleteFn).not.toHaveBeenCalled();

    // Rename → the in-page field, focused (autoFocus), seeded with the name
    const rename = menu.root.find((n) => n.type === MENU_BUTTON && n.props['label'] === 'Rename');
    await act(async () => {
      (rename.props['onPress'] as () => void)();
    });
    const input = tree.root.findAll(
      (n) =>
        n.type === TEXT_INPUT &&
        n.props['accessibilityLabel'] === 'Drive name' &&
        !!n.props['onChangeText'],
    );
    expect(input).toHaveLength(1);
    expect(input[0]!.props['autoFocus']).toBe(true);
    expect(input[0]!.props['value']).toBe('My loop');
    // while the field is open the menu offers only Delete drive
    const reopened = await lastHeaderMenu(setHeaderRight);
    expect(reopened.text).not.toContain('"label":"Rename"');
    expect(reopened.text).toContain('"label":"Delete drive"');
  });
});
