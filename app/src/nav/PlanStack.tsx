/**
 * The Plan flow stack (M7-T03; §16 flow: Plan →(submit)→ Generation-progress
 * →(result)→ Result). The PlanDraft context scopes to this stack so the
 * map-pick screen writes points without non-serializable navigation params.
 *
 * REDESIGN (SPEC "Navigation & IA > Stacks and presentation", PlanStack rows;
 * rule 13). Every header here is composed from `nav/screen_options.ts` and
 * nothing else — no screen in this stack draws its own title any more:
 *
 *   PlanForm   tab root, a PAGE: large title "Plan a drive" that collapses
 *              into the bar as the form scrolls under it.
 *   PickPoint  a MODAL CARD — a self-contained task the user can abandon —
 *              titled for the point it is asking for ("Start point" /
 *              "Destination"), with Cancel where iOS puts it: the header's
 *              left. The screen itself only ever goes back.
 *   Progress   a page: "Planning your drive". Back is allowed; the screen's
 *              unmount already aborts the stream honestly.
 *   Result     a page titled by the drive's own name, "Your drive" until it
 *              has one.
 *   Follow     owns the phone: no header, no back gesture, tab bar hidden
 *              (`tab_spec`); the only exits unmount it.
 *
 * THE PRESENTATION INVARIANT (SPEC): the modal card's adapter exposes ONLY
 * `goBack` — `PickPoint` cannot reach Follow or Record, by type. Follow is
 * pushed, never modal, never a sheet.
 *
 * Pushes run the platform's own transition; under Reduce Motion they cross-
 * fade (SPEC vocabulary: `animation: reduced ? 'fade' : 'default'`).
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo, useState, type ReactElement } from 'react';

import { useReducedMotion } from '../components/ui';
import { DEFAULT_DRAFT, PlanDraftContext, type PlanDraft } from '../lib/plan_draft';
import FollowScreen, { type FollowScreenParams } from '../screens/FollowScreen';
import PickPointScreen, { pickPointTitle, type PickPointTarget } from '../screens/PickPointScreen';
import PlanScreen, { PLAN_FORM_TITLE } from '../screens/PlanScreen';
import ProgressScreen, { type ProgressScreenProps } from '../screens/ProgressScreen';
import ResultScreen, { type ResultScreenParams } from '../screens/ResultScreen';
import { useTheme } from '../theme';

import { modalTaskOptions, pageOptions, phoneOwnerOptions } from './screen_options';

type ProgressScreenParams = NonNullable<ProgressScreenProps['route']['params']>;

export type PlanStackParamList = {
  PlanForm: undefined;
  PickPoint: { target: PickPointTarget };
  Progress: ProgressScreenParams;
  Result: ResultScreenParams;
  Follow: FollowScreenParams;
};

const Stack = createNativeStackNavigator<PlanStackParamList>();

export default function PlanStack(): ReactElement {
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
        <Stack.Screen name="PlanForm" options={pageOptions(PLAN_FORM_TITLE, theme)}>
          {(p) => (
            <PlanScreen
              navigation={{
                navigate: (screen, params) =>
                  p.navigation.navigate(screen as never, params as never),
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
                // "Plan another drive" must land on the form, not on the
                // previous result of a refinement chain.
                goHome: () => p.navigation.popToTop(),
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
    </PlanDraftContext.Provider>
  );
}
