/**
 * Record a drive (M9-T03..T05; FR-060..062). Foreground-only capture (spec
 * §20.3 — never a background permission) with the screen held awake; stopping
 * map-matches the trace through POST /match and shows a review (snapped line,
 * real recorded time, dropped-fix honesty) before the gated save
 * (origin_type='recorded', private by default — server-enforced too).
 *
 * The §18 permission states render inline: denied → "enable location or build
 * by hand instead", error → honest retry. A capture that is too short to be a
 * drive is SAID to be, never silently matched into noise.
 *
 * Device pass (2026-09-04): a failed or cancelled snap KEEPS the capture and
 * offers Try again / Discard (before, the only button left wiped it); the
 * snap itself has a Cancel and a timeout, so "Snapping to roads…" can no
 * longer sit forever; the clock and distance hold their final values after
 * Stop; and thirty seconds without a GPS fix is said out loud.
 *
 * REDESIGN (SPEC "Record"). It WAS a pushed screen with a solid header, a
 * floating opaque HUD and a fixed opaque bottom panel whose Discard armed on
 * a first tap ("Tap again to discard"). It IS the same composition on
 * MATERIAL under a transparent native header ("Record a drive",
 * `mapTaskOptions` in CreateStack; the native back is the exit that unmounts —
 * GPS + wake-lock released; the tab bar is hidden because this screen owns
 * the phone, `tab_spec`): the map bleeds under everything; the HUD is a
 * `Material role="panel"` under the header whose clock is the biggest ink on
 * the screen; the bottom panel is a `Material role="panel"` that is FIXED
 * (a driver's screen is never a draggable sheet — hard-rule conflict #4); and
 * Discard asks through a native `ConfirmDialog` with a destructive action —
 * the op runs ONLY from that action (SPEC rule 15). Try again dismisses a
 * presented dialog, so an asked Discard never carries into the review.
 *
 * Still hand-drawn, deliberately: the clock is a MEASUREMENT in `statLg`
 * with tabular figures (Hard rule D: a duration, never pace or timing
 * framing) and the "as driven" minutes are the same; the honest failure copy
 * is untouched; the foreground-only promise stays pinned above Start.
 *
 * MOTION (expo-animation gate). The HUD is glanced at constantly, so nothing
 * on it animates but the live dot: a Reanimated CSS animation on `opacity`
 * (1 → 0.35 → 1 over 2·pulse = 2200 ms, ~0.45 Hz, clear of the 0.2 Hz
 * vestibular band), off under Reduce Motion — the word RECORDING carries it.
 * Phase roots fade in place (`ENTER_FADE`) and the panel reflows (`REFLOW`).
 * HAPTICS (§8; one per user action, same frame as the visual, never alone):
 * Medium when capture starts and when Stop is tapped; Success once when the
 * review mounts; Error when a snap fails or the capture is too short (not on
 * the user's own Cancel); the confirmed Discard's Medium is the dialog's.
 * Nothing per fix, nothing per second.
 */

import Mapbox, { Camera, LineLayer, MapView, ShapeSource, UserTrackingMode } from '@rnmapbox/maps';
import type { RouteThroughOutput } from '@shared/types';
import {
  ImpactFeedbackStyle,
  impactAsync,
  NotificationFeedbackType,
  notificationAsync,
} from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import Animated, { type CSSAnimationKeyframes } from 'react-native-reanimated';

import '../lib/mapbox';
import SafetyNote from '../components/SafetyNote';
import SaveDriveButton from '../components/SaveDriveButton';
import {
  Button,
  ENTER_FADE,
  Legend,
  Material,
  REFLOW,
  Stat,
  Symbol,
  Text,
  useReducedMotion,
  type SymbolKey,
  type TextTone,
} from '../components/ui';
import { ConfirmDialog } from '../components/ui/native';
import { ApiError, NetworkError, postMatch } from '../lib/api';
import { useBottomInset } from '../lib/insets';
import { watchLocation, type StopWatching } from '../lib/location';
import {
  addFix,
  elapsedS,
  IDLE_RECORDER,
  rawDistanceM,
  startRecording,
  stopRecording,
  toRecordedRoute,
  traceForMatch,
  whyCannotMatch,
  type RecorderState,
} from '../lib/recorder';
import { getApiBaseUrl } from '../lib/runtime';
import { sessionId } from '../lib/session';
import { AMBER, motion, spacing, useTheme } from '../theme';

export interface RecordScreenProps {
  navigation: {
    goBack: () => void;
    /** Present in CreateStack: opens follow-mode on the reviewed drive. */
    navigate?: (screen: string, params?: Record<string, unknown>) => void;
  };
  /** The native header's height, from the stack (`useHeaderHeight`): the map
   *  bleeds under the transparent header, so the HUD needs to know where the
   *  bar ends. 0 in a bare render. */
  headerHeight?: number;
  /** Injectable for tests. */
  watchFn?: typeof watchLocation;
  matchFn?: typeof postMatch;
  now?: () => number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'denied' }
  | { kind: 'error' }
  | { kind: 'recording' }
  | { kind: 'matching' }
  | { kind: 'review'; matched: RouteThroughOutput }
  | { kind: 'too_short'; why: 'too_few_points' | 'too_short' }
  /** The capture is KEPT; Try again re-runs the snap on it. */
  | { kind: 'match_failed'; message: string };

const KEEP_AWAKE_TAG = 'roadopia-record';
/** Without a fix for this long the HUD says so (signal, or a revoked permission). */
export const FIX_DROUGHT_MS = 30_000;

/** Where the map sits before a fix exists — the planner's region, at a zoom
 *  where roads are individually visible once the camera follows the car. */
const INITIAL_CENTER: [number, number] = [-79.8, 43.6];

/** The live dot, in pt (SPEC: an 8 pt `danger` dot beside the legend). */
const CAPTURE_DOT = 8;

/**
 * "Capture is live" — the breath. A loop with no state change is a CSS
 * animation (expo-animation §3); module scope so the keyframes are one object
 * for the life of the app. Full → 0.35 → full: low amplitude, opacity only.
 */
const BREATH: CSSAnimationKeyframes = {
  from: { opacity: 1 },
  '50%': { opacity: 0.35 },
  to: { opacity: 1 },
};

/**
 * The key beside the legend: the colour capture is drawn in on the HUD, as a
 * `LegendKey` would draw it — hand-composed here because the primitive's
 * swatch cannot breathe. Breathes only while capture is LIVE; a stopped
 * recorder and a running one used to differ only by a ticking clock. Under
 * Reduce Motion it holds still and the word carries the state.
 */
function CaptureDot({ live }: { live: boolean }): ReactElement {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const breathing = live && !reduced;
  return (
    <Animated.View
      testID="record-capture-dot"
      style={[
        styles.captureDot,
        { backgroundColor: colors.danger },
        breathing
          ? {
              animationName: BREATH,
              animationDuration: motion.pulse * 2,
              animationTimingFunction: 'ease-in-out',
              animationIterationCount: 'infinite',
            }
          : null,
      ]}
    />
  );
}

export default function RecordScreen(props: RecordScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const bottomInset = useBottomInset();
  const headerHeight = props.headerHeight ?? 0;
  const watch = props.watchFn ?? watchLocation;
  const match = props.matchFn ?? postMatch;
  const now = props.now ?? Date.now;

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [rec, setRec] = useState<RecorderState>(IDLE_RECORDER);
  /** Discard takes the capture with it — it asks first, natively. */
  const [discardAsked, setDiscardAsked] = useState(false);
  const [, forceTick] = useState(0);
  const stopFixes = useRef<StopWatching | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFixAt = useRef<number | null>(null);
  const matchAbort = useRef<AbortController | null>(null);
  /** False once the screen is gone. Starting is async (a permission dialog can
   *  sit open for a minute), so without this the watcher, the wake-lock and the
   *  1 Hz timer all install AFTER cleanup has run and then leak for the life of
   *  the app — GPS included, which would break the foreground-only promise. */
  const live = useRef(true);
  /** A second tap while the dialog is up would start a second watcher. */
  const starting = useRef(false);

  useEffect(
    () => () => {
      live.current = false;
      stopFixes.current?.();
      stopFixes.current = null;
      if (tick.current) clearInterval(tick.current);
      matchAbort.current?.abort();
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    },
    [],
  );

  const start = (): void => {
    if (starting.current || stopFixes.current !== null) return;
    starting.current = true;
    void (async () => {
      try {
        const res = await watch((fix) => {
          lastFixAt.current = now();
          setRec((s) => addFix(s, fix));
        });
        if (res.status !== 'ok') {
          if (live.current) setPhase({ kind: res.status });
          return;
        }
        if (!live.current) {
          res.stop(); // the screen left while the dialog was open
          return;
        }
        stopFixes.current = res.stop;
        try {
          await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        } catch {
          // Android throws when the activity is momentarily gone. Without
          // this catch the watcher stayed installed behind an idle "Start"
          // button that could never stop it (review finding): stop it, say
          // so, and let Start work again.
          res.stop();
          stopFixes.current = null;
          if (live.current) setPhase({ kind: 'error' });
          return;
        }
        if (!live.current) {
          deactivateKeepAwake(KEEP_AWAKE_TAG);
          return;
        }
        lastFixAt.current = now();
        setRec(startRecording(now()));
        setPhase({ kind: 'recording' });
        // A heavy object lands (§8): capture is live, the frame the HUD mounts.
        void impactAsync(ImpactFeedbackStyle.Medium);
        tick.current = setInterval(() => forceTick((n) => n + 1), 1000); // HUD clock
      } finally {
        starting.current = false;
      }
    })();
  };

  /** Snap the kept capture; failure and cancellation both keep it. */
  const runMatch = (captured: RecorderState): void => {
    setDiscardAsked(false); // a Discard asked on the failed panel must not carry over
    setPhase({ kind: 'matching' });
    const controller = new AbortController();
    matchAbort.current = controller;
    // decimated: a long drive exceeds /match's 5,000-point cap, and a 400 with
    // a raw schema string would strand a capture the user cannot get back
    match(
      { baseUrl: getApiBaseUrl(), sessionId },
      { trace: traceForMatch(captured) },
      controller.signal,
    )
      .then((matched) => {
        if (!live.current) return;
        // The phase change is announced by three things that move: "Snapping
        // to roads…" leaves, the breathing dot stops, and the map swaps the
        // raw trace for the snapped line — and by one Success, once.
        void notificationAsync(NotificationFeedbackType.Success);
        setPhase({ kind: 'review', matched });
      })
      .catch((err: unknown) => {
        if (!live.current) return;
        const cancelled = err instanceof Error && err.name === 'AbortError';
        // The user's own Cancel is not a failure; nothing buzzes for it.
        if (!cancelled) void notificationAsync(NotificationFeedbackType.Error);
        setPhase({
          kind: 'match_failed',
          message: cancelled
            ? 'Snapping was cancelled — the recording is still here.'
            : err instanceof ApiError || err instanceof NetworkError
              ? err.message
              : 'Could not snap that drive to roads right now.',
        });
      })
      .finally(() => {
        if (matchAbort.current === controller) matchAbort.current = null;
      });
  };

  const stop = (): void => {
    stopFixes.current?.();
    stopFixes.current = null;
    if (tick.current) clearInterval(tick.current);
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    // The clock freezes this frame — the Medium lands with it (§8).
    void impactAsync(ImpactFeedbackStyle.Medium);
    const stopped = stopRecording(rec, now());
    setRec(stopped);
    const why = whyCannotMatch(stopped);
    if (why !== null) {
      void notificationAsync(NotificationFeedbackType.Error);
      setPhase({ kind: 'too_short', why });
      return;
    }
    runMatch(stopped);
  };

  /** Runs ONLY from the dialog's destructive action (SPEC rule 15). */
  const reset = (): void => {
    matchAbort.current?.abort();
    lastFixAt.current = null;
    setDiscardAsked(false);
    setRec(IDLE_RECORDER);
    setPhase({ kind: 'idle' });
  };

  const elapsed = elapsedS(rec, now());
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const km = (rawDistanceM(rec) / 1000).toFixed(1);
  const drought =
    phase.kind === 'recording' &&
    lastFixAt.current !== null &&
    now() - lastFixAt.current >= FIX_DROUGHT_MS;

  const captureLine = (): string =>
    `${km} km · ${rec.points.length} points${rec.droppedFixes > 0 ? ` · ${rec.droppedFixes} noisy fixes dropped` : ''}`;

  const isReview = phase.kind === 'review';
  const hasCapture = rec.startedAtMs !== null;
  /** The raw trace, rebuilt only when a fix is actually appended (the 1 Hz
   *  clock tick re-renders without changing the geometry). */
  const trace = useMemo(
    () =>
      rec.points.length >= 2
        ? {
            type: 'LineString' as const,
            coordinates: rec.points.map((p) => [p.lng, p.lat]),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rec.points.length],
  );

  /** The honest state lines, in the panel beside the control they concern,
   *  each with the glyph for what went wrong. Wording is verbatim — §18
   *  plainness is the product, not a placeholder. */
  const notes: Array<{ key: string; text: string; tone: TextTone; symbol: SymbolKey }> = [];
  if (drought) {
    notes.push({
      key: 'drought',
      tone: 'notice',
      symbol: 'antennaRadiowavesLeftAndRightSlash',
      text: 'No GPS fix for 30 s — check the signal, or whether location permission is still on.',
    });
  }
  if (phase.kind === 'denied') {
    notes.push({
      key: 'denied',
      tone: 'danger',
      symbol: 'locationSlash',
      text: 'Location permission is off. Enable it in Settings, or build the route by hand instead.',
    });
  }
  if (phase.kind === 'error') {
    notes.push({
      key: 'error',
      tone: 'danger',
      symbol: 'exclamationmarkTriangle',
      text: 'Could not read the GPS — try again.',
    });
  }
  if (phase.kind === 'too_short') {
    notes.push({
      key: 'too_short',
      tone: 'notice',
      symbol: 'exclamationmarkTriangle',
      text:
        phase.why === 'too_short'
          ? 'That capture is too short to be a drive (under 500 m) — nothing was saved.'
          : 'Too few GPS fixes landed to snap that to roads (signal may have been poor) — nothing was saved.',
    });
  }
  if (phase.kind === 'match_failed') {
    notes.push({
      key: 'match_failed',
      tone: 'danger',
      symbol: 'exclamationmarkTriangle',
      text: phase.message,
    });
  }

  /** The in-page Discard: opens the dialog. The label stays for bare renders
   *  and is what the test presses; the op never runs from here. */
  const discardButton = (extraStyle?: object): ReactElement => (
    <Button
      title="Discard"
      variant="secondary"
      size={phase.kind === 'match_failed' ? 'lg' : 'md'}
      accessibilityLabel="Discard recording"
      icon={<Symbol name="trash" size="md" />}
      onPress={() => setDiscardAsked(true)}
      {...(extraStyle !== undefined ? { style: extraStyle } : {})}
    />
  );

  return (
    // the drive-name field sits at the bottom of the review panel: without
    // this the iOS keyboard covered it and the Save button (review finding).
    // The header is transparent, so this view spans the window and the
    // keyboard padding needs no vertical offset.
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
          scaleBarEnabled={false}
        >
          {isReview ? (
            <Camera
              defaultSettings={{
                centerCoordinate: phase.matched.geometry.coordinates[0] as [number, number],
                zoomLevel: 10,
              }}
              animationDuration={0}
            />
          ) : (
            <Camera
              defaultSettings={{ centerCoordinate: INITIAL_CENTER, zoomLevel: 9 }}
              // Only once there are fixes to follow: true at mount makes the
              // SDK discard defaultSettings, which leaves a denied permission
              // staring at the world view (the same trap FollowScreen hit).
              followUserLocation={rec.points.length > 0}
              followUserMode={UserTrackingMode.Follow}
              followZoomLevel={14.5}
              followPitch={0}
              animationDuration={800}
            />
          )}
          {isReview ? (
            <ShapeSource
              id="recorded-line"
              shape={{ type: 'Feature', properties: {}, geometry: phase.matched.geometry }}
            >
              <LineLayer
                id="recorded-line-layer"
                style={{ lineColor: AMBER, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}
              />
            </ShapeSource>
          ) : (
            trace && (
              <ShapeSource
                id="record-trace"
                shape={{ type: 'Feature', properties: {}, geometry: trace }}
              >
                {/* the raw capture, pre-snap — the same amber the snapped line
                    uses, because it is the same drive */}
                <LineLayer
                  id="record-trace-layer"
                  style={{
                    lineColor: AMBER,
                    lineWidth: 5,
                    lineOpacity: 0.85,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </ShapeSource>
            )
          )}
        </MapView>

        {/* The measurements, on material over the live map, under the header.
            Only once there is a capture to measure — an empty clock is not
            information. Nothing on it animates but the live dot. */}
        {!isReview && hasCapture && (
          <Material
            role="panel"
            style={[styles.hud, { top: headerHeight + spacing.md }]}
            testID="record-hud"
          >
            <View style={styles.hudInner}>
              <View style={styles.hudHead}>
                <CaptureDot live={phase.kind === 'recording'} />
                <Legend>{phase.kind === 'recording' ? 'recording' : 'capture'}</Legend>
              </View>
              <Text variant="statLg" style={styles.figures}>
                {`${mins}:${String(secs).padStart(2, '0')}`}
              </Text>
              <View accessible accessibilityLabel={captureLine()} style={styles.statRow}>
                <Stat value={`${km} km`} label="distance" />
                <Stat value={String(rec.points.length)} label="gps points" />
              </View>
              {rec.droppedFixes > 0 && (
                <Text variant="footnote" tone="muted">
                  {`${rec.droppedFixes} noisy fixes dropped`}
                </Text>
              )}
            </View>
          </Material>
        )}
      </View>

      {/* The control panel: fixed, on material, on the home indicator. A
          driver's screen is never a draggable sheet. */}
      <Material
        role="panel"
        style={[styles.panel, { paddingBottom: spacing.gutter + bottomInset }]}
        testID="record-panel"
      >
        <Animated.View layout={REFLOW} style={styles.panelInner}>
          {notes.map((n) => (
            <Animated.View key={n.key} entering={ENTER_FADE} style={styles.noteRow}>
              {/* the glyph sits in its own box so a wrapped sentence hang-
                  indents under itself rather than under the icon */}
              <View style={styles.noteMark}>
                <Symbol name={n.symbol} size="md" tone={n.tone} />
              </View>
              <Text variant="body" tone={n.tone} style={styles.noteText}>
                {n.text}
              </Text>
            </Animated.View>
          ))}

          <Animated.View key={phase.kind} entering={ENTER_FADE} style={styles.phase}>
            {isReview ? (
              <>
                <View
                  accessible
                  accessibilityLabel={`${(phase.matched.distance_m / 1000).toFixed(1)} km · ${Math.floor(
                    elapsed / 60,
                  )} min as driven`}
                  style={styles.statRow}
                >
                  <Stat
                    value={`${(phase.matched.distance_m / 1000).toFixed(1)} km`}
                    label="distance"
                    size="lg"
                  />
                  <Stat value={`${Math.floor(elapsed / 60)} min`} label="as driven" size="lg" />
                </View>
                <Text variant="footnote" tone="muted">
                  Snapped to real roads from {rec.points.length} GPS points
                  {rec.droppedFixes > 0 ? ` (${rec.droppedFixes} noisy fixes dropped)` : ''}.
                </Text>
                {/* a recorded drive is followable straight from the review — with
                    the matcher's own turns (device pass 2026-09-07) */}
                {props.navigation.navigate && (
                  <Button
                    title="Follow this drive"
                    variant="secondary"
                    size="lg"
                    block
                    accessibilityLabel="Follow this drive"
                    icon={<Symbol name="locationNorthLineFill" size="md" />}
                    onPress={() =>
                      props.navigation.navigate?.('Follow', {
                        route: toRecordedRoute(phase.matched, rec),
                      })
                    }
                  />
                )}
                <SaveDriveButton
                  route={toRecordedRoute(phase.matched, rec)}
                  agentExplanation={null}
                />
                {discardButton(styles.centred)}
                <SafetyNote context="route" />
              </>
            ) : phase.kind === 'matching' ? (
              <>
                <View style={styles.busyRow}>
                  <ActivityIndicator color={colors.accentText} />
                  <Text variant="body" tone="muted">
                    Snapping to roads…
                  </Text>
                </View>
                <Button
                  title="Cancel"
                  variant="secondary"
                  size="lg"
                  block
                  accessibilityLabel="Cancel snapping"
                  icon={<Symbol name="xmark" size="md" />}
                  onPress={() => matchAbort.current?.abort()}
                />
              </>
            ) : phase.kind === 'match_failed' ? (
              <View style={styles.actionRow}>
                <Button
                  title="Try again"
                  variant="primary"
                  size="lg"
                  style={styles.grow}
                  accessibilityLabel="Try snapping again"
                  icon={<Symbol name="arrowClockwise" size="md" tone="onAccent" />}
                  onPress={() => runMatch(rec)}
                />
                {discardButton()}
              </View>
            ) : (
              <>
                {/* The foreground-only contract (spec §20.3), pinned to the
                    control it is a promise about. It must stay on screen. */}
                {!hasCapture && (
                  <Text variant="footnote" tone="muted">
                    Capture runs only while this screen is open — no background tracking, ever.
                  </Text>
                )}
                <Button
                  title={phase.kind === 'recording' ? 'Stop' : 'Start recording'}
                  // Amber is the action colour in this system; `danger` is
                  // reserved for destruction and failure, and Stop destroys
                  // nothing — it hands the capture to the review. The live
                  // state is carried by the breathing dot on the HUD.
                  variant="primary"
                  size="lg"
                  block
                  accessibilityLabel={
                    phase.kind === 'recording' ? 'Stop recording' : 'Start recording'
                  }
                  icon={
                    <Symbol
                      name={phase.kind === 'recording' ? 'stopFill' : 'recordCircle'}
                      size="md"
                      tone="onAccent"
                    />
                  }
                  onPress={phase.kind === 'recording' ? stop : start}
                />
              </>
            )}
          </Animated.View>
        </Animated.View>
      </Material>

      {/* Mounted whether or not it is presented (the modifier needs a view to
          attach to); the op runs only from its destructive action. Keep is
          the platform's cancel. */}
      <ConfirmDialog
        isPresented={discardAsked}
        onIsPresentedChange={setDiscardAsked}
        title="Discard this recording?"
        message="The capture will be lost."
        actions={[
          {
            title: 'Discard',
            role: 'destructive',
            accessibilityLabel: 'Confirm discard recording',
            onPress: reset,
          },
          { title: 'Keep', role: 'cancel', onPress: () => undefined },
        ]}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  /** The HUD's material box: top-left under the header; `top` is set inline
   *  from the header's measured height. */
  hud: {
    position: 'absolute',
    left: spacing.gutter,
  },
  hudInner: { padding: spacing.md, gap: spacing.xs },
  hudHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  captureDot: { width: CAPTURE_DOT, height: CAPTURE_DOT, borderRadius: CAPTURE_DOT / 2 },
  /** Changing numbers must not shimmy: same-width digits, every tick. */
  figures: { fontVariant: ['tabular-nums'] },
  statRow: { flexDirection: 'row', gap: spacing.xl },
  /** Pinned to the window's bottom edge over the map: square bottom corners
   *  (the material's own radius is for a box that floats), the lit top edge
   *  and the home-indicator padding are the panel's. */
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  panelInner: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.gutter,
    gap: spacing.md,
  },
  phase: { gap: spacing.md },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  /** 2 pt of optical lead-in so an 18 pt glyph sits on the body's x-height. */
  noteMark: { paddingTop: 2 },
  noteText: { flex: 1 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  centred: { alignSelf: 'center' },
});
