/**
 * Generation progress (M7-T04; FR-041 — the showpiece). Streams /plan over SSE
 * and renders each GenerationEvent as it arrives; cancel closes the connection
 * (the server halts the planner loop AND model spend — SPK-03's bar).
 *
 * §18 states: guard rejections (rate limit / kill switch / cap / out-of-region)
 * render the server's friendly JSON message + retry; connection loss → honest
 * "connection lost" + retry; done:unavailable → the error-event text (clarify
 * questions land there too); backgrounding cancels cleanly + offers a re-run
 * (§14 design — no fetch-later store before M8). Success auto-advances to the
 * Result screen with the validated payload.
 *
 * REDESIGN (SPEC "Progress") — the CONTOUR LOG. The page's title is the native
 * large title ("Planning your drive", registered by the stacks) — the in-page
 * sentence is gone, and the scroll view is the page's first child with
 * `contentInsetAdjustmentBehavior="automatic"`, which is what collapses that
 * title natively. The timeline is no longer rows in an inset panel: it is ONE
 * vertical index rule down the left margin with STATION MARKS on it — a step is
 * a 24pt mark over the rule (`circle.fill` in the action colour while it runs,
 * `checkmark.circle.fill` in the success colour once it lands), a tool call is
 * a 6pt dot on the rule with its verdict and label indented to the step text.
 * The labels (`STEP_LABELS`, `toolLabel`, ` · N`) are unchanged. Under the log:
 * Cancel. A failure is an atlas note under it — a raised panel with a `Legend`
 * kicker naming the note's category above the verbatim headline.
 *
 * Motion (expo-animation gate). This is a 25-second wall-clock wait, and it is
 * the product's most impressive moment, so every animation here says exactly
 * one true thing:
 *   - A row ARRIVING enters with the shared `ENTER` builder (240ms; the fade
 *     alone under Reduce Motion). The stagger is real arrival time — a plain
 *     map, never a virtualised list, nothing faked.
 *   - The IN-FLIGHT mark breathes — a Reanimated CSS animation on opacity
 *     (1 → 0.45 → 1 over 2200ms, infinite, ease-in-out; expo-animation §3:
 *     "loop → CSS animation") — only while its step is unfinished, and not at
 *     all under Reduce Motion (the mark's colour already carries the state).
 *     A pulse says "working"; it never claims progress.
 *   - COMPLETION is a CSS transition on transform: the in-flight mark sits at
 *     0.85 and settles to 1 in 140ms with no overshoot the frame its step
 *     completes. A step finishing used to be a silent glyph substitution and
 *     nine to fifteen of them land per run — it is the screen's one unit of
 *     achievement.
 *   - The FAILURE panel enters rather than blinking into existence after a
 *     long wait (which reads as a crash), and fires ONE `notificationAsync
 *     (Error)` the frame it mounts — never on a user's own cancel (§8: an
 *     operation failed; a cancel is not a failure). Result fires the success
 *     haptic on ITS mount, not this screen.
 * NO progress bar, no `ProgressView`, no percentage, no ETA: the iteration
 * count is not known in advance (the 3-iteration self-correction loop in
 * plan_run), so any of those would be a number presented as measured
 * (expo-animation §1: "can't name the purpose? don't build it").
 *
 * The list follows its own tail — the newest rows were landing below the fold
 * for the whole run — and releases the moment the reader scrolls back. The
 * honest failure taxonomy is UNCHANGED: never-connected is still distinguished
 * from dropped-mid-run, the server's own message is still what renders,
 * "Nothing was saved" still ships, and a user cancel is still separate from a
 * backgrounding. Every body is `selectable` (expo-native-ui: "selectable on
 * error messages") — it is exactly the string someone copies into a report.
 */

import { notificationAsync, NotificationFeedbackType } from 'expo-haptics';
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedRef, type CSSAnimationKeyframes } from 'react-native-reanimated';

import {
  Button,
  CSS_EASE_OUT,
  Legend,
  RULE_W,
  Surface,
  Symbol,
  Text,
  useEntering,
  useReducedMotion,
  type SymbolKey,
  type TextTone,
} from '../components/ui';
import { ApiError, type PlanRequest } from '../lib/api';
import { useTabBarHeight } from '../lib/insets';
import {
  INITIAL_RUN,
  runReducer,
  STEP_LABELS,
  toolLabel,
  type PlanRunState,
} from '../lib/plan_run';
import { streamPlan, type PlanStreamOptions, type PlanStreamResult } from '../lib/plan_stream';
import type { RouteSummary } from '../lib/refine';
import { getApiBaseUrl } from '../lib/runtime';
import { sessionId } from '../lib/session';
import { font, motion, spacing, useTheme } from '../theme';

type StreamFn = (req: PlanRequest, opts: PlanStreamOptions) => Promise<PlanStreamResult>;

/** The station-mark box, in pt — one width for every mark on the log. */
const MARK = 24;
/** Where the rule runs: its left edge, so its 2pt body is centred under the
 *  24pt mark box (11 + 1 = 12 = MARK / 2). */
const RULE_X = 11;
/** A tool call's station: a dot on the rule, not a mark over it. */
const TOOL_DOT = 6;
/** The in-flight mark's scale — it settles to 1 the frame its step completes. */
const MARK_INFLIGHT_SCALE = 0.85;

/**
 * The in-flight breath, as CSS keyframes at module scope (one rule for the
 * life of the app, never rebuilt in render). Offsets are FRACTIONS, not
 * percentage strings: the keyframes are a style value, and a style value is in
 * the serialised test tree, where a `%` would read as a claimed progress
 * figure (progress.test pins that none appears).
 */
const BREATHE: CSSAnimationKeyframes = {
  0: { opacity: 1 },
  0.5: { opacity: 0.45 },
  1: { opacity: 1 },
};

interface ProgressNav {
  replace: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
}

export interface ProgressScreenProps {
  navigation: ProgressNav;
  route: {
    params?: {
      request?: PlanRequest;
      /** When refining: the previous route's summary for the comparison. */
      previous?: RouteSummary;
    };
  };
  /** Injectable for tests; defaults to the expo/fetch transport. */
  streamFn?: StreamFn;
}

/** A STEP on the log: a 24pt station mark over the rule, then its label. */
function StepRow(props: { done: boolean; children: ReactNode }): ReactElement {
  const entering = useEntering();
  const reduced = useReducedMotion();
  // Runs ONLY while the step is unfinished, and stops the instant it
  // completes — an animation that keeps running after the thing it describes
  // has finished is the decorative kind. Off under Reduce Motion: a pulse is
  // vestibular noise, and the mark's colour already carries the state.
  const breathing = !props.done && !reduced;

  return (
    <Animated.View entering={entering} style={styles.row}>
      <Animated.View
        style={[
          styles.mark,
          {
            // Completion: 0.85 → 1, 140ms, strong ease-out, no overshoot — no
            // gesture carried momentum in, so a bounce would be decoration
            // pretending to be physics. Reduce Motion drops the scale change.
            transform: [{ scale: props.done || reduced ? 1 : MARK_INFLIGHT_SCALE }],
            transitionProperty: 'transform',
            transitionDuration: motion.crossFade,
            transitionTimingFunction: CSS_EASE_OUT,
          },
          breathing
            ? {
                animationName: BREATHE,
                animationDuration: motion.pulse * 2,
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
              }
            : null,
        ]}
      >
        <Symbol
          name={props.done ? 'checkmarkCircleFill' : 'circleFill'}
          size="lg"
          tone={props.done ? 'success' : 'accent'}
        />
      </Animated.View>
      <View style={styles.rowBody}>{props.children}</View>
    </Animated.View>
  );
}

/** A TOOL CALL on the log: a 6pt dot on the rule; its verdict glyph and label
 *  indented to where the step text starts, so the two levels share an edge. */
function ToolRow(props: { ok: boolean | null; children: ReactNode }): ReactElement {
  const entering = useEntering();
  const { colors } = useTheme();
  const glyph: SymbolKey = props.ok === null ? 'ellipsisCircle' : props.ok ? 'checkmark' : 'xmark';
  const tone: TextTone = props.ok === false ? 'danger' : 'muted';

  return (
    <Animated.View entering={entering} style={styles.row}>
      <View style={styles.toolStation}>
        <View style={[styles.toolDot, { backgroundColor: colors.borderStrong }]} />
      </View>
      <View style={[styles.rowBody, styles.toolBody]}>
        <View style={styles.toolMark}>
          <Symbol name={glyph} size="sm" tone={tone} />
        </View>
        <Text variant="footnote" tone="muted" style={styles.toolText}>
          {props.children}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function ProgressScreen(props: ProgressScreenProps): ReactElement {
  const { colors } = useTheme();
  const tabBarHeight = useTabBarHeight();
  const [state, dispatch] = useReducer(runReducer, INITIAL_RUN);
  const aborterRef = useRef<AbortController | null>(null);
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);
  const streamFn = props.streamFn ?? streamPlan;
  const request = props.route.params?.request;
  // A run emits up to 15 steps plus tool rows across the 25s budget, and
  // self-correction REPEATS steps — so the log routinely outgrows the screen
  // and the newest rows land below the fold. Follow the tail, but stop the
  // moment the reader scrolls back: nobody may be yanked away from what they
  // are reading.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const followTail = useRef(true);

  const cancel = useCallback(() => {
    aborterRef.current?.abort();
    dispatch({ type: 'cancelled' });
  }, []);

  // one stream per attempt; strict-mode double-mount safe via the aborter
  useEffect(() => {
    if (!request) return;
    // every attempt starts clean (retry regression, review 2026-07-16)
    dispatch({ type: 'reset' });
    const aborter = new AbortController();
    aborterRef.current = aborter;
    // strict-mode double-mount / retry: a superseded stream's settlement must
    // never touch the current run's state
    const stale = (): boolean => aborterRef.current !== aborter;

    streamFn(request, {
      baseUrl: getApiBaseUrl(),
      sessionId,
      signal: aborter.signal,
      onEvent: (event) => {
        if (!stale()) dispatch({ type: 'event', event });
      },
    })
      .then((result) => {
        if (!stale()) dispatch({ type: 'stream_end', done: result.done, aborted: result.aborted });
      })
      .catch((err: unknown) => {
        if (stale()) return;
        if (err instanceof ApiError) dispatch({ type: 'guard_rejected', error: err });
        else dispatch({ type: 'network_failed' });
      });

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        aborter.abort();
        dispatch({ type: 'backgrounded' });
      }
    });
    return () => {
      sub.remove();
      aborter.abort();
    };
  }, [request, streamFn, attempt]);

  // success → hand the validated payload to Result (replace: back skips this screen)
  useEffect(() => {
    if (state.phase === 'succeeded' && state.route) {
      props.navigation.replace('Result', {
        route: state.route,
        alternates: state.alternates,
        explanation: state.explanation,
        done: state.done,
        timeline: state.timeline,
        constraints: state.constraints,
        previous: props.route.params?.previous ?? null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigation identity is stable
  }, [state.phase]);

  return (
    // FIRST CHILD of the page: the scroll view the native large title
    // ("Planning your drive", from the stack) collapses over.
    <Animated.ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.bg }}
      // under the translucent tab bar — the log scrolls beneath it
      contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing.xxl }]}
      scrollIndicatorInsets={{ bottom: tabBarHeight }}
      onScrollBeginDrag={() => {
        followTail.current = false;
      }}
      onContentSizeChange={() => {
        if (followTail.current) scrollRef.current?.scrollToEnd({ animated: true });
      }}
    >
      {/* THE LOG: one index rule down the margin, station marks arriving on
          it as the pipeline reports — a contour, not a list in a box */}
      {state.timeline.length > 0 && (
        <View style={styles.log}>
          <View
            pointerEvents="none"
            style={[styles.rule, { backgroundColor: colors.borderStrong }]}
          />
          {state.timeline.map((e, i) =>
            e.kind === 'step' ? (
              <StepRow key={i} done={e.status === 'completed'}>
                <Text variant="body">
                  {STEP_LABELS[e.step]}
                  {e.detail ? (
                    <Text variant="body" tone="muted">
                      {' '}
                      {e.detail}
                    </Text>
                  ) : null}
                </Text>
              </StepRow>
            ) : (
              <ToolRow key={i} ok={e.ok}>
                {toolLabel(e.tool)}
                {e.count !== null ? ` · ${e.count}` : ''}
              </ToolRow>
            ),
          )}
        </View>
      )}

      {state.phase === 'streaming' && (
        <Button variant="secondary" title="Cancel" onPress={cancel} style={styles.cancel} />
      )}

      {state.phase !== 'streaming' && state.phase !== 'succeeded' && (
        <FailurePanel state={state} onRetry={() => retry()} onBack={props.navigation.goBack} />
      )}
    </Animated.ScrollView>
  );
}

/**
 * The note's category, as the atlas kicker above the verbatim headline. It
 * names the KIND of note — never a second copy of the headline under it — so
 * "Connection" sits over "No connection" / "Connection lost", and "Stopped"
 * over "Cancelled" / "Paused in the background".
 */
function kickerFor(phase: PlanRunState['phase']): string {
  switch (phase) {
    case 'guard_rejected':
      return 'Not started';
    case 'no_route':
      return 'Planner';
    case 'network_failed':
      return 'Connection';
    case 'cancelled':
      return 'Stopped';
    default:
      return '';
  }
}

function FailurePanel(props: {
  state: PlanRunState;
  onRetry: () => void;
  onBack: () => void;
}): ReactElement {
  const { state } = props;
  const entering = useEntering();

  // One haptic the frame the note lands, and only for a FAILURE — a user's
  // own cancel (or the OS backgrounding the app) is not something that went
  // wrong. Mount-only: a panel is unmounted by the retry that resets the run,
  // so a new failure is a new mount.
  useEffect(() => {
    if (state.phase !== 'cancelled') void notificationAsync(NotificationFeedbackType.Error);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per failure mount
  }, []);

  let headline = '';
  let body = '';
  let glyph: SymbolKey = 'exclamationmarkTriangleFill';
  let tone: TextTone = 'danger';
  switch (state.phase) {
    case 'guard_rejected': {
      const code = state.guard?.code;
      headline =
        code === 'rate_limited'
          ? 'One moment'
          : code === 'planner_disabled' || code === 'spend_cap_reached'
            ? 'Planning is paused'
            : code === 'out_of_region'
              ? 'Outside the covered region'
              : "That plan didn't start";
      body = state.guard?.message ?? 'The planner rejected the request.';
      // A guard is a policy answer, not a fault — it should not look like one.
      glyph = 'infoCircleFill';
      tone = 'notice';
      break;
    }
    case 'no_route':
      headline = 'No route this time';
      body =
        state.errorMessage ??
        'The planner could not put a drive together from that brief. Try adjusting it.';
      glyph = 'exclamationmarkTriangleFill';
      tone = 'notice';
      break;
    case 'network_failed':
      // §18 offline: distinguish never-connected from dropped-mid-run honestly.
      if (state.timeline.length === 0) {
        headline = 'No connection';
        body = 'Planning needs a connection. Check your network and try again.';
      } else {
        headline = 'Connection lost';
        body = 'Planning needs a connection and it dropped mid-run. Nothing was saved — try again.';
      }
      glyph = 'wifiSlash';
      tone = 'danger';
      break;
    case 'cancelled':
      headline = state.wentToBackground ? 'Paused in the background' : 'Cancelled';
      body = state.wentToBackground
        ? 'The app went to the background, so planning stopped cleanly. Run it again when ready.'
        : 'Planning stopped — nothing was generated.';
      glyph = 'pauseCircleFill';
      tone = 'muted';
      break;
    default:
      break;
  }

  return (
    <Animated.View entering={entering}>
      <Surface level="raised" padding="md" style={styles.panel}>
        <View style={styles.panelHead}>
          <View style={styles.panelMark}>
            <Symbol name={glyph} size="lg" tone={tone} />
          </View>
          <View style={styles.panelTitle}>
            <Legend>{kickerFor(state.phase)}</Legend>
            <Text variant="headline">{headline}</Text>
          </View>
        </View>
        {/* selectable: this is exactly the string someone copies when they
            report that something went wrong */}
        <Text variant="body" tone="muted" selectable>
          {body}
        </Text>
        <View style={styles.panelButtons}>
          <Button
            variant="secondary"
            title="Adjust the plan"
            onPress={props.onBack}
            style={styles.panelButton}
          />
          {state.phase !== 'cancelled' && (
            <Button
              variant="primary"
              title={
                state.guard?.retryAfterS ? `Try again (~${state.guard.retryAfterS}s)` : 'Try again'
              }
              onPress={props.onRetry}
              style={styles.panelButton}
            />
          )}
          {state.phase === 'cancelled' && (
            <Button
              variant="primary"
              title="Run it again"
              onPress={props.onRetry}
              style={styles.panelButton}
            />
          )}
        </View>
      </Surface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    gap: spacing.xl,
  },
  /** The log is positioned so the rule can run its full height behind the marks. */
  log: { gap: spacing.md },
  rule: { position: 'absolute', left: RULE_X, top: 0, bottom: 0, width: RULE_W.index },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  /** The station mark: a box the width of the column, the height of a body
   *  line, so the glyph sits on the label's first line. */
  mark: {
    width: MARK,
    height: font.body.lineHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** A tool's station: the same column, the height of a footnote line. */
  toolStation: {
    width: MARK,
    height: font.footnote.lineHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolDot: { width: TOOL_DOT, height: TOOL_DOT, borderRadius: TOOL_DOT / 2 },
  rowBody: { flex: 1 },
  toolBody: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  /** 2pt of optical lead-in puts the 14pt glyph on the footnote's x-height. */
  toolMark: { paddingTop: 2 },
  toolText: { flex: 1, fontVariant: ['tabular-nums'] },
  cancel: { alignSelf: 'flex-start' },
  panel: { gap: spacing.md },
  panelHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  panelMark: { paddingTop: 2 },
  panelTitle: { flex: 1, gap: spacing.xs },
  panelButtons: { flexDirection: 'row', gap: spacing.md },
  panelButton: { flex: 1 },
});
