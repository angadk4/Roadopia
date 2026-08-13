/**
 * Follow-mode (M9-T06; FR-110..114) — the PRIMARY in-app driving experience.
 * Route polyline + live position tracking along it + remaining distance
 * (FR-110), next-maneuver hints (FR-111), screen held awake (FR-113), and the
 * persistent safe-driving disclaimer (FR-114). Foreground-only GPS (§20.3).
 *
 * Saved/served routes carry no maneuvers, so guidance is re-derived by
 * map-matching the followed line through /match — and trusted ONLY when the
 * match reconstructs the same route (length agreement, follow.ts). When it
 * doesn't, the screen says guidance is unavailable and still tracks position
 * + remaining distance honestly. No re-routing: off the line = say so.
 */

import Mapbox, { Camera, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import type { Route } from '@shared/types';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import '../lib/mapbox';
import SafetyNote from '../components/SafetyNote';
import { postMatch } from '../lib/api';
import {
  buildFollowTrack,
  decimateForMatch,
  fmtDistance,
  followStatus,
  matchAgrees,
  type FollowStatus,
  type FollowTrack,
} from '../lib/follow';
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
const FOLLOW_ZOOM = 13.5;

export default function FollowScreen(props: FollowScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const drive = props.route.params?.route ?? null;
  const watch = props.watchFn ?? watchLocation;
  const match = props.matchFn ?? postMatch;

  const track = useRef<FollowTrack | null>(null);
  if (track.current === null && drive !== null) {
    track.current = buildFollowTrack(drive.geometry, []);
  }

  const [guidance, setGuidance] = useState<Guidance>('pending');
  const [gps, setGps] = useState<Gps>('acquiring');
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [status, setStatus] = useState<FollowStatus | null>(null);
  const lastAlong = useRef<number | null>(null);
  const stopFixes = useRef<StopWatching | null>(null);

  // FR-113 wake-lock + GPS stream, released on unmount
  useEffect(() => {
    if (drive === null) return undefined;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    void (async () => {
      const res = await watch((f) => {
        setFix(f);
        setGps('ok');
        const t = track.current;
        if (!t) return;
        const st = followStatus(t, { lat: f.lat, lng: f.lng }, lastAlong.current);
        lastAlong.current = st.alongM;
        setStatus(st);
      });
      if (res.status !== 'ok') {
        setGps(res.status);
        return;
      }
      stopFixes.current = res.stop;
    })();
    return () => {
      stopFixes.current?.();
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FR-111: derive maneuvers by matching the followed line itself
  useEffect(() => {
    if (drive === null) return;
    match({ baseUrl: getApiBaseUrl(), sessionId }, { trace: decimateForMatch(drive.geometry) })
      .then((matched) => {
        const total = track.current?.totalM ?? 0;
        if (matchAgrees(total, matched.distance_m)) {
          track.current = buildFollowTrack(drive.geometry, matched.maneuvers);
          setGuidance('ready');
        } else {
          setGuidance('unavailable');
        }
      })
      .catch(() => setGuidance('unavailable'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (drive === null || track.current === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <Text style={[styles.bannerText, { color: colors.textMuted }]}>
          No drive to follow — open a route first.
        </Text>
      </View>
    );
  }

  const banner = ((): { text: string; tone: 'ok' | 'warn' | 'muted' } => {
    if (gps === 'denied')
      return {
        text: 'Location permission is off — enable it in Settings to follow.',
        tone: 'warn',
      };
    if (gps === 'error') return { text: 'Could not read the GPS — try again.', tone: 'warn' };
    if (gps === 'acquiring') return { text: 'Getting a GPS fix…', tone: 'muted' };
    if (status?.done) return { text: 'That’s the drive — nice one.', tone: 'ok' };
    if (status?.offRoute)
      return { text: 'You’re off the route — rejoin the line on the map.', tone: 'warn' };
    if (status?.hint)
      return {
        text: `In ${fmtDistance(status.hint.inM)} · ${status.hint.instruction}`,
        tone: 'ok',
      };
    if (guidance === 'unavailable')
      return { text: 'Turn guidance unavailable — following the line.', tone: 'muted' };
    if (guidance === 'pending') return { text: 'Loading turn guidance…', tone: 'muted' };
    return { text: 'Follow the highlighted line.', tone: 'muted' };
  })();

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
      >
        <Camera
          defaultSettings={{
            centerCoordinate: drive.geometry.coordinates[0] as [number, number],
            zoomLevel: 10,
          }}
          {...(fix !== null
            ? { centerCoordinate: [fix.lng, fix.lat] as [number, number], zoomLevel: FOLLOW_ZOOM }
            : {})}
          animationDuration={800}
        />
        <ShapeSource
          id="follow-line"
          shape={{ type: 'Feature', properties: {}, geometry: drive.geometry }}
        >
          <LineLayer
            id="follow-line-layer"
            style={{ lineColor: AMBER, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }}
          />
        </ShapeSource>
        {fix !== null && (
          <ShapeSource
            id="follow-puck"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [fix.lng, fix.lat] },
            }}
          >
            <Mapbox.CircleLayer
              id="follow-puck-layer"
              style={{
                circleRadius: 9,
                circleColor: '#2f6fed',
                circleStrokeWidth: 3,
                circleStrokeColor: '#ffffff',
              }}
            />
          </ShapeSource>
        )}
      </MapView>

      <View
        style={[
          styles.banner,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor:
              banner.tone === 'warn'
                ? colors.danger
                : banner.tone === 'ok'
                  ? colors.accent
                  : colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.bannerText,
            { color: banner.tone === 'warn' ? colors.danger : colors.text },
          ]}
          accessibilityLabel="Guidance"
        >
          {banner.text}
        </Text>
      </View>

      <View
        style={[
          styles.panel,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ]}
      >
        <View style={styles.row}>
          <Text style={[styles.remaining, { color: colors.text }]} accessibilityLabel="Remaining">
            {status !== null ? `${fmtDistance(status.remainingM)} to go` : '—'}
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
        <SafetyNote context="follow" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  map: { flex: 1 },
  banner: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  bannerText: { ...font.body, lineHeight: 21 },
  panel: { borderTopWidth: 1, padding: spacing.md, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remaining: { ...font.heading },
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
