/**
 * Node-safe stand-in for 'expo-linear-gradient' (vitest alias — BD-204
 * redesign).
 *
 * The real `LinearGradient` requires the `ExpoLinearGradient` native view at
 * IMPORT time, so one gradient scrim in a tested screen takes the suite down
 * before an assertion runs. Here it is a plain host element
 * ('expo-lineargradient') wrapping its children, with `colors` / `locations` /
 * `start` / `end` / `style` and the rest of its props forwarded, so a screen
 * test can find it by type and read the stops the app asked for. Not emulated:
 * the paint, colour normalisation (`processColor`), the `{x,y}` → `[x,y]`
 * point conversion the real render does, the library defaults (start
 * `{0.5,0}` / end `{0.5,1}` are NOT filled in — the tree shows what the app
 * passed), and dithering. `ref` is dropped: nothing to measure in node.
 *
 * Serialisation guard. Every screen test asserts over
 * `JSON.stringify(tree.toJSON())`, and react-test-renderer serialises host
 * props, so one cyclic prop reaching 'expo-lineargradient' turns the whole
 * suite into "Converting circular structure to JSON". Gradients are the
 * component most often wrapped in `Animated.createAnimatedComponent`, and
 * rn-stub's version of that returns the component unchanged — so every prop
 * goes through `plain()` before createElement: an rn-stub Animated node
 * resolves to its current number, plain arrays/objects are walked, and any
 * other object (class instance, React element) is dropped.
 */

import { createElement, type ReactElement, type ReactNode } from 'react';

export type NativeLinearGradientPoint = [x: number, y: number];

export type LinearGradientPoint = { x: number; y: number } | NativeLinearGradientPoint;

/** ColorValue on device is a string or a PlatformColor/DynamicColorIOS plain
 *  object; both are serialisable, so `unknown` here loses nothing. */
type ColorLike = unknown;

/** Wider than the real ViewProps on purpose: anything the real component
 *  accepts is accepted here, and the guard below decides what is forwarded. */
type ViewLikeProps = Record<string, unknown> & { children?: ReactNode; style?: unknown };

export type LinearGradientProps = ViewLikeProps & {
  colors: readonly [ColorLike, ColorLike, ...ColorLike[]];
  locations?: readonly [number, number, ...number[]] | null;
  start?: LinearGradientPoint | null;
  end?: LinearGradientPoint | null;
  dither?: boolean;
};

// --- serialisation guard --------------------------------------------------

/** Same marker rn-stub puts on its Animated nodes (rn-stub.tsx `ANIMATED`). */
const ANIMATED = Symbol.for('roadopia.rn-stub.animated');

function isAnimated(v: unknown): v is { __value(): number } {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[ANIMATED] === true;
}

/** Reduce one prop value to something JSON.stringify accepts. */
function plain(v: unknown): unknown {
  if (isAnimated(v)) return v.__value();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object' && v !== null) {
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return undefined; // class instance
    if ('$$typeof' in v) return undefined; // React element: its owner is a fiber
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = plain(x);
    return out;
  }
  return v; // primitives; functions never reach JSON (toJSON keeps, stringify drops)
}

const DROPPED = new Set(['ref']);

function plainProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!DROPPED.has(k)) out[k] = plain(v);
  }
  return out;
}

// --- component ------------------------------------------------------------

/** A function component where the real one is a class: production code only
 *  ever renders it as JSX, and the reanimated alias owns `createAnimatedComponent`. */
export function LinearGradient(props: LinearGradientProps): ReactElement {
  const { children, ...rest } = props;
  return createElement('expo-lineargradient', plainProps(rest), children);
}
