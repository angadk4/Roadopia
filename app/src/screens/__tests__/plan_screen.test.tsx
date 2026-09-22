/**
 * Component smoke (M7-T01) — renders OUR screens in node via react-test-renderer
 * over the rn-stub alias. Catches wiring failures (broken imports, hook misuse,
 * render crashes); native behaviour is verified on device (M7-T09).
 */
/**
 * Split verbatim out of screens.test.tsx (redesign shell — SPEC "Test
 * changes"), then re-targeted for the plan cluster (SPEC "Test changes",
 * `plan_screen.test.tsx` row). Every copy assertion is unchanged. What moved:
 *
 *   - 'Plan a drive' in the bare page → the title is the NATIVE large
 *     title's: `PlanStack` feeds `pageOptions(PLAN_FORM_TITLE)`, so the
 *     contract "the screen is titled Plan a drive" is asserted on the string
 *     the stack registers, and the page is asserted NOT to draw it (IA — the
 *     same adapter pattern spot_detail_screen.test uses for `setTitle`).
 *   - '"selected":true' (the Chip's a11y state) → the Road-character
 *     `expo-ui-picker` host's `selection === 1` (Backroads): the wrapper's
 *     `selectedIndex` travels to the native Picker as `selection` (R).
 *   - 'Remove' → the `"Remove stop 1"` accessibilityLabel on the row's
 *     minus.circle.fill control (T); the stop values are read off the two
 *     stop pickers' selections as well as their Text tags (T).
 *   - NEW: the pinned Material bar renders the blocker sentence ABOVE the CTA,
 *     inside a KeyboardAvoidingView, and drops the sentence once the draft is
 *     complete (N).
 */
import { act } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFT, PlanDraftContext, type PlanDraft } from '../../lib/plan_draft';
import PlanScreen, { PLAN_FORM_TITLE } from '../PlanScreen';

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

const NOOP_NAV = { navigate: () => {}, goBack: () => {} };

function planScreenWith(draft: Partial<PlanDraft>): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <PlanDraftContext.Provider
        value={{ draft: { ...EMPTY_DRAFT, ...draft }, setDraft: () => {} }}
      >
        <PlanScreen navigation={NOOP_NAV} locate={() => new Promise(() => {})} />
      </PlanDraftContext.Provider>,
    );
  });
  return tree;
}

/** Typed `string`, not literal: `ReactTestInstance.type` is React's
 *  `ElementType`, and strict TS rejects a comparison against a literal it can
 *  never equal — the same reason `test/dialog.ts` widens its tag names. */
function ofTag(tag: string): (n: ReactTestInstance) => boolean {
  return (n) => n.type === tag;
}

/** The `@expo/ui` Picker host carrying this label (the stub renders the real
 *  prop names: `label`, `selection`). Exactly one, or the screen has two
 *  controls announcing the same name. */
function picker(root: ReactTestInstance, label: string): ReactTestInstance {
  const hits = root.findAll(
    (n) => String(n.type) === 'expo-ui-picker' && n.props['label'] === label,
  );
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

/** The pinned bar's HOST view (a testID also rides the composite wrappers
 *  above it; the host is the one whose children are the bar's contents). */
function isBar(n: ReactTestInstance): boolean {
  return String(n.type) === 'rn-view' && n.props['testID'] === 'plan-pinned-bar';
}

describe('screen smoke', () => {
  it('PlanScreen renders brief input, origin buttons, shape + R16-5 sections (FR-040)', () => {
    const tree = planScreenWith({});
    const text = textOf(tree);
    // The title is the native large title's (PlanStack → pageOptions): the
    // stack registers this string, and the page itself draws no title.
    expect(PLAN_FORM_TITLE).toBe('Plan a drive');
    expect(text).not.toContain('Plan a drive');
    // …and the page's first child is the scroll view the large title
    // collapses over — `contentInsetAdjustmentBehavior="automatic"` is what
    // makes that happen natively (SPEC rule 13).
    const page = tree.root.findAll(ofTag('rn-scrollview'));
    expect(page).toHaveLength(1);
    expect(page[0]!.props['contentInsetAdjustmentBehavior']).toBe('automatic');
    expect(text).toContain('Use my location');
    expect(text).toContain('Pick on map');
    expect(text).toContain('Loop');
    expect(text).toContain('A → B');
    // R23: the style control is presets-only under the hood (BD-30 / Hard rule
    // L — buildPlanRequest composes onto the preset slot). R25-U17 relabel:
    // "Road character" (it selects which roads, never pace) + R25-U16b's third
    // chip makes style:null reachable (the duration "Any" precedent).
    expect(text).toContain('optional');
    expect(text).toContain('Drive time'); // R24-U12 time control (loops)
    expect(text).toContain('Road character');
    expect(text).toContain('Direct');
    // R29 Unit D: the chip is named for its mechanism, and the "No preference"
    // third chip is gone (its null value doubled as quick-fill's marker — the
    // twisty-un-fills-the-chip bug).
    expect(text).toContain('Backroads');
    expect(text).not.toContain('No preference');
    expect(text).toContain('not how fast you drive it'); // Hard rule D sub-label
    expect(text).toContain('Scenery');
    expect(text).toContain('Prefer views');
    expect(text).toContain('On the route');
    expect(text).toContain('Avoid highways');
    expect(text).toContain('Paved roads only');
    expect(text).toContain('Add a stop');
    expect(text.toLowerCase()).not.toContain('slider');
    // Chill + the retired Twisty / Mostly-backroads tiers are gone from the UI
    expect(text).not.toContain('Chill');
    expect(text).not.toContain('Twisty');
    expect(text).not.toContain('Mostly backroads');
    // Hard rule D: no speed/racing/timing framing anywhere in the drive copy
    for (const w of ['racing', 'fastest', 'leaderboard', 'mph', 'velocity']) {
      expect(text.toLowerCase()).not.toContain(w);
    }
    // CTA blocked only by the missing origin — the brief is optional now (U12)
    expect(text).not.toContain('Describe the drive you want.');
    expect(text).toContain('Add a start point.');
  });

  it('PlanScreen with a complete draft shows the set origin and no blockers', () => {
    const text = textOf(
      planScreenWith({
        brief: 'a 90 minute loop',
        origin: { source: 'current', point: { lat: 43.26, lng: -79.87 } },
      }),
    );
    expect(text).toContain('current location');
    expect(text).not.toMatch(/43\.26|-79\.87/); // never raw coordinates in copy
    expect(text).not.toContain('Add a start point.');
  });

  it('PlanScreen marks the active drive-style segment selected; stops builder rows render', () => {
    const tree = planScreenWith({
      style: 'backroads',
      stops: [
        { type: 'coffee', when: 'midway' },
        { type: 'fuel', when: 'late' },
      ],
    });
    const text = textOf(tree);
    // The Chip's `"selected":true` became the native segmented control's
    // selection: index 1 of [Direct · Backroads] is Backroads.
    expect(picker(tree.root, 'Road character').props['selection']).toBe(1);
    // Each stop row is two segmented pickers; their labels are still Picker
    // Text tags in the tree, and their selections say which is set.
    expect(text).toContain('Coffee');
    expect(text).toContain('Gas');
    expect(text).toContain('Midway');
    expect(text).toContain('Late');
    expect(picker(tree.root, 'Stop 1 type').props['selection']).toBe(0); // coffee
    expect(picker(tree.root, 'Stop 1 timing').props['selection']).toBe(2); // midway
    expect(picker(tree.root, 'Stop 2 type').props['selection']).toBe(2); // fuel → "Gas"
    expect(picker(tree.root, 'Stop 2 timing').props['selection']).toBe(3); // late
    // The ghost "Remove" became the row's minus.circle.fill, announced per row.
    expect(text).toContain('Remove stop 1');
    expect(text).toContain('Remove stop 2');
    expect(text).not.toContain('down'); // the glyph tripwire
  });

  it('PlanScreen pins the CTA in a Material bar with the blocker sentence above it', () => {
    const tree = planScreenWith({});
    const bars = tree.root.findAll(isBar);
    expect(bars).toHaveLength(1);
    const bar = bars[0]!;
    // A Material: the blur layer is inside the bar, and the bar rides the
    // keyboard — its ancestor is the KeyboardAvoidingView, never the scroll.
    expect(bar.findAll(ofTag('expo-blurview'))).toHaveLength(1);
    expect(tree.root.findAll(ofTag('rn-keyboardavoidingview'))[0]!.findAll(isBar)).toHaveLength(1);
    expect(tree.root.findAll(ofTag('rn-scrollview'))[0]!.findAll(isBar)).toHaveLength(0);
    // Document order inside the bar: the sentence that says why the button is
    // disabled comes BEFORE the button — the eye lands on it before the tap.
    const order = bar.findAll(
      (n) =>
        (String(n.type) === 'rn-text' &&
          JSON.stringify(n.children).includes('Add a start point.')) ||
        (String(n.type) === 'rn-pressable' && n.props['accessibilityLabel'] === 'Plan my drive'),
    );
    expect(order).toHaveLength(2);
    expect(order[0]!.type).toBe('rn-text');
    expect(order[1]!.type).toBe('rn-pressable');
    expect(order[1]!.props['disabled']).toBe(true);

    // A complete draft: the sentence is gone from the bar and the CTA is live.
    const done = planScreenWith({
      origin: { source: 'current', point: { lat: 43.26, lng: -79.87 } },
    });
    const doneBar = done.root.findAll(isBar)[0]!;
    expect(
      doneBar.findAll(
        (n) =>
          String(n.type) === 'rn-text' && JSON.stringify(n.children).includes('Add a start point.'),
      ),
    ).toHaveLength(0);
    const cta = doneBar.findAll(
      (n) => String(n.type) === 'rn-pressable' && n.props['accessibilityLabel'] === 'Plan my drive',
    );
    expect(cta).toHaveLength(1);
    expect(cta[0]!.props['disabled']).toBe(false);
  });
});
