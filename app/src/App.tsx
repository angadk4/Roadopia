/**
 * Roadopia root component (M7-T01). Replaces the SPK-01 rig screen (deleted —
 * recorded in the decision log 2026-07-16): providers + the root stack.
 * Theme follows the OS (dark-first, §19); both palettes ship (§663 contrast).
 *
 * REDESIGN SHELL (SPEC "Navigation & IA > RootStack"; rule 11):
 *
 *   - `GestureHandlerRootView` wraps everything. The shelf, the swipe-to-
 *     delete rows and every `GestureDetector` in the app need it at the root
 *     (a detector outside it silently receives nothing), and it must be the
 *     outermost view so the navigators' own gesture handlers share it.
 *   - The container's child is `RootStack`, not the tabs: the tabs are its
 *     first route, the sign-in sheet its second — a real `formSheet` that
 *     replaces the RN `Modal` that used to sit beside the container.
 *   - The auth engine's `sheetOpen` drives that route through a container
 *     ref (`AuthSheetRoute`, below). FR-201 stays exactly what it was: the
 *     ONLY sign-in trigger is a gated action while anonymous; this just
 *     turns the flag into a navigation. The route's unmount closes the loop
 *     for a platform dismissal (`screens/SignInScreen`).
 */

import {
  createNavigationContainerRef,
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { secureSessionStore } from './lib/session_store_secure';
import { AuthProvider, useAuth } from './lib/use_auth';
import RootStack, { type RootStackParamList } from './nav/RootStack';
import { colorsFor, useTheme } from './theme';

function navTheme(name: 'dark' | 'light'): Theme {
  const base = name === 'dark' ? DarkTheme : DefaultTheme;
  const c = colorsFor(name);
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.bg,
      card: c.surfaceRaised,
      text: c.text,
      border: c.border,
    },
  };
}

/** The one handle on the root stack from outside a screen: the auth mirror
 *  below is its only user. */
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Mirrors the engine's `sheetOpen` onto the `SignIn` route. Renders nothing;
 * lives inside `AuthProvider` (it reads the context) and beside the container
 * (it drives the ref). Opens the sheet when the flag turns true; pops it when
 * the flag turns false WHILE the sheet is the current route — after a
 * successful verify or "Not now". A swipe-down pop reaches the engine the
 * other way round (the route's unmount → `dismissSheet()`), by which time the
 * sheet is no longer current and this effect has nothing to do.
 *
 * The engine's initial session read is async, so the flag cannot turn true
 * before the container has mounted; the `isReady()` guard is belt and braces.
 */
function AuthSheetRoute(): null {
  const { sheetOpen } = useAuth();
  useEffect(() => {
    if (!navigationRef.isReady()) return;
    const current = navigationRef.getCurrentRoute()?.name;
    if (sheetOpen && current !== 'SignIn') {
      navigationRef.navigate('SignIn');
    } else if (!sheetOpen && current === 'SignIn' && navigationRef.canGoBack()) {
      navigationRef.goBack();
    }
  }, [sheetOpen]);
  return null;
}

export default function App(): ReactElement {
  const { name } = useTheme();
  return (
    <GestureHandlerRootView style={styles.root}>
      {/* BD-204: `initialWindowMetrics` seeds the insets SYNCHRONOUSLY from
          the native side. Without it every header-less screen renders one
          frame with top inset 0 and then snaps down ~59pt on a Dynamic Island
          iPhone — the visible jolt on cold start of MapHome and Follow. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
        {/* M8-T01: auth wraps the shell; the sign-in sheet is a route of the
            root stack, opened only when a gated action fires while anonymous
            (FR-201). */}
        <AuthProvider store={secureSessionStore}>
          <NavigationContainer ref={navigationRef} theme={navTheme(name)}>
            <RootStack />
          </NavigationContainer>
          <AuthSheetRoute />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = { root: { flex: 1 } } as const;
