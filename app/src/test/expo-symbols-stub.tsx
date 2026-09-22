/**
 * Node-safe stand-in for 'expo-symbols' (vitest alias — BD-204 redesign).
 *
 * The real iOS `SymbolView` requires the `SymbolModule` native view manager at
 * IMPORT time (and the Android/web one loads a Material font through
 * `@expo-google-fonts`), so one SF Symbol in a tested screen takes the suite
 * down before an assertion runs. Here it is a plain host element
 * ('expo-symbol') carrying the symbol name under `symbolName`, with `size` /
 * `tintColor` / `weight` / `scale` / `type` / `animationSpec` / `style` and
 * the rest of its props forwarded, and `fallback` rendered as a CHILD rather
 * than a prop (a React element kept as a prop would sit in the JSON tree with
 * its fiber owner and make JSON.stringify circular).
 *
 * READ THIS before choosing a symbol name. `JSON.stringify(tree.toJSON())`
 * serialises host props, so `symbolName` IS in the serialised tree: a symbol
 * whose name contains the substring "down" (chevron.down, arrow.down,
 * square.and.arrow.down …) WILL trip the four suites that assert
 * `not.toContain('down')` as a raw-error tripwire (screens, saved_screen,
 * builder_screen, record_screen). This stub does not hide the name — a prop
 * is still a string in the output. The app-side SymbolView wrapper is what
 * refuses such names; that is where the rule lives, not here. (The
 * vector-icons stub's header claims a prop escapes substring assertions; it
 * does not, and this stub does not repeat the claim.)
 *
 * Not emulated: the glyph; the real defaults (type 'monochrome', size 24, the
 * `{width:size,height:size}` style the real render prepends — the tree shows
 * what the app passed); `processColor`; and the on-device rule that the
 * fallback renders INSTEAD of the symbol when the platform has no name — here
 * the fallback is always the host element's child so a test can see both what
 * was asked for and what would stand in. `name` given as a platform object
 * resolves iOS-first (`ios ?? android ?? web`), matching the redesign's target.
 *
 * Serialisation guard. Every prop goes through `plain()` before createElement:
 * an rn-stub Animated node resolves to its current number, plain arrays/objects
 * are walked, and any other object (class instance, React element) is dropped.
 */

import { createElement, type ReactElement, type ReactNode } from 'react';

/** The real types are literal unions of every SF Symbol / Material Symbol
 *  name; `string` here is wider, so anything valid on device is valid here. */
export type SFSymbol = string;
export type AndroidSymbol = string;
export type AndroidSymbolWeight = { name: string; font: number };

export type SymbolWeight =
  | 'unspecified'
  | 'ultraLight'
  | 'thin'
  | 'light'
  | 'regular'
  | 'medium'
  | 'semibold'
  | 'bold'
  | 'heavy'
  | 'black';

export type SymbolScale = 'default' | 'unspecified' | 'small' | 'medium' | 'large';

export type ContentMode =
  | 'scaleToFill'
  | 'scaleAspectFit'
  | 'scaleAspectFill'
  | 'redraw'
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

export type SymbolType = 'monochrome' | 'hierarchical' | 'palette' | 'multicolor';

export type AnimationType = 'bounce' | 'pulse' | 'scale';

export type AnimationEffect = {
  type: AnimationType;
  wholeSymbol?: boolean;
  direction?: 'up' | 'down';
};

export type VariableAnimationSpec = {
  reversing?: boolean;
  nonReversing?: boolean;
  cumulative?: boolean;
  iterative?: boolean;
  hideInactiveLayers?: boolean;
  dimInactiveLayers?: boolean;
};

export type AnimationSpec = {
  effect?: AnimationEffect;
  repeating?: boolean;
  repeatCount?: number;
  speed?: number;
  variableAnimationSpec?: VariableAnimationSpec;
};

/** ColorValue on device is a string or a PlatformColor/DynamicColorIOS plain
 *  object; both are serialisable, so `unknown` here loses nothing. */
type ColorLike = unknown;

/** Wider than the real ViewProps on purpose: anything the real component
 *  accepts is accepted here, and the guard below decides what is forwarded. */
type ViewLikeProps = Record<string, unknown> & { style?: unknown };

export type SymbolViewProps = ViewLikeProps & {
  name: SFSymbol | { ios?: SFSymbol; android?: AndroidSymbol; web?: AndroidSymbol };
  fallback?: ReactNode;
  type?: SymbolType;
  scale?: SymbolScale;
  weight?: SymbolWeight | { ios: SymbolWeight; android: AndroidSymbolWeight };
  colors?: ColorLike | ColorLike[];
  size?: number;
  tintColor?: ColorLike;
  resizeMode?: ContentMode;
  animationSpec?: AnimationSpec;
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

function resolveName(name: SymbolViewProps['name']): string | undefined {
  if (typeof name === 'string') return name;
  return name.ios ?? name.android ?? name.web;
}

export function SymbolView(props: SymbolViewProps): ReactElement {
  const { name, fallback, ...rest } = props;
  return createElement(
    'expo-symbol',
    { ...plainProps(rest), symbolName: resolveName(name) },
    fallback ?? null,
  );
}

/** The real call shape (symbol, size, colour); declared on the type so the
 *  implementation can ignore its arguments without an unused-parameter lint. */
type MaterialSymbolSource = (
  symbol: AndroidSymbol | null,
  size: number,
  color: string,
) => Promise<null>;

/** Android-only Material rasteriser; there is no font in node, so it answers
 *  the way the real one does when it has nothing to draw. */
export const unstable_getMaterialSymbolSourceAsync: MaterialSymbolSource = () =>
  Promise.resolve(null);
