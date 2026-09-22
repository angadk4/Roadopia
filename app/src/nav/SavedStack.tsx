/**
 * The Saved flow stack (M8): SavedHome →(tap a drive)→ SavedRoute.
 * A listed row that does nothing is a dead end (§18); the detail screen
 * reuses the SHARED RouteDetail component (FR-074) rather than a second
 * renderer, so a saved drive reads exactly like a fresh result.
 *
 * REDESIGN (SPEC "Navigation & IA > Stacks and presentation", SavedStack rows;
 * rule 13). Every header here is composed from `nav/screen_options.ts` and
 * nothing else — no screen in this stack draws its own title any more:
 *
 *   SavedHome   tab root, a PAGE: large title "Saved" that collapses into the
 *               bar as the library's FlatList scrolls under it.
 *   SavedRoute  a page titled by the DRIVE'S NAME — `params.name` at once, so
 *               the header is never blank while the row loads; the loaded row
 *               and a rename re-title it through the `setTitle` adapter. Its
 *               `headerRight` is the `ellipsis.circle` menu (Rename · Delete
 *               drive), which the SCREEN builds — it owns the handlers — and
 *               hands over through `setHeaderRight`; `null` takes it out
 *               again (an explicit undefined un-sets the option).
 *   Follow      owns the phone: no header, no back gesture, tab bar hidden
 *               (`tab_spec`); the only exits unmount it.
 *
 * THE PRESENTATION INVARIANT (SPEC): nothing in this stack is presented as a
 * modal or a form sheet, so nothing here can reach Follow from one. Follow is
 * pushed, and stays pushed.
 *
 * Pushes run the platform's own transition; under Reduce Motion they cross-
 * fade (SPEC vocabulary: `animation: reduced ? 'fade' : 'default'`).
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';

import { useReducedMotion } from '../components/ui';
import FollowScreen, { type FollowScreenParams } from '../screens/FollowScreen';
import SavedRouteScreen, { type SavedRouteScreenParams } from '../screens/SavedRouteScreen';
import SavedScreen from '../screens/SavedScreen';
import { useTheme } from '../theme';

import { pageOptions, phoneOwnerOptions } from './screen_options';

export type SavedStackParamList = {
  SavedHome: undefined;
  SavedRoute: SavedRouteScreenParams;
  Follow: FollowScreenParams;
};

const Stack = createNativeStackNavigator<SavedStackParamList>();

export default function SavedStack(): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  return (
    <Stack.Navigator screenOptions={{ animation: reduced ? 'fade' : 'default' }}>
      {/* Screens keep lightweight prop shapes (node-smoke-testable without
          React Navigation); these adapters bridge the typed navigator. */}
      <Stack.Screen name="SavedHome" options={pageOptions('Saved', theme)}>
        {(p) => (
          <SavedScreen
            navigation={{
              navigate: (screen, params) => p.navigation.navigate(screen as never, params as never),
              // A drive saved on another tab must be here when the user comes
              // back (device pass: "saved drives aren't saving" was a list
              // that loaded once and never refreshed).
              addFocusListener: (cb) => p.navigation.addListener('focus', cb),
            }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen
        name="SavedRoute"
        options={({ route }) => pageOptions(route.params?.name ?? 'Saved drive', theme)}
      >
        {(p) => (
          <SavedRouteScreen
            navigation={{
              goBack: () => p.navigation.goBack(),
              navigate: (screen, params) => p.navigation.navigate(screen as never, params as never),
              addFocusListener: (cb) => p.navigation.addListener('focus', cb),
              setTitle: (title) => p.navigation.setOptions({ title }),
              setHeaderRight: (render) =>
                p.navigation.setOptions({ headerRight: render ?? undefined }),
            }}
            route={{ params: p.route.params }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Follow" options={phoneOwnerOptions}>
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
