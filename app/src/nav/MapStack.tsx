/**
 * The Map flow stack (M10): MapHome →(add)→ AddSpot / →(pin details)→ Spot.
 * MapHome reloads spots on focus so a just-added pin appears when the user
 * comes back (§18: the thing you made is visible where you made it).
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';

import AddSpotScreen, { type AddSpotScreenParams } from '../screens/AddSpotScreen';
import MapHome from '../screens/MapHome';
import SpotDetailScreen, { type SpotDetailScreenParams } from '../screens/SpotDetailScreen';
import { useTheme } from '../theme';

export type MapStackParamList = {
  MapHome: undefined;
  AddSpot: AddSpotScreenParams;
  Spot: SpotDetailScreenParams;
};

const Stack = createNativeStackNavigator<MapStackParamList>();

export default function MapStack(): ReactElement {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surfaceRaised },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="MapHome" options={{ headerShown: false }}>
        {(p) => (
          <MapHome
            navigation={{
              navigate: (screen, params) => p.navigation.navigate(screen as never, params as never),
              addFocusListener: (cb) => p.navigation.addListener('focus', cb),
            }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="AddSpot" options={{ title: 'Add a spot' }}>
        {(p) => (
          <AddSpotScreen
            navigation={{ goBack: () => p.navigation.goBack() }}
            route={{ params: p.route.params }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Spot" options={{ title: 'Spot' }}>
        {(p) => (
          <SpotDetailScreen
            navigation={{ goBack: () => p.navigation.goBack() }}
            route={{ params: p.route.params }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
