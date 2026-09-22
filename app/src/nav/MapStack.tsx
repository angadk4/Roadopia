/**
 * The Map flow stack — the MERGED home's stack (redesign — SPEC "Navigation &
 * IA > Stacks and presentation", MapStack rows; "What is deleted": DiscoverStack
 * is gone and this stack absorbed it).
 *
 * WHAT IT WAS. Two stacks over the same map: `MapStack` (MapHome → AddSpot /
 * Spot / Follow, under hand-set opaque `surfaceRaised` headers) and
 * `DiscoverStack` (DiscoverHome → PickPoint / Progress / Result / Follow,
 * which owned the `PlanDraftContext`). WHAT IT IS. One stack whose root is the
 * merged `MapHome`, composed ONLY from `nav/screen_options.ts`:
 *
 *   MapHome   tab root, FULL-BLEED: the map is the page, so no header at all
 *             (its own `StatusScrim` covers the status bar).
 *   PickPoint a MODAL CARD titled for the point it asks for ("Start point" /
 *             "Destination"), Cancel in the header — the same card the Plan
 *             tab presents, so picking a start is one screen in the whole app.
 *   Progress  a page: "Planning your drive" — a Near-you drive that has to be
 *             planned runs here rather than sending the user to another tab.
 *   Result    a page titled by the drive's own name.
 *   Spot      a page titled by the spot's name (`params.name` at once, then
 *             `setTitle` from the loaded row), with the screen's own
 *             `ellipsis.circle` menu in `headerRight`.
 *   AddSpot   a MODAL CARD, "New spot", Cancel in the header.
 *   Follow    owns the phone: no header, no back gesture, tab bar hidden.
 *
 * THIS STACK OWNS THE PLAN DRAFT. PickPoint writes `draft.origin` and MapHome
 * reads it — the Map tab's Near-you scan is driven by the same shared draft the
 * Plan tab uses, without passing points through navigation params.
 *
 * THE PRESENTATION INVARIANT (SPEC): the two modal cards' adapters expose ONLY
 * `goBack` — by type, neither can reach Follow. Follow is pushed, never modal.
 *
 * Pushes run the platform's own transition; under Reduce Motion they cross-fade.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo, useState, type ReactElement } from 'react';

import { useReducedMotion } from '../components/ui';
import { DEFAULT_DRAFT, PlanDraftContext, type PlanDraft } from '../lib/plan_draft';
import AddSpotScreen, { type AddSpotScreenParams } from '../screens/AddSpotScreen';
import FollowScreen, { type FollowScreenParams } from '../screens/FollowScreen';
import MapHome from '../screens/MapHome';
import PickPointScreen, { pickPointTitle, type PickPointTarget } from '../screens/PickPointScreen';
import ProgressScreen, { type ProgressScreenProps } from '../screens/ProgressScreen';
import ResultScreen, { type ResultScreenParams } from '../screens/ResultScreen';
import SpotDetailScreen, { type SpotDetailScreenParams } from '../screens/SpotDetailScreen';
import { useTheme } from '../theme';

import { modalTaskOptions, pageOptions, phoneOwnerOptions } from './screen_options';

type ProgressScreenParams = NonNullable<ProgressScreenProps['route']['params']>;

export type MapStackParamList = {
  MapHome: undefined;
  PickPoint: { target: PickPointTarget };
  Progress: ProgressScreenParams;
  Result: ResultScreenParams;
  Spot: SpotDetailScreenParams;
  AddSpot: AddSpotScreenParams;
  /** A seed route tapped on the map is followable in place (device pass:
   *  the route sheet had no action at all). */
  Follow: FollowScreenParams;
};

const Stack = createNativeStackNavigator<MapStackParamList>();

export default function MapStack(): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [draft, setDraftState] = useState<PlanDraft>(DEFAULT_DRAFT);
  const store = useMemo(
    () => ({
      draft,
      setDraft: (update: Partial<PlanDraft>) => setDraftState((d) => ({ ...d, ...update })),
    }),
    [draft],
  );

  return (
    <PlanDraftContext.Provider value={store}>
      <Stack.Navigator screenOptions={{ animation: reduced ? 'fade' : 'default' }}>
        {/* Screens keep lightweight prop shapes (node-smoke-testable without
            React Navigation); these adapters bridge the typed navigator. */}
        <Stack.Screen name="MapHome" options={{ headerShown: false }}>
          {(p) => (
            <MapHome
              navigation={{
                navigate: (screen, params) =>
                  p.navigation.navigate(screen as never, params as never),
                addFocusListener: (cb) => p.navigation.addListener('focus', cb),
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="PickPoint"
          options={({ route, navigation }) =>
            modalTaskOptions(pickPointTitle(route.params.target), theme, () => navigation.goBack())
          }
        >
          {(p) => (
            <PickPointScreen
              navigation={{ goBack: () => p.navigation.goBack() }}
              route={{ params: p.route.params }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Progress" options={pageOptions('Planning your drive', theme)}>
          {(p) => (
            <ProgressScreen
              navigation={{
                replace: (screen, params) => p.navigation.replace(screen as never, params as never),
                goBack: () => p.navigation.goBack(),
              }}
              route={{ params: p.route.params }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="Result"
          options={({ route }) => pageOptions(route.params.route?.name ?? 'Your drive', theme)}
        >
          {(p) => (
            <ResultScreen
              navigation={{
                goBack: () => p.navigation.goBack(),
                navigate: (screen, params) =>
                  p.navigation.navigate(screen as never, params as never),
                // "Plan another drive" must land on the map, not on the
                // previous result of a refinement chain.
                goHome: () => p.navigation.popToTop(),
              }}
              route={{ params: p.route.params }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="Spot"
          options={({ route }) => pageOptions(route.params?.name ?? 'Spot', theme)}
        >
          {(p) => (
            <SpotDetailScreen
              navigation={{
                goBack: () => p.navigation.goBack(),
                addFocusListener: (cb) => p.navigation.addListener('focus', cb),
                setTitle: (title) => p.navigation.setOptions({ title }),
                // The screen builds the `HeaderMenu` itself; the stack only
                // hands the render function to the header (or clears it).
                setHeaderRight: (render) =>
                  p.navigation.setOptions({ headerRight: render ?? undefined }),
              }}
              route={{ params: p.route.params }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="AddSpot"
          options={({ navigation }) =>
            modalTaskOptions('New spot', theme, () => navigation.goBack())
          }
        >
          {(p) => (
            <AddSpotScreen
              navigation={{ goBack: () => p.navigation.goBack() }}
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
    </PlanDraftContext.Provider>
  );
}
