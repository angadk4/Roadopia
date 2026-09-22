/**
 * The four small expo stubs (BD-204 redesign): expo-haptics, expo-blur,
 * expo-linear-gradient, expo-symbols.
 *
 * The four libraries are imported by PACKAGE NAME, which is what proves their
 * aliases in app/vitest.config.ts resolve (each real module requires a native
 * view or module at import and throws in node). It also means this file
 * type-checks against the REAL types — tsc resolves the real packages, only
 * vitest sees the stubs — so the deliberately-bad props below are widened
 * through the real prop types, the way the guard would meet them. The two
 * `__` hooks come from the stub's own path (the real types do not declare
 * them) and act on the same module instance the alias resolves to.
 *
 * These tests pin the one property the whole suite depends on: a host element
 * built by a stub never carries a prop that JSON.stringify cannot take, even
 * when the app hands it an Animated value or a ref whose `current` is cyclic.
 * They also pin the haptics recorder, because the one-haptic-per-commit rule
 * is asserted by count.
 */

import { BlurView, type BlurViewProps } from 'expo-blur';
import {
  AndroidHaptics,
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  impactAsync,
  notificationAsync,
  performAndroidHapticsAsync,
  selectionAsync,
} from 'expo-haptics';
import { LinearGradient, type LinearGradientProps } from 'expo-linear-gradient';
import {
  SymbolView,
  unstable_getMaterialSymbolSourceAsync,
  type SymbolViewProps,
} from 'expo-symbols';
import { act, type ReactElement } from 'react';
import { Animated, Text, type ViewStyle } from 'react-native';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { __haptics, __resetHaptics } from '../expo-haptics-stub';

function render(node: ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
}

const textOf = (tree: ReactTestRenderer): string => JSON.stringify(tree.toJSON());

/** Matches a stub's host element by tag. A predicate rather than
 *  `findByType`, whose parameter is React's `ElementType` — DOM tag names
 *  only under strict TS, so a stub's own tag would not type-check (and a bare
 *  literal in `n.type === 'rn-text'` is rejected as a no-overlap comparison;
 *  the `string`-typed parameter here is what makes it legal). */
const ofTag =
  (tag: string) =>
  (n: ReactTestInstance): boolean =>
    n.type === tag;

/** The one host element of a stub's tag in the whole tree. */
const host = (tree: ReactTestRenderer, tag: string): ReactTestInstance =>
  tree.root.find(ofTag(tag));

/** A class instance whose graph loops back on itself — what a ref's `current`
 *  or an unresolved animated node looks like to JSON.stringify. */
class Cyclic {
  self: Cyclic;
  constructor() {
    this.self = this;
  }
}

describe('expo-blur / expo-linear-gradient / expo-symbols stubs', () => {
  it('renders BlurView > LinearGradient > SymbolView and serialises without throwing', () => {
    const tree = render(
      <BlurView intensity={40} tint="systemChromeMaterial" style={{ padding: 8 }}>
        <LinearGradient
          colors={['#000000', 'transparent']}
          locations={[0, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ flex: 1 }}
        >
          <SymbolView
            name="chevron.forward"
            size={20}
            tintColor="#ffffff"
            weight="semibold"
            scale="medium"
            type="monochrome"
            animationSpec={{ effect: { type: 'bounce' } }}
            style={{ opacity: 1 }}
            fallback={<Text>fallback glyph</Text>}
          />
        </LinearGradient>
      </BlurView>,
    );

    const text = textOf(tree);
    expect(text).toContain('"type":"expo-blurview"');
    expect(text).toContain('"type":"expo-lineargradient"');
    expect(text).toContain('"type":"expo-symbol"');

    // Blur: the asked-for props are forwarded as plain values.
    const blur = host(tree, 'expo-blurview');
    expect(blur.props['intensity']).toBe(40);
    expect(blur.props['tint']).toBe('systemChromeMaterial');
    expect(blur.props['style']).toEqual({ padding: 8 });

    // Gradient: stops and points are forwarded untouched.
    const gradient = host(tree, 'expo-lineargradient');
    expect(gradient.props['colors']).toEqual(['#000000', 'transparent']);
    expect(gradient.props['locations']).toEqual([0, 1]);
    expect(gradient.props['start']).toEqual({ x: 0, y: 0 });
    expect(gradient.props['end']).toEqual({ x: 0, y: 1 });

    // Symbol: the name lives under `symbolName`, the fallback is a CHILD.
    const symbol = host(tree, 'expo-symbol');
    expect(symbol.props['symbolName']).toBe('chevron.forward');
    expect(symbol.props['name']).toBeUndefined();
    expect(symbol.props['fallback']).toBeUndefined();
    expect(symbol.props['size']).toBe(20);
    expect(symbol.props['weight']).toBe('semibold');
    expect(symbol.props['animationSpec']).toEqual({ effect: { type: 'bounce' } });
    expect(symbol.find(ofTag('rn-text')).children).toEqual(['fallback glyph']);
    // …and, as the header says, the name IS in the serialised tree.
    expect(text).toContain('chevron.forward');
  });

  it('resolves a platform-object symbol name iOS-first', () => {
    const tree = render(<SymbolView name={{ ios: 'chevron.forward', android: 'chevron_right' }} />);
    expect(host(tree, 'expo-symbol').props['symbolName']).toBe('chevron.forward');

    const androidOnly = render(<SymbolView name={{ android: 'chevron_right' }} />);
    expect(host(androidOnly, 'expo-symbol').props['symbolName']).toBe('chevron_right');
  });

  it('resolves rn-stub Animated values to their current number before the host element', () => {
    const intensity = new Animated.Value(30);
    const opacity = new Animated.Value(0.5);
    // The casts feed the guard what rn-stub's createAnimatedComponent would
    // let through (it returns the component unchanged): an Animated.Value
    // where the real prop types want a number.
    const animatedStyle = { opacity } as unknown as ViewStyle;
    const tree = render(
      <BlurView intensity={intensity as unknown as number}>
        <LinearGradient colors={['#000', '#fff']} style={animatedStyle}>
          <SymbolView name="star" style={[animatedStyle, { margin: 2 }]} />
        </LinearGradient>
      </BlurView>,
    );
    expect(() => textOf(tree)).not.toThrow();
    expect(host(tree, 'expo-blurview').props['intensity']).toBe(30);
    expect(host(tree, 'expo-lineargradient').props['style']).toEqual({ opacity: 0.5 });
    expect(host(tree, 'expo-symbol').props['style']).toEqual([{ opacity: 0.5 }, { margin: 2 }]);
  });

  it('drops refs and non-plain objects so a cyclic prop cannot poison the suite', () => {
    const cyclic = new Cyclic();
    // Widened on purpose: the real prop types would refuse every one of these,
    // which is exactly why the guard must not rely on the type system.
    const evilBlur = {
      blurTarget: { current: cyclic },
      ref: { current: cyclic },
      decoration: cyclic,
    } as unknown as BlurViewProps;
    const evilGradient = { nested: { inner: cyclic, keep: 'yes' } } as unknown as Omit<
      LinearGradientProps,
      'colors'
    >;
    const evilSymbol = { element: <Text>x</Text> } as unknown as Omit<SymbolViewProps, 'name'>;
    const tree = render(
      <BlurView {...evilBlur} testID="bar" onLayout={() => undefined}>
        <LinearGradient colors={['#000', '#fff']} {...evilGradient}>
          <SymbolView name="star" fallback={null} {...evilSymbol} />
        </LinearGradient>
      </BlurView>,
    );
    expect(() => textOf(tree)).not.toThrow();

    const blur = host(tree, 'expo-blurview');
    expect(blur.props['blurTarget']).toBeUndefined();
    expect(blur.props['decoration']).toBeUndefined();
    expect(blur.props['testID']).toBe('bar'); // plain props still forwarded
    expect(typeof blur.props['onLayout']).toBe('function'); // functions kept; stringify drops them

    const gradient = host(tree, 'expo-lineargradient');
    expect(gradient.props['nested']).toEqual({ keep: 'yes' }); // walked, the cycle removed

    const symbol = host(tree, 'expo-symbol');
    expect(symbol.props['element']).toBeUndefined(); // a stray element is dropped, not serialised
  });

  it('unstable_getMaterialSymbolSourceAsync resolves null (no font in node)', async () => {
    // One argument: tsc reads the package's iOS declaration (`moduleSuffixes:
    // ['.ios', '']`, the redesign's platform split), whose signature takes only
    // the symbol; the Android one takes size and colour too. The stub ignores
    // both and answers null either way — the assertion is unchanged.
    await expect(unstable_getMaterialSymbolSourceAsync('chevron_right')).resolves.toBe(null);
  });
});

describe('expo-haptics stub', () => {
  afterEach(() => {
    __resetHaptics();
  });

  it('records impactAsync(Light) by member name', async () => {
    await impactAsync(ImpactFeedbackStyle.Light);
    expect(__haptics).toEqual(['impact:Light']);
  });

  it('records every kind, in order, and counts each call once', async () => {
    await selectionAsync();
    await notificationAsync(NotificationFeedbackType.Success);
    await performAndroidHapticsAsync(AndroidHaptics.Confirm);
    await impactAsync(); // bare call → the real default, Medium
    await notificationAsync(); // bare call → the real default, Success
    expect(__haptics).toEqual([
      'selection',
      'notification:Success',
      'android:Confirm',
      'impact:Medium',
      'notification:Success',
    ]);
    expect(__haptics).toHaveLength(5);
  });

  it('every call resolves void', async () => {
    await expect(impactAsync(ImpactFeedbackStyle.Heavy)).resolves.toBeUndefined();
    await expect(notificationAsync(NotificationFeedbackType.Error)).resolves.toBeUndefined();
    await expect(selectionAsync()).resolves.toBeUndefined();
    await expect(performAndroidHapticsAsync(AndroidHaptics.Segment_Tick)).resolves.toBeUndefined();
  });

  it('__resetHaptics empties the log in place (the imported binding stays live)', async () => {
    await impactAsync(ImpactFeedbackStyle.Rigid);
    expect(__haptics).toHaveLength(1);
    __resetHaptics();
    expect(__haptics).toHaveLength(0);
  });

  it('enum values are the real native strings, so production comparisons hold', () => {
    expect(ImpactFeedbackStyle.Light).toBe('light');
    expect(ImpactFeedbackStyle.Soft).toBe('soft');
    expect(NotificationFeedbackType.Warning).toBe('warning');
    expect(AndroidHaptics.Segment_Frequent_Tick).toBe('segment-frequent-tick');
    expect(Object.keys(AndroidHaptics)).toHaveLength(19);
  });
});
