/**
 * The translucent chrome (redesign — SPEC "Shell chrome > Material").
 *
 * The tab bar, the shelf, a pinned bar, Follow's panels, the 44pt map circles:
 * everything that floats over the live map or over scrolling content is a
 * MATERIAL — an `expo-blur` `BlurView` under a paper-coloured overlay with a
 * 1px lit top edge — and nothing else in the app is. `Surface` keeps the
 * opaque in-page panels (`inset` / `raised`); its `floating` level is what
 * this replaces, one consumer at a time.
 *
 * THREE RULES (SPEC rule 9), each enforced here rather than remembered:
 *
 *   1. NEVER NESTED. Inside a material everything is an opaque tier —
 *      `Surface`, `surface`, `fill` — because a blur of a blur is mud and
 *      costs a second render pass. A React context flag makes a nested
 *      `<Material>` throw in development.
 *   2. INTENSITY IS NEVER ANIMATED. It is a constant from `theme.material`,
 *      not a prop, so there is nothing to animate: a material that must appear
 *      crossfades the whole layer's `opacity` (expo-animation §4 — on Android
 *      an animated intensity re-renders the blur every frame).
 *   3. SOLID UNDER REDUCE TRANSPARENCY. When the OS says so, the material is
 *      opaque `surfaceRaised` — the same shape, no blur, no overlay.
 *
 * REDUCE TRANSPARENCY is read the way `ui/press.ts` reads Reduce Motion: a
 * module cache, seeded on import and refreshed on every mount, kept current
 * by the OS event — so the first render already holds the answer, modulo the
 * documented cold-launch window. `isReduceTransparencyEnabled` is an iOS-only
 * API: Android's `AccessibilityInfo` has no such method, and neither does the
 * node test stub, so it is called with optional chaining and its absence
 * simply means "not reduced" — a material without the answer is a blurred one.
 * The stub is not edited to add it; a test that wants the solid branch
 * patches the method on the stub's plain object and lets the mount refresh
 * read it.
 *
 * WHY THE OVERLAY IS NOT CONTRAST-BEARING. Ink is never drawn on a material
 * directly; a material's contents are opaque tiers whose contrast
 * `theme.test.ts` measures. The overlay alphas (`theme.material.overlay`) tune
 * how much of the map shows through, nothing else.
 */

import { BlurView } from 'expo-blur';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from 'react-native';

import { HIT_TARGET, material, radius, squircle, useTheme, withAlpha } from '../../theme';

// --- Reduce Transparency, cached at MODULE scope --------------------------------

let reduceTransparency = false;
let primed = false;
const listeners = new Set<(value: boolean) => void>();

function publish(value: boolean): void {
  if (value === reduceTransparency) return;
  reduceTransparency = value;
  for (const listener of listeners) listener(value);
}

/** Ask the OS once. Optional chaining: iOS-only API — absent on Android and in
 *  the node stub — and absent means "not reduced". */
function refresh(): void {
  AccessibilityInfo.isReduceTransparencyEnabled?.()
    .then(publish)
    .catch(() => undefined); // an unavailable a11y API is not an error
}

/** Seed the cache and keep it current. Idempotent; runs on import. */
function prime(): void {
  if (primed) return;
  primed = true;
  refresh();
  // One subscription for the life of the JS context, deliberately never
  // removed — there is no moment at which the app stops caring.
  AccessibilityInfo.addEventListener?.('reduceTransparencyChanged', publish);
}

prime();

/** The cached OS "Reduce Transparency" flag — synchronous, safe during render. */
export function reduceTransparencyEnabled(): boolean {
  return reduceTransparency;
}

/**
 * Tracks the OS "Reduce Transparency" switch across renders. Seeded from the
 * cache, refreshed on mount (the answer may have arrived between import and
 * this mount), then kept in step with the OS.
 */
export function useReduceTransparency(): boolean {
  const [reduced, setReduced] = useState(reduceTransparencyEnabled);
  useEffect(() => {
    setReduced(reduceTransparencyEnabled());
    listeners.add(setReduced);
    refresh();
    return () => {
      listeners.delete(setReduced);
    };
  }, []);
  return reduced;
}

// --- The component --------------------------------------------------------------

/**
 *   bar    the tab bar, a pinned bottom bar — square, full width
 *   sheet  the shelf — top corners `radius.xl`
 *   panel  Follow / Record panels and HUD — `radius.lg`
 *   pill   a 44pt circle or capsule — `radius.pill`
 *   dense  Follow's status band — panel shape, the heavier overlay
 */
export type MaterialRole = 'bar' | 'sheet' | 'panel' | 'pill' | 'dense';

export interface MaterialProps {
  role: MaterialRole;
  /** Merged LAST: position and size come from the caller (a tab-bar background
   *  passes `flex: 1`; a pinned bar passes its absolute position). */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

/** `true` inside a material's subtree — the nesting guard. */
const InsideMaterial = createContext(false);

const ABSOLUTE_FILL: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

function shapeFor(role: MaterialRole): ViewStyle {
  switch (role) {
    case 'bar':
      return {};
    case 'sheet':
      return {
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
        overflow: 'hidden',
        ...squircle,
      };
    case 'panel':
    case 'dense':
      return { borderRadius: radius.lg, overflow: 'hidden', ...squircle };
    case 'pill':
      return {
        borderRadius: radius.pill,
        overflow: 'hidden',
        minWidth: HIT_TARGET,
        minHeight: HIT_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
      };
  }
}

export function Material({ role, style, children, testID }: MaterialProps): React.JSX.Element {
  const nested = useContext(InsideMaterial);
  if (nested && process.env.NODE_ENV !== 'production') {
    throw new Error(
      'Material: never nested. Inside a Material everything is an opaque tier — ' +
        'use Surface, or the surface / fill tokens.',
    );
  }

  const { name, colors } = useTheme();
  const solid = useReduceTransparency();

  const overlay =
    role === 'dense'
      ? withAlpha(colors.bg, material.overlay.dense)
      : name === 'dark'
        ? withAlpha(colors.bg, material.overlay.dark)
        : withAlpha(colors.surface, material.overlay.light);

  return (
    <InsideMaterial.Provider value={true}>
      <View
        testID={testID}
        style={[
          shapeFor(role),
          // The 1px lit edge — light catching the top of a physical surface.
          // It replaces the tab bar's 2pt index rule; the index rule keeps its
          // job INSIDE pages.
          { borderTopWidth: 1, borderTopColor: colors.topEdge },
          solid && { backgroundColor: colors.surfaceRaised },
          style,
        ]}
      >
        {solid ? null : (
          <>
            <BlurView
              tint={name === 'dark' ? 'dark' : 'light'}
              intensity={material.intensity}
              style={ABSOLUTE_FILL}
            />
            <View pointerEvents="none" style={[ABSOLUTE_FILL, { backgroundColor: overlay }]} />
          </>
        )}
        {children}
      </View>
    </InsideMaterial.Provider>
  );
}
