import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import type { SpotRow } from '../../lib/data';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import AddSpotScreen from '../AddSpotScreen';

/**
 * M10-T01/T03 — the create flow's contract: required fields stop the save
 * with plain words; a near same-type spot WARNS once and never blocks.
 */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };

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

// The map stub never pans in tests, so the pin stays at the initial centre
// (43.6, -79.8) — plant the "existing" spot right there.
const NEARBY: SpotRow[] = [
  { id: 's1', name: 'Old Faithful Espresso', type: 'coffee', lat: 43.6, lng: -79.8, source: 'osm' },
];

async function render(
  createFn: ReturnType<typeof vi.fn>,
  knownSpots: SpotRow[],
): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      (
        <AuthProvider engine={signedIn()}>
          <AddSpotScreen
            navigation={{ goBack: () => undefined }}
            route={{ params: { knownSpots } }}
            cfg={CFG}
            createFn={createFn as never}
          />
        </AuthProvider>
      ) as ReactElement,
    );
  });
  await act(async () => {});
  return tree;
}

function press(tree: ReactTestRenderer, label: string): Promise<void> {
  const node = tree.root.findAll(
    (n) => n.props['accessibilityLabel'] === label && !!n.props['onPress'],
  )[0]!;
  return act(async () => {
    (node.props['onPress'] as () => void)();
  });
}

function type(tree: ReactTestRenderer, label: string, text: string): Promise<void> {
  const input = tree.root.findAll((n) => n.props['accessibilityLabel'] === label)[0]!;
  return act(async () => {
    (input.props['onChangeText'] as (t: string) => void)(text);
  });
}

describe('AddSpotScreen', () => {
  it('refuses to save without type/name, with plain words', async () => {
    const createFn = vi.fn();
    const tree = await render(createFn, []);
    await press(tree, 'Save spot');
    expect(JSON.stringify(tree.toJSON())).toContain('Pick a spot type');
    await press(tree, 'Type Viewpoint');
    await press(tree, 'Save spot');
    expect(JSON.stringify(tree.toJSON())).toContain('Give the spot a name');
    expect(createFn).not.toHaveBeenCalled();
  });

  it('warns ONCE about a near same-type spot, then saves anyway (FR-033)', async () => {
    const createFn = vi.fn(async () => 'new-id');
    const tree = await render(createFn, NEARBY);
    await press(tree, 'Type Coffee');
    await type(tree, 'Spot name', 'Corner Beans');
    await press(tree, 'Save spot');
    const warned = JSON.stringify(tree.toJSON());
    expect(warned).toContain('already a coffee spot');
    expect(warned).toContain('Old Faithful Espresso');
    expect(createFn).not.toHaveBeenCalled(); // warned, not saved
    await press(tree, 'Save anyway');
    expect(createFn).toHaveBeenCalledTimes(1); // nudge never blocks
    expect(JSON.stringify(tree.toJSON())).toContain('Spot added');
  });

  it('changing the type after a nudge RE-CHECKS instead of saving blind', async () => {
    const createFn = vi.fn(async () => 'new-id');
    // a coffee spot AND a viewpoint both sit on this pin
    const both: SpotRow[] = [
      ...NEARBY,
      { id: 's2', name: 'Ridge Lookout', type: 'viewpoint', lat: 43.6, lng: -79.8, source: 'user' },
    ];
    const tree = await render(createFn, both);
    await press(tree, 'Type Coffee');
    await type(tree, 'Spot name', 'Corner Beans');
    await press(tree, 'Save spot'); // nudged about the coffee spot
    expect(JSON.stringify(tree.toJSON())).toContain('already a coffee spot');

    await press(tree, 'Type Viewpoint'); // ← the acknowledgement no longer applies
    await press(tree, 'Save anyway');
    // it must warn about the VIEWPOINT rather than saving unchecked
    expect(createFn).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('already a viewpoint spot');
  });

  it('a DIFFERENT-type pin nearby saves straight through — no false nudge', async () => {
    const createFn = vi.fn(async () => 'new-id');
    const tree = await render(createFn, NEARBY);
    await press(tree, 'Type Viewpoint');
    await type(tree, 'Spot name', 'Ridge View');
    await press(tree, 'Save spot');
    expect(createFn).toHaveBeenCalledTimes(1);
  });
});

describe('AddSpotScreen pin + keyboard (device pass, 2026-09-04)', () => {
  it('the pin is asked of the MAP at press time, not read from a stale layout', async () => {
    const { MOCK_MAP } = await import('../../test/rnmapbox-stub');
    const before = MOCK_MAP.center;
    MOCK_MAP.center = [-79.75, 43.65]; // the user panned here
    try {
      const createFn = vi.fn(async () => 'new-id');
      const tree = await render(createFn, []);
      const wrap = tree.root.findAll((n) => typeof n.props['onLayout'] === 'function')[0]!;
      await act(async () => {
        (wrap.props['onLayout'] as (e: unknown) => void)({
          nativeEvent: { layout: { width: 390, height: 500 } },
        });
      });
      await press(tree, 'Type Viewpoint');
      await type(tree, 'Spot name', 'Ridge View');
      await press(tree, 'Save spot');
      await act(async () => {});
      expect(createFn).toHaveBeenCalledTimes(1);
      const draft = (createFn.mock.calls[0] as unknown[])[2] as { lat: number; lng: number };
      expect(draft.lat).toBeCloseTo(43.65, 6);
      expect(draft.lng).toBeCloseTo(-79.75, 6);
    } finally {
      MOCK_MAP.center = before;
    }
  });

  it('the form rides above the keyboard (Save is never hidden behind it)', async () => {
    const tree = await render(vi.fn(), []);
    expect(JSON.stringify(tree.toJSON())).toContain('rn-keyboardavoidingview');
  });
});

describe('AddSpotScreen double-tap (review, 2026-09-04)', () => {
  it('two taps on Save in quick succession create ONE spot', async () => {
    const createFn = vi.fn(async () => 'new-id');
    const tree = await render(createFn, []);
    await press(tree, 'Type Viewpoint');
    await type(tree, 'Spot name', 'Ridge View');
    const node = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Save spot' && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (node.props['onPress'] as () => void)();
      (node.props['onPress'] as () => void)(); // before the pin has resolved
    });
    await act(async () => {});
    expect(createFn).toHaveBeenCalledTimes(1);
  });
});
