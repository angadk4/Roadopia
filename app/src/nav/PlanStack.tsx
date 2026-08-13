/**
 * The Plan flow stack (M7-T03; §16 flow: Plan →(submit)→ Generation-progress
 * →(result)→ Result). The PlanDraft context scopes to this stack so the
 * map-pick screen writes points without non-serializable navigation params.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo, useState, type ReactElement } from 'react';

import { DEFAULT_DRAFT, PlanDraftContext, type PlanDraft } from '../lib/plan_draft';
import FollowScreen from '../screens/FollowScreen';
import PickPointScreen from '../screens/PickPointScreen';
import PlanScreen from '../screens/PlanScreen';
import ProgressScreen from '../screens/ProgressScreen';
import ResultScreen from '../screens/ResultScreen';
import { useTheme } from '../theme';

export type PlanStackParamList = {
  PlanForm: undefined;
  PickPoint: { target: 'origin' | 'destination' };
  Progress: { request: unknown };
  Result: { route: unknown; explanation: unknown; done: unknown; timeline: unknown };
  Follow: { route: unknown };
};

type ResultScreenParams = import('../screens/ResultScreen').ResultScreenParams;
type FollowScreenParams = import('../screens/FollowScreen').FollowScreenParams;
type ProgressParams = import('../screens/ProgressScreen').ProgressScreenProps['route']['params'];

const Stack = createNativeStackNavigator<PlanStackParamList>();

export default function PlanStack(): ReactElement {
  const { colors } = useTheme();
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
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surfaceRaised },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      >
        {/* Screens keep lightweight prop shapes (node-smoke-testable without
            React Navigation); these adapters bridge the typed navigator. */}
        <Stack.Screen name="PlanForm" options={{ headerShown: false }}>
          {(p) => (
            <PlanScreen
              navigation={{
                navigate: (screen, params) =>
                  p.navigation.navigate(screen as never, params as never),
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="PickPoint" options={{ title: 'Pick a point' }}>
          {(p) => (
            <PickPointScreen
              navigation={{ goBack: () => p.navigation.goBack() }}
              route={{ params: p.route.params }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Progress" options={{ title: 'Planning your drive' }}>
          {(p) => (
            <ProgressScreen
              navigation={{
                replace: (screen, params) => p.navigation.replace(screen as never, params as never),
                goBack: () => p.navigation.goBack(),
              }}
              route={{ params: p.route.params as ProgressParams }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Result" options={{ title: 'Your drive' }}>
          {(p) => (
            <ResultScreen
              navigation={{
                goBack: () => p.navigation.goBack(),
                navigate: (screen, params) =>
                  p.navigation.navigate(screen as never, params as never),
              }}
              route={{ params: p.route.params as ResultScreenParams }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Follow" options={{ headerShown: false }}>
          {(p) => (
            <FollowScreen
              navigation={{ goBack: () => p.navigation.goBack() }}
              route={{ params: p.route.params as FollowScreenParams }}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </PlanDraftContext.Provider>
  );
}
