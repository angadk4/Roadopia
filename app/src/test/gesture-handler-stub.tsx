/**
 * Node-safe stand-in for 'react-native-gesture-handler' 2.30 (vitest alias —
 * BD-204 redesign).
 *
 * The real module cannot load in node: its components resolve native view
 * managers at IMPORT time and `GestureDetector` needs the reanimated worklet
 * runtime, so one `Gesture.Pan()` in a tested screen would take the whole
 * suite down before an assertion runs. This file lets screens that carry
 * gestures render under react-test-renderer, and lets a test DRIVE the
 * handlers a screen registered (`__fireGesture`, below), so "the sheet
 * dismisses on a downward drag" is assertable in node.
 *
 * Serialisation guard — the constraint that decides whether the suite lives.
 * Every screen test asserts over `JSON.stringify(tree.toJSON())`, and
 * react-test-renderer serialises HOST ELEMENT PROPS. A gesture builder is a
 * class instance holding functions and config; a legacy handler's
 * `onGestureEvent` can be an Animated.event object with back-references; a
 * FlatList `ListHeaderComponent` can be an ELEMENT (whose owner is a fiber);
 * `waitFor` is a ref whose `current` is a component instance. Any one of them
 * reaching a host element turns 474 tests into "Converting circular structure
 * to JSON". So:
 *   - `GestureDetector` renders its children ONLY; `gesture` never reaches a
 *     host element (it is recorded in a registry a test can read instead);
 *   - the legacy `*GestureHandler` components render children only;
 *   - `FlatList` renders its slot props as CHILDREN and never forwards `data`,
 *     `extraData`, `renderItem`, `keyExtractor` or the slots;
 *   - every other host element gets its props through `plainProps()`: an
 *     rn-stub Animated node resolves to its number, plain arrays/objects are
 *     walked (ancestor-tracked, so a cyclic plain object cannot recurse),
 *     refs and relation props are dropped by name, and any other object
 *     (class instance, React element) is dropped. Functions stay — toJSON
 *     keeps them and stringify drops them, which is what `onPress` needs.
 *
 * Deliberately NOT emulated: recognition. No touch is ever turned into a
 * gesture here — no activation criteria, offsets, velocity or pointer
 * counting; Simultaneous/Exclusive only remember their children;
 * `runOnJS`/worklets are a no-op distinction; the state manager, hit-slop
 * geometry, and the native buttons' ripple/underlay/active-opacity do not
 * exist. `Swipeable`/`DrawerLayout` refs are null (no `close()`/`openDrawer()`
 * to call). Whether a real finger would have activated a gesture is an
 * on-device check (M7-T09).
 *
 * Deliberately NOT exported: the third composer of the real `Gesture` object,
 * the one that lets whichever child recognises first win. Its name is a token
 * the §59 safety scan (backend safety_scan.test.ts, Hard rule D) bans in app
 * source, and the scan walks every screen too — so no app code can ever call
 * it without going red, and omitting it here loses nothing. Compose with
 * `Gesture.Exclusive` (first-wins in declaration order) or
 * `Gesture.Simultaneous`; calling the missing composer under the alias throws
 * "not a function", which is the visible failure the rule wants.
 *
 * Host tags. RN-equivalent components keep rn-stub's naming (`rn-flatlist`,
 * `rn-switch`, `rn-touchableopacity`) because on device they are drop-in
 * replacements for the RN ones; library-only components are `gh-*`
 * (`gh-rectbutton`, `gh-swipeable`). Find them with
 * `tree.root.find((n) => n.type === 'gh-rectbutton')`.
 */

import {
  createElement,
  Fragment,
  isValidElement,
  useEffect,
  useImperativeHandle,
  type ComponentType,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

// Same host tags as the app's own primitives: under the vitest alias
// 'react-native' IS rn-stub, so these render 'rn-scrollview', 'rn-pressable'
// (with the style-as-function form resolved) and so on. Under tsc they are
// the real components, which is the import shape production code expects.
export { Pressable, RefreshControl, ScrollView, Text, TextInput } from 'react-native';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

// --- enums (the real values, so production comparisons hold) --------------

export const State = {
  UNDETERMINED: 0,
  FAILED: 1,
  BEGAN: 2,
  CANCELLED: 3,
  ACTIVE: 4,
  END: 5,
} as const;

export const Directions = { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 } as const;

export const PointerType = { TOUCH: 0, STYLUS: 1, MOUSE: 2, KEY: 3, OTHER: 4 } as const;

export const MouseButton = {
  LEFT: 1,
  RIGHT: 2,
  MIDDLE: 4,
  BUTTON_4: 8,
  BUTTON_5: 16,
  ALL: 31,
} as const;

export const HoverEffect = { NONE: 0, LIFT: 1, HIGHLIGHT: 2 } as const;

// --- serialisation guard --------------------------------------------------

/** Same marker rn-stub puts on its Animated nodes (rn-stub.tsx `ANIMATED`). */
const ANIMATED = Symbol.for('roadopia.rn-stub.animated');

function isAnimated(v: unknown): v is { __value(): number } {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[ANIMATED] === true;
}

/** Reduce one prop value to something JSON.stringify accepts. `ancestors`
 *  holds the objects on the current path, so a plain object that loops back
 *  on itself is cut where the loop closes instead of recursing forever. */
function plain(v: unknown, ancestors: WeakSet<object> = new WeakSet()): unknown {
  if (isAnimated(v)) return v.__value();
  if (typeof v !== 'object' || v === null) return v; // primitives + functions
  if (ancestors.has(v)) return undefined; // the loop closes here
  if (Array.isArray(v)) {
    ancestors.add(v);
    const out = v.map((x) => plain(x, ancestors));
    ancestors.delete(v);
    return out;
  }
  const proto: unknown = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return undefined; // class instance
  if ('$$typeof' in v) return undefined; // React element: its owner is a fiber
  ancestors.add(v);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = plain(x, ancestors);
  ancestors.delete(v);
  return out;
}

/** Refs and handler-relation refs: their `current` is a component instance,
 *  and nothing in node could honour the relation anyway. */
const DROPPED = new Set(['ref', 'innerRef', 'waitFor', 'simultaneousHandlers', 'blocksHandlers']);

function plainProps(props: Record<string, unknown>, drop: ReadonlySet<string> = DROPPED) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!drop.has(k)) out[k] = plain(v);
  }
  return out;
}

function assertNoBareText(tag: string, children: ReactNode): void {
  // Mirror RN's invariant (and rn-stub's): raw strings/numbers may only sit
  // inside <Text>. On device this crashes; here it is a CI failure.
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
    return createElement(tag, plainProps(rest), children);
  };
}

/** Renders children only: every prop of the legacy handlers is either a
 *  handler relation (refs) or an event sink that may be an Animated.event
 *  object — none of it may reach a host element. */
function childrenOnly(props: AnyProps): ReactElement {
  return createElement(Fragment, null, props.children);
}

// --- gesture builder ------------------------------------------------------

/** The plain event `__fireGesture` hands to a handler. Every field is a
 *  number so the event itself survives JSON.stringify (a test may well put it
 *  there). The Pan fields are always present; another kind's fields (`scale`,
 *  `rotation`, `duration`, `numberOfTaps`…) ride along as extra keys. */
export interface StubGestureEvent extends Record<string, unknown> {
  handlerTag: number;
  numberOfPointers: number;
  pointerType: number;
  state: number;
  oldState: number;
  x: number;
  y: number;
  absoluteX: number;
  absoluteY: number;
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
}

export interface StubTouchData {
  id: number;
  x: number;
  y: number;
  absoluteX: number;
  absoluteY: number;
}

export interface StubTouchEvent {
  handlerTag: number;
  numberOfTouches: number;
  state: number;
  eventType: number;
  allTouches: StubTouchData[];
  changedTouches: StubTouchData[];
  pointerType: number;
}

export interface StubStateManager {
  begin(): void;
  activate(): void;
  fail(): void;
  end(): void;
}

type StateHandler = (event: StubGestureEvent) => void;
type EndHandler = (event: StubGestureEvent, success: boolean) => void;
type TouchHandler = (event: StubTouchEvent, manager: StubStateManager) => void;

/** What the chain registered, keyed by the method that registered it. The
 *  touch-stream handlers are stored but not driven by `__fireGesture`; a test
 *  that needs one calls it directly with a `StubTouchEvent`. */
export interface StubGestureHandlers {
  onBegin?: StateHandler;
  onStart?: StateHandler;
  onUpdate?: StateHandler;
  onChange?: StateHandler;
  onEnd?: EndHandler;
  onFinalize?: EndHandler;
  onTouchesDown?: TouchHandler;
  onTouchesMove?: TouchHandler;
  onTouchesUp?: TouchHandler;
  onTouchesCancelled?: TouchHandler;
}

export type StubGestureKind =
  | 'pan'
  | 'tap'
  | 'longPress'
  | 'native'
  | 'fling'
  | 'pinch'
  | 'rotation'
  | 'manual'
  | 'hover'
  | 'forceTouch'
  | 'simultaneous'
  | 'exclusive';

type HitSlop = number | null | undefined | Record<string, number>;
type Offset = number | [number, number];

let nextHandlerTag = 1;

/** A gesture, or a ref to one, reduced to its handler tag; anything else
 *  (a component ref from the old API) contributes nothing. */
function tagsOf(gestures: readonly unknown[]): number[] {
  const tags: number[] = [];
  for (const g of gestures) {
    const target =
      typeof g === 'object' && g !== null && 'current' in g
        ? (g as { current: unknown }).current
        : g;
    if (target instanceof StubGesture) tags.push(target.handlerTag);
  }
  return tags;
}

/**
 * ONE builder class for every gesture kind, base or composed: each
 * configuration method records its argument under `__config` (keyed by the
 * method name — `withTestId` → `testId`) and returns `this`, each `on*`
 * method records its callback under `__handlers`. A composed gesture keeps
 * its children in `__gestures` and `__fireGesture` fans out to them.
 * External-relation methods (`simultaneousWithExternalGesture`…) store
 * NOTHING: two gestures relating to each other would put a cycle on the
 * builder, and a builder must stay stringifiable for the day one leaks.
 */
export class StubGesture {
  readonly handlerTag: number;
  readonly __kind: StubGestureKind;
  readonly __handlers: StubGestureHandlers = {};
  readonly __config: Record<string, unknown> = {};
  readonly __gestures: readonly StubGesture[];

  constructor(kind: StubGestureKind, gestures: readonly StubGesture[] = []) {
    this.handlerTag = nextHandlerTag++;
    this.__kind = kind;
    this.__gestures = gestures;
  }

  private set(key: string, value: unknown): this {
    this.__config[key] = value;
    return this;
  }

  // -- callbacks
  onBegin(cb: StateHandler): this {
    this.__handlers.onBegin = cb;
    return this;
  }
  onStart(cb: StateHandler): this {
    this.__handlers.onStart = cb;
    return this;
  }
  onUpdate(cb: StateHandler): this {
    this.__handlers.onUpdate = cb;
    return this;
  }
  onChange(cb: StateHandler): this {
    this.__handlers.onChange = cb;
    return this;
  }
  onEnd(cb: EndHandler): this {
    this.__handlers.onEnd = cb;
    return this;
  }
  onFinalize(cb: EndHandler): this {
    this.__handlers.onFinalize = cb;
    return this;
  }
  onTouchesDown(cb: TouchHandler): this {
    this.__handlers.onTouchesDown = cb;
    return this;
  }
  onTouchesMove(cb: TouchHandler): this {
    this.__handlers.onTouchesMove = cb;
    return this;
  }
  onTouchesUp(cb: TouchHandler): this {
    this.__handlers.onTouchesUp = cb;
    return this;
  }
  onTouchesCancelled(cb: TouchHandler): this {
    this.__handlers.onTouchesCancelled = cb;
    return this;
  }

  // -- common configuration
  enabled(v: boolean): this {
    return this.set('enabled', v);
  }
  shouldCancelWhenOutside(v: boolean): this {
    return this.set('shouldCancelWhenOutside', v);
  }
  hitSlop(v: HitSlop): this {
    return this.set('hitSlop', v);
  }
  activeCursor(v: string): this {
    return this.set('activeCursor', v);
  }
  mouseButton(v: number): this {
    return this.set('mouseButton', v);
  }
  runOnJS(v: boolean): this {
    return this.set('runOnJS', v);
  }
  withTestId(id: string): this {
    return this.set('testId', id);
  }
  cancelsTouchesInView(v: boolean): this {
    return this.set('cancelsTouchesInView', v);
  }
  manualActivation(v: boolean): this {
    return this.set('manualActivation', v);
  }
  /** Old-API interop: the ref sees this builder at once (the real one sets it
   *  on initialize). The ref itself is NOT kept on the builder. */
  withRef(ref: { current: unknown }): this {
    ref.current = this;
    return this;
  }
  /** External relations are recorded as handler TAGS (numbers) under the
   *  real config keys — never as references, which would put a cycle on
   *  both builders the moment two gestures relate to each other. */
  simultaneousWithExternalGesture(...gestures: unknown[]): this {
    return this.set('simultaneousWith', tagsOf(gestures));
  }
  requireExternalGestureToFail(...gestures: unknown[]): this {
    return this.set('requireToFail', tagsOf(gestures));
  }
  blocksExternalGesture(...gestures: unknown[]): this {
    return this.set('blocksHandlers', tagsOf(gestures));
  }

  // -- pan
  activeOffsetX(v: Offset): this {
    return this.set('activeOffsetX', v);
  }
  activeOffsetY(v: Offset): this {
    return this.set('activeOffsetY', v);
  }
  failOffsetX(v: Offset): this {
    return this.set('failOffsetX', v);
  }
  failOffsetY(v: Offset): this {
    return this.set('failOffsetY', v);
  }
  minDistance(v: number): this {
    return this.set('minDistance', v);
  }
  minPointers(v: number): this {
    return this.set('minPointers', v);
  }
  maxPointers(v: number): this {
    return this.set('maxPointers', v);
  }
  minVelocity(v: number): this {
    return this.set('minVelocity', v);
  }
  minVelocityX(v: number): this {
    return this.set('minVelocityX', v);
  }
  minVelocityY(v: number): this {
    return this.set('minVelocityY', v);
  }
  averageTouches(v: boolean): this {
    return this.set('averageTouches', v);
  }
  enableTrackpadTwoFingerGesture(v: boolean): this {
    return this.set('enableTrackpadTwoFingerGesture', v);
  }
  activateAfterLongPress(v: number): this {
    return this.set('activateAfterLongPress', v);
  }

  // -- tap / long press / fling / native / hover
  numberOfTaps(v: number): this {
    return this.set('numberOfTaps', v);
  }
  maxDistance(v: number): this {
    return this.set('maxDistance', v);
  }
  maxDuration(v: number): this {
    return this.set('maxDuration', v);
  }
  maxDelay(v: number): this {
    return this.set('maxDelay', v);
  }
  maxDeltaX(v: number): this {
    return this.set('maxDeltaX', v);
  }
  maxDeltaY(v: number): this {
    return this.set('maxDeltaY', v);
  }
  minDuration(v: number): this {
    return this.set('minDuration', v);
  }
  numberOfPointers(v: number): this {
    return this.set('numberOfPointers', v);
  }
  direction(v: number): this {
    return this.set('direction', v);
  }
  shouldActivateOnStart(v: boolean): this {
    return this.set('shouldActivateOnStart', v);
  }
  disallowInterruption(v: boolean): this {
    return this.set('disallowInterruption', v);
  }
  effect(v: number): this {
    return this.set('effect', v);
  }

  // -- real-API compatibility (production code rarely touches these)
  /** The leaves, in order — a base gesture is its own only leaf. */
  toGestureArray(): StubGesture[] {
    return this.__gestures.length === 0
      ? [this]
      : this.__gestures.flatMap((g) => g.toGestureArray());
  }
  initialize(): void {}
  prepare(): void {}
}

export const Gesture = {
  Pan: (): StubGesture => new StubGesture('pan'),
  Tap: (): StubGesture => new StubGesture('tap'),
  LongPress: (): StubGesture => new StubGesture('longPress'),
  Native: (): StubGesture => new StubGesture('native'),
  Fling: (): StubGesture => new StubGesture('fling'),
  Pinch: (): StubGesture => new StubGesture('pinch'),
  Rotation: (): StubGesture => new StubGesture('rotation'),
  Manual: (): StubGesture => new StubGesture('manual'),
  Hover: (): StubGesture => new StubGesture('hover'),
  ForceTouch: (): StubGesture => new StubGesture('forceTouch'),
  Simultaneous: (...gestures: StubGesture[]): StubGesture =>
    new StubGesture('simultaneous', gestures),
  Exclusive: (...gestures: StubGesture[]): StubGesture => new StubGesture('exclusive', gestures),
  // The first-wins composer is deliberately absent — see the header.
};

// --- test hooks -----------------------------------------------------------

/**
 * Narrow a builder to this stub's class. Under the vitest alias a screen's
 * `Gesture.Pan()` IS a `StubGesture` at runtime but is TYPED as the real
 * `PanGesture` (production code and its tests type-check against the real
 * package), so a test holding one calls this to read `__config` /
 * `__handlers` / `__gestures` without a cast. Throws on anything else, so a
 * wrong object fails at the lookup rather than three lines on. Pure; nothing
 * to restore.
 */
export function __stubGesture(gesture: object): StubGesture {
  if (gesture instanceof StubGesture) return gesture;
  throw new Error('gesture-handler-stub: not a gesture built by this stub');
}

export type StubGesturePhase = 'begin' | 'start' | 'update' | 'change' | 'end' | 'finalize';

const PHASE_STATE: Record<StubGesturePhase, number> = {
  begin: State.BEGAN,
  start: State.ACTIVE,
  update: State.ACTIVE,
  change: State.ACTIVE,
  end: State.END,
  finalize: State.END,
};

const PHASE_OLD_STATE: Record<StubGesturePhase, number> = {
  begin: State.UNDETERMINED,
  start: State.BEGAN,
  update: State.ACTIVE,
  change: State.ACTIVE,
  end: State.ACTIVE,
  finalize: State.END,
};

function fire(handler: StateHandler | undefined, event: StubGestureEvent): boolean {
  if (!handler) return false;
  handler(event);
  return true;
}

function fireEnd(handler: EndHandler | undefined, event: StubGestureEvent, ok: boolean): boolean {
  if (!handler) return false;
  handler(event, ok);
  return true;
}

/**
 * DRIVE a gesture: call the handler the builder registered for `phase`
 * (`begin`→onBegin, `start`→onStart, `update`→onUpdate, `change`→onChange,
 * `end`→onEnd, `finalize`→onFinalize) with a plain event. Every numeric field
 * defaults to 0 and `state`/`oldState` to the phase's natural values; pass
 * only what the assertion needs (`{ translationY: 120, velocityY: 900 }`).
 * `success` is the second argument of onEnd/onFinalize. A composed gesture
 * fans out to every leaf. Returns whether ANY handler ran, so a test can tell
 * "nothing registered" from "registered and silent". Wrap the call in `act()`
 * when the handler sets React state. Recognition is NOT emulated: the handler
 * runs whether or not a real finger would have activated the gesture. Takes
 * the builder as `object` because under the alias it is typed as the real
 * `GestureType` (see `__stubGesture`).
 */
export function __fireGesture(
  builder: object,
  phase: StubGesturePhase,
  event: Partial<StubGestureEvent> = {},
  success = true,
): boolean {
  const gesture = __stubGesture(builder);
  if (gesture.__gestures.length > 0) {
    let fired = false;
    for (const child of gesture.__gestures) {
      fired = __fireGesture(child, phase, event, success) || fired;
    }
    return fired;
  }
  const full: StubGestureEvent = {
    handlerTag: gesture.handlerTag,
    numberOfPointers: 1,
    pointerType: PointerType.TOUCH,
    x: 0,
    y: 0,
    absoluteX: 0,
    absoluteY: 0,
    translationX: 0,
    translationY: 0,
    velocityX: 0,
    velocityY: 0,
    state: PHASE_STATE[phase],
    oldState: PHASE_OLD_STATE[phase],
    ...event,
  };
  const h = gesture.__handlers;
  switch (phase) {
    case 'begin':
      return fire(h.onBegin, full);
    case 'start':
      return fire(h.onStart, full);
    case 'update':
      return fire(h.onUpdate, full);
    case 'change':
      return fire(h.onChange, full);
    case 'end':
      return fireEnd(h.onEnd, full, success);
    case 'finalize':
      return fireEnd(h.onFinalize, full, success);
  }
}

/** Builders attached to a currently-mounted `GestureDetector`, in mount
 *  order — how a screen test reaches a gesture the screen built internally.
 *  Module state shared by every test in a file: a test that mounts a detector
 *  restores by unmounting its tree (`tree.unmount()` inside `act`) or by
 *  calling `__clearMountedGestures()` in afterEach. */
const mounted = new Set<StubGesture>();

export function __mountedGestures(): StubGesture[] {
  return [...mounted];
}

/** The mounted LEAF gesture whose chain called `.withTestId(testId)` —
 *  composed gestures are searched through. Throws when absent, so a screen
 *  that quietly dropped its gesture fails at the lookup, not three lines on. */
export function __mountedGesture(testId: string): StubGesture {
  for (const root of mounted) {
    const leaf = root.toGestureArray().find((g) => g.__config['testId'] === testId);
    if (leaf) return leaf;
  }
  throw new Error(`gesture-handler-stub: no mounted gesture with testId "${testId}"`);
}

export function __clearMountedGestures(): void {
  mounted.clear();
}

// --- components -----------------------------------------------------------

export interface GestureDetectorProps {
  gesture: StubGesture;
  children?: ReactNode;
  userSelect?: 'none' | 'auto' | 'text';
  enableContextMenu?: boolean;
  touchAction?: string;
}

/** Children only. The builder is registered for `__mountedGestures` and
 *  NEVER forwarded: it is a class instance holding functions and config. */
export function GestureDetector(props: GestureDetectorProps): ReactElement {
  const { gesture, children } = props;
  useEffect(() => {
    mounted.add(gesture);
    return () => {
      mounted.delete(gesture);
    };
  }, [gesture]);
  return createElement(Fragment, null, children);
}

/** An 'rn-view' with `flex: 1` merged UNDER the caller's style (the real one
 *  uses `style ?? { flex: 1 }`; merging keeps the fill when a caller only adds
 *  a colour, and the caller still wins on any key it sets). */
export function GestureHandlerRootView(props: AnyProps & { style?: unknown }): ReactElement {
  const { children, style, ...rest } = props;
  assertNoBareText('rn-view', children);
  const merged = style === undefined ? { flex: 1 } : [{ flex: 1 }, plain(style)];
  return createElement('rn-view', { ...plainProps(rest), style: merged }, children);
}

/** @deprecated in the real library too; identity here. */
export function gestureHandlerRootHOC<C>(component: C): C {
  return component;
}

export function createNativeWrapper<C>(component: C): C {
  return component;
}

export const TapGestureHandler = childrenOnly;
export const PanGestureHandler = childrenOnly;
export const LongPressGestureHandler = childrenOnly;
export const PinchGestureHandler = childrenOnly;
export const RotationGestureHandler = childrenOnly;
export const FlingGestureHandler = childrenOnly;
export const ForceTouchGestureHandler = childrenOnly;
export const NativeViewGestureHandler = childrenOnly;

export const Switch = host('rn-switch');
export const TouchableOpacity = host('rn-touchableopacity');
export const TouchableWithoutFeedback = host('rn-touchablewithoutfeedback');
export const TouchableHighlight = host('rn-touchablehighlight');
export const TouchableNativeFeedback = host('rn-touchablenativefeedback');
export const RawButton = host('gh-rawbutton');
export const PureNativeButton = host('gh-purenativebutton');
export const BaseButton = host('gh-basebutton');
export const RectButton = host('gh-rectbutton');
export const BorderlessButton = host('gh-borderlessbutton');
export const Swipeable = host('gh-swipeable');
export const DrawerLayout = host('gh-drawerlayout');
export const DrawerLayoutAndroid = host('gh-drawerlayout');

export function enableExperimentalWebImplementation(): void {}
export function enableLegacyWebImplementation(): void {}

// --- FlatList -------------------------------------------------------------

/** A slot the way RN types it: a component, an element, or nothing. */
type Slot = ComponentType<Record<string, never>> | ReactElement | null | undefined;

export interface StubListRenderItemInfo<ItemT> {
  item: ItemT;
  index: number;
  separators: {
    highlight(): void;
    unhighlight(): void;
    updateProps(): void;
  };
}

/** The scroll methods production code calls through a ref; no-ops in node
 *  (nothing scrolls) but present, so `listRef.current?.scrollToOffset(...)`
 *  is not a crash. */
export interface StubFlatListHandle {
  scrollToOffset(): void;
  scrollToIndex(): void;
  scrollToItem(): void;
  scrollToEnd(): void;
}

export interface StubFlatListProps<ItemT> extends Record<string, unknown> {
  data?: ReadonlyArray<ItemT> | null;
  renderItem?: ((info: StubListRenderItemInfo<ItemT>) => ReactElement | null) | null;
  keyExtractor?: (item: ItemT, index: number) => string;
  ListHeaderComponent?: Slot;
  ListFooterComponent?: Slot;
  ListEmptyComponent?: Slot;
  ItemSeparatorComponent?: Slot;
  /** Rendered as the first CHILD, as rn-stub's ScrollView does — kept as a
   *  prop an element sits in the JSON tree with its fiber owner. */
  refreshControl?: ReactElement | null;
  ref?: Ref<StubFlatListHandle>;
}

const SEPARATORS: StubListRenderItemInfo<unknown>['separators'] = {
  highlight() {},
  unhighlight() {},
  updateProps() {},
};

const LIST_HANDLE: StubFlatListHandle = {
  scrollToOffset() {},
  scrollToIndex() {},
  scrollToItem() {},
  scrollToEnd() {},
};

/** `extraData` is an opaque re-render token (anything at all); the slots and
 *  callbacks become children. None of them is a host prop. */
const FLATLIST_DROPPED = new Set([
  ...DROPPED,
  'extraData',
  'getItemLayout',
  'renderScrollComponent',
]);

function renderSlot(slot: Slot): ReactNode {
  if (slot === null || slot === undefined) return null;
  if (isValidElement(slot)) return slot;
  return createElement(slot);
}

/** RN's default key: `item.key`, then `item.id`, then the index. */
function keyOf(item: unknown, index: number): string {
  if (typeof item === 'object' && item !== null) {
    const rec = item as Record<string, unknown>;
    if (typeof rec['key'] === 'string') return rec['key'];
    if (typeof rec['id'] === 'string') return rec['id'];
  }
  return String(index);
}

/**
 * Header, then every row (keyed, separators between), then footer — or the
 * empty slot when there is no data — inside host 'rn-flatlist'. Not
 * virtualised: every row renders, which is what a smoke test wants to see.
 * A function component with `ref` as a prop (React 19), so it stays generic
 * over the item type and still answers the scroll methods.
 */
export function FlatList<ItemT>(props: StubFlatListProps<ItemT>): ReactElement {
  const {
    data,
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    ItemSeparatorComponent,
    refreshControl,
    ref,
    ...rest
  } = props;
  useImperativeHandle(ref, () => LIST_HANDLE, []);

  const items = data ?? [];
  const rows = items.map((item, index) => {
    const rendered = renderItem ? renderItem({ item, index, separators: SEPARATORS }) : null;
    assertNoBareText('rn-flatlist', rendered);
    const key = keyExtractor ? keyExtractor(item, index) : keyOf(item, index);
    const separator = index < items.length - 1 ? renderSlot(ItemSeparatorComponent) : null;
    return createElement(Fragment, { key }, rendered, separator);
  });

  return createElement(
    'rn-flatlist',
    plainProps(rest, FLATLIST_DROPPED),
    refreshControl ?? null,
    renderSlot(ListHeaderComponent),
    ...(rows.length === 0 ? [renderSlot(ListEmptyComponent)] : rows),
    renderSlot(ListFooterComponent),
  );
}
