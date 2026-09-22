/**
 * Minimal node-safe stand-in for 'react-native' (vitest alias — M7-T01).
 *
 * Lets component smoke tests render OUR screens with react-test-renderer in a
 * node environment: primitives become plain host elements ('rn-view' etc.), so
 * the tests catch real wiring failures (broken imports, hook misuse, crashing
 * render logic) without the native runtime. NOT a behavioural emulation.
 */

import { createElement, type ReactElement, type ReactNode } from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

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

function host(tag: string) {
  return function Host(props: AnyProps): ReactElement {
    const { children, ...rest } = props;
    assertNoBareText(tag, children);
    return createElement(tag, rest, children);
  };
}

export const View = host('rn-view');
export const Text = host('rn-text');
/** ScrollView takes its pull-to-refresh control as an ELEMENT prop; kept as a
 *  prop it would sit in the JSON tree with its fiber owner and make
 *  JSON.stringify circular, so it is rendered as a first child instead. */
export function ScrollView(props: AnyProps & { refreshControl?: ReactNode }): ReactElement {
  const { children, refreshControl, ...rest } = props;
  assertNoBareText('rn-scrollview', children);
  return createElement('rn-scrollview', rest, refreshControl ?? null, children);
}
export const TextInput = host('rn-textinput');
export const ActivityIndicator = host('rn-activityindicator');
/** Pull-to-refresh: passed as ScrollView's `refreshControl` element. */
export const RefreshControl = host('rn-refreshcontrol');
/** M8-T01: the sign-in sheet is a Modal that rides above the keyboard. Modal
 *  renders its children inline here (node has no native overlay), which is
 *  what the sheet tests want to inspect. */
export const Modal = host('rn-modal');
export const KeyboardAvoidingView = host('rn-keyboardavoidingview');
/** Keyboard.dismiss() is a no-op in node — the tests assert the AFFORDANCE
 *  exists (a labelled dismiss target), not the native side effect. */
export const Keyboard = { dismiss: (): void => undefined };

/** Pressable supports the style-as-function form used by our buttons. */
export function Pressable(
  props: AnyProps & { style?: unknown | ((state: { pressed: boolean }) => unknown) },
): ReactElement {
  const { children, style, ...rest } = props;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return createElement('rn-pressable', { ...rest, style: resolved }, children);
}

export const StyleSheet = {
  create<T>(styles: T): T {
    return styles;
  },
  flatten(style: unknown): unknown {
    return style;
  },
};

export const Platform = {
  OS: 'test',
  select<T>(options: { default?: T } & Record<string, T>): T | undefined {
    return options['test'] ?? options.default;
  },
};

/** BD-204: the scheme is SWITCHABLE. It returned 'dark' unconditionally for
 *  the app's whole history, so no test had ever rendered `lightColors` — which
 *  is exactly how light `surface` and `surfaceRaised` both shipped as #ffffff
 *  (no elevation ladder at all) and the light accent shipped below contrast on
 *  every primary button. A test that wants the light palette calls
 *  `__setColorScheme('light')` and restores it in a finally/afterEach. */
let __scheme: 'dark' | 'light' = 'dark';

export function __setColorScheme(scheme: 'dark' | 'light'): void {
  __scheme = scheme;
}

export function useColorScheme(): 'dark' | 'light' {
  return __scheme;
}

export function Image(props: Record<string, unknown>): ReturnType<typeof createElement> {
  return createElement('rn-image', props);
}

export const Linking = {
  openURL(): Promise<void> {
    return Promise.resolve();
  },
};

export const AppState = {
  currentState: 'active' as const,
  addEventListener(): { remove(): void } {
    return { remove() {} };
  },
};

// --- Animated (BD-204) --------------------------------------------------
// The redesign's motion is built on RN's own Animated. The stub must RESOLVE
// animated values to plain numbers before they reach the host element: an
// `Animated.Value` holds `_children`/`_parents` back-references, and every
// screen test serialises with `JSON.stringify(tree.toJSON())`, so passing one
// through unresolved turns the whole suite into "Converting circular structure
// to JSON". Driving a timeline is NOT emulated — `start()` completes
// immediately, which is what a render smoke test wants (the committed end
// state), and device behaviour stays an on-device check.

const ANIMATED = Symbol.for('roadopia.rn-stub.animated');

interface AnimatedNode {
  [ANIMATED]: true;
  __value(): number;
}

function isAnimated(v: unknown): v is AnimatedNode {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[ANIMATED] === true;
}

class AnimatedValue implements AnimatedNode {
  readonly [ANIMATED] = true as const;
  private v: number;
  constructor(value: number) {
    this.v = value;
  }
  __value(): number {
    return this.v;
  }
  setValue(value: number): void {
    this.v = value;
  }
  /** Linear map between two ranges — enough for a render assertion. */
  interpolate(cfg: { inputRange: number[]; outputRange: Array<number | string> }): AnimatedNode {
    const read = (): number => this.__value();
    return {
      [ANIMATED]: true as const,
      __value(): number {
        const { inputRange: i, outputRange: o } = cfg;
        const x = read();
        const first = i[0] ?? 0;
        const last = i[i.length - 1] ?? 1;
        const a = typeof o[0] === 'number' ? (o[0] as number) : 0;
        const b = typeof o[o.length - 1] === 'number' ? (o[o.length - 1] as number) : 0;
        if (last === first) return a;
        const t = Math.min(1, Math.max(0, (x - first) / (last - first)));
        return a + (b - a) * t;
      },
    };
  }
  addListener(): string {
    return '0';
  }
  removeAllListeners(): void {}
  stopAnimation(cb?: (v: number) => void): void {
    cb?.(this.v);
  }
}

/** Replace every AnimatedNode in a style tree with its current number. */
function resolveAnimated(style: unknown): unknown {
  if (isAnimated(style)) return style.__value();
  if (Array.isArray(style)) return style.map(resolveAnimated);
  if (typeof style === 'object' && style !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
      out[k] = resolveAnimated(v);
    }
    return out;
  }
  return style;
}

function animatedHost(tag: string) {
  return function AnimatedHost(props: AnyProps & { style?: unknown }): ReactElement {
    const { children, style, ...rest } = props;
    assertNoBareText(tag, children);
    return createElement(tag, { ...rest, style: resolveAnimated(style) }, children);
  };
}

interface Anim {
  start(cb?: (r: { finished: boolean }) => void): void;
  stop(): void;
  reset(): void;
}

/** Animations resolve instantly: a smoke test asserts the committed state. */
function completed(toValue?: number, value?: AnimatedValue): Anim {
  return {
    start(cb) {
      if (value && typeof toValue === 'number') value.setValue(toValue);
      cb?.({ finished: true });
    },
    stop() {},
    reset() {},
  };
}

type TimingCfg = { toValue: number; duration?: number; useNativeDriver?: boolean };

export const Animated = {
  Value: AnimatedValue,
  View: animatedHost('rn-view'),
  Text: animatedHost('rn-text'),
  ScrollView: animatedHost('rn-scrollview'),
  Image: animatedHost('rn-image'),
  createAnimatedComponent<T>(C: T): T {
    return C;
  },
  timing(value: AnimatedValue, cfg: TimingCfg): Anim {
    return completed(cfg.toValue, value);
  },
  spring(value: AnimatedValue, cfg: TimingCfg): Anim {
    return completed(cfg.toValue, value);
  },
  decay(value: AnimatedValue): Anim {
    return completed(undefined, value);
  },
  sequence(list: Anim[]): Anim {
    return {
      start(cb) {
        for (const a of list) a.start();
        cb?.({ finished: true });
      },
      stop() {
        for (const a of list) a.stop();
      },
      reset() {
        for (const a of list) a.reset();
      },
    };
  },
  parallel(list: Anim[]): Anim {
    return Animated.sequence(list);
  },
  stagger(_ms: number, list: Anim[]): Anim {
    return Animated.sequence(list);
  },
  delay(): Anim {
    return completed();
  },
  /** A loop must NOT run forever in node — start it once and settle. */
  loop(a: Anim): Anim {
    return {
      start(cb) {
        a.start();
        cb?.({ finished: true });
      },
      stop() {
        a.stop();
      },
      reset() {
        a.reset();
      },
    };
  },
};

const identity = (t: number): number => t;
export const Easing = {
  linear: identity,
  ease: identity,
  quad: identity,
  cubic: identity,
  in: () => identity,
  out: () => identity,
  inOut: () => identity,
  bezier: () => identity,
};

/** LayoutAnimation is a no-op in node; the committed tree is what is asserted. */
export const LayoutAnimation = {
  configureNext(): void {},
  create(): Record<string, unknown> {
    return {};
  },
  Presets: { easeInEaseOut: {}, linear: {}, spring: {} },
  Types: { easeInEaseOut: 'easeInEaseOut', linear: 'linear', spring: 'spring' },
  Properties: { opacity: 'opacity', scaleXY: 'scaleXY' },
};

/** iPhone 14 Pro logical size — a stable default for layout-dependent render. */
export function useWindowDimensions(): {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
} {
  return { width: 393, height: 852, scale: 3, fontScale: 1 };
}

export const Dimensions = {
  get(): { width: number; height: number; scale: number; fontScale: number } {
    return { width: 393, height: 852, scale: 3, fontScale: 1 };
  },
  addEventListener(): { remove(): void } {
    return { remove() {} };
  },
};

export const PixelRatio = {
  get(): number {
    return 3;
  },
  getFontScale(): number {
    return 1;
  },
  roundToNearestPixel(n: number): number {
    return Math.round(n * 3) / 3;
  },
};

/** BD-204 round 2: Reduce Motion is SWITCHABLE, for the same reason the colour
 *  scheme is (see `__setColorScheme`). `isReduceMotionEnabled()` resolved `false`
 *  unconditionally, so the defect it hid — every entrance in the app running at
 *  full duration with the OS switch ON, because the flag arrived asynchronously
 *  after `useEnter`'s mount-only effect had already started — could not be
 *  observed from a test at all. It was fixed, proved with a throwaway mock, and
 *  left unpinned; this is what pins it.
 *
 *  The setter also notifies anything registered through
 *  `addEventListener('reduceMotionChanged', …)`, because that subscription is how
 *  press.ts keeps its synchronous module cache current — so flipping the switch
 *  drives the real path instead of a shortcut around it. A test that turns it on
 *  restores it in a finally/afterEach: the cache it writes to is module state
 *  shared by every test in the same file. */
let __reduceMotion = false;
const __reduceMotionListeners = new Set<(value: boolean) => void>();

export function __setReduceMotion(value: boolean): void {
  __reduceMotion = value;
  for (const listener of __reduceMotionListeners) listener(value);
}

export const AccessibilityInfo = {
  isReduceMotionEnabled(): Promise<boolean> {
    return Promise.resolve(__reduceMotion);
  },
  addEventListener(event: string, handler: (value: boolean) => void): { remove(): void } {
    if (event === 'reduceMotionChanged') __reduceMotionListeners.add(handler);
    return {
      remove() {
        __reduceMotionListeners.delete(handler);
      },
    };
  },
};
