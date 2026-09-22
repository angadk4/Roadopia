/**
 * The root stack (redesign — SPEC "Navigation & IA > RootStack").
 *
 * Two routes. `Tabs` is the whole app as it was — the bottom-tab shell,
 * untouched in behaviour. `SignIn` is the sign-in sheet as a real
 * `UISheetPresentationController`: the platform's grabber, corner radius,
 * drag-to-dismiss, dimming and keyboard avoidance, none of it hand-rolled
 * (expo-animation §3: "a bottom sheet that is its own screen →
 * `presentation: 'formSheet'` — free and correct"). The body inside it is the
 * same RN form it always was (`components/SignInSheet` → `SignInBody`).
 *
 * WHO OPENS IT. Nobody navigates here by hand. The auth engine's `sheetOpen`
 * is the single source of truth (FR-201: the ONLY sign-in trigger is a gated
 * action while anonymous), and `App.tsx` mirrors that flag onto this stack
 * through the container ref — navigate when it turns true, pop when it turns
 * false while the sheet is up. The route's own unmount tells the engine when
 * the platform dismissed it (a swipe), so a parked action is dropped exactly
 * once (`screens/SignInScreen`).
 *
 * `fitToContents` needs explicitly sized content — the body has no `flex: 1`
 * root (expo-animation RECIPES). `sheetGrabberVisible` is iOS-only; Android
 * shows no grabber and the sheet is still draggable.
 *
 * The presentation invariant (SPEC): `SignIn`'s params carry no route to
 * Follow or Record — a form sheet never navigates to a screen that owns the
 * phone; it only ever goes back.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';

import SignInScreen from '../screens/SignInScreen';
import { radius, useTheme } from '../theme';

import RootTabs from './tabs';

export type RootStackParamList = {
  Tabs: undefined;
  SignIn: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStack(): ReactElement {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={RootTabs} />
      <Stack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          // The one radius that says "floating over the app, not a card".
          sheetCornerRadius: radius.xl,
          // The sheet's own ground: the raised tier, opaque — the body draws
          // its inputs on `fill` and its ink on `text` over this.
          contentStyle: { backgroundColor: colors.surfaceRaised },
          // The sheet's `title`-role text is its title; no bar above it.
          headerShown: false,
        }}
      />
    </Stack.Navigator>
  );
}
