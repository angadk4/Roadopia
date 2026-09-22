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
 *
 * Redesign (SPEC "Follow"). Structurally this screen was already right for a
 * car mount — headerless, full-bleed, pushed with `gestureEnabled: false`
 * (the stack registers `phoneOwnerOptions`; an edge swipe would fight map
 * panning, and Exit is the way out), tab bar hidden, unmounted on exit so the
 * GPS watcher and the wake-lock are released. What changed is what the chrome
 * is MADE OF:
 *   - the status-bar scrim is one `StatusScrim` gradient instead of four
 *     stacked bands.
 *   - the status banner is `Material role="dense"` — the heavier paper tint
 *     over a blur, because the content under it is moving map tiles (the
 *     busiest content in the app), and the bottom panel and the Recenter
 *     pill are `Material` too.
 *   - the TURN CARD is the one deliberately OPAQUE surface on the screen. A
 *     driver reads it in a glance over tiles that scroll; legibility beats
 *     material here. It is the screen's hero: a legend, the distance as a
 *     tabular stat line, the manoeuvre in the `display` role — the only page
 *     that still uses `display`, because here it is an instruction, not a
 *     title.
 *   - NOTHING on the turn card animates. Run through the expo-animation gate
 *     ("should this animate?"): a cross-fade on a manoeuvre puts a fading
 *     instruction in front of a driver, and no purpose but decoration can be
 *     named for it — so it is not written. Motion is confined to the chrome:
 *     the banner fades in (opacity only), Recenter fades in with the pan that
 *     summoned it and fades out when following resumes, and every control has
 *     its press response. Under Reduce Motion those fades are skipped by the
 *     OS switch (`ReduceMotion.System`) and the elements simply appear.
 *     The two fades run on the shell's builders, `ENTER_FADE` (200 ms) and
 *     `EXIT` (160 ms), where the SPEC's Follow section writes 160 / 120 for
 *     Recenter: rule 10 makes `ui/motion.ts` the only place a duration meets
 *     Reanimated, and a private pair of numbers in one screen is exactly the
 *     drift that file exists to prevent. Said here so it is visible; if 160 /
 *     120 is wanted literally the shell adds a `RECENTER_IN` / `RECENTER_OUT`
 *     pair and this screen swaps two identifiers.
 *   - ONE haptic: `notificationAsync(Success)` the moment `done` flips true —
 *     the car has stopped. Nothing per fix, nothing for off-route, nothing
 *     while in motion (SPEC haptics policy; expo-animation §8).
 *   - the honest copy is verbatim (§18): every status line below is the same
 *     string it was, only the surface under it changed.
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
import { notificationAsync, NotificationFeedbackType } from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { type LayoutChangeEvent, ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import '../lib/mapbox';
import SafetyNote from '../components/SafetyNote';
import {
  Button,
  ENTER_FADE,
  EXIT,
  Legend,
  Material,
  PressableScale,
  StatusScrim,
  Surface,
  Symbol,
  Text,
} from '../components/ui';
import { EmptyState } from '../components/ui/native';
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
import { useBottomInset, useTopInset } from '../lib/insets';
import { watchLocation, type LocationFix, type StopWatching } from '../lib/location';
import { getApiBaseUrl } from '../lib/runtime';
import { sessionId } from '../lib/session';
import { AMBER, ATTRIBUTION_STRIP_H, HIT_TARGET, spacing, useTheme } from '../theme';

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
  const bottomInset = useBottomInset();
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
  /** Measured, not estimated: Recenter sits above the panel and the compass
   *  below the banner, both of which change height with the content, the
   *  safe-area inset and Dynamic Type. */
  const [panelH, setPanelH] = useState(0);
  const [bannerH, setBannerH] = useState(0);
  const lastAlong = useRef<number | null>(null);
  /** The smallest on-route progress seen — `done` needs the drive to have
   *  been started, not joined at its end (review finding). */
  const minAlong = useRef<number | null>(null);
  const lastFix = useRef<LatLng | null>(null);
  const lastCourse = useRef<Course | null>(null);
  /** On-route progress over the last few minutes, for the arrival estimate. */
  const progress = useRef<ProgressSample[]>([]);
  const stopFixes = useRef<StopWatching | null>(null);
  /** The finish haptic has played. One per screen life: `done` is computed
   *  from every fix, and a car parked at the end keeps producing fixes. */
  const finished = useRef(false);
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
    if (st.done && !finished.current) {
      // The one haptic on this screen, fired at the causal moment — the same
      // tick as the state change that shows "That's the drive". The car has
      // stopped; nothing plays while it is moving.
      finished.current = true;
      void notificationAsync(NotificationFeedbackType.Success);
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
      // Headerless, so this dead end pads its own top. The copy is the honest
      // one; the composition is the platform's own "content unavailable".
      <View style={[styles.center, { backgroundColor: colors.bg, paddingTop: topInset }]}>
        <EmptyState
          symbol="locationSlash"
          title="No drive to follow — open a route first."
          action={
            <Button
              title="Exit"
              variant="secondary"
              size="lg"
              block
              accessibilityLabel="Exit follow mode"
              icon={<Symbol name="xmark" size="md" />}
              onPress={() => props.navigation.goBack()}
            />
          }
        />
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
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <MapView
        style={styles.map}
        styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        compassEnabled
        // The SDK draws the compass top-right, which is exactly where the
        // banner's right edge lands. Push it below the MEASURED banner.
        compassViewMargins={{ x: spacing.md, y: topInset + spacing.md + bannerH + spacing.sm }}
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
              // The ground colour inside an amber ring: the same reticle read
              // the builder uses, and it themes with the map style instead of
              // being a hardcoded white dot on a dark map.
              style={{
                circleRadius: 7,
                circleColor: colors.bg,
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

      {/* the status-bar glyphs read on any tile: paper fading to nothing */}
      <StatusScrim testID="follow-scrim" />

      <View
        pointerEvents="box-none"
        style={[styles.bannerWrap, { top: topInset + spacing.md }]}
        onLayout={(e: LayoutChangeEvent) => setBannerH(e.nativeEvent.layout.height)}
      >
        {line !== null ? (
          // The status band: the dense material, because the tiles under it
          // move. It fades in (opacity only) when it replaces the turn card.
          <Animated.View entering={ENTER_FADE}>
            <Material role="dense" style={styles.banner} testID="follow-banner">
              <View style={styles.bannerRow}>
                {gps === 'acquiring' ? (
                  <ActivityIndicator color={colors.accentText} />
                ) : (
                  <Symbol
                    name={
                      line.tone === 'warn'
                        ? 'exclamationmarkTriangleFill'
                        : line.tone === 'ok'
                          ? 'checkmarkCircleFill'
                          : 'locationNorthLine'
                    }
                    size="lg"
                    tone={
                      line.tone === 'warn' ? 'danger' : line.tone === 'ok' ? 'success' : 'muted'
                    }
                  />
                )}
                {/* no accessibilityLabel: a label REPLACES the text for a
                    screen reader, and "Guidance" said nothing (review) */}
                <Text
                  variant="body"
                  tone={line.tone === 'warn' ? 'danger' : 'default'}
                  style={styles.bannerText}
                >
                  {line.text}
                </Text>
              </View>
              {(gps === 'denied' || gps === 'error') && (
                <Button
                  title="Retry"
                  variant="secondary"
                  block
                  style={styles.retry}
                  accessibilityLabel="Retry location"
                  icon={<Symbol name="arrowClockwise" size="md" />}
                  onPress={startTracking}
                />
              )}
            </Material>
          </Animated.View>
        ) : (
          // The turn card: OPAQUE (a raised Surface, not a material — the one
          // place legibility beats material), deliberately NOT animated, and
          // deliberately the heaviest type on the screen. A driver glances at
          // this once.
          <Surface
            level="raised"
            padding="md"
            style={[styles.turnCard, { borderColor: colors.accent }]}
            testID="follow-turn-card"
          >
            <View
              accessible
              accessibilityLabel={`In ${fmtDistance(status!.hint!.inM)}, ${
                status!.hint!.instruction
              }${status!.then ? `, then ${status!.then.instruction}` : ''}`}
              style={styles.turn}
            >
              {/* legend, distance and manoeuvre are ONE unit (intra-row
                  spacing); the turn after it is a separate line (row spacing). */}
              <View style={styles.turnHead}>
                <Legend>Next</Legend>
                <Text variant="stat" tone="muted" style={styles.figures}>
                  {`In ${fmtDistance(status!.hint!.inM)}`}
                </Text>
                <Text variant="display">{status!.hint!.instruction}</Text>
              </View>
              {status!.then && (
                <Text variant="label" tone="muted" numberOfLines={1}>
                  {`then ${status!.then.instruction}`}
                </Text>
              )}
            </View>
          </Surface>
        )}
      </View>

      {!following && (
        // A material pill. It fades in with the pan that summoned it and out
        // when following resumes, anchored above the measured panel and clear
        // of the Mapbox attribution (FR-014).
        <Animated.View
          entering={ENTER_FADE}
          exiting={EXIT}
          style={[styles.recenter, { bottom: panelH + ATTRIBUTION_STRIP_H + spacing.sm }]}
        >
          <PressableScale accessibilityLabel="Recenter on me" onPress={() => setFollowing(true)}>
            <Material role="pill" style={styles.pill} testID="follow-recenter">
              <Symbol name="locationFill" size="lg" tone="accent" />
            </Material>
          </PressableScale>
        </Animated.View>
      )}

      <View onLayout={(e: LayoutChangeEvent) => setPanelH(e.nativeEvent.layout.height)}>
        <Material
          role="panel"
          style={[styles.panel, { paddingBottom: spacing.gutter + bottomInset }]}
          testID="follow-panel"
        >
          <View style={styles.panelRow}>
            <View style={styles.remainingSlot}>
              {status !== null && (
                // Hand-rolled rather than `Stat`: the announced string is
                // "8.1 km to go" — one measurement read as a sentence — and
                // `Stat` would announce "8.1 km, to go".
                <View accessible accessibilityLabel={`${fmtDistance(status.remainingM)} to go`}>
                  <Text variant="stat" style={styles.figures}>
                    {fmtDistance(status.remainingM)}
                  </Text>
                  <Legend>to go</Legend>
                </View>
              )}
              {eta !== null && (
                <Text variant="footnote" tone="muted">
                  {`about ${fmtDuration(eta)} left`}
                </Text>
              )}
            </View>
            <Button
              title="Exit"
              variant="secondary"
              size="lg"
              accessibilityLabel="Exit follow mode"
              icon={<Symbol name="xmark" size="md" />}
              onPress={() => props.navigation.goBack()}
            />
          </View>
          <SafetyNote context="follow" />
        </Material>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: spacing.gutter },
  map: { flex: 1 },
  bannerWrap: { position: 'absolute', left: spacing.gutter, right: spacing.gutter },
  banner: { padding: spacing.md },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bannerText: { flexShrink: 1 },
  retry: { marginTop: spacing.sm },
  /** The one outlined surface on this screen: the turn card has to be
   *  instantly separable from the status banner it replaces. */
  turnCard: { borderWidth: 1 },
  turn: { gap: spacing.sm },
  turnHead: { gap: spacing.xs },
  /** Numbers that change on every GPS fix sit in a driver's peripheral
   *  vision — same-width digits, so the line never shimmies. */
  figures: { fontVariant: ['tabular-nums'] },
  recenter: { position: 'absolute', right: spacing.gutter },
  /** A 44pt circle: the visual IS the touch target (expo-animation §7).
   *  PressableScale's default 12pt slop stays — the pill floats alone over the
   *  map, so the extra reach cannot make it ambiguous with a neighbour. */
  pill: { width: HIT_TARGET, height: HIT_TARGET },
  panel: {
    padding: spacing.gutter,
    gap: spacing.md,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  remainingSlot: { flex: 1, minHeight: 48, justifyContent: 'center', gap: spacing.xs },
});
