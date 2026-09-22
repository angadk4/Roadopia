/**
 * CreateHome (BD-204 review).
 *
 * The Create tab's home had ZERO coverage because it lived inline in
 * `nav/CreateStack.tsx`, and importing that module pulls in
 * `react-native-screens`, which the vitest aliases do not stub. That is also why
 * the redesign pass missed the screen. These pin the things a future edit would
 * quietly undo: both modes are offered, both navigate to the right screen, the
 * copy is the §18 wording (no promise the builder does not keep), and the cards
 * are real controls rather than text behind a hairline.
 */

import { act, type ReactElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { HIT_TARGET } from '../../theme';
import CreateHome from '../CreateHome';

function render(node: ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
}

const textOf = (tree: ReactTestRenderer): string => JSON.stringify(tree.toJSON());

/** Every tappable, by its accessibility label. */
function control(tree: ReactTestRenderer, label: string): { onPress: () => void } {
  const node = tree.root.find(
    (n) => n.props['accessibilityLabel'] === label && typeof n.props['onPress'] === 'function',
  );
  return node.props as { onPress: () => void };
}

describe('CreateHome', () => {
  it('offers both creation modes with the honest description of each', () => {
    const text = textOf(render(<CreateHome navigate={() => {}} />));
    // Redesign (SPEC rule 13): the title "Create" is the NATIVE large title —
    // `CreateStack` sets `pageOptions('Create')` — so a bare render draws no
    // page title of its own: no `display`-role text (32 pt) anywhere.
    expect(text).not.toContain('"fontSize":32');
    // The two atlas kickers, source-case in the tree (`Legend` uppercases via
    // textTransform, never toUpperCase()).
    expect(text).toContain('By hand');
    expect(text).toContain('As you drive');
    expect(text).toContain('Build by hand');
    expect(text).toContain('Drop points on the map');
    expect(text).toContain('the route snaps to real roads as you go');
    expect(text).toContain('Record a drive');
    expect(text).toContain('Capture a drive you love as you drive it');
    expect(text).toContain('snapped to real roads when you stop');
    // Hard rule D: a recorded drive is a MEASUREMENT, never a timed run.
    expect(text).not.toContain('down'); // never a raw error, never a "down" icon
  });

  it('each card navigates to its own screen', () => {
    const seen: string[] = [];
    const tree = render(<CreateHome navigate={(s) => seen.push(s)} />);
    act(() => {
      control(tree, 'Build a route by hand').onPress();
    });
    act(() => {
      control(tree, 'Record a drive').onPress();
    });
    expect(seen).toEqual(['Builder', 'Record']);
  });

  it('the cards clear the owner-recorded 44pt floor', () => {
    const tree = render(<CreateHome navigate={() => {}} />);
    const mins = tree.root
      .findAll((n) => String(n.type) === 'rn-view')
      .flatMap((n) => {
        const style = n.props['style'] as unknown;
        const parts = (Array.isArray(style) ? style : [style]).filter(
          (s): s is Record<string, unknown> => s !== null && typeof s === 'object',
        );
        return parts.map((s) => s['minHeight']).filter((v): v is number => typeof v === 'number');
      });
    expect(mins.length).toBeGreaterThan(0);
    for (const m of mins) expect(m).toBeGreaterThanOrEqual(HIT_TARGET);
  });
});
