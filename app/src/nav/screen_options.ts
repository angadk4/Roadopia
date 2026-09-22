/**
 * The four header kinds (redesign — SPEC "Shell chrome > Headers"; rule 13).
 *
 * Every stack composes its screen options from THESE and nothing else, and no
 * screen draws its own page title any more: the title is the native header's,
 * large where the page is a page (it collapses into the bar as the reader
 * scrolls — `contentInsetAdjustmentBehavior="automatic"` on the scroll view
 * directly under it is what makes that happen natively), compact where the
 * page is a task over a map.
 *
 * WHY PLAIN FUNCTIONS THAT TAKE THE THEME, NOT HOOKS. A stack's `options` is
 * often a callback — `options={({ route }) => pageOptions(route.params.name,
 * theme)}` — and a hook cannot be called inside a callback. A function that
 * takes the theme works in both places; the stack calls `useTheme()` once at
 * its top (it already does) and passes the result down. The theme argument is
 * the exact shape `useTheme()` returns.
 *
 *   pageOptions(title, theme)              a page: LARGE title, collapsing
 *   mapTaskOptions(title, theme)           a task over a map: compact title
 *   modalTaskOptions(title, theme, cancel) a modal card: compact + Cancel
 *   phoneOwnerOptions                      Follow: no header, no back gesture
 *
 * THE CHROME. Transparent header over the platform's chrome material
 * (`systemChromeMaterialDark` / `…Light` by theme), under a paper tint of the
 * page ground so the material reads as THIS app's paper and not as bare
 * glass; ink from the theme (`text` on the titles, `accentText` on the back
 * chevron and Cancel — amber is the action colour and a header button is an
 * action); no shadow line, ever (the material's own edge does that job); and
 * the page ground under the content so a screen never flashes the navigator's
 * default card colour on the way in.
 *
 * The blur is iOS-only in react-native-screens, so Android gets the tint
 * alone — at the SPEC's own "no blur" fallback alpha, because a 55% tint over
 * scrolling content with nothing blurring it is a legibility problem, not a
 * material. Device-verify on iOS that the tint composes with the effect (SPEC
 * "Headers"); if it does not, iOS drops to `tintNoBlur` with the blur removed.
 * Both alphas live in `theme.material.header` (rule 17: every non-map literal
 * lives in theme.ts) — this module holds no literals of its own.
 *
 * `headerLargeTitleEnabled` is the current name of the SPEC's
 * `headerLargeTitle` (deprecated in native-stack 7.17; expo-animation §3 says
 * so) — the same option, the non-deprecated key.
 */

import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { createElement, type ReactElement } from 'react';
import { Platform } from 'react-native';

import { PressableScale, Text } from '../components/ui';
import { material, withAlpha, type ThemeColors, type ThemeName } from '../theme';

/** What `useTheme()` returns — the stack passes it straight through. */
export interface HeaderTheme {
  name: ThemeName;
  colors: ThemeColors;
}

/** The transparent-over-material chrome every header kind shares. */
function chrome(theme: HeaderTheme): NativeStackNavigationOptions {
  const { name, colors } = theme;
  const blurred = Platform.OS === 'ios';
  return {
    headerTransparent: true,
    headerBlurEffect: name === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight',
    headerStyle: {
      backgroundColor: withAlpha(
        colors.bg,
        blurred ? material.header.tint : material.header.tintNoBlur,
      ),
    },
    headerTitleStyle: { color: colors.text },
    headerTintColor: colors.accentText,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.bg },
  };
}

/**
 * A PAGE — a tab root or a pushed page of reading: the large title that
 * collapses into the bar on scroll. The screen's first child must be a
 * ScrollView / FlatList with `contentInsetAdjustmentBehavior="automatic"`.
 */
export function pageOptions(title: string, theme: HeaderTheme): NativeStackNavigationOptions {
  return {
    ...chrome(theme),
    title,
    headerLargeTitleEnabled: true,
    headerLargeTitleStyle: { color: theme.colors.text },
    headerLargeTitleShadowVisible: false,
  };
}

/**
 * A TASK OVER A MAP — Builder, Record, and the two modal cards: a compact
 * title on the same transparent material, so the map bleeds under the bar.
 */
export function mapTaskOptions(title: string, theme: HeaderTheme): NativeStackNavigationOptions {
  return {
    ...chrome(theme),
    title,
    headerLargeTitleEnabled: false,
  };
}

/** The header's Cancel: a plain text button in the action colour. Built with
 *  `createElement` because this is a `.ts` module — one element, no JSX. */
function HeaderCancel(props: { onPress: () => void }): ReactElement {
  return createElement(
    PressableScale,
    { onPress: props.onPress, accessibilityLabel: 'Cancel' },
    createElement(Text, { variant: 'label', tone: 'accent' }, 'Cancel'),
  );
}

/**
 * A MODAL CARD — PickPoint, AddSpot: a self-contained task the user can
 * abandon, presented as the iOS card, with Cancel where iOS puts it (the
 * header's left). `onCancel` is the stack's `goBack()`; these screens only
 * ever go back (SPEC "The presentation invariant").
 */
export function modalTaskOptions(
  title: string,
  theme: HeaderTheme,
  onCancel: () => void,
): NativeStackNavigationOptions {
  return {
    ...mapTaskOptions(title, theme),
    presentation: 'modal',
    headerLeft: () => createElement(HeaderCancel, { onPress: onCancel }),
  };
}

/**
 * A screen that OWNS THE PHONE — Follow: no header, and no interactive back
 * gesture, because the only exits are the ones that unmount it and release
 * the GPS stream and the wake-lock (tab_spec.ts).
 */
export const phoneOwnerOptions: NativeStackNavigationOptions = {
  headerShown: false,
  gestureEnabled: false,
};
