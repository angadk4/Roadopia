import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import type { Profile } from '../../lib/profile';
import { memorySessionStore } from '../../lib/session_store';
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
