/**
 * Safe-area helpers (device pass, 2026-09-04). Screens that render with
 * `headerShown: false` (MapHome, Follow) put their first line under the
 * Dynamic Island unless they pad by the top inset themselves. App.tsx mounts
 * SafeAreaProvider; this is the one consumer, so the rule lives in one place:
 * a header-less screen pads its top by `useTopInset()`. Every screen with a
 * native header drops its hand-rolled top padding (redesign — SPEC "Shell
 * chrome > Headers").
 *
 * THE TAB BAR'S HEIGHT (redesign — SPEC "Shell chrome > Tab bar"). The bar is
 * absolutely positioned and translucent, so content scrolls UNDER it and every
 * scrolling tab root pads its bottom by the bar's height; map screens feed the
 * same number to their camera insets. `@react-navigation/bottom-tabs` exports
 * `useBottomTabBarHeight()` for exactly this, and it is not used here, for two
 * reasons that are both about the tests:
 *
 *   1. It THROWS outside a tab navigator ("Couldn't find the bottom tab bar
 *      height"), and every screen in this app is rendered BARE by its node
 *      test — no navigator, no tab bar. A screen that called it would fail
 *      to render under test at all.
 *   2. The package cannot be imported under vitest: it is an externalised
 *      dependency, so the `react-native` alias does not reach it, and it
 *      loads the real `react-native` entry — Flow syntax that node cannot
 *      parse. One import in this file would take every screen test down.
 *
 * So the number travels through an APP-OWNED context instead: `nav/tabs.tsx`
 * provides the bar's own height (`BAR_CONTENT_H + bottomInset` — the same
 * explicit `height` it hands the navigator, and therefore the same number the
 * library would report), and `useTabBarHeight()` reads it, defaulting to 0
 * where there is no bar — a bare render in a test, or a screen outside the
 * tabs (the SignIn sheet).
 */

import { createContext, useContext } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The device's top inset (status bar / notch / Dynamic Island), in dp. */
export function useTopInset(): number {
  return useSafeAreaInsets().top;
}

/** The device's bottom inset (the home-indicator strip on Face ID phones), in
 *  dp. A control laid out inside it competes with the system home gesture. */
export function useBottomInset(): number {
  return useSafeAreaInsets().bottom;
}

/** The tab bar's height, provided by `nav/tabs.tsx` around its navigator.
 *  0 = no bar (a bare render, or a screen outside the tabs). */
export const TabBarHeightContext = createContext(0);

/**
 * The height of the translucent tab bar the content scrolls under, in dp —
 * what a scrolling tab root pads its bottom by, and what a map screen adds to
 * its camera's bottom inset. Follow and Record hide the bar and pad nothing.
 */
export function useTabBarHeight(): number {
  return useContext(TabBarHeightContext);
}
