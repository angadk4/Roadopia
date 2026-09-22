/**
 * The Create flow stack (M9; Master Spec §16): CreateHome offers the two
 * creation modes; Builder (T01/T02) and Record (T03..T05) live in the same
 * stack, and a drive you just built or recorded can be followed right away.
 *
 * BD-204 review: CreateHome was the one tab home still defined inline in a nav
 * file, which is why the redesign pass missed it and why nothing in it was ever
 * covered by a test (importing this module pulls in `react-native-screens`,
 * which the vitest aliases do not stub). It now lives in `screens/CreateHome`
 * beside the other tab homes.
 *
 * REDESIGN (SPEC "Navigation & IA > Stacks and presentation", CreateStack rows;
 * rule 13). Every header here is composed from `nav/screen_options.ts` and
 * nothing else — no screen in this stack draws its own title any more:
 *
 *   CreateHome  tab root, a PAGE: large title "Create" that collapses into the
 *               bar as the two mode plates scroll under it.
 *   Builder     a TASK OVER A MAP: compact "Build a route" on the transparent
 *               material, the map bled under it; `headerRight` is **Clear**,
 *               present exactly while there are points (the screen drives it
 *               through `setClear`; its in-page ghost Clear stays for bare
 *               renders, and both call the same handler). The tab bar stays.
 *   Record      a task over a map: compact "Record a drive". The tab bar hides
 *               (`tab_spec`: it owns the phone — a live GPS stream and a
 *               wake-lock) and the native back is a plain `goBack`, which
 *               UNMOUNTS the screen and releases both. Never modal, never a
 *               sheet — hard-rule conflict #4 was decided against RECIPES'
 *               "self-contained task → modal".
 *   Follow      owns the phone: no header, no back gesture, tab bar hidden;
 *               the only exits unmount it.
 *
 * THE PRESENTATION INVARIANT (SPEC): nothing in this stack is presented as a
 * modal or a form sheet, so nothing here can reach Follow or Record from one.
 * Follow and Record are pushed, and stay pushed.
 *
 * Pushes run the platform's own transition; under Reduce Motion they cross-
 * fade (SPEC vocabulary: `animation: reduced ? 'fade' : 'default'`).
 *
 * THE HEADER'S HEIGHT for Record. The map bleeds under the transparent bar, so
 * the HUD needs to know where the bar ends. React Navigation's answer is
 * `useHeaderHeight()` from `@react-navigation/elements` — a package this
 * workspace has installed (hoisted, as a dependency of native-stack) but the
 * app does not DECLARE, and declaring one is a dependency request for the
 * owner (Build Contract §5), not a thing a screen cluster does. Until that is
 * approved the stack derives the same number the library would report for a
 * compact bar in portrait: the status inset plus the platform's own bar
 * height (44 pt `UINavigationBar`, 56 dp Material toolbar — the two constants
 * `getDefaultHeaderHeight` uses). The literal is flagged in the report: it
 * belongs in `theme.ts` (rule 17), which the shell owns.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';
import { Platform } from 'react-native';

import { PressableScale, Text, useReducedMotion } from '../components/ui';
import { useTopInset } from '../lib/insets';
import BuilderScreen from '../screens/BuilderScreen';
import CreateHome from '../screens/CreateHome';
import FollowScreen, { type FollowScreenParams } from '../screens/FollowScreen';
import RecordScreen, { type RecordScreenProps } from '../screens/RecordScreen';
import { useTheme } from '../theme';

import { mapTaskOptions, pageOptions, phoneOwnerOptions } from './screen_options';

export type CreateStackParamList = {
  CreateHome: undefined;
  Builder: undefined;
  Record: undefined;
  /** Device pass 2026-09-07: a drive you just built or recorded can be
   *  followed right away, before (or instead of) saving it. */
  Follow: FollowScreenParams;
};

const Stack = createNativeStackNavigator<CreateStackParamList>();

/**
 * The compact bar's content height above the status inset, in pt — what the
 * platform's own navigation bar measures in portrait (see the module note;
 * interim until `useHeaderHeight` is approved, and a `theme.ts` token then).
 */
const COMPACT_BAR_H = Platform.OS === 'ios' ? 44 : 56;

/** The header's Clear: a plain text button in the action colour — the same
 *  shape as `screen_options`' Cancel, on the right. */
function HeaderClear(props: { onPress: () => void }): ReactElement {
  return (
    <PressableScale onPress={props.onPress} accessibilityLabel="Clear">
      <Text variant="label" tone="accent">
        Clear
      </Text>
    </PressableScale>
  );
}

/** Record under its transparent header: a component, because the height is a
 *  hook's answer and a screen's render callback is not a component. */
function RecordRoute(props: { navigation: RecordScreenProps['navigation'] }): ReactElement {
  const topInset = useTopInset();
  return <RecordScreen navigation={props.navigation} headerHeight={topInset + COMPACT_BAR_H} />;
}

export default function CreateStack(): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  return (
    <Stack.Navigator screenOptions={{ animation: reduced ? 'fade' : 'default' }}>
      {/* Screens keep lightweight prop shapes (node-smoke-testable without
          React Navigation); these adapters bridge the typed navigator. */}
      <Stack.Screen name="CreateHome" options={pageOptions('Create', theme)}>
        {(p) => <CreateHome navigate={(screen) => p.navigation.navigate(screen as never)} />}
      </Stack.Screen>
      <Stack.Screen name="Builder" options={mapTaskOptions('Build a route', theme)}>
        {(p) => (
          <BuilderScreen
            navigation={{
              goBack: () => p.navigation.goBack(),
              navigate: (screen, params) => p.navigation.navigate(screen as never, params as never),
              // Clear lives in the bar exactly while there are points; `null`
              // takes it out again (an explicit undefined un-sets the option).
              setClear: (onClear) =>
                p.navigation.setOptions({
                  headerRight:
                    onClear === null ? undefined : () => <HeaderClear onPress={onClear} />,
                }),
            }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Record" options={mapTaskOptions('Record a drive', theme)}>
        {(p) => (
          <RecordRoute
            navigation={{
              goBack: () => p.navigation.goBack(),
              navigate: (screen, params) => p.navigation.navigate(screen as never, params as never),
            }}
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
