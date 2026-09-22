/**
 * The primitive library's contract (BD-204).
 *
 * These pin the rules the redesign depends on — the ones a future edit would
 * quietly break: a Stat never invents a number, an Icon never carries a name
 * that trips the raw-error tripwires, a Row never scales, a destructive control
 * is never a danger FILL (2.19:1 in light), and every control clears the owner's
 * recorded 44pt floor.
 */

import { act, createRef, type ReactElement } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { __haptics, __resetHaptics } from '../../../test/expo-haptics-stub';
import {
  __clearMountedGestures,
  __fireGesture,
  __mountedGesture,
  __mountedGestures,
} from '../../../test/gesture-handler-stub';
import { __setReducedMotion } from '../../../test/reanimated-stub';
import { darkColors, HIT_TARGET, material, motion, radius, withAlpha } from '../../../theme';
import {
  assertSafeSymbol,
  Button,
  Chapter,
  Chip,
  Legend,
  LegendKey,
  Material,
  PressableScale,
  Row,
  ROW_TINT_ALPHA,
  RULE_W,
  Shelf,
  SHELF_PAN_TEST_ID,
  Stat,
  STATUS_SCRIM_ALPHA,
  StatusScrim,
  Surface,
  SWATCH_SIZE,
  Symbol,
  SYMBOLS,
  Text,
  type ShelfHandle,
} from '../index';

function render(node: ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
}

const json = (node: ReactElement): string => JSON.stringify(render(node).toJSON());

/** Find the first node carrying a style key, flattening arrays. */
function styleWith(tree: ReactTestRenderer, key: string): Record<string, unknown> | null {
  const seen: Array<Record<string, unknown>> = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const node = n as { props?: { style?: unknown }; children?: unknown[] };
    const flat = (s: unknown): void => {
      if (Array.isArray(s)) s.forEach(flat);
      else if (s && typeof s === 'object') seen.push(s as Record<string, unknown>);
    };
    flat(node.props?.style);
    (node.children ?? []).forEach(walk);
  };
  walk(render(<Text>x</Text>).toJSON()); // warm-up no-op keeps the walker honest
  seen.length = 0;
  walk(tree.toJSON());
  return seen.find((s) => key in s) ?? null;
}

describe('Text', () => {
  it('renders its children and picks a role from the scale', () => {
    expect(json(<Text variant="display">Plan a drive</Text>)).toContain('Plan a drive');
    const s = styleWith(render(<Text variant="display">t</Text>), 'fontSize');
    expect(s?.['fontSize']).toBe(32);
    expect(s?.['letterSpacing']).toBe(-0.6);
  });

  it('Legend uppercases AND tracks — one without the other is shouting', () => {
    // Uppercased by `textTransform`, never `toUpperCase()` (SPEC "Verified
    // facts"): the SOURCE-CASE word is what sits in the tree, so a heading
    // promoted to a Legend keeps matching the case-sensitive copy assertions
    // ('Stops', 'Saved drives') and VoiceOver reads the word, not the letters.
    const out = json(<Legend>distance</Legend>);
    expect(out).toContain('distance');
    expect(out).not.toContain('DISTANCE');
    const upper = styleWith(render(<Legend>distance</Legend>), 'textTransform');
    expect(upper?.['textTransform']).toBe('uppercase');
    const s = styleWith(render(<Legend>distance</Legend>), 'letterSpacing');
    expect(s?.['letterSpacing']).toBe(0.8);
  });
});

describe('Surface', () => {
  it('an inset level has no shadow and no lit edge; a raised one has both', () => {
    expect(styleWith(render(<Surface level="inset" />), 'boxShadow')).toBeNull();
    expect(styleWith(render(<Surface level="raised" />), 'boxShadow')).not.toBeNull();
    expect(styleWith(render(<Surface level="raised" />), 'borderTopColor')).not.toBeNull();
  });

  it('every rounded surface is a squircle — iOS is continuous-curvature', () => {
    const s = styleWith(render(<Surface />), 'borderCurve');
    expect(s?.['borderCurve']).toBe('continuous');
  });
});

describe('Button', () => {
  it('clears the owner-recorded hit-target floor', () => {
    const s = styleWith(render(<Button title="Plan" />), 'minHeight');
    expect(Number(s?.['minHeight'])).toBeGreaterThanOrEqual(HIT_TARGET);
  });

  it('the primary fill carries the AMBER_BRIGHT lit edge', () => {
    const s = styleWith(render(<Button title="Plan" />), 'borderTopColor');
    expect(s?.['borderTopColor']).toBe('#ffd54a');
  });

  it('secondary carries a real fill AND the index rule, not an outline alone', () => {
    const s = styleWith(render(<Button title="Cancel" variant="secondary" />), 'borderColor');
    expect(s?.['borderColor']).toBeTruthy();
    const fill = styleWith(
      render(<Button title="Cancel" variant="secondary" />),
      'backgroundColor',
    );
    expect(fill?.['backgroundColor']).not.toBe('transparent');
  });

  it('does not fire while loading or disabled, and says so to assistive tech', () => {
    const onPress = vi.fn();
    const out = json(<Button title="Save" loading onPress={onPress} />);
    expect(out).toContain('"busy":true');
    expect(out).toContain('"disabled":true');
    expect(onPress).not.toHaveBeenCalled();
  });

  it('danger is an OUTLINED destructive control, never a danger fill', () => {
    // The trap this closes: filled, the variant put the `onAccent` ink on a
    // `danger` ground — 2.19:1 in light (#2a1f06 on #a4231c) against a 4.5:1
    // body floor. theme.test.ts measures the pairing it uses instead; this pins
    // that the component actually uses that pairing.
    const out = json(<Button title="Delete this drive" variant="danger" />);
    const fill = styleWith(
      render(<Button title="Delete this drive" variant="danger" />),
      'backgroundColor',
    );
    expect(fill?.['backgroundColor']).toBe('transparent');
    expect(out).not.toContain(darkColors.onAccent);
    // Label and ring are both the danger tone, so the control is drawn twice
    // over — it is visible as a control before it is read as a label.
    expect(out).toContain(`"color":"${darkColors.danger}"`);
    const ring = styleWith(
      render(<Button title="Delete this drive" variant="danger" />),
      'borderColor',
    );
    expect(ring?.['borderColor']).toBe(darkColors.danger);
  });

  it('is announced as a button with its title', () => {
    expect(json(<Button title="Follow this drive" />)).toContain('Follow this drive');
    expect(json(<Button title="Follow this drive" />)).toContain('"accessibilityRole":"button"');
  });

  it('press feedback is PressableScale — a transform transition, never an opacity fade', () => {
    // A fading button fades its label at the moment you are reading it. The
    // dip is a CSS transition on `transform` only (SPEC "Shell chrome >
    // PressableScale"), and a disabled control never dips.
    const tree = render(<Button title="Plan my drive" onPress={() => {}} />);
    const s = styleWith(tree, 'transitionProperty');
    expect(s?.['transitionProperty']).toBe('transform');
    expect(s?.['transitionDuration']).toBe(motion.press);
    expect(JSON.stringify(tree.toJSON())).toContain('"scale":1');
    act(() => {
      (tree.root.find(ofTag('rn-pressable')).props['onPressIn'] as () => void)();
    });
    expect(JSON.stringify(tree.toJSON())).toContain(`"scale":${motion.pressScale}`);
    // Already ≥ 44pt: no hitSlop, so two stacked buttons never overlap in the gap.
    expect(tree.root.find(ofTag('rn-pressable')).props['hitSlop']).toBe(0);
  });
});

describe('Chip', () => {
  it('is a pill, not a rounded box', () => {
    const s = styleWith(render(<Chip label="Backroads" />), 'borderRadius');
    expect(Number(s?.['borderRadius'])).toBeGreaterThan(100);
  });

  it('selection is announced, and the role distinguishes one-of from many', () => {
    expect(json(<Chip label="Twisty" selected choice="one" />)).toContain(
      '"accessibilityRole":"radio"',
    );
    expect(json(<Chip label="Avoid tolls" choice="many" />)).toContain(
      '"accessibilityRole":"checkbox"',
    );
    expect(json(<Chip label="Twisty" selected />)).toContain('"selected":true');
  });

  it('takes an announced name of its own, and defaults to the visible label', () => {
    // Hard-coding the announcement to `label` is why three screens hand-rolled
    // their own pill: a chip inside a labelled group has to carry the group's
    // name into the announcement ("Set visibility unlisted", not "Unlisted").
    expect(json(<Chip label="Unlisted" accessibilityLabel="Set visibility unlisted" />)).toContain(
      '"accessibilityLabel":"Set visibility unlisted"',
    );
    expect(json(<Chip label="Unlisted" />)).toContain('"accessibilityLabel":"Unlisted"');
    expect(json(<Chip label="Viewpoint" accessibilityHint="Sets the spot type" />)).toContain(
      '"accessibilityHint":"Sets the spot type"',
    );
    // The override is announcement-only: the visible label is untouched.
    expect(json(<Chip label="Unlisted" accessibilityLabel="Set visibility unlisted" />)).toContain(
      'Unlisted',
    );
  });

  it('an unselected chip is still DRAWN — it carries the index rule', () => {
    const s = styleWith(render(<Chip label="Scenic" selected={false} />), 'borderColor');
    expect(s?.['borderColor']).toBeTruthy();
    const fill = styleWith(render(<Chip label="Scenic" selected={false} />), 'backgroundColor');
    expect(fill?.['backgroundColor']).not.toBe('transparent');
  });
});

describe('Stat', () => {
  it('renders the measured value above its legend', () => {
    // The legend IS a `Legend`, so its uppercase comes from `textTransform`
    // and the label sits in the tree in source case (see the Legend case).
    const out = json(<Stat value="67.8 km" label="distance" />);
    expect(out).toContain('67.8 km');
    expect(out).toContain('distance');
    const upper = styleWith(render(<Stat value="67.8 km" label="distance" />), 'textTransform');
    expect(upper?.['textTransform']).toBe('uppercase');
  });

  it('a value that was never measured renders NOTHING — §18, no invented zero', () => {
    // RouteDetail omits twistiness for hand-built and recorded drives rather
    // than printing 0.0. The primitive must make that the easy path.
    expect(render(<Stat value={null} label="twistiness" />).toJSON()).toBeNull();
  });

  it('reads as one string to VoiceOver, not two loose fragments', () => {
    expect(json(<Stat value="≈75 min" label="drive time" />)).toContain('"≈75 min, drive time"');
  });
});

describe('Row', () => {
  it('NEVER scales — a full-width row that scales drags its own text', () => {
    const out = json(
      <Row onPress={() => {}}>
        <Text>Hockley Valley loop</Text>
      </Row>,
    );
    expect(out).not.toContain('scale');
    expect(out).toContain('Hockley Valley loop');
  });

  it('renders a forward chevron, never a "down" one', () => {
    const out = json(
      <Row onPress={() => {}} chevron>
        <Text>Saved drive</Text>
      </Row>,
    );
    expect(out).toContain('chevron-forward');
    expect(out).not.toContain('down');
  });

  it('an accessory replaces the chevron rather than stacking with it', () => {
    const out = json(
      <Row onPress={() => {}} chevron accessory={<Text>3</Text>}>
        <Text>Stops</Text>
      </Row>,
    );
    expect(out).not.toContain('chevron-forward');
  });

  it('without onPress it is not announced as a control', () => {
    const out = json(
      <Row>
        <Text>Read-only</Text>
      </Row>,
    );
    expect(out).not.toContain('"accessibilityRole":"button"');
  });

  it('tints on press — a 120 ms CSS transition on backgroundColor to accent at 0.12', () => {
    // The successor to `usePressFill`: the same tint, as a Reanimated CSS
    // transition (SPEC "Shell chrome > PressableScale"). backgroundColor is the
    // ONLY transitioned property — a row never scales.
    const tree = render(
      <Row onPress={() => {}}>
        <Text>Hockley Valley loop</Text>
      </Row>,
    );
    const s = styleWith(tree, 'transitionProperty');
    expect(s?.['transitionProperty']).toBe('backgroundColor');
    expect(s?.['transitionDuration']).toBe(motion.press);
    expect(JSON.stringify(s?.['transitionTimingFunction'])).toContain('"x1":0.23');
    expect(JSON.stringify(tree.toJSON())).toContain('"backgroundColor":"transparent"');
    act(() => {
      (tree.root.find(ofTag('rn-pressable')).props['onPressIn'] as () => void)();
    });
    const pressed = JSON.stringify(tree.toJSON());
    expect(pressed).toContain(
      `"backgroundColor":"${withAlpha(darkColors.accent, ROW_TINT_ALPHA)}"`,
    );
    expect(pressed).not.toContain('scale');
    act(() => {
      (tree.root.find(ofTag('rn-pressable')).props['onPressOut'] as () => void)();
    });
    expect(JSON.stringify(tree.toJSON())).toContain('"backgroundColor":"transparent"');
  });
});

// ---------------------------------------------------------------------------
// The shell primitives (redesign — SPEC "Shell chrome"). Added beside the
// cases above, which are untouched: Icon / Reveal / Swap / press.ts stay
// until the final sweep, and so do their contracts.
// ---------------------------------------------------------------------------

/** Matches a stub's host element by tag. A `string`-typed predicate rather
 *  than `findByType`, whose parameter is React's `ElementType` — DOM tag names
 *  only under strict TS, so a stub's own tag would not type-check. */
const ofTag =
  (tag: string) =>
  (n: ReactTestInstance): boolean =>
    n.type === tag;

describe('Symbol', () => {
  /** rn-stub's `Platform` is a plain object reporting 'test'. Flip it to the
   *  iOS branch for one render and restore it — it is module state shared by
   *  every test in this file. */
  const onIOS = <T,>(run: () => T): T => {
    const platform = Platform as unknown as { OS: string };
    const was = platform.OS;
    platform.OS = 'ios';
    try {
      return run();
    } finally {
      platform.OS = was;
    }
  };

  it('renders the SF name as a PROP on iOS — medium weight, sized to its label', () => {
    // The expo-symbols stub keeps `symbolName` as a prop, so the name IS in the
    // serialised tree: that is what keeps the 'down' tripwire meaningful.
    const tree = onIOS(() => render(<Symbol name="chevronRight" />));
    const host = tree.root.find(ofTag('expo-symbol'));
    expect(host.props['symbolName']).toBe('chevron.right');
    expect(host.props['weight']).toBe('medium');
    expect(host.props['size']).toBe(18);
    expect(host.props['tintColor']).toBe(darkColors.text);
    expect(JSON.stringify(tree.toJSON())).toContain('chevron.right');
  });

  it('renders the Ionicons twin off iOS — the same key, the other namespace', () => {
    const tree = render(<Symbol name="chevronRight" tone="muted" size="lg" />);
    expect(tree.root.findAll(ofTag('expo-symbol'))).toHaveLength(0);
    const host = tree.root.find(ofTag('rn-icon'));
    expect(host.props['iconName']).toBe('chevron-forward');
    expect(host.props['size']).toBe(22);
    expect(host.props['color']).toBe(darkColors.textMuted);
  });

  it('is hidden from assistive tech beside a label, and an image when it is the content', () => {
    expect(json(<Symbol name="checkmark" />)).toContain('"accessibilityElementsHidden":true');
    const labelled = json(<Symbol name="xmark" label="Dismiss" />);
    expect(labelled).toContain('"accessibilityLabel":"Dismiss"');
    expect(labelled).toContain('"accessibilityRole":"image"');
    // The same contract on the SF branch.
    const ios = onIOS(() => json(<Symbol name="xmark" label="Dismiss" />));
    expect(ios).toContain('"accessibilityLabel":"Dismiss"');
    expect(ios).toContain('"accessibilityRole":"image"');
    expect(onIOS(() => json(<Symbol name="checkmark" />))).toContain(
      '"accessibilityElementsHidden":true',
    );
  });

  it('throws in dev on "down" in EITHER namespace, and on a denylist word', () => {
    // Six suites assert not.toContain('down') on the serialised tree, and the
    // SF name is a prop in that tree — so the guard covers both names, not
    // just the Ionicons one `Icon` checked.
    expect(() =>
      assertSafeSymbol('x', { sf: 'chevron.down', ionicons: 'chevron-forward' }),
    ).toThrow(/tripwire/);
    expect(() => assertSafeSymbol('x', { sf: 'chevron.right', ionicons: 'chevron-down' })).toThrow(
      /tripwire/,
    );
    // Hard rule D: no speed / timing / racing glyph, ever.
    expect(() => assertSafeSymbol('x', { sf: 'gauge', ionicons: 'checkmark' })).toThrow(/denylist/);
    expect(() =>
      assertSafeSymbol('x', { sf: 'checkmark', ionicons: 'speedometer-outline' }),
    ).toThrow(/denylist/);
    expect(() => assertSafeSymbol('x', { sf: 'stopwatch', ionicons: 'timer-outline' })).toThrow(
      /denylist/,
    );
    expect(() => assertSafeSymbol('x', { sf: 'flag.checkered', ionicons: 'rocket' })).toThrow(
      /denylist/,
    );
    // A clean pair passes…
    expect(() =>
      assertSafeSymbol('x', { sf: 'chevron.right', ionicons: 'chevron-forward' }),
    ).not.toThrow();
    // …and a key that is not in the table is refused at render, never drawn blank.
    expect(() => render(<Symbol name={'chevronDown' as never} />)).toThrow(/not a key/);
  });

  it('the WHOLE table is clean — no "down", no denylist word, in either namespace', () => {
    const denylist = ['speed', 'gauge', 'race', 'flash', 'rocket', 'timer', 'stopwatch'];
    const keys = Object.keys(SYMBOLS) as Array<keyof typeof SYMBOLS>;
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) {
      const { sf, ionicons } = SYMBOLS[key];
      for (const name of [key, sf, ionicons]) {
        expect(name).not.toContain('down');
        for (const w of denylist) expect(name.toLowerCase()).not.toContain(w);
      }
      expect(() => assertSafeSymbol(key, { sf, ionicons })).not.toThrow();
    }
    // Every key the tab bar and the SPEC name is present.
    const required = [
      'map',
      'mapFill',
      'chevronRight',
      'chevronLeft',
      'ellipsisCircle',
      'plus',
      'plusCircle',
      'plusCircleFill',
      'arrowRight',
      'arrowUpCircleFill',
      'arrowTriangleTurnUpRightDiamond',
      'arrowTriangleTurnUpRightDiamondFill',
      'location',
      'locationFill',
      'locationSlash',
      'wifiSlash',
      'infoCircle',
      'exclamationmarkTriangle',
      'exclamationmarkCircleFill',
      'checkmarkCircleFill',
      'bookmark',
      'bookmarkFill',
      'xmark',
      'trash',
      'pencil',
      'flag',
      'camera',
      'photo',
      'signpostRight',
      'signpostRightFill',
    ] as const;
    for (const k of required) expect(SYMBOLS[k]).toBeDefined();
    // Filled twins are the same glyph plus `.fill`: selection is ONE rule.
    expect(SYMBOLS.mapFill.sf).toBe(`${SYMBOLS.map.sf}.fill`);
    expect(SYMBOLS.bookmarkFill.sf).toBe(`${SYMBOLS.bookmark.sf}.fill`);
    expect(SYMBOLS.plusCircleFill.sf).toBe(`${SYMBOLS.plusCircle.sf}.fill`);
    expect(SYMBOLS.signpostRightFill.sf).toBe(`${SYMBOLS.signpostRight.sf}.fill`);
    expect(SYMBOLS.arrowTriangleTurnUpRightDiamondFill.sf).toBe(
      `${SYMBOLS.arrowTriangleTurnUpRightDiamond.sf}.fill`,
    );
  });
});

describe('Material', () => {
  type Patchable = { isReduceTransparencyEnabled?: () => Promise<boolean> };
  const a11y = AccessibilityInfo as unknown as Patchable;

  /** Drive the OS flag through the path the component reads it by. rn-stub
   *  has no `isReduceTransparencyEnabled` (an iOS-only API, guarded with
   *  optional chaining in the component), so the test gives its plain object
   *  one, mounts a material — whose mount refresh asks — and lets the promise
   *  land. The cache it writes is module state: restored in afterEach. */
  async function setReduceTransparency(value: boolean): Promise<void> {
    a11y.isReduceTransparencyEnabled = () => Promise.resolve(value);
    await act(async () => {
      create(<Material role="panel" />);
    });
  }

  afterEach(async () => {
    await setReduceTransparency(false);
    delete a11y.isReduceTransparencyEnabled;
  });

  it('is a blur under a paper tint with a lit edge — intensity a constant, never a prop', () => {
    const tree = render(
      <Material role="panel">
        <Text>Panel</Text>
      </Material>,
    );
    const blur = tree.root.find(ofTag('expo-blurview'));
    expect(blur.props['intensity']).toBe(material.intensity);
    expect(blur.props['tint']).toBe('dark');
    const out = JSON.stringify(tree.toJSON());
    expect(out).toContain(`"backgroundColor":"${withAlpha(darkColors.bg, material.overlay.dark)}"`);
    expect(out).toContain(`"borderTopColor":"${darkColors.topEdge}"`);
    expect(out).toContain('Panel');
    // The blur is not a fill: the container carries no opaque ground of its own.
    expect(out).not.toContain(darkColors.surfaceRaised);
  });

  it('dense carries the heavier band; sheet rounds only its top; pill clears the hit floor', () => {
    expect(json(<Material role="dense" />)).toContain(
      `"backgroundColor":"${withAlpha(darkColors.bg, material.overlay.dense)}"`,
    );
    const sheet = styleWith(render(<Material role="sheet" />), 'borderTopLeftRadius');
    expect(sheet?.['borderTopLeftRadius']).toBe(radius.xl);
    expect(sheet?.['borderBottomLeftRadius']).toBeUndefined();
    expect(sheet?.['borderCurve']).toBe('continuous');
    const pill = styleWith(render(<Material role="pill" />), 'minHeight');
    expect(Number(pill?.['minHeight'])).toBeGreaterThanOrEqual(HIT_TARGET);
    expect(pill?.['borderRadius']).toBe(radius.pill);
  });

  it('renders solid surfaceRaised under Reduce Transparency — no blur, no overlay', async () => {
    await setReduceTransparency(true);
    const tree = render(
      <Material role="bar">
        <Text>Bar</Text>
      </Material>,
    );
    expect(tree.root.findAll(ofTag('expo-blurview'))).toHaveLength(0);
    const out = JSON.stringify(tree.toJSON());
    expect(out).toContain(`"backgroundColor":"${darkColors.surfaceRaised}"`);
    expect(out).not.toContain(withAlpha(darkColors.bg, material.overlay.dark));
    // The shape and the lit edge survive; only the translucency goes.
    expect(out).toContain(`"borderTopColor":"${darkColors.topEdge}"`);
    expect(out).toContain('Bar');
  });

  it('throws in dev when nested — inside a material everything is an opaque tier', () => {
    expect(() =>
      render(
        <Material role="sheet">
          <Material role="pill" />
        </Material>,
      ),
    ).toThrow(/never nested/);
    // An opaque Surface inside a material is the intended composition.
    expect(
      json(
        <Material role="sheet">
          <Surface level="raised">
            <Text>Card</Text>
          </Surface>
        </Material>,
      ),
    ).toContain('Card');
  });
});

describe('PressableScale', () => {
  afterEach(() => {
    __setReducedMotion(false);
  });

  const pressIn = (tree: ReactTestRenderer): void => {
    act(() => {
      (tree.root.find(ofTag('rn-pressable')).props['onPressIn'] as () => void)();
    });
  };
  const pressOut = (tree: ReactTestRenderer): void => {
    act(() => {
      (tree.root.find(ofTag('rn-pressable')).props['onPressOut'] as () => void)();
    });
  };

  it('transitions transform ONLY, on the 120 ms strong ease-out', () => {
    const tree = render(
      <PressableScale onPress={() => {}}>
        <Text>Plan my drive</Text>
      </PressableScale>,
    );
    const s = styleWith(tree, 'transitionProperty');
    expect(s?.['transitionProperty']).toBe('transform');
    expect(s?.['transitionDuration']).toBe(motion.press);
    expect(JSON.stringify(s?.['transitionTimingFunction'])).toContain('"x1":0.23');
    // Nothing else is transitioned: opacity and colour stay the caller's, and
    // no keyframe animation rides along.
    const out = JSON.stringify(tree.toJSON());
    expect(out.match(/transitionProperty/g)).toHaveLength(1);
    expect(out).not.toContain('animationName');
    expect(out).toContain('Plan my drive');
  });

  it('dips to 0.97 on press-in and eases back on press-out; 0.99 under Reduce Motion', () => {
    const tree = render(
      <PressableScale onPress={() => {}}>
        <Text>Card</Text>
      </PressableScale>,
    );
    const pressable = tree.root.find(ofTag('rn-pressable'));
    expect(pressable.props['hitSlop']).toBe(12);
    expect(pressable.props['pressRetentionOffset']).toBe(16);
    expect(JSON.stringify(tree.toJSON())).toContain('"scale":1');
    pressIn(tree);
    expect(JSON.stringify(tree.toJSON())).toContain(`"scale":${motion.pressScale}`);
    pressOut(tree);
    expect(JSON.stringify(tree.toJSON())).toContain('"scale":1');

    // SHORTENED, never removed: a control with no feedback reads as broken.
    __setReducedMotion(true);
    const reduced = render(
      <PressableScale onPress={() => {}}>
        <Text>Card</Text>
      </PressableScale>,
    );
    pressIn(reduced);
    const out = JSON.stringify(reduced.toJSON());
    expect(out).toContain(`"scale":${motion.pressScaleReduced}`);
    expect(out).not.toContain(`"scale":${motion.pressScale}`);
  });

  it('is announced as a button and forwards its label, hint and disabled state', () => {
    const out = json(
      <PressableScale
        accessibilityLabel="Build a route by hand"
        accessibilityHint="Opens the builder"
        disabled
      >
        <Text>Build by hand</Text>
      </PressableScale>,
    );
    expect(out).toContain('"accessibilityRole":"button"');
    expect(out).toContain('"accessibilityLabel":"Build a route by hand"');
    expect(out).toContain('"accessibilityHint":"Opens the builder"');
    expect(out).toContain('"disabled":true');
    expect(out).toContain('Build by hand');
  });
});

// ---------------------------------------------------------------------------
// The chapter / shelf primitives (redesign — SPEC "Shell chrome": Chapter,
// LegendKey, StatusScrim, Shelf). Added beside the cases above.
// ---------------------------------------------------------------------------

describe('Chapter', () => {
  it('draws an INDEX rule over a source-case Legend kicker, announced as a header', () => {
    const tree = render(
      <Chapter title="Stops" trailing={<Legend>3</Legend>}>
        <Text>Coffee at the mill</Text>
      </Chapter>,
    );
    const out = JSON.stringify(tree.toJSON());
    // The rule is `Rule weight="index"`: 2pt, the index-rule token — never a
    // hairline, which is deliberately sub-3:1 and would not be seen on device.
    const rule = styleWith(tree, 'height');
    expect(rule?.['height']).toBe(RULE_W.index);
    expect(rule?.['backgroundColor']).toBe(darkColors.borderStrong);
    // Source case in the tree (`textTransform` uppercases it), so the
    // case-sensitive copy assertions on a promoted heading keep passing.
    expect(out).toContain('Stops');
    expect(out).not.toContain('STOPS');
    expect(out).toContain('"accessibilityRole":"header"');
    expect(out).toContain('Coffee at the mill');
    expect(out).toContain('"children":["3"]'); // the trailing slot, beside the kicker
  });
});

describe('LegendKey', () => {
  it('carries a 10pt swatch in the keyed colour beside a source-case Legend', () => {
    const tree = render(<LegendKey color={darkColors.accent}>The drive</LegendKey>);
    const out = JSON.stringify(tree.toJSON());
    const swatch = styleWith(tree, 'borderRadius');
    expect(swatch?.['width']).toBe(SWATCH_SIZE);
    expect(swatch?.['height']).toBe(SWATCH_SIZE);
    expect(swatch?.['backgroundColor']).toBe(darkColors.accent);
    expect(out).toContain('The drive');
    expect(out).not.toContain('THE DRIVE');
    // The dot is decoration: hidden, so the row reads as its label.
    expect(out).toContain('"accessibilityElementsHidden":true');
  });
});

describe('StatusScrim', () => {
  it('is one gradient from the paper at 0.72 to the same hue at 0, the height of the top inset', () => {
    const tree = render(<StatusScrim />);
    const gradient = tree.root.find(ofTag('expo-lineargradient'));
    expect(gradient.props['colors']).toEqual([
      withAlpha(darkColors.bg, STATUS_SCRIM_ALPHA),
      withAlpha(darkColors.bg, 0),
    ]);
    expect(gradient.props['start']).toEqual({ x: 0, y: 0 });
    expect(gradient.props['end']).toEqual({ x: 0, y: 1 });
    // It must never take a touch from the map beneath it.
    expect(gradient.props['pointerEvents']).toBe('none');
    // Insets are zero in node; the height is the inset, whatever it is.
    const s = styleWith(tree, 'height');
    expect(s?.['position']).toBe('absolute');
    expect(s?.['height']).toBe(0);
    // Never the `transparent` keyword: a CAGradientLayer fades to rgba(0,0,0,0)
    // through half-black and paints a grey band mid-fade.
    expect(JSON.stringify(tree.toJSON())).not.toContain('"transparent"');
  });
});

describe('Shelf', () => {
  /** MapHome's three detents at the iPhone 14 Pro size. */
  const DETENTS = { collapsed: 132, half: 409, full: 796 } as const;
  const MAX = DETENTS.full;

  afterEach(() => {
    __resetHaptics();
    __clearMountedGestures();
  });

  function mount(
    props: { onDetent?: (key: string) => void; locked?: boolean; footer?: ReactElement } = {},
    ref?: ReturnType<typeof createRef<ShelfHandle>>,
  ): ReactTestRenderer {
    return render(
      <Shelf
        {...(ref ? { ref } : {})}
        detents={DETENTS}
        initial="collapsed"
        header={<Text>Near you</Text>}
        {...props}
      >
        <Text>Escarpment sweep</Text>
      </Shelf>,
    );
  }

  const translateOf = (tree: ReactTestRenderer): string =>
    JSON.stringify(tree.toJSON()).match(/"translateY":(-?[\d.]+)/)?.[1] ?? 'none';

  /** One finger: land, move, let go. `dy` is screen translation (down +). */
  const drag = (dy: number, velocityY: number): void => {
    const pan = __mountedGesture(SHELF_PAN_TEST_ID);
    act(() => {
      __fireGesture(pan, 'start');
      __fireGesture(pan, 'update', { translationY: dy });
      __fireGesture(pan, 'end', { translationY: dy, velocityY });
      __fireGesture(pan, 'finalize', { translationY: dy, velocityY });
    });
  };

  it('renders a GestureDetector over a Material sheet: header always, body that does not bounce, footer pinned', () => {
    const tree = mount({ footer: <Text>Follow this drive</Text> });
    expect(__mountedGestures().length).toBeGreaterThanOrEqual(1);
    const pan = __mountedGesture(SHELF_PAN_TEST_ID);
    // The recipe's activation offset, and the body's scroll declared simultaneous.
    expect(pan.__config['activeOffsetY']).toEqual([-10, 10]);
    expect(pan.__config['enabled']).toBe(true);
    expect(pan.__config['simultaneousWith']).toHaveLength(1);

    const out = JSON.stringify(tree.toJSON());
    expect(tree.root.findAll(ofTag('expo-blurview'))).toHaveLength(1); // Material role="sheet"
    expect(out).toContain('Near you');
    expect(out).toContain('Escarpment sweep');
    expect(out).toContain('Follow this drive');
    const body = tree.root.find(ofTag('rn-scrollview'));
    expect(body.props['bounces']).toBe(false);
    // Laid out at the TOP detent's height and translated down by what is not
    // visible — transform only, never an animated height.
    expect(translateOf(tree)).toBe(String(MAX - DETENTS.collapsed));
    expect(styleWith(tree, 'height')?.['height']).toBe(MAX);
    // The body pads its bottom by max − committed, so the list end is reachable.
    expect(body.props['contentContainerStyle']).toEqual({
      paddingBottom: MAX - DETENTS.collapsed,
    });
    // Nothing fired on mount: no haptic, no announcement, no entrance.
    expect(__haptics).toEqual([]);
  });

  it('commits a detent through onDetent when driven, with exactly one haptic; a re-catch is silent', () => {
    const onDetent = vi.fn();
    const tree = mount({ onDetent });

    // From collapsed (132): 120 pt up puts y at 252; a 300 pt/s upward flick
    // projects ~150 more → 402 → half. onStart captured 132, onEnd decided.
    drag(-120, -300);
    expect(onDetent).toHaveBeenCalledTimes(1);
    expect(onDetent).toHaveBeenCalledWith('half');
    expect(__haptics).toEqual(['impact:Light']);
    expect(translateOf(tree)).toBe(String(MAX - DETENTS.half));
    expect(tree.root.find(ofTag('rn-scrollview')).props['contentContainerStyle']).toEqual({
      paddingBottom: MAX - DETENTS.half,
    });

    // A small drag that settles back on the same detent changes nothing, so
    // nothing fires: one haptic per CATCH, never per release.
    drag(20, 0);
    expect(onDetent).toHaveBeenCalledTimes(1);
    expect(__haptics).toEqual(['impact:Light']);
    expect(translateOf(tree)).toBe(String(MAX - DETENTS.half));
  });

  it('the release lands where the velocity points, not where the finger let go', () => {
    const onDetent = vi.fn();
    mount({ onDetent });
    // 500 pt up from collapsed → y 632, past the half↔full midpoint (602.5),
    // then flicked DOWN at 400 pt/s: projection carries it back to ~432 → half.
    // Distance alone would have said full.
    drag(-500, 400);
    expect(onDetent).toHaveBeenCalledWith('half');
    expect(__haptics).toHaveLength(1);
  });

  it('snapTo moves programmatically, announces once with one haptic, and refuses an unknown key', () => {
    const onDetent = vi.fn();
    const ref = createRef<ShelfHandle>();
    const tree = mount({ onDetent }, ref);
    act(() => {
      ref.current?.snapTo('full');
    });
    expect(onDetent).toHaveBeenCalledTimes(1);
    expect(onDetent).toHaveBeenCalledWith('full');
    expect(__haptics).toEqual(['impact:Light']);
    expect(translateOf(tree)).toBe('0');
    // Asked for the detent it is already on: nothing new happened.
    act(() => {
      ref.current?.snapTo('full');
    });
    expect(onDetent).toHaveBeenCalledTimes(1);
    expect(__haptics).toHaveLength(1);
    // The settle spring lands the same way (Builder's route-landed rise).
    act(() => {
      ref.current?.snapTo('half', { settle: true });
    });
    expect(onDetent).toHaveBeenLastCalledWith('half');
    expect(translateOf(tree)).toBe(String(MAX - DETENTS.half));
    expect(() => ref.current?.snapTo('nope')).toThrow(/not a key/);
  });

  it('a SILENT snapTo still announces, but plays no haptic (no finger caused it)', () => {
    // The impact is feedback for a move the user made. Builder's sheet rises
    // because a routing result landed — an entrance nobody asked for on that
    // frame — so it passes `silent` (SPEC haptics policy: "one per user
    // action … nothing on entrances"; expo-animation section 8).
    const onDetent = vi.fn();
    const ref = createRef<ShelfHandle>();
    const tree = mount({ onDetent }, ref);
    act(() => {
      ref.current?.snapTo('full', { settle: true, silent: true });
    });
    expect(onDetent).toHaveBeenCalledTimes(1);
    expect(onDetent).toHaveBeenCalledWith('full');
    expect(translateOf(tree)).toBe('0'); // it still MOVED
    expect(__haptics).toEqual([]); // …and said nothing
  });

  it('locked disables the pan, and an initial that is not a detent throws in dev', () => {
    mount({ locked: true });
    expect(__mountedGesture(SHELF_PAN_TEST_ID).__config['enabled']).toBe(false);
    expect(() =>
      render(
        <Shelf detents={DETENTS} initial="nope" header={<Text>h</Text>}>
          <Text>b</Text>
        </Shelf>,
      ),
    ).toThrow(/not a key/);
  });
});
