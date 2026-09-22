/**
 * Bottom-tab navigation (M7-T01; Master Spec §16/§20).
 *
 * React Navigation (native + bottom-tabs) — the Dependency Verification is
 * silent on a navigation library, so this is a logged builder choice (decision
 * log, M7-T01): the RN-standard, New-Arch-compatible stack, installed at
 * Expo-SDK-55-matched versions via `expo install`. Deep links (§20.4 — shared
 * routes, eval page) ride NavigationContainer `linking` at M13.
 *
 * REDESIGN SHELL (SPEC "Shell chrome > Tab bar"; rule 14). The bar is the one
 * piece of chrome on every screen, so it is where the new materials land
 * first. What changed and why:
 *
 *   GROUND. The bar is ABSOLUTE and TRANSPARENT over the page, and its ground
 *   is a `Material` (blur + paper tint + a 1px lit top edge): content scrolls
 *   under it, and the map shows through it. The opaque `surfaceRaised` slab
 *   and its 2pt `borderStrong` top edge are gone — the index rule keeps its
 *   job INSIDE pages, and the material's `topEdge` catches the light here.
 *   Every scrolling tab root pads its bottom by `useTabBarHeight()`
 *   (`lib/insets`), which this navigator provides; map screens feed the same
 *   number to their camera insets.
 *
 *   SELECTION IS STILL THREE CHANNELS. Measured on this bar, the active and
 *   inactive tints land at almost the same luminance (dark ≈5.9:1 vs ≈5.8:1;
 *   light ≈6.4:1 vs ≈6.6:1), so colour alone cannot carry the selected state
 *   and never could. Three things carry it: the filled-vs-outline glyph (the
 *   only channel that survives greyscale), a 700-weight label, and an
 *   `accentTint` capsule behind the active icon. The capsule's arrival is
 *   now a Reanimated CSS TRANSITION on `opacity` + `transform` — a two-state
 *   change is exactly what a CSS transition is for (expo-animation §3) — at
 *   the cross-fade duration on the strong ease-out; under Reduce Motion the
 *   scale is dropped and the fade stays.
 *
 *   GLYPHS are `Symbol`s (SF on iOS, Ionicons on Android) at 24pt, weight
 *   medium, named by `tab_spec`'s `symbol` / `symbolFilled`.
 *
 *   MOTION. Tab switches never slide and never cross-fade: tabs are peers,
 *   not a hierarchy, and a switch happens dozens of times a session
 *   (expo-animation §1: "Tab switches never slide. `animation: 'none'`").
 *   The `shift` preset, its `transitionSpec` and the `sceneStyle` that
 *   covered the offset are deleted. Pressing a tab dips through
 *   `PressableScale` — the same 120ms transform transition every bounded
 *   control in the app uses.
 *
 * UNCHANGED ON PURPOSE: the Follow / Record `display: 'none'` toggle below.
 * Those screens hold a live GPS stream and a wake-lock, and hiding the bar is
 * what forces the only exits (Exit, back) to UNMOUNT them and release both
 * (tab_spec.ts; review 2026-09-07). Presenting them as a `fullScreenModal`
 * would cover the bar more cleanly and is explicitly out of scope here — a
 * regression on that path once left the stream running for hours.
 *
 * THE BAR IS NOW FOUR (SPEC "The tab bar — four tabs"): Map | Plan | Create |
 * Saved. Discover and Map were two tabs on the same map, so the merged
 * `MapHome` is one tab in the lead slot — `tab_spec` is the data, this file
 * only maps each name to its stack.
 *
 * Tab bar honors the owner's M7 UI bar: ≥44 pt items, amber active tint with
 * label + icon (tappable at a glance), surface/border from the shared theme.
 */

import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps,
} from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useMemo, type ComponentType, type ReactElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  CSS_EASE_OUT,
  Material,
  PressableScale,
  Symbol,
  SYMBOLS,
  Text,
  useReducedMotion,
  type SymbolKey,
} from '../components/ui';
import { TabBarHeightContext, useBottomInset } from '../lib/insets';
import { HIT_TARGET, motion, radius, useTheme } from '../theme';

import CreateStack from './CreateStack';
import MapStack from './MapStack';
import PlanStack from './PlanStack';
import SavedStack from './SavedStack';
import { TAB_SPEC, tabBarHiddenFor, type TabSpec } from './tab_spec';

export type RootTabParamList = Record<TabSpec['name'], undefined>;

const SCREENS: Record<TabSpec['name'], ComponentType> = {
  Map: MapStack,
  Plan: PlanStack,
  Create: CreateStack,
  Saved: SavedStack,
};

/**
 * The bar's content box, above the home-indicator inset.
 *
 * Sized deliberately rather than inherited: 5 + 28 (icon slot) + 14 (the
 * `micro` role's line box) + 5. The library's own 49 was tuned for a 10pt
 * label with no leading, and the type scale's smallest role overflows it by
 * 3pt — which is invisible on a Face ID phone and clipped at the screen edge
 * on a home-button one. Stating the height is also what keeps the height this
 * navigator PROVIDES (`TabBarHeightContext`) honest: it is the number the
 * navigator is told, not one measured after the fact.
 */
const BAR_CONTENT_H = 52;

/** The tab glyph, in pt (SPEC: 24pt, weight medium). */
const TAB_GLYPH = 24;

/** The active-tab capsule, sized to the icon slot it sits behind. */
const ICON_SLOT = { width: 46, height: 28 } as const;

/** Where the capsule rests before it arrives — it grows INTO place, never past
 *  it (zero bounce is a global rule), and never from nothing (no scale(0)). */
const CAPSULE_REST_SCALE = 0.86;

/**
 * SF name → `SymbolKey`, once, for the whole table. `tab_spec` names its
 * glyphs by SF name (so the `.fill` pairing is testable as data); `Symbol`
 * takes a semantic key. A name `SYMBOLS` does not know throws here, at
 * module load, in every environment — and `tab_spec.test` pins the same
 * fact on the data, so it fails as a test before it can fail as a screen.
 */
const SYMBOL_KEY_BY_SF: ReadonlyMap<string, SymbolKey> = new Map(
  (Object.keys(SYMBOLS) as SymbolKey[]).map((key) => [SYMBOLS[key].sf, key]),
);

function symbolKeyFor(sf: string): SymbolKey {
  const key = SYMBOL_KEY_BY_SF.get(sf);
  if (key === undefined) {
    throw new Error(
      `tabs: "${sf}" is not a glyph in SYMBOLS — add it before naming it in tab_spec.`,
    );
  }
  return key;
}

const TAB_GLYPHS: ReadonlyMap<TabSpec['name'], { idle: SymbolKey; focused: SymbolKey }> = new Map(
  TAB_SPEC.map((t) => [
    t.name,
    { idle: symbolKeyFor(t.symbol), focused: symbolKeyFor(t.symbolFilled) },
  ]),
);

const Tab = createBottomTabNavigator<RootTabParamList>();

/**
 * One tab item: the selection capsule, plus real press feedback.
 *
 * This is deliberately `tabBarButton` and not `tabBarIcon`. The library
 * renders the icon slot TWICE — a focused copy and an idle copy stacked on top
 * of each other — and steps their opacity, so no component in that slot ever
 * sees `focused` change and nothing there can animate a transition. The button
 * is the one instance that survives the change, so the capsule lives here.
 *
 * COMPOSITION. The library hands this button the item's LAYOUT style (its
 * flex share of the bar, its padding) and a `PlatformPressable` prop bag. The
 * layout style goes on an outer `View` — `PressableScale` styles the box it
 * scales, not the cell it sits in — and that cell stretches its child, so the
 * pressable spans the whole cell and the whole cell is the target (no slop,
 * which would spill into the neighbour). The accessibility the tab depends on
 * is forwarded EXPLICITLY, never spread: role, label and selected state on the
 * pressable (the VoiceOver element); iOS's large-content-viewer title on the
 * cell, which is how an 11pt label stays reachable at accessibility text
 * sizes. The library's `onPress` / `onLongPress` ignore their event argument
 * (they emit `tabPress` / `tabLongPress` and navigate), so the narrower
 * zero-argument signature is the same call.
 */
function TabItem(props: BottomTabBarButtonProps): ReactElement {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const focused = props['aria-selected'] === true;
  const label = props['aria-label'];

  return (
    <View
      style={[props.style as StyleProp<ViewStyle>, styles.cell]}
      accessibilityShowsLargeContentViewer={props.accessibilityShowsLargeContentViewer}
      accessibilityLargeContentTitle={props.accessibilityLargeContentTitle}
    >
      <PressableScale
        accessibilityRole={props.role === 'tab' ? 'tab' : 'button'}
        {...(label !== undefined ? { accessibilityLabel: label } : {})}
        accessibilityState={{ selected: focused }}
        {...(props.testID !== undefined ? { testID: props.testID } : {})}
        {...(props.onPress !== undefined ? { onPress: props.onPress as () => void } : {})}
        {...(props.onLongPress !== undefined
          ? { onLongPress: props.onLongPress as () => void }
          : {})}
        hitSlop={0}
        style={styles.item}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.selection,
            {
              backgroundColor: colors.accentTint,
              opacity: focused ? 1 : 0,
              // Grows into place; never past it. Under Reduce Motion the
              // fade stays and the growth goes (fewer and gentler, not zero).
              transform: [{ scale: focused || reduced ? 1 : CAPSULE_REST_SCALE }],
              transitionProperty: ['opacity', 'transform'],
              transitionDuration: motion.crossFade,
              transitionTimingFunction: CSS_EASE_OUT,
            },
          ]}
        />
        {props.children}
      </PressableScale>
    </View>
  );
}

/** The bar's ground: one material, filling the slot the library gives it. */
function renderBarBackground(): ReactElement {
  return <Material role="bar" style={styles.fill} />;
}

export default function RootTabs(): ReactElement {
  const { colors } = useTheme();
  const bottomInset = useBottomInset();
  const barHeight = BAR_CONTENT_H + bottomInset;

  // Hoisted out of the render function below: `screenOptions` runs per route on
  // every render, and rebuilding this object each time re-rendered the bar.
  const barStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      backgroundColor: 'transparent',
      borderTopWidth: 0,
      height: barHeight,
    }),
    [barHeight],
  );

  return (
    <TabBarHeightContext.Provider value={barHeight}>
      <Tab.Navigator
        screenOptions={({ route }) => {
          const glyphs = TAB_GLYPHS.get(route.name);
          // Follow / Record own the phone (GPS + wake-lock): no tab bar under
          // them, so leaving means Exit/back, which unmounts and releases both.
          const nested = getFocusedRouteNameFromRoute(route);
          return {
            headerShown: false,
            // Tabs are peers: no slide, no cross-fade (expo-animation §1).
            animation: 'none',
            tabBarActiveTintColor: colors.accentText,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarStyle: [
              barStyle,
              { display: tabBarHiddenFor(nested) ? ('none' as const) : ('flex' as const) },
            ],
            tabBarBackground: renderBarBackground,
            tabBarItemStyle: { minHeight: HIT_TARGET },
            tabBarIconStyle: ICON_SLOT,
            tabBarButton: (props) => <TabItem {...props} />,
            tabBarIcon: ({ focused }) =>
              glyphs === undefined ? null : (
                <Symbol
                  name={focused ? glyphs.focused : glyphs.idle}
                  size={TAB_GLYPH}
                  weight="medium"
                  tone={focused ? 'accent' : 'muted'}
                />
              ),
            tabBarLabel: ({ focused, children }) => (
              <Text
                variant="micro"
                tone={focused ? 'accent' : 'muted'}
                numberOfLines={1}
                // Chrome, not copy: the bar is a fixed height, so the label
                // scales with Dynamic Type but cannot grow past its own slot.
                maxFontSizeMultiplier={1.1}
                style={focused ? styles.labelFocused : undefined}
              >
                {children}
              </Text>
            ),
          };
        }}
      >
        {TAB_SPEC.map((t) => (
          <Tab.Screen key={t.name} name={t.name} component={SCREENS[t.name]} />
        ))}
      </Tab.Navigator>
    </TabBarHeightContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  /** The library's item cell; its child is stretched so the pressable spans it. */
  cell: { alignItems: 'stretch' },
  /** The scaled box: the capsule, the glyph and the label move as one. */
  item: { alignItems: 'center', minHeight: HIT_TARGET },
  /** Sits exactly over the icon slot; the label stays outside it. */
  selection: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: ICON_SLOT.width,
    height: ICON_SLOT.height,
    borderRadius: radius.pill,
  },
  /** Weight is the channel that survives greyscale and colour blindness. */
  labelFocused: { fontWeight: '700' },
});
