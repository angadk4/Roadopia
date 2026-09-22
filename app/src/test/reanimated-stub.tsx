/**
 * Node-safe stand-in for 'react-native-reanimated' 4.2.1 (vitest alias — iOS-grade
 * redesign).
 *
 * WHY IT EXISTS. The real module cannot be imported in node at all: its entry
 * initialises the worklets runtime (react-native-worklets reads NativeModules and
 * installs the UI runtime at module scope) and throws before a single export
 * exists. One `Animated.View` in a tested screen would take all 43 test files
 * down before an assertion ran.
 *
 * THE ONE CONSTRAINT THIS FILE HOLDS. Every screen test asserts with substring
 * matching over `JSON.stringify(tree.toJSON())`, and react-test-renderer
 * serialises HOST ELEMENT PROPS. The real library's shared values carry listener
 * maps and mutable back-references, its layout-animation builders are class
 * instances with chained state, and its animated styles are handles onto view
 * descriptors — any one of those reaching a host element turns the whole suite
 * into "Converting circular structure to JSON". So this stub RESOLVES before it
 * renders, on the same rule rn-stub's `resolveAnimated` uses for RN's Animated:
 *   - shared / derived values anywhere in a style tree become their current plain
 *     value (arrays and nested objects recursed);
 *   - `entering` / `exiting` / `layout` / `animatedProps` / `sharedTransitionTag`
 *     / `sharedTransitionStyle` are STRIPPED before createElement — a builder
 *     never reaches a host;
 *   - `createAnimatedComponent` is a WRAPPER that applies the same contract
 *     (strip builders, resolve `style` and `animatedProps`, forward the ref) to
 *     whatever was wrapped — it was an identity in the first cut, which let
 *     `entering={FadeInDown}` on a custom pressable reach the host as
 *     `{"presetName":"FadeInDown"}` and trip the `not.toContain('down')` suites;
 *   - as a last line of defence, a shared value is a plain class with ONE
 *     private field and no parents/children graph, and a layout builder is a
 *     plain object whose methods return it (a closure reference, not a
 *     property), so even one that somehow leaked would serialise as flat data
 *     rather than a cycle. Functions are dropped by JSON.stringify, which is
 *     why `onPress`-style props are fine as they are.
 *
 * WHAT IT DELIBERATELY DOES NOT EMULATE (device-only). Timelines. `withTiming` /
 * `withSpring` / `withDelay` / `withRepeat` / `withSequence` return the COMMITTED
 * END VALUE synchronously (mirroring rn-stub's `completed()`) and fire their
 * callback at once, so a render smoke test sees the settled state. No frames, no
 * easing curves, no scroll / gesture / keyboard events, no layout-transition
 * geometry, no CSS transition or keyframe PLAYBACK (those style keys pass through
 * untouched as the plain values they already are). Motion is an on-device check.
 *
 * Host tags are rn-view / rn-text / rn-scrollview / rn-image — the SAME tags
 * rn-stub renders — so a test's `findAll(n => n.type === 'rn-view')` sees
 * animated and plain views alike. Animated.FlatList renders `rn-flatlist`
 * (rn-stub has no FlatList) and runs `renderItem` over `data` so item content
 * is assertable.
 *
 * Import shape mirrors the real index: `Animated` is the DEFAULT export (with
 * .View .Text .ScrollView .Image .FlatList .createAnimatedComponent); hooks,
 * animation functions, builders, enums and the `css` helpers are NAMED exports.
 * Production code type-checks against the real package (tsconfig resolves the
 * real types); this file only has to be strict about itself and match the
 * runtime shape under the vitest alias.
 */

import {
  createElement,
  forwardRef,
  Fragment,
  isValidElement,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

export type DependencyList = ReadonlyArray<unknown> | undefined | null;

// --- Bare-text invariant (same rule as rn-stub) --------------------------

function assertNoBareText(tag: string, children: ReactNode): void {
  // Mirror RN's invariant: raw strings/numbers may only sit inside <Text>.
  // On device this crashes ("Text strings must be rendered within a <Text>");
  // making it throw here turns that crash class into a CI failure.
  if (tag === 'rn-text') return;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'string' && child.trim() !== '') {
      throw new Error(`RN text invariant: bare string "${child}" inside <${tag}>`);
    }
    if (typeof child === 'number') {
      throw new Error(`RN text invariant: bare number ${child} inside <${tag}>`);
    }
  }
}

// --- Enums (plain `as const` objects, like rn-stub's Platform/LayoutAnimation) --

export const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' } as const;
export type ReduceMotion = (typeof ReduceMotion)[keyof typeof ReduceMotion];

export const KeyboardState = { UNKNOWN: 0, OPENING: 1, OPEN: 2, CLOSING: 3, CLOSED: 4 } as const;
export type KeyboardState = (typeof KeyboardState)[keyof typeof KeyboardState];

export const Extrapolation = { IDENTITY: 'identity', CLAMP: 'clamp', EXTEND: 'extend' } as const;
export type Extrapolation = (typeof Extrapolation)[keyof typeof Extrapolation];
/** @deprecated alias the real index still ships. */
export const Extrapolate = Extrapolation;

export const ColorSpace = { RGB: 0, HSV: 1, LAB: 2 } as const;
export type ColorSpace = (typeof ColorSpace)[keyof typeof ColorSpace];

export const ReanimatedLogLevel = { warn: 1, error: 2 } as const;
export type ReanimatedLogLevel = (typeof ReanimatedLogLevel)[keyof typeof ReanimatedLogLevel];

// --- Shared values ---------------------------------------------------------
// A shared value is ONE private field behind get/set and a `value` accessor.
// The real one keeps `_value`, listener maps and (on the UI side) a mutable
// graph; that graph is what makes it circular. This has no such edges, so even
// if one leaks past the resolver it serialises as `{"v":…}`.

export interface SharedValue<Value = unknown> {
  value: Value;
  get(): Value;
  set(value: Value | ((value: Value) => Value)): void;
  addListener(listenerID: number, listener: (value: Value) => void): void;
  removeListener(listenerID: number): void;
  modify(modifier?: (value: Value) => Value, forceUpdate?: boolean): void;
}

export interface DerivedValue<Value = unknown> extends Readonly<Omit<SharedValue<Value>, 'set'>> {
  /** Deprecated on the real type too (derived values are read-only). */
  set: SharedValue<Value>['set'];
}

class SharedValueImpl<Value> implements SharedValue<Value> {
  private v: Value;
  constructor(initial: Value) {
    this.v = initial;
  }
  get value(): Value {
    return this.v;
  }
  set value(next: Value) {
    this.v = next;
  }
  get(): Value {
    return this.v;
  }
  set(next: Value | ((value: Value) => Value)): void {
    this.v = typeof next === 'function' ? (next as (value: Value) => Value)(this.v) : next;
  }
  /** Listeners never fire: nothing in node changes a value asynchronously. */
  addListener(): void {}
  removeListener(): void {}
  modify(modifier?: (value: Value) => Value): void {
    if (modifier) this.v = modifier(this.v);
  }
}

class DerivedValueImpl<Value> implements DerivedValue<Value> {
  private compute: () => Value;
  constructor(compute: () => Value) {
    this.compute = compute;
  }
  /** Re-pointed every render so the latest closure is what a read sees. */
  __setCompute(compute: () => Value): void {
    this.compute = compute;
  }
  get value(): Value {
    return this.compute();
  }
  get(): Value {
    return this.compute();
  }
  set(): void {}
  addListener(): void {}
  removeListener(): void {}
  modify(): void {}
}

export function isSharedValue<Value = unknown>(value: unknown): value is SharedValue<Value> {
  return value instanceof SharedValueImpl || value instanceof DerivedValueImpl;
}

/** Module-level shared value (the real core export). */
export function makeMutable<Value>(initial: Value): SharedValue<Value> {
  return new SharedValueImpl(initial);
}

/** Replace every shared / derived value in a style tree with its current
 *  plain value. Arrays and nested objects (transform lists, shadow offsets)
 *  are recursed; everything else passes through as-is. */
function resolveShared(style: unknown): unknown {
  if (isSharedValue(style)) return resolveShared(style.get());
  if (Array.isArray(style)) return style.map(resolveShared);
  if (typeof style === 'object' && style !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
      out[k] = resolveShared(v);
    }
    return out;
  }
  return style;
}

// --- Hooks -------------------------------------------------------------------

export function useSharedValue<Value>(initialValue: Value): SharedValue<Value> {
  const [sv] = useState(() => new SharedValueImpl(initialValue));
  return sv;
}

export function useDerivedValue<Value>(updater: () => Value): DerivedValue<Value> {
  const [dv] = useState(() => new DerivedValueImpl(updater));
  dv.__setCompute(updater);
  return dv;
}

/** Calls the updater once per render and returns its result with every shared
 *  value READ already a plain number (the updater reads `sv.value` / `sv.get()`
 *  inside, which are plain on this stub) — and, belt and braces, with any shared
 *  value placed in the result unresolved run through the resolver too. */
export function useAnimatedStyle<Style extends object>(updater: () => Style): Style {
  return resolveShared(updater()) as Style;
}

export function useAnimatedProps<Props extends object>(
  updater: () => Partial<Props>,
): Partial<Props> {
  return resolveShared(updater()) as Partial<Props>;
}

/** Reactions run on the UI thread when a shared value changes; nothing changes
 *  a value asynchronously in node, so this is a no-op (not even a first fire —
 *  a reaction that setState'd during a smoke render would only add noise). */
export function useAnimatedReaction<Prepared>(
  prepare: () => Prepared,
  react: (prepared: Prepared, previous: Prepared | null) => void,
): void {
  void prepare;
  void react;
}

export function useAnimatedRef<T = unknown>(): RefObject<T | null> {
  return useRef<T | null>(null);
}

const noopHandler = (): void => undefined;

/** Scroll events are not emulated: returns a stable no-op the screen can hand
 *  to `onScroll`. A test that needs scroll-driven state drives it directly. */
export function useAnimatedScrollHandler(): () => void {
  return noopHandler;
}

export interface AnimatedKeyboardInfo {
  height: SharedValue<number>;
  state: SharedValue<KeyboardState>;
}

export function useAnimatedKeyboard(): AnimatedKeyboardInfo {
  const [info] = useState<AnimatedKeyboardInfo>(() => ({
    height: new SharedValueImpl(0),
    state: new SharedValueImpl<KeyboardState>(KeyboardState.UNKNOWN),
  }));
  return info;
}

export function useScrollOffset(
  animatedRef: unknown,
  providedOffset?: SharedValue<number>,
): SharedValue<number> {
  void animatedRef;
  const [own] = useState(() => new SharedValueImpl(0));
  return providedOffset ?? own;
}
/** @deprecated alias the real index still ships. */
export const useScrollViewOffset = useScrollOffset;

export interface FrameCallback {
  setActive: (isActive: boolean) => void;
  isActive: boolean;
  callbackId: number;
}

/** No frames tick in node; the callback never runs. */
export function useFrameCallback(): FrameCallback {
  return { setActive: () => undefined, isActive: false, callbackId: 0 };
}

/** Reduce Motion is SWITCHABLE for the same reason rn-stub's
 *  `AccessibilityInfo` flag is: a flag that only ever reads `false` cannot
 *  observe the defect where an entrance runs at full duration with the OS
 *  switch ON. A test that turns it on restores it in a finally/afterEach —
 *  it is module state shared by every test in the same file. This flag is
 *  independent of rn-stub's `__setReduceMotion` (stubs do not import each
 *  other); a test exercising both paths sets both. */
let __reducedMotion = false;

export function __setReducedMotion(value: boolean): void {
  __reducedMotion = value;
}

export function useReducedMotion(): boolean {
  return __reducedMotion;
}

// --- Animations: resolve to the committed end value ---------------------------
// Assigning `sv.value = withSpring(1)` therefore stores the plain number 1, which
// is exactly what a render smoke test wants to see in the serialised style.

export type AnimationCallback = (finished?: boolean, current?: unknown) => void;

export interface WithTimingConfig {
  duration?: number;
  reduceMotion?: ReduceMotion;
  easing?: EasingFunction | EasingFunctionFactory;
}

export interface WithSpringConfig {
  mass?: number;
  damping?: number;
  stiffness?: number;
  duration?: number;
  dampingRatio?: number;
  velocity?: number;
  overshootClamping?: boolean;
  energyThreshold?: number;
  reduceMotion?: ReduceMotion;
  clamp?: { min?: number; max?: number };
}

export function withTiming<T>(
  toValue: T,
  config?: WithTimingConfig,
  callback?: AnimationCallback,
): T {
  void config;
  callback?.(true, toValue);
  return toValue;
}

export function withSpring<T>(
  toValue: T,
  config?: WithSpringConfig,
  callback?: AnimationCallback,
): T {
  void config;
  callback?.(true, toValue);
  return toValue;
}

export function withDelay<T>(delayMs: number, delayedAnimation: T): T {
  void delayMs;
  return delayedAnimation;
}

/** Settles at the animation's target. On device an even number of REVERSED
 *  repetitions would end where it started; that start is unknown here, and an
 *  infinite repeat (-1) never finishes at all — both settle at the target. */
export function withRepeat<T>(
  animation: T,
  numberOfReps?: number,
  reverse?: boolean,
  callback?: AnimationCallback,
): T {
  void numberOfReps;
  void reverse;
  callback?.(true, animation);
  return animation;
}

const REDUCE_MOTION_VALUES: ReadonlySet<unknown> = new Set(Object.values(ReduceMotion));

/** A sequence rests where its LAST animation rests (the real overload's leading
 *  `reduceMotion` argument is recognised and skipped). */
export function withSequence<T>(reduceMotion: ReduceMotion, ...animations: T[]): T;
export function withSequence<T>(...animations: T[]): T;
export function withSequence(...animations: unknown[]): unknown {
  const list =
    animations.length > 1 && REDUCE_MOTION_VALUES.has(animations[0])
      ? animations.slice(1)
      : animations;
  return list[list.length - 1];
}

export function withClamp<T>(config: { min?: number; max?: number }, animation: T): T {
  if (typeof animation !== 'number') return animation;
  const lo = config.min ?? -Infinity;
  const hi = config.max ?? Infinity;
  return Math.min(hi, Math.max(lo, animation)) as T;
}

/** Decay has no target; a real decay's rest point depends on velocity and
 *  friction we do not model. It rests at 0 (clamped into `clamp` if given). */
export function withDecay(
  config: { velocity?: number; clamp?: [number, number] },
  callback?: AnimationCallback,
): number {
  const rest = config.clamp ? Math.min(config.clamp[1], Math.max(config.clamp[0], 0)) : 0;
  callback?.(true, rest);
  return rest;
}

/** Nothing is running, so there is nothing to cancel. */
export function cancelAnimation(): void {}

// Real preset values (lib/module/animation/spring/springConfigs.js), so a
// screen that spreads one into a config reads the same numbers it does on device.
export const Reanimated3DefaultSpringConfig: WithSpringConfig = {
  damping: 10,
  mass: 1,
  stiffness: 100,
};
export const Reanimated3DefaultSpringConfigWithDuration: WithSpringConfig = {
  duration: 1333,
  dampingRatio: 0.5,
};
export const WigglySpringConfig: WithSpringConfig = { damping: 90, mass: 4, stiffness: 900 };
export const WigglySpringConfigWithDuration: WithSpringConfig = {
  duration: 550,
  dampingRatio: 0.75,
};
export const GentleSpringConfig: WithSpringConfig = { damping: 120, mass: 4, stiffness: 900 };
export const GentleSpringConfigWithDuration: WithSpringConfig = { duration: 550, dampingRatio: 1 };
export const SnappySpringConfig: WithSpringConfig = {
  damping: 110,
  mass: 4,
  stiffness: 900,
  overshootClamping: true,
};
export const SnappySpringConfigWithDuration: WithSpringConfig = {
  duration: 550,
  dampingRatio: 0.92,
  overshootClamping: true,
};

// --- Interpolation (real linear maths — this one is pure) ---------------------

export interface ExtrapolationConfig {
  extrapolateLeft?: Extrapolation | string;
  extrapolateRight?: Extrapolation | string;
}
export type ExtrapolationType = ExtrapolationConfig | Extrapolation | string | undefined;

function extrapolationModes(type: ExtrapolationType): { left: string; right: string } {
  if (typeof type === 'string') return { left: type, right: type };
  return {
    left: type?.extrapolateLeft ?? Extrapolation.EXTEND,
    right: type?.extrapolateRight ?? Extrapolation.EXTEND,
  };
}

/** Piecewise-linear map from `inputRange` to `outputRange`. Default
 *  extrapolation is EXTEND, as on the real API (rn-stub's RN.Animated
 *  interpolate clamps; this follows reanimated). */
export function interpolate(
  x: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  type?: ExtrapolationType,
): number {
  const n = Math.min(inputRange.length, outputRange.length);
  if (n === 0) return x;
  if (n === 1) return outputRange[0] as number;
  const segment = (i: number): number => {
    const x0 = inputRange[i] as number;
    const x1 = inputRange[i + 1] as number;
    const y0 = outputRange[i] as number;
    const y1 = outputRange[i + 1] as number;
    if (x1 === x0) return y0;
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };
  const { left, right } = extrapolationModes(type);
  const first = inputRange[0] as number;
  const last = inputRange[n - 1] as number;
  if (x < first) {
    if (left === Extrapolation.IDENTITY) return x;
    if (left === Extrapolation.CLAMP) return outputRange[0] as number;
    return segment(0);
  }
  if (x > last) {
    if (right === Extrapolation.IDENTITY) return x;
    if (right === Extrapolation.CLAMP) return outputRange[n - 1] as number;
    return segment(n - 2);
  }
  let i = 0;
  while (i < n - 2 && x > (inputRange[i + 1] as number)) i += 1;
  return segment(i);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** No colour-space blending. If `value` sits EXACTLY on an input stop the
 *  colour at that stop is returned — a resolved animation lands exactly on its
 *  end stop, so a smoke test sees the committed colour — otherwise the first
 *  output colour. */
export function interpolateColor<T extends string | number>(
  value: number,
  inputRange: readonly number[],
  outputRange: readonly T[],
): T {
  const at = inputRange.indexOf(value);
  const pick = at >= 0 && at < outputRange.length ? outputRange[at] : outputRange[0];
  return pick as T;
}

// --- Easing: every member is identity or returns identity (mirrors rn-stub) ----

export type EasingFunction = (t: number) => number;
export type EasingFunctionFactory = { factory: () => EasingFunction };

const identity: EasingFunction = (t) => t;
const identityFactory = (): EasingFunction => identity;
const identityBezier = (): EasingFunctionFactory => ({ factory: identityFactory });

/** The real member signatures; the implementations below take no arguments
 *  (a curve's parameters change nothing when no timeline plays) and are
 *  assignable because TS permits fewer parameters. `bezier` returns the real
 *  `{ factory }` shape — production code type-checks against the real types
 *  and may call `.factory()` on it — while `bezierFn` returns the curve
 *  function directly, as the real one does. Both curves are identity. */
interface EasingModule {
  linear: EasingFunction;
  ease: EasingFunction;
  quad: EasingFunction;
  cubic: EasingFunction;
  sin: EasingFunction;
  circle: EasingFunction;
  exp: EasingFunction;
  bounce: EasingFunction;
  poly(n: number): EasingFunction;
  elastic(bounciness?: number): EasingFunction;
  back(s?: number): EasingFunction;
  bezier(x1: number, y1: number, x2: number, y2: number): EasingFunctionFactory;
  bezierFn(x1: number, y1: number, x2: number, y2: number): EasingFunction;
  steps(n?: number, roundToNextStep?: boolean): EasingFunction;
  in(easing: EasingFunction): EasingFunction;
  out(easing: EasingFunction): EasingFunction;
  inOut(easing: EasingFunction): EasingFunction;
}

export const Easing: EasingModule = {
  linear: identity,
  ease: identity,
  quad: identity,
  cubic: identity,
  sin: identity,
  circle: identity,
  exp: identity,
  bounce: identity,
  poly: identityFactory,
  elastic: identityFactory,
  back: identityFactory,
  bezier: identityBezier,
  bezierFn: identityFactory,
  steps: identityFactory,
  in: identityFactory,
  out: identityFactory,
  inOut: identityFactory,
};

// --- Layout animations: ONE chainable builder factory --------------------------
// `FadeIn.duration(200).springify()` must work, and so must bare `FadeIn`. Each
// preset is a plain object whose every modifier returns the object itself. No
// state is recorded (nothing plays), and the self-reference lives in the method
// closures, not in a property — so a leaked builder serialises as
// `{"presetName":"FadeIn"}`. Animated.* strip it anyway.

export interface LayoutAnimationBuilder {
  readonly presetName: string;
  duration(durationMs: number): LayoutAnimationBuilder;
  delay(delayMs: number): LayoutAnimationBuilder;
  springify(duration?: number): LayoutAnimationBuilder;
  damping(value: number): LayoutAnimationBuilder;
  dampingRatio(value: number): LayoutAnimationBuilder;
  stiffness(value: number): LayoutAnimationBuilder;
  mass(value: number): LayoutAnimationBuilder;
  overshootClamping(value: number): LayoutAnimationBuilder;
  energyThreshold(value: number): LayoutAnimationBuilder;
  restDisplacementThreshold(value: number): LayoutAnimationBuilder;
  restSpeedThreshold(value: number): LayoutAnimationBuilder;
  easing(easingFunction: EasingFunction | EasingFunctionFactory): LayoutAnimationBuilder;
  rotate(degree: string): LayoutAnimationBuilder;
  withInitialValues(values: Record<string, unknown>): LayoutAnimationBuilder;
  withCallback(callback: (finished: boolean) => void): LayoutAnimationBuilder;
  reduceMotion(reduceMotion: ReduceMotion): LayoutAnimationBuilder;
  randomDelay(): LayoutAnimationBuilder;
  getDuration(): number;
  getDelay(): number;
  getReduceMotion(): ReduceMotion;
  createInstance(): LayoutAnimationBuilder;
  build(): () => { initialValues: Record<string, unknown>; animations: Record<string, unknown> };
}

function layoutAnimation(presetName: string): LayoutAnimationBuilder {
  const self: LayoutAnimationBuilder = {
    presetName,
    duration: () => self,
    delay: () => self,
    springify: () => self,
    damping: () => self,
    dampingRatio: () => self,
    stiffness: () => self,
    mass: () => self,
    overshootClamping: () => self,
    energyThreshold: () => self,
    restDisplacementThreshold: () => self,
    restSpeedThreshold: () => self,
    easing: () => self,
    rotate: () => self,
    withInitialValues: () => self,
    withCallback: () => self,
    reduceMotion: () => self,
    randomDelay: () => self,
    getDuration: () => 0,
    getDelay: () => 0,
    getReduceMotion: () => ReduceMotion.System,
    createInstance: () => self,
    build: () => () => ({ initialValues: {}, animations: {} }),
  };
  return self;
}

export const FadeIn = layoutAnimation('FadeIn');
export const FadeInDown = layoutAnimation('FadeInDown');
export const FadeInUp = layoutAnimation('FadeInUp');
export const FadeInLeft = layoutAnimation('FadeInLeft');
export const FadeInRight = layoutAnimation('FadeInRight');
export const FadeOut = layoutAnimation('FadeOut');
export const FadeOutDown = layoutAnimation('FadeOutDown');
export const FadeOutUp = layoutAnimation('FadeOutUp');
export const FadeOutLeft = layoutAnimation('FadeOutLeft');
export const FadeOutRight = layoutAnimation('FadeOutRight');
export const SlideInDown = layoutAnimation('SlideInDown');
export const SlideInUp = layoutAnimation('SlideInUp');
export const SlideInLeft = layoutAnimation('SlideInLeft');
export const SlideInRight = layoutAnimation('SlideInRight');
export const SlideOutDown = layoutAnimation('SlideOutDown');
export const SlideOutUp = layoutAnimation('SlideOutUp');
export const SlideOutLeft = layoutAnimation('SlideOutLeft');
export const SlideOutRight = layoutAnimation('SlideOutRight');
export const ZoomIn = layoutAnimation('ZoomIn');
export const ZoomInDown = layoutAnimation('ZoomInDown');
export const ZoomInUp = layoutAnimation('ZoomInUp');
export const ZoomInEasyDown = layoutAnimation('ZoomInEasyDown');
export const ZoomInEasyUp = layoutAnimation('ZoomInEasyUp');
export const ZoomOut = layoutAnimation('ZoomOut');
export const ZoomOutDown = layoutAnimation('ZoomOutDown');
export const ZoomOutUp = layoutAnimation('ZoomOutUp');
export const ZoomOutEasyDown = layoutAnimation('ZoomOutEasyDown');
export const ZoomOutEasyUp = layoutAnimation('ZoomOutEasyUp');
export const StretchInX = layoutAnimation('StretchInX');
export const StretchInY = layoutAnimation('StretchInY');
export const StretchOutX = layoutAnimation('StretchOutX');
export const StretchOutY = layoutAnimation('StretchOutY');
export const LinearTransition = layoutAnimation('LinearTransition');
/** @deprecated alias of LinearTransition, as on the real index. */
export const Layout = LinearTransition;
export const SequencedTransition = layoutAnimation('SequencedTransition');
export const FadingTransition = layoutAnimation('FadingTransition');
export const CurvedTransition = layoutAnimation('CurvedTransition');
export const JumpingTransition = layoutAnimation('JumpingTransition');
export const EntryExitTransition = layoutAnimation('EntryExitTransition');

/** `new Keyframe({...})` — the one builder that IS a class on the real API.
 *  Its only field is the plain definitions object, so it too is cycle-free. */
export class Keyframe {
  readonly definitions: Record<string, unknown>;
  constructor(definitions: Record<string, unknown>) {
    this.definitions = definitions;
  }
  duration(): this {
    return this;
  }
  delay(): this {
    return this;
  }
  reduceMotion(): this {
    return this;
  }
  withCallback(): this {
    return this;
  }
}

// --- CSS transitions / animations ---------------------------------------------
// `transitionProperty`, `transitionDuration`, `animationName`, ... are plain style
// values on the real API and pass through the host untouched. The helpers below
// return PLAIN OBJECTS (the real ones are class instances with the same fields;
// a plain object is what the serialisation constraint asks for).

export interface CSSKeyframesRule {
  readonly cssRules: Record<string | number, object>;
  readonly cssText: string;
  readonly length: number;
  readonly name: string;
}

let keyframesCount = 0;

export const css = {
  create<T extends Record<string, object>>(styles: T): T {
    return styles;
  },
  keyframes(definitions: Record<string | number, object>): CSSKeyframesRule {
    keyframesCount += 1;
    return {
      cssRules: definitions,
      cssText: '',
      length: Object.keys(definitions).length,
      name: `stub-keyframes-${keyframesCount}`,
    };
  },
};

export interface CubicBezierEasing {
  readonly easingName: 'cubicBezier';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): CubicBezierEasing {
  return { easingName: 'cubicBezier', x1, y1, x2, y2 };
}

export type ControlPoint = number | [number, ...string[]];
export interface LinearEasing {
  readonly easingName: 'linear';
  readonly points: ControlPoint[];
}
export function linear(...points: ControlPoint[]): LinearEasing {
  return { easingName: 'linear', points };
}

export type StepsModifier = 'jump-start' | 'start' | 'jump-end' | 'end' | 'jump-none' | 'jump-both';
export interface StepsEasing {
  readonly easingName: 'steps';
  readonly stepsNumber: number;
  readonly modifier: StepsModifier;
}
export function steps(stepsNumber: number, modifier: StepsModifier = 'jump-end'): StepsEasing {
  return { easingName: 'steps', stepsNumber, modifier };
}

// --- Animated components ----------------------------------------------------------

/** Props that must NEVER reach a host element: builders and animated-prop
 *  handles. Stripped before createElement on every Animated.* component. */
const STRIPPED_PROPS: ReadonlySet<string> = new Set([
  'entering',
  'exiting',
  'layout',
  'animatedProps',
  'sharedTransitionTag',
  'sharedTransitionStyle',
]);

function stripAnimationProps(props: AnyProps, extra?: ReadonlySet<string>): AnyProps {
  const out: AnyProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (STRIPPED_PROPS.has(k) || extra?.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function animatedHost(tag: string) {
  return function AnimatedHost(props: AnyProps & { style?: unknown }): ReactElement {
    const { children, style, ...rest } = stripAnimationProps(props);
    assertNoBareText(tag, children);
    return createElement(tag, { ...rest, style: resolveShared(style) }, children);
  };
}

const AnimatedView = animatedHost('rn-view');
const AnimatedText = animatedHost('rn-text');
const AnimatedImage = animatedHost('rn-image');

const SCROLLVIEW_STRIPPED: ReadonlySet<string> = new Set(['scrollViewOffset', 'refreshControl']);

/** Same rule as rn-stub's ScrollView: the pull-to-refresh ELEMENT prop is
 *  rendered as a first child, because an element left in props sits in the
 *  JSON tree with its fiber owner and makes JSON.stringify circular. */
function AnimatedScrollView(
  props: AnyProps & {
    style?: unknown;
    contentContainerStyle?: unknown;
    refreshControl?: ReactNode;
  },
): ReactElement {
  const refreshControl = props.refreshControl ?? null;
  const { children, style, contentContainerStyle, ...rest } = stripAnimationProps(
    props,
    SCROLLVIEW_STRIPPED,
  );
  assertNoBareText('rn-scrollview', children);
  return createElement(
    'rn-scrollview',
    {
      ...rest,
      style: resolveShared(style),
      contentContainerStyle: resolveShared(contentContainerStyle),
    },
    refreshControl,
    children,
  );
}

type ListSlot = ReactNode | (() => ReactNode) | ((props: object) => ReactNode);

/** FlatList's Header/Footer/Empty/Separator slots take a component OR an element. */
function renderSlot(slot: unknown): ReactNode {
  if (isValidElement(slot)) return slot;
  if (typeof slot === 'function') return createElement(slot as (props: object) => ReactNode);
  return null;
}

interface FlatListStubProps extends AnyProps {
  data?: ArrayLike<unknown> | null;
  renderItem?: (info: {
    item: unknown;
    index: number;
    separators: { highlight(): void; unhighlight(): void; updateProps(): void };
  }) => ReactNode;
  keyExtractor?: (item: unknown, index: number) => string;
  ListHeaderComponent?: ListSlot;
  ListFooterComponent?: ListSlot;
  ListEmptyComponent?: ListSlot;
  ItemSeparatorComponent?: ListSlot;
  refreshControl?: ReactNode;
  style?: unknown;
  contentContainerStyle?: unknown;
  ListHeaderComponentStyle?: unknown;
  ListFooterComponentStyle?: unknown;
}

const FLATLIST_STRIPPED: ReadonlySet<string> = new Set([
  'data',
  'renderItem',
  'keyExtractor',
  'getItemLayout',
  'extraData',
  'ListHeaderComponent',
  'ListFooterComponent',
  'ListEmptyComponent',
  'ItemSeparatorComponent',
  'refreshControl',
  'itemLayoutAnimation',
  'CellRendererComponentStyle',
]);

const separators = { highlight(): void {}, unhighlight(): void {}, updateProps(): void {} };

/** rn-stub has no FlatList, so this is the one NEW host tag: `rn-flatlist`.
 *  Items are rendered through `renderItem` so their content is assertable;
 *  `data` itself is stripped (it may hold anything the screen put there). */
function AnimatedFlatList(props: FlatListStubProps): ReactElement {
  const items = props.data ? Array.from(props.data) : [];
  const { renderItem, keyExtractor, ItemSeparatorComponent } = props;
  const rendered = items.map((item, index) =>
    createElement(
      Fragment,
      { key: keyExtractor ? keyExtractor(item, index) : String(index) },
      renderItem ? renderItem({ item, index, separators }) : null,
      index < items.length - 1 ? renderSlot(ItemSeparatorComponent) : null,
    ),
  );
  const body = rendered.length > 0 ? rendered : renderSlot(props.ListEmptyComponent);
  const {
    children,
    style,
    contentContainerStyle,
    ListHeaderComponentStyle,
    ListFooterComponentStyle,
    ...rest
  } = stripAnimationProps(props, FLATLIST_STRIPPED);
  return createElement(
    'rn-flatlist',
    {
      ...rest,
      style: resolveShared(style),
      contentContainerStyle: resolveShared(contentContainerStyle),
      ListHeaderComponentStyle: resolveShared(ListHeaderComponentStyle),
      ListFooterComponentStyle: resolveShared(ListFooterComponentStyle),
    },
    props.refreshControl ?? null,
    renderSlot(props.ListHeaderComponent),
    body,
    renderSlot(props.ListFooterComponent),
    children,
  );
}

/**
 * A wrapper, NOT an identity.
 *
 * The first cut returned the component unchanged, which left one hole the
 * Phase 0 probe printed: on `createAnimatedComponent(Pressable)`, an
 * `entering={FadeInDown}` reached the host and serialised as
 * `{"presetName":"FadeInDown"}`. Plain data, never a cycle — but four suites
 * assert `not.toContain('down')` on the serialised tree as a raw-error
 * tripwire, and a screen that animates a custom pressable with a *Down preset
 * would have gone red for a reason no one could see in its own code. So this
 * strips the same builder props every Animated.* host strips, resolves shared
 * values in `style` and merges resolved `animatedProps`, and forwards the ref —
 * the same contract as `Animated.View`, applied to whatever was wrapped.
 */
export function createAnimatedComponent<T>(component: T): T {
  const Inner = component as unknown as ComponentType<AnyProps>;
  const Wrapped = forwardRef<unknown, AnyProps & { style?: unknown; animatedProps?: unknown }>(
    function AnimatedCustom(props, ref) {
      const animated = props['animatedProps'];
      const { style, ...rest } = stripAnimationProps(props);
      const resolvedAnimated =
        typeof animated === 'object' && animated !== null
          ? (resolveShared(animated) as AnyProps)
          : {};
      return createElement(Inner, {
        ...rest,
        ...resolvedAnimated,
        style: resolveShared(style),
        ref,
      });
    },
  );
  Wrapped.displayName =
    'Animated(' +
    ((Inner as { displayName?: string; name?: string }).displayName ?? Inner.name ?? 'Component') +
    ')';
  return Wrapped as unknown as T;
}

/** Deprecated no-ops on the real API too (Reanimated 4). */
function addWhitelistedNativeProps(): void {}
function addWhitelistedUIProps(): void {}

const Animated = {
  View: AnimatedView,
  Text: AnimatedText,
  ScrollView: AnimatedScrollView,
  Image: AnimatedImage,
  FlatList: AnimatedFlatList,
  createAnimatedComponent,
  addWhitelistedNativeProps,
  addWhitelistedUIProps,
};

export default Animated;

// --- Config / wrapper components -----------------------------------------------------

/** Renders its children as-is: skipping entrances is moot when none play. */
export function LayoutAnimationConfig(props: {
  skipEntering?: boolean;
  skipExiting?: boolean;
  children?: ReactNode;
}): ReactElement {
  return createElement(Fragment, null, props.children);
}

/** Renders nothing (the real one is a side-effect-only component). */
export function ReducedMotionConfig(): null {
  return null;
}

export function configureReanimatedLogger(): void {}
export function enableLayoutAnimations(): void {}
export function isReanimated3(): boolean {
  return false;
}
export const reanimatedVersion = '4.2.1';

// --- Platform functions --------------------------------------------------------------------

export interface MeasuredDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
  pageX: number;
  pageY: number;
}

/** No layout exists in node; `null` is the real API's "could not measure". */
export function measure(): MeasuredDimensions | null {
  return null;
}
export function scrollTo(): void {}
export function setNativeProps(): void {}
export function dispatchCommand(): void {}
export function getRelativeCoords(): { x: number; y: number } {
  return { x: 0, y: 0 };
}

// --- Worklet thread helpers (the real index re-exports these from worklets) ---
// There is one thread in node, so "run on the other one" is "call it".

export function runOnUI<Args extends unknown[], Return>(
  worklet: (...args: Args) => Return,
): (...args: Args) => void {
  return worklet;
}
/** @deprecated alias the real index still ships (use scheduleOnRN from worklets). */
export function runOnJS<Args extends unknown[], Return>(
  fun: (...args: Args) => Return,
): (...args: Args) => void {
  return fun;
}
export function executeOnUIRuntimeSync<Args extends unknown[], Return>(
  worklet: (...args: Args) => Return,
): (...args: Args) => Return {
  return worklet;
}
export function runOnRuntime<Args extends unknown[], Return>(
  workletRuntime: unknown,
  worklet: (...args: Args) => Return,
): (...args: Args) => void {
  void workletRuntime;
  return worklet;
}
export type WorkletRuntime = Readonly<Record<string, never>>;
export function createWorkletRuntime(): WorkletRuntime {
  return {};
}
export function isWorkletFunction(): boolean {
  return false;
}
export function makeShareableCloneRecursive<T>(value: T): T {
  return value;
}
