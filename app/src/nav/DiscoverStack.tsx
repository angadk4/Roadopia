/**
 * The Discover flow stack (R23): DiscoverHome →(tap a drive)→ Progress →(result)
 * → Result. Re-registers the EXISTING ProgressScreen + ResultScreen verbatim —
 * a tapped drive is an ordinary /plan run — so nothing in the SSE/result path is
 * forked. The PlanDraft context scopes here (like PlanStack) purely so
 * DiscoverHome can reuse the shared origin picker (PickPoint writes draft.origin).
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo, useState, type ReactElement } from 'react';

import { DEFAULT_DRAFT, PlanDraftContext, type PlanDraft } from '../lib/plan_draft';
import DiscoverHome from '../screens/DiscoverHome';
import PickPointScreen from '../screens/PickPointScreen';
import ProgressScreen from '../screens/ProgressScreen';
import ResultScreen from '../screens/ResultScreen';
import { useTheme } from '../theme';

export type DiscoverStackParamList = {
  DiscoverHome: undefined;
  PickPoint: { target: 'origin' | 'destination' };
  Progress: { request: unknown };
  Result: { route: unknown; explanation: unknown; done: unknown; timeline: unknown };
};

type ResultScreenParams = import('../screens/ResultScreen').ResultScreenParams;
type ProgressParams = import('../screens/ProgressScreen').ProgressScreenProps['route']['params'];

const Stack = createNativeStackNavigator<DiscoverStackParamList>();

export default function DiscoverStack(): ReactElement {
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
        <Stack.Screen name="DiscoverHome" options={{ headerShown: false }}>
          {(p) => (
            <DiscoverHome
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
      </Stack.Navigator>
    </PlanDraftContext.Provider>
  );
}
