/**
 * Bottom-tab navigation (M7-T01; Master Spec §16/§20).
 *
 * React Navigation (native + bottom-tabs) — the Dependency Verification is
 * silent on a navigation library, so this is a logged builder choice (decision
 * log, M7-T01): the RN-standard, New-Arch-compatible stack, installed at
 * Expo-SDK-55-matched versions via `expo install`. Deep links (§20.4 — shared
 * routes, eval page) ride NavigationContainer `linking` at M13.
 *
 * Tab bar honors the owner's M7 UI bar: ≥44 pt items, amber active tint with
 * label + icon (tappable at a glance), surface/border from the shared theme.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { ComponentType, ReactElement } from 'react';

import MapHome from '../screens/MapHome';
import { CreateScreen, SavedScreen } from '../screens/placeholders';
import { HIT_TARGET, useTheme } from '../theme';

import PlanStack from './PlanStack';
import { TAB_SPEC, type TabSpec } from './tab_spec';

export type RootTabParamList = Record<TabSpec['name'], undefined>;

const SCREENS: Record<TabSpec['name'], ComponentType> = {
  Map: MapHome,
  Plan: PlanStack,
  Create: CreateScreen,
  Saved: SavedScreen,
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export default function RootTabs(): ReactElement {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const spec = TAB_SPEC.find((t) => t.name === route.name);
        return {
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.surfaceRaised,
            borderTopColor: colors.border,
          },
          tabBarItemStyle: { minHeight: HIT_TARGET },
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={(focused ? spec?.icon : spec?.iconIdle) as never}
              size={size}
              color={color}
            />
          ),
        };
      }}
    >
      {TAB_SPEC.map((t) => (
        <Tab.Screen key={t.name} name={t.name} component={SCREENS[t.name]} />
      ))}
    </Tab.Navigator>
  );
}
