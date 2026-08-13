/**
 * The Saved flow stack (M8): SavedHome →(tap a drive)→ SavedRoute.
 * A listed row that does nothing is a dead end (§18); the detail screen
 * reuses the SHARED RouteDetail component (FR-074) rather than a second
 * renderer, so a saved drive reads exactly like a fresh result.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';

import FollowScreen, { type FollowScreenParams } from '../screens/FollowScreen';
import SavedRouteScreen, { type SavedRouteScreenParams } from '../screens/SavedRouteScreen';
import SavedScreen from '../screens/SavedScreen';
import { useTheme } from '../theme';

export type SavedStackParamList = {
  SavedHome: undefined;
  SavedRoute: SavedRouteScreenParams;
  Follow: FollowScreenParams;
};

const Stack = createNativeStackNavigator<SavedStackParamList>();

export default function SavedStack(): ReactElement {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surfaceRaised },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="SavedHome" options={{ headerShown: false }}>
        {(p) => (
          <SavedScreen
            navigation={{
              navigate: (screen, params) => p.navigation.navigate(screen as never, params as never),
            }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="SavedRoute" options={{ title: 'Saved drive' }}>
        {(p) => (
          <SavedRouteScreen
            navigation={{
              goBack: () => p.navigation.goBack(),
              navigate: (screen, params) => p.navigation.navigate(screen as never, params as never),
            }}
            route={{ params: p.route.params }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Follow" options={{ headerShown: false }}>
        {(p) => (
          <FollowScreen
            navigation={{ goBack: () => p.navigation.goBack() }}
            route={{ params: p.route.params }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
