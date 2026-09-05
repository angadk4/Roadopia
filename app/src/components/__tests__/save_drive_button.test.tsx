import type { Route } from '@shared/types';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import SaveDriveButton, { defaultDriveName } from '../SaveDriveButton';

/**
 * M8-T04 — the product's FIRST gated action. Anonymous tap opens the sheet
 * (FR-201) and does NOT save; signed-in tap saves through the injected fn.
 */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };
const ROUTE = {
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
  owner_id: null,
  origin_type: 'ai',
  forked_from: null,
  stops: [],
} as unknown as Route;

async function render(engine: AuthEngine, saveFn: typeof import('../../lib/saves').saveRoute) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      (
        <AuthProvider engine={engine}>
          <SaveDriveButton route={ROUTE} cfg={CFG} saveFn={saveFn} />
        </AuthProvider>
      ) as ReactElement,
    );
  });
  await act(async () => {});
  return tree;
}

function pressSave(tree: ReactTestRenderer): void {
  const btn = tree.root.findAll(
    (n) => n.props['accessibilityLabel'] === 'Save this drive' && !!n.props['onPress'],
  )[0]!;
  act(() => {
    (btn.props['onPress'] as () => void)();
  });
}

describe('SaveDriveButton (M8-T04)', () => {
  it('defaultDriveName is deterministic and honest', () => {
    expect(defaultDriveName(ROUTE)).toBe('60-minute loop');
  });

  it('anonymous tap opens the sign-in sheet and saves NOTHING', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
    const saveFn = vi.fn();
    const tree = await render(engine, saveFn as never);
    pressSave(tree);
    expect(engine.getState().sheetOpen).toBe(true);
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('signed-in tap saves and shows the saved state', async () => {
    const engine = new AuthEngine({
      cfg: CFG,
      store: memorySessionStore({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: 9_999_999_999,
        user: { id: 'u1', email: 'a@b.co' },
      }),
    });
    const saveFn = vi.fn(async () => 'route-id');
    const tree = await render(engine, saveFn as never);
    pressSave(tree);
    await act(async () => {});
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tree.toJSON())).toContain('Saved to your drives');
  });
});

describe('SaveDriveButton naming + honesty (device pass, 2026-09-04)', () => {
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

  async function renderWith(
    engine: AuthEngine,
    saveFn: ReturnType<typeof vi.fn>,
    onViewSaved?: () => void,
  ): Promise<ReactTestRenderer> {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        (
          <AuthProvider engine={engine}>
            <SaveDriveButton
              route={ROUTE}
              cfg={CFG}
              saveFn={saveFn as never}
              {...(onViewSaved ? { onViewSaved } : {})}
            />
          </AuthProvider>
        ) as ReactElement,
      );
    });
    await act(async () => {});
    return tree;
  }

  function typeName(tree: ReactTestRenderer, text: string): void {
    const input = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Drive name' && !!n.props['onChangeText'],
    )[0]!;
    act(() => {
      (input.props['onChangeText'] as (t: string) => void)(text);
    });
  }

  it('saves under the name typed into the field and offers the way to Saved', async () => {
    const saveFn = vi.fn(async () => 'route-id');
    const onViewSaved = vi.fn();
    const tree = await renderWith(signedIn(), saveFn, onViewSaved);
    expect(JSON.stringify(tree.toJSON())).toContain('60-minute loop'); // prefilled default
    typeName(tree, '  Escarpment sweep ');
    pressSave(tree);
    await act(async () => {});
    expect(saveFn).toHaveBeenCalledWith(
      CFG,
      'at',
      expect.objectContaining({ name: 'Escarpment sweep' }),
    );
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Saved to your drives as “Escarpment sweep”');
    const view = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'View in Saved' && !!n.props['onPress'],
    )[0]!;
    act(() => {
      (view.props['onPress'] as () => void)();
    });
    expect(onViewSaved).toHaveBeenCalledTimes(1);
  });

  it('a cleared name falls back to the honest default, never an empty name', async () => {
    const saveFn = vi.fn(async () => 'route-id');
    const tree = await renderWith(signedIn(), saveFn);
    typeName(tree, '   ');
    pressSave(tree);
    await act(async () => {});
    expect(saveFn).toHaveBeenCalledWith(
      CFG,
      'at',
      expect.objectContaining({ name: '60-minute loop' }),
    );
  });

  it('dismissing the sign-in sheet says the drive was NOT saved', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
    const saveFn = vi.fn();
    const tree = await renderWith(engine, saveFn);
    pressSave(tree);
    expect(engine.getState().sheetOpen).toBe(true);
    await act(async () => {
      engine.dismissSheet();
    });
    expect(saveFn).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Not saved — sign in to keep this drive.');
  });
});
