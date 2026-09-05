import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import type { Profile } from '../../lib/profile';
import type { SavedRow } from '../../lib/saves';
import { memorySessionStore, type SessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import SavedScreen from '../SavedScreen';

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
