/**
 * The app-owned gesture sheet (redesign — SPEC "Shell chrome > Shelf"; used by
 * MapHome and Builder).
 *
 * WHY NOT A NATIVE SHEET. `@expo/ui`'s `BottomSheet` and the native-stack
 * `formSheet` are the right answer for a sheet that is its own destination —
 * SignIn is one. This sheet is not: it is persistent, never dismissed, lives
 * INSIDE a screen over a live map that must keep receiving touches, must not
 * cover the tab bar, and pushes the camera's insets FROM its detents. That is
 * the one carve-out expo-animation RECIPES makes ("build this only when the
 * sheet has to live inside an existing screen"), and the SPEC's decided
 * hard-rule conflict #5.
 *
 * THE FOUR DETAILS (RECIPES "Bottom sheet you can drag to dismiss"), each the
 * difference between fluid and merely fine:
 *   1. `onStart` captures the current value — a sheet grabbed mid-spring
 *      continues from where the eye last saw it, never teleports.
 *   2. Velocity decides, not distance — `nearestDetent` projects `y` by the
 *      release velocity (`lib/shelf.ts`), so a quick flick commits and a slow
 *      long drag does not feel heavy.
 *   3. The velocity is handed to the spring (`{ duration: 300, dampingRatio:
 *      0.8, velocity }`), so there is no seam between the finger letting go
 *      and the animation continuing.
 *   4. `overshootClamping` at the lowest detent — the sheet must never spring
 *      past its floor and flash the map under its own header.
 *
 * ONE SHARED VALUE, `y`, the visible height in pt. The box is laid out at the
 * TOP detent's height and translated down by `max − y`: transform only, never
 * an animated `height` (expo-animation §4 — a layout pass per frame for the
 * sheet and everything in it). The footer rides on the same value in the other
 * direction, so it is glued to the container's bottom edge at every `y`, on
 * the UI thread, with no layout pass; the body pads its bottom by
 * `max − committed` ONCE PER COMMIT so the end of a list is reachable at every
 * detent.
 *
 * SCROLL HANDOFF. Below the top detent a vertical pan moves the sheet and the
 * body cannot scroll. At the top detent the body scrolls — except a DOWNWARD
 * pan with the list at `contentOffset.y === 0`, which takes the sheet. Both are
 * decided on the UI thread: the pan is `simultaneousWithExternalGesture` with
 * a `Gesture.Native()` wrapped around the body, the body's scroll handler
 * writes its offset to a shared value the pan reads, and `scrollEnabled` is an
 * animated prop derived from the committed index and whether the current pan
 * has taken the sheet — so a finger that takes the sheet down from the top
 * cancels the list's own scroll the same frame (§6: never `setState` from a
 * gesture). The map is OUTSIDE the detector: tiles are the map's at every
 * detent, and Mapbox's own pan is never contested.
 *
 * THE COMMIT. A detent is COMMITTED at exactly two sites — `onEnd`, and a
 * programmatic `snapTo` — and each goes through one `commit` worklet that
 * fires `scheduleOnRN(Haptics.impactAsync, Light)` once and
 * `scheduleOnRN(announce, index)` once, ONLY when the committed index changes.
 * Never per frame; never twice for a re-catch of the same detent (a flick that
 * settles back where it was is silent — nothing new happened). The SPEC
 * phrases this as a `useAnimatedReaction` on the committed index; on device
 * the two are the same frame and the same count, and the commit sites are
 * where a node test can drive it (the reanimated stub's reaction, by design,
 * never fires), so the reaction's contract is held at the sites that write
 * the index. The haptic fires when the detent CATCHES — the frame the spring
 * starts, as the recipe does — not when the animation finishes (§8 "same frame
 * as the visual").
 *
 * PROGRAMMATIC CHANGES (state, not finger) go through `ref.snapTo(key)`: a
 * `withTiming` on the iOS sheet curve at `motion.sheetIn` (300 ms), or
 * `motion.crossFade` (140 ms) under Reduce Motion — timed, because nothing
 * pushed it; `ReduceMotion.Never` on that timing because the shortened
 * version must still play rather than pop (§9: fewer and gentler, not zero).
 * `snapTo(key, { settle: true })` is the no-finger spring (`motion.spring.
 * settle`, dampingRatio 1) Builder uses when a route lands. The release spring
 * itself runs with `ReduceMotion.System` — under the OS switch the sheet lands
 * without overshoot, as the SPEC says. A ref, not a `detent` prop, because the
 * same detent is asked for twice in a row (open detail A → half; drag to full;
 * open detail B → half) and a prop that has not changed cannot ask again.
 *
 * GESTURES ARE MEMOISED and keyed by the detents' VALUES, not the record's
 * identity: a gesture rebuilt on a render re-attaches the recognizer and drops
 * a drag mid-flight (RECIPES), and a consumer that computes `detents` inline
 * from the window height would rebuild it every render.
 */

import * as Haptics from 'expo-haptics';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import {
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { nearestDetent, rubberband, sortDetents, type Detent } from '../../lib/shelf';
import { motion, radius, spacing, useTheme } from '../../theme';

import { Material } from './Material';
import { EASE_SHEET, useReducedMotion } from './motion';

/** The grabber: 36×5, hairline — the drag affordance every sheet carries. */
const GRABBER = { width: 36, height: 5 } as const;

/** The pan must commit to a vertical intent before it activates, so a
 *  horizontal swipe inside the body (a card rail, a swipeable row) wins. */
const ACTIVE_OFFSET_Y: [number, number] = [-10, 10];

/** The pan's test id — how a test reaches the gesture the sheet built. */
export const SHELF_PAN_TEST_ID = 'shelf-pan';

/**
 * What the Shelf hands a custom body renderer: the exact props it would put on
 * its own `Animated.ScrollView`, so a VIRTUALIZED body (MapHome's `FlatList`
 * of drive cards — SPEC "The Shelf") takes part in the scroll handoff the
 * same way. A `FlatList` nested inside the default ScrollView would neither
 * virtualize nor scroll; this hands the list the ScrollView's place instead.
 */
export interface ShelfBodyProps {
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  scrollEventThrottle: number;
  animatedProps: Partial<ScrollViewProps>;
  bounces: false;
  keyboardShouldPersistTaps: 'handled';
  showsVerticalScrollIndicator: false;
  style: ViewStyle;
  /** Once per COMMIT: the end of the body is reachable at every detent. */
  contentContainerStyle: { paddingBottom: number };
}

/** The imperative surface for a programmatic detent change (state, not finger). */
export interface ShelfHandle {
  /**
   * Move to `key`. Default: `withTiming` on the sheet curve (300 ms; 140 ms
   * under Reduce Motion). `settle: true`: the no-finger spring (`{ duration:
   * 400, dampingRatio: 1 }`) for a sheet that rises because content landed.
   *
   * `silent: true` suppresses the detent haptic. The impact is feedback for a
   * MOVE THE USER MADE — a catch under their finger, or a sheet answering the
   * tap they just made. A sheet that rises because an async result landed is
   * an entrance nobody asked for at that instant, and the haptics policy
   * ("one per user action … nothing on entrances") says it must be silent.
   * `onDetent` still fires either way: the camera has to re-fit regardless.
   */
  snapTo(key: string, options?: { settle?: boolean; silent?: boolean }): void;
}

export interface ShelfProps {
  /** Visible heights in pt, from the bottom of the sheet's container. Keyed
   *  by the name `onDetent` reports; order does not matter. */
  detents: Readonly<Record<string, number>>;
  /** The detent the sheet mounts at. Must be a key of `detents`. */
  initial: string;
  /** Disables the drag: the sheet stays at its committed detent. */
  locked?: boolean;
  /** Fires once per committed detent change — never per frame. */
  onDetent?: (key: string) => void;
  /** Always visible, under the grabber. The drag works on it and on the body. */
  header: ReactNode;
  /** The body — scrolls at the top detent, drags the sheet below it. */
  children?: ReactNode;
  /**
   * A body that is its own scroll container (a `FlatList`): the Shelf hands
   * over the scroll props it would put on its ScrollView and renders the
   * result in that ScrollView's place. `children` is not rendered when set.
   * The element returned must be the scrollable itself (an `Animated.FlatList`
   * / `Animated.ScrollView`), not a wrapper around one — the body's native
   * gesture attaches to it.
   */
  renderBody?: (props: ShelfBodyProps) => ReactElement;
  /** Pinned inside the sheet at the container's bottom edge, over the body,
   *  on an opaque `surface` ground. */
  footer?: ReactNode;
  /** Merged LAST: the sheet's position in its container — a Map tab passes
   *  `{ bottom: tabBarHeight }`. */
  style?: StyleProp<ViewStyle>;
  ref?: Ref<ShelfHandle>;
  testID?: string;
}

/** Ascending detents, stable across renders while their VALUES hold. */
function useStableDetents(detents: Readonly<Record<string, number>>): Detent[] {
  const signature = JSON.stringify(sortDetents(detents));
  return useMemo(() => JSON.parse(signature) as Detent[], [signature]);
}

export function Shelf({
  detents,
  initial,
  locked = false,
  onDetent,
  header,
  children,
  renderBody,
  footer,
  style,
  ref,
  testID,
}: ShelfProps): React.JSX.Element {
  const { colors } = useTheme();
  const reduced = useReducedMotion();

  const sorted = useStableDetents(detents);
  const heights = useMemo(() => sorted.map((d) => d.height), [sorted]);
  const keys = useMemo(() => sorted.map((d) => d.key), [sorted]);
  const min = heights[0] ?? 0;
  const max = heights[heights.length - 1] ?? 0;
  const topIndex = heights.length - 1;

  const initialIndex = keys.indexOf(initial);
  if (process.env.NODE_ENV !== 'production') {
    if (sorted.length === 0) throw new Error('Shelf: `detents` must name at least one detent.');
    if (initialIndex < 0) {
      throw new Error(`Shelf: \`initial\` "${initial}" is not a key of \`detents\`.`);
    }
  }

  // --- the shared values ---------------------------------------------------------
  /** Visible height, in pt. The ONE value everything else derives from. */
  const y = useSharedValue(heights[Math.max(initialIndex, 0)] ?? 0);
  /** `y` when the finger landed — the recipe's `context`. */
  const start = useSharedValue(0);
  /** Index of the committed detent. Written at the two commit sites only. */
  const committed = useSharedValue(Math.max(initialIndex, 0));
  /** Who the current pan belongs to: 0 undecided, 1 the sheet, −1 the body's scroll. */
  const owns = useSharedValue(0);
  /** The body's `contentOffset.y`, written by its scroll handler. */
  const scrollOffset = useSharedValue(0);

  // --- the RN-thread side of a commit -----------------------------------------------
  // `onDetent` may be an inline arrow that changes identity every render; the
  // worklet captures a STABLE function that reads the latest through a ref, so a
  // re-render never rebuilds the gesture (and never drops a drag).
  const onDetentRef = useRef(onDetent);
  useEffect(() => {
    onDetentRef.current = onDetent;
  });
  /** Which detent is committed, on the RN thread — the body's padding reads it. */
  const [committedIndex, setCommittedIndex] = useState(Math.max(initialIndex, 0));
  const announce = useCallback(
    (index: number): void => {
      setCommittedIndex(index);
      const key = keys[index];
      if (key !== undefined) onDetentRef.current?.(key);
    },
    [keys],
  );

  // --- geometry changes (a measured detent, a window resize) ----------------------------
  // The committed detent keeps its KEY; its height may have moved. No animation:
  // the geometry changed, nothing travelled.
  useEffect(() => {
    const index = Math.min(committed.get(), heights.length - 1);
    committed.set(index);
    y.set(heights[index] ?? 0);
  }, [heights, committed, y]);

  // --- the gestures ---------------------------------------------------------------
  const scroll = useMemo(() => Gesture.Native(), []);

  const pan = useMemo(() => {
    /** Commit `index`: once per change, the haptic and the announcement. */
    const commit = (index: number): void => {
      'worklet';
      if (index === committed.get()) return;
      committed.set(index);
      scheduleOnRN(Haptics.impactAsync, Haptics.ImpactFeedbackStyle.Light);
      scheduleOnRN(announce, index);
    };

    return Gesture.Pan()
      .withTestId(SHELF_PAN_TEST_ID)
      .enabled(!locked)
      .activeOffsetY(ACTIVE_OFFSET_Y)
      .simultaneousWithExternalGesture(scroll)
      .onStart(() => {
        start.set(y.get());
        owns.set(0);
      })
      .onUpdate((e) => {
        if (owns.get() === 0) {
          // Decide ONCE per gesture, on the first movement past the activation
          // offset — so the sign of `translationY` is a real intent.
          const atTop = committed.get() === topIndex && start.get() >= max - 0.5;
          if (atTop && (scrollOffset.get() > 0 || e.translationY <= 0)) {
            owns.set(-1); // the list scrolls; the sheet holds
            return;
          }
          owns.set(1);
        }
        if (owns.get() < 0) return;
        // Down the screen is LESS sheet: the finger's translation is subtracted.
        y.set(rubberband(start.get() - e.translationY, min, max));
      })
      .onEnd((e) => {
        if (owns.get() < 0) return;
        const velocity = -e.velocityY; // screen-down → sheet-shrinking
        const index = nearestDetent(y.get(), velocity, heights);
        const target = heights[index] ?? min;
        y.set(
          withSpring(target, {
            ...motion.spring.sheet,
            velocity,
            overshootClamping: index === 0,
            reduceMotion: ReduceMotion.System,
          }),
        );
        commit(index);
      })
      .onFinalize(() => {
        owns.set(0);
      });
  }, [
    locked,
    scroll,
    heights,
    min,
    max,
    topIndex,
    announce,
    y,
    start,
    committed,
    owns,
    scrollOffset,
  ]);

  // --- programmatic detent change (state, not finger) --------------------------------------
  useImperativeHandle(
    ref,
    () => ({
      snapTo(key, options) {
        const index = keys.indexOf(key);
        if (index < 0) {
          if (process.env.NODE_ENV !== 'production') {
            throw new Error(`Shelf.snapTo: "${key}" is not a key of \`detents\`.`);
          }
          return;
        }
        const target = heights[index] ?? min;
        if (options?.settle === true) {
          y.set(withSpring(target, { ...motion.spring.settle, reduceMotion: ReduceMotion.System }));
        } else {
          y.set(
            withTiming(target, {
              duration: reduced ? motion.crossFade : motion.sheetIn,
              easing: EASE_SHEET,
              reduceMotion: ReduceMotion.Never,
            }),
          );
        }
        if (index !== committed.get()) {
          committed.set(index);
          // Silent for a rise nobody's finger caused (see `ShelfHandle`).
          if (options?.silent !== true) {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          announce(index);
        }
      },
    }),
    [keys, heights, min, reduced, y, committed, announce],
  );

  // --- the UI-thread derivations ------------------------------------------------------
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollOffset.set(e.contentOffset.y);
    },
  });

  /** The box is laid out at `max` and translated down by what is not visible. */
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: max - y.get() }],
  }));

  /** The footer rides the other way, so it sits on the container's bottom edge at every `y`. */
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(max - y.get()) }],
  }));

  /** The body scrolls only at the top detent, and never while this pan owns the sheet. */
  const scrollProps = useAnimatedProps<ScrollViewProps>(() => ({
    scrollEnabled: committed.get() === topIndex && owns.get() <= 0,
  }));

  const committedHeight = heights[committedIndex] ?? max;

  /** The scroll props the body carries — the Shelf's own ScrollView or the
   *  consumer's list, identically (see `ShelfBodyProps`). */
  const bodyProps: ShelfBodyProps = {
    onScroll,
    scrollEventThrottle: 16,
    animatedProps: scrollProps,
    bounces: false,
    keyboardShouldPersistTaps: 'handled',
    showsVerticalScrollIndicator: false,
    style: styles.body,
    // Once per COMMIT, never per frame: the end of the body is reachable
    // at every detent, not only at the top one.
    contentContainerStyle: { paddingBottom: max - committedHeight },
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        testID={testID}
        style={[
          { position: 'absolute', left: 0, right: 0, bottom: 0, height: max },
          sheetStyle,
          style,
        ]}
      >
        <Material role="sheet" style={{ flex: 1 }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{ alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs }}
          >
            <View
              style={{
                width: GRABBER.width,
                height: GRABBER.height,
                borderRadius: radius.pill,
                backgroundColor: colors.hairline,
              }}
            />
          </View>
          <View>{header}</View>
          <GestureDetector gesture={scroll}>
            {renderBody !== undefined ? (
              renderBody(bodyProps)
            ) : (
              <Animated.ScrollView {...bodyProps}>{children}</Animated.ScrollView>
            )}
          </GestureDetector>
          {footer !== undefined && footer !== null ? (
            <Animated.View
              style={[
                footerStyle,
                // An opaque tier inside the material, over the scrolling body.
                {
                  backgroundColor: colors.surface,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                },
              ]}
            >
              {footer}
            </Animated.View>
          ) : null}
        </Material>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
