/**
 * Node-safe stand-in for 'expo-blur' (vitest alias — BD-204 redesign).
 *
 * The real `BlurView` requires the `ExpoBlurView` native view manager at
 * IMPORT time, so one translucent bar in a tested screen takes the suite down
 * before an assertion runs. Here it is a plain host element ('expo-blurview')
 * wrapping its children, with `intensity` / `tint` / `style` and the rest of
 * its props forwarded, so a screen test can find it by type and read what the
 * app asked for. Not emulated: the blur itself, the library defaults
 * (tint 'default', intensity 50 are NOT filled in — the tree shows what the
 * app passed), the Android blur-method fallback warnings, and
 * `getAnimatableRef`. Refs (`ref`, `blurTarget`) are dropped: there is
 * nothing to measure in node, and a ref's `current` is exactly the kind of
 * instance that would poison serialisation.
 *
 * Serialisation guard. Every screen test asserts over
 * `JSON.stringify(tree.toJSON())`, and react-test-renderer serialises host
 * props, so one cyclic prop reaching 'expo-blurview' turns the whole suite into
 * "Converting circular structure to JSON". `intensity` is documented as
 * animatable, so every prop goes through `plain()` before createElement: an
 * rn-stub Animated node resolves to its current number, plain arrays/objects
 * are walked, and any other object (class instance, React element) is dropped
 * — a missing prop is a visible gap in one assertion, a cycle is 474 failures.
 */

import { createElement, type ReactElement, type ReactNode } from 'react';

export type BlurMethod = 'none' | 'dimezisBlurView' | 'dimezisBlurViewSdk31Plus';
/** @deprecated Use `BlurMethod` — kept because the real index exports it. */
export type ExperimentalBlurMethod = BlurMethod;

export type BlurTint =
  | 'light'
  | 'dark'
  | 'default'
  | 'extraLight'
  | 'regular'
  | 'prominent'
  | 'systemUltraThinMaterial'
  | 'systemThinMaterial'
  | 'systemMaterial'
  | 'systemThickMaterial'
  | 'systemChromeMaterial'
  | 'systemUltraThinMaterialLight'
  | 'systemThinMaterialLight'
  | 'systemMaterialLight'
  | 'systemThickMaterialLight'
  | 'systemChromeMaterialLight'
  | 'systemUltraThinMaterialDark'
  | 'systemThinMaterialDark'
  | 'systemMaterialDark'
  | 'systemThickMaterialDark'
  | 'systemChromeMaterialDark';

/** Wider than the real ViewProps on purpose: anything the real component
 *  accepts is accepted here, and the guard below decides what is forwarded. */
type ViewLikeProps = Record<string, unknown> & { children?: ReactNode; style?: unknown };

export type BlurViewProps = ViewLikeProps & {
  /** RefObject on device; dropped here (see header). */
  blurTarget?: unknown;
  tint?: BlurTint;
  intensity?: number;
  blurReductionFactor?: number;
  experimentalBlurMethod?: ExperimentalBlurMethod;
  blurMethod?: BlurMethod;
};

export type BlurTargetViewProps = ViewLikeProps & { ref?: unknown };

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

const DROPPED = new Set(['ref', 'blurTarget']);

function plainProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!DROPPED.has(k)) out[k] = plain(v);
  }
  return out;
}

// --- components -----------------------------------------------------------

export function BlurView(props: BlurViewProps): ReactElement {
  const { children, ...rest } = props;
  return createElement('expo-blurview', plainProps(rest), children);
}

/** The Android blur source; a plain wrapper here, exported so the real
 *  index's import shape (`{ BlurView, BlurTargetView }`) resolves. */
export function BlurTargetView(props: BlurTargetViewProps): ReactElement {
  const { children, ...rest } = props;
  return createElement('expo-blurtargetview', plainProps(rest), children);
}
