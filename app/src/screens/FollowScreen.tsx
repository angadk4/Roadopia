/**
 * Follow-mode (M9-T06; FR-110..114) — the PRIMARY in-app driving experience.
 * Route polyline + live position tracking along it + remaining distance
 * (FR-110), next-maneuver hints (FR-111), screen held awake (FR-113), and the
 * persistent safe-driving disclaimer (FR-114). Foreground-only GPS (§20.3).
 *
 * Guidance (device pass, 2026-09-04): a route now CARRIES the engine's
 * maneuvers for its exact geometry, so hints are anchored directly — no
 * re-match. Rows saved before that (no `maneuvers`) fall back to re-matching
 * the line and anchoring each matched turn BY POSITION; when too few land,
 * the screen says the drive predates turn guidance and follows the line.
 * No re-routing: off the line = say so.
 *
 * Driving UX from the same pass: the camera follows the car and rotates with
 * its course (a north-up map on a loop with overlapping legs never told the
 * driver which line was theirs); panning shows Recenter; the next turn is the
 * largest text on screen with the turn after it underneath; the driven part
 * of the line greys out; the panel shows distance and time left.
 */

import Mapbox, {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  ShapeSource,
  UserLocation,
  UserTrackingMode,
} from '@rnmapbox/maps';
import type { LatLng, Route } from '@shared/types';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import '../lib/mapbox';
import SafetyNote from '../components/SafetyNote';
import { postMatch } from '../lib/api';
import {
  anchorsFromMatched,
  buildFollowTrack,
  decimateForMatch,
  derivedGuidanceUsable,
  etaSeconds,
  fmtDistance,
  fmtDuration,
  followStatus,
  pointAtDistance,
  splitAtAlong,
  trimProgressWindow,
  type Course,
  type FollowStatus,
  type FollowTrack,
  type ProgressSample,
} from '../lib/follow';
import { useTopInset } from '../lib/insets';
import { watchLocation, type LocationFix, type StopWatching } from '../lib/location';
import { getApiBaseUrl } from '../lib/runtime';
import { sessionId } from '../lib/session';
import { AMBER, font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface FollowScreenParams {
  route: Route;
}

export interface FollowScreenProps {
  navigation: { goBack: () => void };
  route: { params?: FollowScreenParams };
  /** Injectable for tests. */
  watchFn?: typeof watchLocation;
  matchFn?: typeof postMatch;
}

type Guidance = 'pending' | 'ready' | 'unavailable';
type Gps = 'acquiring' | 'ok' | 'denied' | 'error';

const KEEP_AWAKE_TAG = 'roadopia-follow';
const FOLLOW_ZOOM = 14.5;
/** The driven part of the line. */
const DRIVEN_GREY = '#8a93a6';

export default function FollowScreen(props: FollowScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const topInset = useTopInset();
  const drive = props.route.params?.route ?? null;
  const watch = props.watchFn ?? watchLocation;
  const match = props.matchFn ?? postMatch;

  /** Turns that came WITH the route; null/[] = a legacy row → fallback. */
  const carried = drive?.maneuvers && drive.maneuvers.length > 0 ? drive.maneuvers : null;
  const track = useRef<FollowTrack | null>(null);
  if (track.current === null && drive !== null) {
    track.current = buildFollowTrack(drive.geometry, carried ?? []);
  }

  const [guidance, setGuidance] = useState<Guidance>(carried ? 'ready' : 'pending');
  const [gps, setGps] = useState<Gps>('acquiring');
  const [status, setStatus] = useState<FollowStatus | null>(null);
  /** Camera follows the car until the user pans; Recenter re-enables it. */
  const [following, setFollowing] = useState(true);
  const lastAlong = useRef<number | null>(null);
  /** The smallest on-route progress seen — `done` needs the drive to have
   *  been started, not joined at its end (review finding). */
  const minAlong = useRef<number | null>(null);
  const lastFix = useRef<LatLng | null>(null);
  const lastCourse = useRef<Course | null>(null);
  /** On-route progress over the last few minutes, for the arrival estimate. */
  const progress = useRef<ProgressSample[]>([]);
  const stopFixes = useRef<StopWatching | null>(null);
  /** False once the screen is gone. Starting is async (a permission dialog can
   *  sit open for a minute), so without this the watcher and the wake-lock
   *  install AFTER cleanup has run and leak for the life of the app — GPS
   *  included, which would break the foreground-only promise (§20.3). */
  const live = useRef(true);
  const starting = useRef(false);

  /** Status from a fix → screen. Progress is committed from ON-ROUTE fixes
   *  only: an off-route fix keeps the last progress on screen but must never
   *  seed it (a first fix near a loop's return leg used to declare the drive
   *  finished at the origin — review finding). */
  const commit = (st: FollowStatus): void => {
    if (!st.offRoute) {
      lastAlong.current = st.alongM;
      minAlong.current =
        minAlong.current === null ? st.alongM : Math.min(minAlong.current, st.alongM);
      const now = Date.now();
      progress.current = [
        ...trimProgressWindow(progress.current, now),
        { t: now, alongM: st.alongM },
      ];
    }
    setStatus(st);
  };

  const statusFor = (t: FollowTrack, fix: LatLng): FollowStatus =>
    followStatus(t, fix, lastAlong.current, {
      ...(lastCourse.current ? { course: lastCourse.current } : {}),
      minAlongM: minAlong.current,
    });

  const applyFix = (f: LocationFix): void => {
    if (!live.current) return;
    lastFix.current = { lat: f.lat, lng: f.lng };
    // the heading tells a retraced road's two copies apart (review finding)
    lastCourse.current = { headingDeg: f.headingDeg, speedMps: f.speedMps };
    setGps('ok');
    const t = track.current;
    if (!t) return;
    commit(statusFor(t, lastFix.current));
  };

  /** Ask for location and start the stream (+ the FR-113 wake-lock). Also the
   *  Retry after a denied permission or a GPS error — the banner used to say
   *  "try again" with nothing to press (review finding). Guarded so a second
   *  start never installs a second watcher. */
  const startTracking = (): void => {
    if (starting.current || stopFixes.current !== null) return;
    starting.current = true;
    setGps('acquiring');
    void (async () => {
      try {
        const res = await watch(applyFix);
        if (!live.current) {
          if (res.status === 'ok') res.stop(); // the screen left while the dialog was open
          return;
        }
        if (res.status !== 'ok') {
          setGps(res.status);
          return;
        }
        stopFixes.current = res.stop;
        try {
          await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        } catch {
          // no wake-lock (Android throws when the activity is momentarily
          // gone) — following still works, the screen may just dim
        }
        if (!live.current) deactivateKeepAwake(KEEP_AWAKE_TAG);
      } finally {
        starting.current = false;
      }
    })();
  };

  // FR-113 wake-lock + GPS stream, released on unmount (live-guarded)
  useEffect(() => {
    if (drive === null) return undefined;
    live.current = true;
    startTracking();
    return () => {
      live.current = false;
      stopFixes.current?.();
      stopFixes.current = null;
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FR-111 fallback for rows saved before turns travelled with the route:
  // re-match the line and anchor each matched turn by position.
  useEffect(() => {
    if (drive === null || carried !== null) return undefined;
    const controller = new AbortController();
    match(
      { baseUrl: getApiBaseUrl(), sessionId },
      { trace: decimateForMatch(drive.geometry) },
      controller.signal,
    )
      .then((matched) => {
        const t = track.current;
        if (!live.current || !t) return;
        const derived = anchorsFromMatched(t, matched.geometry, matched.maneuvers);
        if (!derivedGuidanceUsable(derived)) {
          setGuidance('unavailable');
          return;
        }
        track.current = { ...t, anchors: derived.anchors };
        setGuidance('ready');
        // recompute for the fix already in hand — the banner must not wait
        // for the next GPS tick to show the first turn
        if (lastFix.current) commit(statusFor(track.current, lastFix.current));
      })
      .catch(() => {
        if (live.current) setGuidance('unavailable');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // driven vs ahead — recomputed every ~25 m of progress, not every fix
  const alongBucket = Math.round((status?.alongM ?? 0) / 25);
  const lines = useMemo(
    () =>
      track.current
        ? splitAtAlong(track.current, status?.alongM ?? 0)
        : { behind: null, ahead: null },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alongBucket],
  );

  if (drive === null || track.current === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={[styles.bannerText, { color: colors.textMuted }]}>
          No drive to follow — open a route first.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Exit follow mode"
          onPress={() => props.navigation.goBack()}
          style={[styles.exitBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.exitLabel, { color: colors.text }]}>Exit</Text>
        </Pressable>
      </View>
    );
  }

  const nextTurnPoint =
    status?.hint && !status.offRoute
      ? pointAtDistance(track.current, status.alongM + status.hint.inM)
      : null;
  const eta =
    status !== null && !status.done
      ? etaSeconds(status.remainingM, progress.current, drive.distance_m, drive.duration_s)
      : null;

  /** One-line status when there is no turn to show; null → the turn card. */
  const line = ((): { text: string; tone: 'ok' | 'warn' | 'muted' } | null => {
    if (gps === 'denied') {
      return {
        text: 'Location permission is off — enable it in Settings, then tap Retry.',
        tone: 'warn',
      };
    }
    if (gps === 'error') return { text: 'Could not read the GPS — tap Retry.', tone: 'warn' };
    if (gps === 'acquiring') return { text: 'Getting a GPS fix…', tone: 'muted' };
    if (status?.done) return { text: 'That’s the drive — nice one.', tone: 'ok' };
    if (status?.offRoute) {
      return { text: 'You’re off the route — rejoin the line on the map.', tone: 'warn' };
    }
    if (status?.hint) return null;
    if (guidance === 'unavailable') {
      // One neutral line: the app cannot know WHY there are no turns (a seed
      // drive, a legacy row, a matcher that could not rebuild it, a network
      // failure), so it claims nothing about provenance (review finding).
      return { text: 'No turn guidance for this drive — following the line.', tone: 'muted' };
    }
    if (guidance === 'pending') return { text: 'Loading turn guidance…', tone: 'muted' };
    return { text: 'Follow the highlighted line.', tone: 'muted' };
  })();

  const onTrackingChange = (e: unknown): void => {
    const payload = (e as { nativeEvent?: { payload?: { followUserLocation?: boolean } } })
      .nativeEvent?.payload;
    if (payload && payload.followUserLocation === false) setFollowing(false);
  };

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        compassEnabled
      >
        <Camera
          defaultSettings={{
            centerCoordinate: drive.geometry.coordinates[0] as [number, number],
            zoomLevel: 10,
          }}
          // only once there is something to follow: with this true at mount
          // the SDK discards defaultSettings, so a denied/slow GPS left the
          // map on the world view instead of the drive (review finding)
          followUserLocation={following && gps === 'ok'}
          followUserMode={UserTrackingMode.FollowWithCourse}
          followZoomLevel={FOLLOW_ZOOM}
          followPitch={0}
          onUserTrackingModeChange={onTrackingChange}
          animationDuration={800}
        />
        {lines.behind && (
          <ShapeSource
            id="follow-behind"
            shape={{ type: 'Feature', properties: {}, geometry: lines.behind }}
          >
            <LineLayer
              id="follow-behind-layer"
              style={{
                lineColor: DRIVEN_GREY,
                lineWidth: 5,
                lineOpacity: 0.7,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}
        {lines.ahead && (
          <ShapeSource
            id="follow-ahead"
            shape={{ type: 'Feature', properties: {}, geometry: lines.ahead }}
          >
            <LineLayer
              id="follow-ahead-layer"
              style={{ lineColor: AMBER, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }}
            />
          </ShapeSource>
        )}
        {nextTurnPoint && (
          <ShapeSource
            id="follow-next-turn"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [nextTurnPoint.lng, nextTurnPoint.lat] },
            }}
          >
            <CircleLayer
              id="follow-next-turn-layer"
              style={{
                circleRadius: 7,
                circleColor: '#ffffff',
                circleStrokeWidth: 3,
                circleStrokeColor: AMBER,
              }}
            />
          </ShapeSource>
        )}
        {/* the SDK puck: the heading arrow tells the driver which of two
            overlapping lines is theirs */}
        <UserLocation visible showsUserHeadingIndicator androidRenderMode="gps" />
      </MapView>

      {line !== null ? (
        <View
          style={[
            styles.banner,
            {
              top: topInset + spacing.md,
              backgroundColor: colors.surfaceRaised,
              borderColor:
                line.tone === 'warn'
                  ? colors.danger
                  : line.tone === 'ok'
                    ? colors.accent
                    : colors.border,
            },
          ]}
        >
          {/* no accessibilityLabel: a label REPLACES the text for a screen
              reader, and "Guidance" said nothing (review finding) */}
          <Text
            style={[
              styles.bannerText,
              { color: line.tone === 'warn' ? colors.danger : colors.text },
            ]}
          >
            {line.text}
          </Text>
          {(gps === 'denied' || gps === 'error') && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry location"
              onPress={startTracking}
              style={[styles.retryBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.exitLabel, { color: colors.text }]}>Retry</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View
          style={[
            styles.banner,
            {
              top: topInset + spacing.md,
              backgroundColor: colors.surfaceRaised,
              borderColor: AMBER,
            },
          ]}
          accessible
          accessibilityLabel={`In ${fmtDistance(status!.hint!.inM)}, ${status!.hint!.instruction}${
            status!.then ? `, then ${status!.then.instruction}` : ''
          }`}
        >
          <Text style={[styles.hintIn, { color: colors.textMuted }]}>
            {`In ${fmtDistance(status!.hint!.inM)}`}
          </Text>
          <Text style={[styles.hintTurn, { color: colors.text }]}>{status!.hint!.instruction}</Text>
          {status!.then && (
            <Text style={[styles.hintThen, { color: colors.textMuted }]} numberOfLines={1}>
              {`then ${status!.then.instruction}`}
            </Text>
          )}
        </View>
      )}

      {!following && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recenter on me"
          onPress={() => setFollowing(true)}
          style={[styles.recenter, { backgroundColor: colors.surfaceRaised, borderColor: AMBER }]}
        >
          <Text style={[styles.recenterLabel, { color: colors.text }]}>Recenter</Text>
        </Pressable>
      )}

      <View
        style={[
          styles.panel,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ]}
      >
        <View style={styles.row}>
          <View style={styles.remainingWrap}>
            <Text style={[styles.remaining, { color: colors.text }]}>
              {status !== null ? `${fmtDistance(status.remainingM)} to go` : '—'}
            </Text>
            {eta !== null && (
              <Text style={[styles.eta, { color: colors.textMuted }]}>
                {`about ${fmtDuration(eta)} left`}
              </Text>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Exit follow mode"
            onPress={() => props.navigation.goBack()}
            style={[styles.exitBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.exitLabel, { color: colors.text }]}>Exit</Text>
          </Pressable>
        </View>
        <SafetyNote context="follow" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  map: { flex: 1 },
  banner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  bannerText: { ...font.body, lineHeight: 21 },
  retryBtn: {
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  hintIn: { ...font.heading },
  /** The next turn is the biggest text on the screen (device pass). */
  hintTurn: { fontSize: 26, fontWeight: '700', lineHeight: 32 },
  hintThen: { ...font.body },
  recenter: {
    position: 'absolute',
    right: spacing.md,
    bottom: 132,
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recenterLabel: { ...font.button },
  panel: { borderTopWidth: 1, padding: spacing.md, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remainingWrap: { gap: 2 },
  remaining: { ...font.heading },
  eta: { ...font.caption },
  exitBtn: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitLabel: { ...font.button },
});
