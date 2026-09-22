/**
 * Route result (M7-T05; FR-042 — "= route detail with constraints panel +
 * explanation", §15). Hosts the SHARED RouteDetail component; the reasoning
 * view (M7-T06) and inline refinement (M7-T07) mount as conditional sections
 * inside it (§16 cohesion rules 2–3). FB-4: the planner's feasible runner-up
 * options are switchable — the deterministic answer to "same prompt, same
 * route". Save / hand-off arrive from M8/M9; Follow (M9-T06) is the primary.
 *
 * REDESIGN (SPEC "Result") — the PLATE. This is the payoff screen, and it used
 * to arrive as a queue of look-alike panels under a hand-drawn title, with the
 * primary action three panels below the fold. It is now:
 *   1. A page NAMED after the drive: the native large title
 *      (`route.name ?? 'Your drive'`, registered by the stacks) collapses into
 *      the bar as the reader scrolls — the `ScrollView` is the page's first
 *      child with `contentInsetAdjustmentBehavior="automatic"`, which is what
 *      makes that native (expo-animation §3: the stack, not a scroll worklet;
 *      expo-native-ui: "ALWAYS use a navigation stack title"). RouteDetail no
 *      longer draws a name.
 *   2. The map bled EDGE TO EDGE as the first plate, the numbers card riding
 *      over its lower edge (RouteDetail owns the gutter; this scroll passes
 *      no horizontal padding of its own).
 *   3. **Follow + Save directly under the numbers** — RouteDetail's `hero`
 *      slot, the Apple Maps "GO" position. Follow is the page's ONE filled
 *      amber (M9-T06/FR-112); Save is `secondary`.
 *   4. The option switcher is the platform's segmented control
 *      (`SegmentedPicker` ← the chip track; a `MenuPicker` past four options —
 *      SPEC rule 8), ticking a selection haptic.
 *   5. The refinement is a PINNED composer bar (`RefineComposer` ← the raised
 *      `RefinePanel` card) at the bottom of the page, over a material, riding
 *      the keyboard — still on Result (§34). The scroll pads its bottom by the
 *      bar's measured height so the last chapter can rise above it.
 *   6. Everything else is a CHAPTER: COMPARED WITH THE PREVIOUS DRIVE, HERE'S
 *      WHAT I UNDERSTOOD, OPEN IN ANOTHER APP, MORE.
 * The honest copy is verbatim: the "that tweak changed nothing" margin note,
 * the runner-up footnote, the "tweaks apply to the recommended drive" line,
 * "No route arrived — go back and plan again."; explanation and elevation stay
 * best-only.
 *
 * Motion (expo-animation gate). FIRST MOUNT is the rare tier — the reader
 * waited up to 25 s for this — purpose "explanation": three beats through
 * `RouteDetail reveal` (plate fades, numbers rise, hero rises), mount-only:
 * switching options or returning from a refinement never replays what the
 * reader is looking at. An OPTION SWITCH is content swapping in the same
 * slot, so the keyed RouteDetail crossfades in (`FadeIn` 140ms, no travel)
 * with `reveal` off. Haptics (SPEC policy; §8): one `notificationAsync
 * (Success)` on mount when the planner finished with a drive (`ok` /
 * `relaxed` / `best_so_far`) — the visual stands alone without it — and the
 * picker's own `selectionAsync` on a tick. Nothing else.
 *
 * Keyboard. `react-native-keyboard-controller` (RECIPES) is a new dependency
 * and was refused; the pinned bar rides `KeyboardAvoidingView`, with the same
 * offset reasoning PlanScreen documents (a transparent header means the view
 * already sits in window coordinates, so the offset is 0 — device-verify).
 */

import type { ParsedConstraints, Route } from '@shared/types';
import { notificationAsync, NotificationFeedbackType } from 'expo-haptics';
import { useEffect, useState, type ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import HandoffSection from '../components/HandoffSection';
import ReasoningView from '../components/ReasoningView';
import RefineComposer from '../components/RefineComposer';
import RouteCompare from '../components/RouteCompare';
import RouteDetail from '../components/RouteDetail';
import SafetyNote from '../components/SafetyNote';
import SaveDriveButton from '../components/SaveDriveButton';
import { Button, Chapter, Legend, Symbol, Text } from '../components/ui';
import { EmptyState, MenuPicker, SegmentedPicker } from '../components/ui/native';
import { useTabBarHeight } from '../lib/insets';
import { parseChips } from '../lib/parse_summary';
import type { Explanation, TimelineEntry } from '../lib/plan_run';
import type { DoneStatus } from '../lib/plan_stream';
import {
  buildRefineRequest,
  refineUnchanged,
  summarizeRoute,
  type RouteSummary,
} from '../lib/refine';
import { motion, radius, spacing, useTheme } from '../theme';

export interface ResultScreenParams {
  route?: Route;
  /** Feasible runner-up options (FB-4) — no elevation/LLM enrich (best-only). */
  alternates?: Route[];
  explanation?: Explanation | null;
  done?: DoneStatus | null;
  timeline?: TimelineEntry[];
  /** The running `c` from this generation — enables inline refinement (§34). */
  constraints?: ParsedConstraints | null;
  /** Present when this result came from a refinement — drives the comparison. */
  previous?: RouteSummary | null;
}

export interface ResultScreenProps {
  navigation: {
    goBack: () => void;
    navigate: (screen: string, params?: Record<string, unknown>) => void;
    /** Pop to the stack's form. Absent in bare test renders → falls back to
     *  goBack. */
    goHome?: () => void;
  };
  route: { params?: ResultScreenParams };
}

/** An option switch: content swapping in the same slot fades, it does not
 *  travel (module scope — stable identity, never rebuilt in render). */
const OPTION_IN = FadeIn.duration(motion.crossFade);

/** The segmented control holds up to four choices (SPEC rule 8); the planner
 *  emits at most a handful of runner-ups, and past four the whole set is one
 *  tap away in a menu instead. */
const SEGMENT_MAX = 4;

/** The planner finished WITH a drive — the one moment the success haptic
 *  marks (an `unavailable` end never reaches this screen with a route). */
function arrivedWithDrive(done: DoneStatus | null | undefined): boolean {
  return done === 'ok' || done === 'relaxed' || done === 'best_so_far';
}

export default function ResultScreen(props: ResultScreenProps): ReactElement {
  const { colors } = useTheme();
  const tabBarHeight = useTabBarHeight();
  const params = props.route.params ?? {};
  const best = params.route;
  const alternates = params.alternates ?? [];
  const constraints = params.constraints ?? null;
  // 0 = the recommended route; 1.. = runner-up options
  const [selected, setSelected] = useState(0);
  // Once the reader has switched options the reveal beats are over: a keyed
  // remount crossfades instead, and never replays the plate.
  const [switched, setSwitched] = useState(false);
  /** The pinned composer's measured height — what the scroll pads by so the
   *  last chapter can rise above it. 0 until the first layout, or no bar. */
  const [barH, setBarH] = useState(0);

  // Same frame as the plate landing; once, on arrival (SPEC haptics policy).
  useEffect(() => {
    if (best && arrivedWithDrive(params.done)) {
      void notificationAsync(NotificationFeedbackType.Success);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  if (!best) {
    // Defensive only — Progress never navigates here without a route. The
    // platform's own "content unavailable" shape, with the control the copy
    // promises.
    return (
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.empty, { paddingBottom: tabBarHeight + spacing.xl }]}
      >
        <EmptyState
          symbol="map"
          title="No route arrived — go back and plan again."
          action={
            <Button
              variant="secondary"
              title="Plan another drive"
              onPress={props.navigation.goHome ?? props.navigation.goBack}
            />
          }
        />
      </ScrollView>
    );
  }

  const options = [best, ...alternates];
  const shownIndex = Math.min(selected, options.length - 1);
  const shown = options[shownIndex]!;
  const viewingBest = shownIndex === 0;
  const optionLabels = options.map((_, i) => (i === 0 ? 'Recommended' : `Option ${i + 1}`));
  const chips = viewingBest && constraints ? parseChips(constraints) : [];

  const pickOption = (i: number): void => {
    setSelected(i);
    setSwitched(true);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* FIRST CHILD: the scroll view the native large title (the drive's
          name) collapses over. No horizontal padding — RouteDetail owns the
          gutter so its plate can bleed to both edges. */}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          // under the pinned composer and the translucent tab bar
          { paddingBottom: barH + tabBarHeight + spacing.xl },
        ]}
        scrollIndicatorInsets={{ bottom: barH + tabBarHeight }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // iOS: the drive-name field sits low on the page; without this the
        // keyboard covers it (device pass)
        automaticallyAdjustKeyboardInsets
      >
        {/* option switcher — deterministic variety (FB-4): one of N, so it is
            the platform's segmented control, not N look-alike pills */}
        {alternates.length > 0 &&
          (options.length <= SEGMENT_MAX ? (
            <SegmentedPicker
              label="Route option"
              options={optionLabels}
              selectedIndex={shownIndex}
              onChange={pickOption}
              style={styles.gutter}
            />
          ) : (
            <MenuPicker
              label="Route option"
              options={optionLabels}
              selectedIndex={shownIndex}
              onChange={pickOption}
              style={styles.gutter}
            />
          ))}

        {/* the honest "that tweak changed nothing" MARGIN NOTE (FB-3): the
            index rule runs down its left edge in the disclosure colour, which
            is the one thing on the page that must not be mistakable for
            "this is selected" */}
        {viewingBest &&
          params.previous &&
          refineUnchanged(params.previous, summarizeRoute(best)) && (
            <View style={[styles.gutter, styles.marginNote, { borderLeftColor: colors.notice }]}>
              <View style={styles.mark}>
                <Symbol name="infoCircleFill" size="md" tone="notice" />
              </View>
              <Text variant="body" tone="notice" style={styles.flex}>
                That tweak couldn't improve on the previous drive from this start — the planner
                keeps quality first (no forced u-turns or messy detours just to hit a number). This
                is still its best answer.
              </Text>
            </View>
          )}
        {viewingBest && params.previous && (
          <View style={styles.gutter}>
            <RouteCompare previous={params.previous} next={summarizeRoute(best)} />
          </View>
        )}

        {/* THE PLATE. Keyed on the option so a switch is a fresh crossfade;
            the three reveal beats play on the first mount only. */}
        <Animated.View key={shownIndex} {...(switched ? { entering: OPTION_IN } : {})}>
          <RouteDetail
            route={shown}
            explanation={viewingBest ? (params.explanation ?? null) : null}
            done={viewingBest ? (params.done ?? null) : null}
            reveal={!switched}
            hero={
              <View style={styles.hero}>
                {/* M9-T06 (FR-112): follow-mode is the PRIMARY in-app driving
                    experience, so it is the ONE filled amber on the screen —
                    in the "GO" position, directly under the numbers */}
                <Button
                  title="Follow this drive"
                  variant="primary"
                  size="lg"
                  block
                  accessibilityLabel="Follow this drive"
                  icon={<Symbol name="locationNorthLineFill" size="md" tone="onAccent" />}
                  onPress={() => props.navigation.navigate('Follow', { route: shown })}
                />

                {/* M8-T04: the product's first gated action (FR-080/201) —
                    saves the currently SHOWN option (runner-ups are saveable
                    too). Keyed on the option so "Saved" for one option never
                    sticks to the next. */}
                <SaveDriveButton
                  key={shownIndex}
                  route={shown}
                  agentExplanation={viewingBest ? (params.explanation?.text ?? null) : null}
                  // the TAB name bubbles up to the tab navigator; `screen` +
                  // `pop` land on the LIST (a tab remembers whichever detail
                  // it was left on, and the new row is only reloaded by the
                  // list's own focus)
                  onViewSaved={() =>
                    props.navigation.navigate('Saved', { screen: 'SavedHome', pop: true })
                  }
                />
              </View>
            }
          >
            {!viewingBest && (
              <Text variant="footnote" tone="muted">
                A feasible runner-up from the same generation. The detailed explanation and
                elevation belong to the recommended option.
              </Text>
            )}
            {viewingBest && <ReasoningView timeline={params.timeline ?? []} />}
            {chips.length > 0 && (
              <Chapter title="Here's what I understood">
                <View style={styles.pillRow}>
                  {chips.map((chip) => (
                    <View
                      key={chip}
                      style={[
                        styles.pill,
                        { borderColor: colors.hairline, backgroundColor: colors.fill },
                      ]}
                    >
                      <Legend>{chip}</Legend>
                    </View>
                  ))}
                </View>
              </Chapter>
            )}
          </RouteDetail>
        </Animated.View>

        {/* M9-T07 (FR-115..117): best-effort, honestly framed — its own
            chapter, OPEN IN ANOTHER APP */}
        <View style={styles.gutter}>
          <HandoffSection route={shown} />
        </View>

        <Chapter title="More" style={styles.gutter}>
          {/* M9-T08 (FR-400): persistent on every generated-route surface */}
          <SafetyNote context="route" />
          <Button
            variant="secondary"
            title="Plan another drive"
            // popToTop where the stack provides it: after a refinement chain,
            // goBack would land on the PREVIOUS result, not the form
            onPress={props.navigation.goHome ?? props.navigation.goBack}
          />
        </Chapter>
      </ScrollView>

      {/* THE PINNED COMPOSER (§34: on Result, never a separate screen) —
          above the tab bar, riding the keyboard. `behavior` is iOS-only:
          Android resizes the window for the keyboard itself, and padding on
          top of that would double it. `keyboardVerticalOffset` is 0 because
          the header is TRANSPARENT: the content is full-window, so the frame
          RN measures already sits in window coordinates (PlanScreen's
          reasoning; device-verify with the keyboard up). */}
      {constraints && (
        <KeyboardAvoidingView
          style={[styles.pinned, { bottom: tabBarHeight }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
          pointerEvents="box-none"
        >
          <View onLayout={(e: LayoutChangeEvent) => setBarH(e.nativeEvent.layout.height)}>
            <RefineComposer
              // A tweak merges into the RECOMMENDED drive's constraints (that
              // is what `constraints` holds), so the comparison is against it
              // too — never against a runner-up the tweak was not applied to.
              note={
                viewingBest
                  ? null
                  : 'Tweaks apply to the recommended drive — its constraints are the ones held.'
              }
              onSend={(followUp) =>
                props.navigation.navigate('Progress', {
                  request: buildRefineRequest(constraints, followUp),
                  previous: summarizeRoute(best),
                })
              }
            />
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /** No horizontal padding: the plate bleeds; everything else asks for the
   *  gutter itself. */
  content: { gap: spacing.lg },
  gutter: { marginHorizontal: spacing.gutter },
  /** The dead end, centred, with the control its own copy promises. */
  empty: { paddingHorizontal: spacing.gutter, paddingTop: spacing.xxl },
  /** The "GO" position: the two actions as one group under the numbers. */
  hero: { gap: spacing.md },
  marginNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    borderLeftWidth: 3,
    paddingLeft: spacing.md,
  },
  /** 2pt of optical lead-in puts the mark on the line's cap height. */
  mark: { paddingTop: 2 },
  flex: { flex: 1 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  /** A capsule, not a rounded box — the same legend pill RouteDetail draws
   *  its character tags in. */
  pill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pinned: { position: 'absolute', left: 0, right: 0 },
});
