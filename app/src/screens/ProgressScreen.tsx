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
 */

import { useCallback, useEffect, useReducer, useRef, type ReactElement } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError, type PlanRequest } from '../lib/api';
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
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

type StreamFn = (req: PlanRequest, opts: PlanStreamOptions) => Promise<PlanStreamResult>;

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

export default function ProgressScreen(props: ProgressScreenProps): ReactElement {
  const { colors } = useTheme();
  const [state, dispatch] = useReducer(runReducer, INITIAL_RUN);
  const aborterRef = useRef<AbortController | null>(null);
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);
  const streamFn = props.streamFn ?? streamPlan;
  const request = props.route.params?.request;

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
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      {state.phase === 'streaming' && (
        <Text style={[styles.title, { color: colors.text }]}>Planning your drive…</Text>
      )}

      {/* the streamed timeline */}
      <View style={styles.timeline}>
        {state.timeline.map((e, i) =>
          e.kind === 'step' ? (
            <View key={i} style={styles.stepRow}>
              <Text
                style={[
                  styles.stepMark,
                  { color: e.status === 'completed' ? colors.success : colors.accent },
                ]}
              >
                {e.status === 'completed' ? '✓' : '•'}
              </Text>
              <Text style={[styles.stepText, { color: colors.text }]}>
                {STEP_LABELS[e.step]}
                {e.detail ? <Text style={{ color: colors.textMuted }}> {e.detail}</Text> : null}
              </Text>
            </View>
          ) : (
            <View key={i} style={[styles.stepRow, styles.toolRow]}>
              <Text style={[styles.stepMark, { color: colors.textMuted }]}>
                {e.ok === null ? '…' : e.ok ? '✓' : '✕'}
              </Text>
              <Text style={[styles.toolText, { color: colors.textMuted }]}>
                {toolLabel(e.tool)}
                {e.count !== null ? ` · ${e.count}` : ''}
              </Text>
            </View>
          ),
        )}
      </View>

      {state.phase === 'streaming' && (
        <Pressable
          accessibilityRole="button"
          onPress={cancel}
          style={({ pressed }) => [
            styles.cancelButton,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.cancelLabel, { color: colors.text }]}>Cancel</Text>
        </Pressable>
      )}

      {state.phase !== 'streaming' && state.phase !== 'succeeded' && (
        <FailurePanel state={state} onRetry={() => retry()} onBack={props.navigation.goBack} />
      )}
    </ScrollView>
  );
}

function FailurePanel(props: {
  state: PlanRunState;
  onRetry: () => void;
  onBack: () => void;
}): ReactElement {
  const { colors } = useTheme();
  const { state } = props;

  let headline = '';
  let body = '';
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
      break;
    }
    case 'no_route':
      headline = 'No route this time';
      body =
        state.errorMessage ??
        'The planner could not put a drive together from that brief. Try adjusting it.';
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
      break;
    case 'cancelled':
      headline = state.wentToBackground ? 'Paused in the background' : 'Cancelled';
      body = state.wentToBackground
        ? 'The app went to the background, so planning stopped cleanly. Run it again when ready.'
        : 'Planning stopped — nothing was generated.';
      break;
    default:
      break;
  }

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.panelTitle, { color: colors.text }]}>{headline}</Text>
      <Text style={[styles.panelBody, { color: colors.textMuted }]}>{body}</Text>
      <View style={styles.panelButtons}>
        <Pressable
          accessibilityRole="button"
          onPress={props.onBack}
          style={({ pressed }) => [
            styles.backButton,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.cancelLabel, { color: colors.text }]}>Adjust the plan</Text>
        </Pressable>
        {state.phase !== 'cancelled' && (
          <Pressable
            accessibilityRole="button"
            onPress={props.onRetry}
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.retryLabel, { color: colors.onAccent }]}>
              {state.guard?.retryAfterS ? `Try again (~${state.guard.retryAfterS}s)` : 'Try again'}
            </Text>
          </Pressable>
        )}
        {state.phase === 'cancelled' && (
          <Pressable
            accessibilityRole="button"
            onPress={props.onRetry}
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.retryLabel, { color: colors.onAccent }]}>Run it again</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl },
  title: { ...font.title },
  timeline: { gap: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  toolRow: { paddingLeft: spacing.xl },
  stepMark: { ...font.body, width: 18, textAlign: 'center' },
  stepText: { ...font.body, flex: 1 },
  toolText: { ...font.body, fontSize: 13, flex: 1 },
  cancelButton: {
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xl,
  },
  cancelLabel: { ...font.button },
  panel: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  panelTitle: { ...font.heading },
  panelBody: { ...font.body, lineHeight: 21 },
  panelButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  backButton: {
    flex: 1,
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButton: {
    flex: 1,
    minHeight: HIT_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: { ...font.button },
});
