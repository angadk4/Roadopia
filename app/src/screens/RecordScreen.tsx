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
 */

import Mapbox, { Camera, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import type { RouteThroughOutput } from '@shared/types';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import '../lib/mapbox';
import SafetyNote from '../components/SafetyNote';
import SaveDriveButton from '../components/SaveDriveButton';
import { ApiError, NetworkError, postMatch } from '../lib/api';
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
import { AMBER, font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface RecordScreenProps {
  navigation: { goBack: () => void };
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

export default function RecordScreen(props: RecordScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const watch = props.watchFn ?? watchLocation;
  const match = props.matchFn ?? postMatch;
  const now = props.now ?? Date.now;

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [rec, setRec] = useState<RecorderState>(IDLE_RECORDER);
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
        tick.current = setInterval(() => forceTick((n) => n + 1), 1000); // HUD clock
      } finally {
        starting.current = false;
      }
    })();
  };

  /** Snap the kept capture; failure and cancellation both keep it. */
  const runMatch = (captured: RecorderState): void => {
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
        setPhase({ kind: 'review', matched });
      })
      .catch((err: unknown) => {
        if (!live.current) return;
        setPhase({
          kind: 'match_failed',
          message:
            err instanceof Error && err.name === 'AbortError'
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
    const stopped = stopRecording(rec, now());
    setRec(stopped);
    const why = whyCannotMatch(stopped);
    if (why !== null) {
      setPhase({ kind: 'too_short', why });
      return;
    }
    runMatch(stopped);
  };

  const reset = (): void => {
    matchAbort.current?.abort();
    lastFixAt.current = null;
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

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {phase.kind === 'review' ? (
        <MapView
          style={styles.map}
          styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
          scaleBarEnabled={false}
        >
          <Camera
            defaultSettings={{
              centerCoordinate: phase.matched.geometry.coordinates[0] as [number, number],
              zoomLevel: 10,
            }}
            animationDuration={0}
          />
          <ShapeSource
            id="recorded-line"
            shape={{ type: 'Feature', properties: {}, geometry: phase.matched.geometry }}
          >
            <LineLayer
              id="recorded-line-layer"
              style={{ lineColor: AMBER, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}
            />
          </ShapeSource>
        </MapView>
      ) : (
        <View style={[styles.map, styles.hud]}>
          <Text style={[styles.clock, { color: colors.text }]} accessibilityLabel="Recording time">
            {rec.startedAtMs !== null ? `${mins}:${String(secs).padStart(2, '0')}` : '—:——'}
          </Text>
          <Text style={[styles.hudLine, { color: colors.textMuted }]}>
            {rec.startedAtMs !== null
              ? captureLine()
              : 'Capture runs only while this screen is open — no background tracking, ever.'}
          </Text>
          {drought && (
            <Text style={[styles.hudLine, { color: colors.warn }]}>
              No GPS fix for 30 s — check the signal, or whether location permission is still on.
            </Text>
          )}
          {phase.kind === 'denied' && (
            <Text style={[styles.hudLine, { color: colors.danger }]}>
              Location permission is off. Enable it in Settings, or build the route by hand instead.
            </Text>
          )}
          {phase.kind === 'error' && (
            <Text style={[styles.hudLine, { color: colors.danger }]}>
              Could not read the GPS — try again.
            </Text>
          )}
          {phase.kind === 'too_short' && (
            <Text style={[styles.hudLine, { color: colors.warn }]}>
              {phase.why === 'too_short'
                ? 'That capture is too short to be a drive (under 500 m) — nothing was saved.'
                : 'Too few GPS fixes landed to snap that to roads (signal may have been poor) — nothing was saved.'}
            </Text>
          )}
          {phase.kind === 'match_failed' && (
            <Text style={[styles.hudLine, { color: colors.danger }]}>{phase.message}</Text>
          )}
          {phase.kind === 'matching' && (
            <Text style={[styles.hudLine, { color: colors.textMuted }]}>Snapping to roads…</Text>
          )}
        </View>
      )}

      <View
        style={[
          styles.panel,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ]}
      >
        {phase.kind === 'review' ? (
          <>
            <Text style={[styles.stats, { color: colors.text }]}>
              {(phase.matched.distance_m / 1000).toFixed(1)} km · {Math.floor(elapsed / 60)} min as
              driven
            </Text>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              Snapped to real roads from {rec.points.length} GPS points
              {rec.droppedFixes > 0 ? ` (${rec.droppedFixes} noisy fixes dropped)` : ''}.
            </Text>
            <SaveDriveButton route={toRecordedRoute(phase.matched, rec)} agentExplanation={null} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard recording"
              onPress={reset}
              style={styles.discard}
            >
              <Text style={[styles.hint, { color: colors.textMuted }]}>Discard</Text>
            </Pressable>
            <SafetyNote context="route" />
          </>
        ) : phase.kind === 'matching' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel snapping"
            onPress={() => matchAbort.current?.abort()}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>Cancel</Text>
          </Pressable>
        ) : phase.kind === 'match_failed' ? (
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try snapping again"
              onPress={() => runMatch(rec)}
              style={({ pressed }) => [
                styles.recordBtn,
                styles.grow,
                { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.recordLabel, { color: colors.onAccent }]}>Try again</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard recording"
              onPress={reset}
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.secondaryLabel, { color: colors.textMuted }]}>Discard</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={phase.kind === 'recording' ? 'Stop recording' : 'Start recording'}
            onPress={phase.kind === 'recording' ? stop : start}
            style={({ pressed }) => [
              styles.recordBtn,
              {
                backgroundColor: phase.kind === 'recording' ? colors.danger : colors.accent,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.recordLabel, { color: colors.onAccent }]}>
              {phase.kind === 'recording' ? 'Stop' : 'Start recording'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  hud: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  clock: { fontSize: 56, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hudLine: { ...font.body, textAlign: 'center', lineHeight: 21 },
  panel: { borderTopWidth: 1, padding: spacing.md, gap: spacing.sm },
  stats: { ...font.heading },
  hint: { ...font.caption, lineHeight: 18 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  grow: { flex: 1 },
  recordBtn: {
    minHeight: HIT_TARGET + 8,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordLabel: { ...font.button },
  secondaryBtn: {
    minHeight: HIT_TARGET + 8,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: { ...font.body },
  discard: { minHeight: HIT_TARGET, alignItems: 'center', justifyContent: 'center' },
});
