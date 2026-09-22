/**
 * Proof that reanimated-stub / worklets-stub keep the suite's one invariant:
 * a screen built on shared values, animated styles, entering/exiting/layout
 * builders and CSS transition keys renders through react-test-renderer to a
 * tree that `JSON.stringify` can serialise, with every animated value already
 * a plain number and no builder in any host prop.
 *
 * NOTE: the library members are imported by PACKAGE NAME — 'react-native-
 * reanimated' and 'react-native-worklets' — because that is what proves the
 * aliases in app/vitest.config.ts resolve: the real modules throw at import in
 * node (worklets runtime), so this file running at all means the alias table
 * works. It also means the code below type-checks against the REAL types (tsc
 * resolves the real packages; only vitest sees the stubs), which is the same
 * contract every screen lives under. Only the test-only `__` hook comes from
 * the stub's own path, since the real types do not declare it; it acts on the
 * SAME module instance the alias resolves to, and the reduced-motion test
 * below is what pins that.
 */

import { act, type ReactElement } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  css,
  cubicBezier,
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolate,
  interpolateColor,
  isSharedValue,
  KeyboardState,
  LinearTransition,
  ReduceMotion,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  createWorkletRuntime,
  isWorkletFunction,
  runOnJS,
  scheduleOnRN,
  scheduleOnUI,
} from 'react-native-worklets';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { __setReducedMotion } from '../reanimated-stub';

function render(node: ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
}

const textOf = (tree: ReactTestRenderer): string => JSON.stringify(tree.toJSON());

/** The redesign's card shape: spring-driven style, entering/exiting/layout
 *  builders, and a CSS transition on the same element. */
function Card({ open }: { open: boolean }): ReactElement {
  const progress = useSharedValue(0);
  progress.value = withSpring(open ? 1 : 0);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.get(), [0, 1], [0.92, 1]) }],
  }));
  return (
    <Animated.View
      entering={FadeIn.duration(200).springify()}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition}
      style={[
        style,
        {
          transitionProperty: 'opacity',
          transitionDuration: 200,
          transitionTimingFunction: cubicBezier(0.2, 0, 0, 1),
        },
      ]}
      testID="card"
    >
      <Animated.Text>Ready</Animated.Text>
    </Animated.View>
  );
}

describe('reanimated-stub: serialisation safety', () => {
  it('renders spring + animated style + builders + CSS transition to plain JSON', () => {
    const tree = render(<Card open />);
    // The assertion that matters: this line throwing is the whole suite dying.
    const text = textOf(tree);
    // The committed end value of withSpring(1) reached the host as a number.
    expect(text).toContain('"opacity":1');
    expect(text).toContain('"scale":1');
    // No builder reached the host.
    expect(text).not.toContain('"entering"');
    expect(text).not.toContain('"exiting"');
    expect(text).not.toContain('"layout"');
    expect(text).not.toContain('presetName');
    // CSS keys passed through as the plain values they are.
    expect(text).toContain('"transitionProperty":"opacity"');
    expect(text).toContain('"x1":0.2');
    expect(text).toContain('Ready');
  });

  it('closed state resolves to the other end of the ranges', () => {
    const text = textOf(render(<Card open={false} />));
    expect(text).toContain('"opacity":0');
    expect(text).toContain('"scale":0.92');
  });

  it('renders the SAME host tags rn-stub renders', () => {
    const tree = render(<Card open />);
    expect(tree.root.findAll((n) => String(n.type) === 'rn-view')).toHaveLength(1);
    expect(tree.root.findAll((n) => String(n.type) === 'rn-text')).toHaveLength(1);
  });

  it('resolves shared and derived values placed INLINE in a style tree', () => {
    function Inline(): ReactElement {
      const width = useSharedValue(42);
      const height = useDerivedValue(() => width.value * 2);
      return <Animated.View style={{ width, height, transform: [{ translateY: width }] }} />;
    }
    const text = textOf(render(<Inline />));
    expect(text).toContain('"width":42');
    expect(text).toContain('"height":84');
    expect(text).toContain('"translateY":42');
    expect(text).not.toContain('"v":');
  });

  it('keyframes are plain data on the host', () => {
    function Pulse(): ReactElement {
      const pulse = css.keyframes({ from: { opacity: 0.4 }, to: { opacity: 1 } });
      return (
        <Animated.View
          style={{
            animationName: pulse,
            animationDuration: '600ms',
            animationIterationCount: 'infinite',
          }}
        />
      );
    }
    const text = textOf(render(<Pulse />));
    expect(text).toContain('"from":{"opacity":0.4}');
    expect(text).toContain('"animationIterationCount":"infinite"');
  });

  it('enforces the bare-text invariant on animated views, like rn-stub', () => {
    expect(() => render(<Animated.View>{'loose text'}</Animated.View>)).toThrow(
      /RN text invariant/,
    );
  });

  it('FlatList renders items through renderItem and strips data from the host', () => {
    const tree = render(
      <Animated.FlatList
        data={[
          { id: 'a', label: 'First drive' },
          { id: 'b', label: 'Second drive' },
        ]}
        keyExtractor={(item) => (item as { id: string }).id}
        renderItem={({ item }) => (
          <Animated.Text>{(item as { label: string }).label}</Animated.Text>
        )}
        ListHeaderComponent={<Animated.Text>Header</Animated.Text>}
        ListEmptyComponent={<Animated.Text>Nothing yet</Animated.Text>}
        itemLayoutAnimation={LinearTransition}
      />,
    );
    const text = textOf(tree);
    expect(text).toContain('First drive');
    expect(text).toContain('Second drive');
    expect(text).toContain('Header');
    expect(text).not.toContain('Nothing yet');
    expect(text).not.toContain('"data"');
    expect(text).not.toContain('presetName');
    expect(tree.root.findAll((n) => String(n.type) === 'rn-flatlist')).toHaveLength(1);
  });
});

describe('reanimated-stub: values and animations', () => {
  it('shared values expose value/get/set including the updater form', () => {
    function Probe(): ReactElement {
      const sv = useSharedValue(1);
      sv.set((prev) => prev + 1);
      sv.value = withTiming(sv.get() + 10);
      expect(isSharedValue(sv)).toBe(true);
      return <Animated.View style={{ width: sv }} />;
    }
    expect(textOf(render(<Probe />))).toContain('"width":12');
  });

  it('animation helpers return the committed end value and fire callbacks at once', () => {
    const seen: Array<[boolean | undefined, unknown]> = [];
    expect(withTiming(5, { duration: 300 }, (f, c) => seen.push([f, c]))).toBe(5);
    expect(withSpring(7, undefined, (f, c) => seen.push([f, c]))).toBe(7);
    expect(withDelay(100, withTiming(3))).toBe(3);
    expect(withRepeat(withTiming(9), -1, true)).toBe(9);
    expect(withSequence(withTiming(1), withTiming(2), withTiming(4))).toBe(4);
    expect(withSequence(ReduceMotion.Never, withTiming(1), withTiming(2))).toBe(2);
    expect(seen).toEqual([
      [true, 5],
      [true, 7],
    ]);
  });

  it('interpolate is real piecewise-linear maths with extrapolation modes', () => {
    expect(interpolate(0.5, [0, 1], [0, 100])).toBe(50);
    expect(interpolate(1.5, [0, 1, 2], [0, 10, 30])).toBe(20);
    expect(interpolate(2, [0, 1], [0, 100])).toBe(200);
    expect(interpolate(2, [0, 1], [0, 100], Extrapolation.CLAMP)).toBe(100);
    expect(interpolate(-1, [0, 1], [0, 100], { extrapolateLeft: 'clamp' })).toBe(0);
    expect(interpolate(2, [0, 1], [0, 100], 'identity')).toBe(2);
  });

  it('interpolateColor returns the stop colour at an exact stop, else the first', () => {
    expect(interpolateColor(0, [0, 1], ['#000', '#fff'])).toBe('#000');
    expect(interpolateColor(1, [0, 1], ['#000', '#fff'])).toBe('#fff');
    expect(interpolateColor(0.3, [0, 1], ['#000', '#fff'])).toBe('#000');
  });

  it('layout builders chain every modifier and build to a function', () => {
    const built = FadeIn.duration(1)
      .delay(2)
      .springify()
      .damping(3)
      .stiffness(4)
      .mass(5)
      .easing(Easing.out(Easing.quad))
      .withInitialValues({ opacity: 0 })
      .withCallback(() => undefined)
      .reduceMotion(ReduceMotion.Never);
    expect(typeof built.build()).toBe('function');
    // Cycle-free even unresolved: methods hold the self-reference, props do
    // not — and `presetName` is the only own data (the real type does not
    // declare it, so it is read through JSON rather than as a property).
    expect(JSON.stringify(built)).toBe('{"presetName":"FadeIn"}');
  });

  it('Easing members are identity or return identity, in the real shapes', () => {
    expect(Easing.linear(0.3)).toBe(0.3);
    // The real `bezier` returns `{ factory }`; `bezierFn` returns the curve.
    expect(Easing.bezier(0.2, 0, 0, 1).factory()(0.3)).toBe(0.3);
    expect(Easing.bezierFn(0.2, 0, 0, 1)(0.3)).toBe(0.3);
    expect(Easing.inOut(Easing.cubic)(0.9)).toBe(0.9);
  });

  it('keyboard hook hands back shared values at rest', () => {
    let state: KeyboardState | undefined;
    function Probe(): ReactElement {
      const kb = useAnimatedKeyboard();
      state = kb.state.value;
      return <Animated.View style={{ height: kb.height }} />;
    }
    const text = textOf(render(<Probe />));
    expect(text).toContain('"height":0');
    expect(state).toBe(KeyboardState.UNKNOWN);
  });
});

describe('reanimated-stub: reduced motion switch', () => {
  afterEach(() => {
    // Module state shared by every test in this file: always restore.
    __setReducedMotion(false);
  });

  it('useReducedMotion reads the switch', () => {
    const seen: boolean[] = [];
    function Probe(): ReactElement {
      seen.push(useReducedMotion());
      return <Animated.View />;
    }
    render(<Probe />);
    __setReducedMotion(true);
    render(<Probe />);
    expect(seen).toEqual([false, true]);
  });
});

describe('worklets-stub', () => {
  it('scheduleOnRN / scheduleOnUI call synchronously with their arguments', () => {
    const calls: Array<[string, number]> = [];
    const result = scheduleOnRN((a: string, b: number) => calls.push([a, b]), 'x', 1);
    scheduleOnUI((a: string, b: number) => calls.push([a, b]), 'y', 2);
    expect(result).toBeUndefined();
    expect(calls).toEqual([
      ['x', 1],
      ['y', 2],
    ]);
  });

  it('runOnJS returns the function; runtime helpers are inert', () => {
    const fn = (n: number): number => n * 2;
    expect(runOnJS(fn)).toBe(fn);
    expect(createWorkletRuntime()).toEqual({});
    expect(isWorkletFunction(fn)).toBe(false);
  });
});

/**
 * createAnimatedComponent is a WRAPPER, not an identity.
 *
 * The Phase 0 probe found the one hole an identity left: on a custom animated
 * pressable, `entering={FadeInDown}` reached the host and serialised as
 * `{"presetName":"FadeInDown"}` — plain data, but four suites assert
 * `not.toContain('down')` on the serialised tree, so a screen animating a
 * custom pressable with a *Down preset would go red for a reason invisible in
 * its own code. The wrapper applies the Animated.View contract to whatever was
 * wrapped: builders stripped, shared values in `style` resolved.
 */
describe('createAnimatedComponent', () => {
  const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

  function Custom(): ReactElement {
    const lift = useSharedValue(0);
    lift.set(withSpring(-6));
    return (
      <AnimatedPressable
        entering={FadeInDown.duration(200)}
        exiting={FadeOut}
        layout={LinearTransition}
        // inline shared value, not via useAnimatedStyle — the hardest case
        style={[{ opacity: 1 }, { transform: [{ translateY: lift }] }]}
        onPress={() => undefined}
      >
        <Animated.Text>Pressable copy</Animated.Text>
      </AnimatedPressable>
    );
  }

  it('strips builders and resolves inline shared values on a wrapped component', () => {
    const tree = render(<Custom />);
    const json = JSON.stringify(tree.toJSON());
    // the tripwire the whole exercise protects
    expect(json).not.toContain('down');
    expect(json).not.toContain('presetName');
    expect(json).not.toContain('entering');
    // the inline shared value became its committed number, not {"v":…}
    expect(json).toContain('"translateY":-6');
    expect(json).not.toContain('"v":');
    // the wrapped component still rendered its own host and its copy
    expect(json).toContain('rn-pressable');
    expect(json).toContain('Pressable copy');
  });
});
