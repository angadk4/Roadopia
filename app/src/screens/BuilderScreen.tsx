/**
 * Manual route builder (M9-T01/T02; FR-050..053). Crosshair pattern: pan the
 * map, "Add point" appends the centre; ≥2 points live-snap through POST
 * /route (debounced 400 ms — the AC's <2 s update budget is mostly the route
 * call itself). The snapped line renders as the single source of truth — the
 * product IS the snap (§21: hand-built routes still follow real roads).
 * Saving reuses SaveDriveButton (gated, FR-201) with origin_type='manual'.
 */

import Mapbox, { Camera, MapView, ShapeSource, LineLayer } from '@rnmapbox/maps';
import type { RouteThroughOutput } from '@shared/types';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import '../lib/mapbox';
import SafetyNote from '../components/SafetyNote';
import SaveDriveButton from '../components/SaveDriveButton';
import { postRouteThrough, ApiError, NetworkError } from '../lib/api';
import {
  addWaypoint,
  canRoute,
  clearWaypoints,
  closeLoop,
  EMPTY_BUILDER,
  MAX_WAYPOINTS,
  statsLine,
  toManualRoute,
  undoWaypoint,
  type BuilderState,
} from '../lib/builder';
import { getApiBaseUrl } from '../lib/runtime';
import { sessionId } from '../lib/session';
import { AMBER, font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface BuilderScreenProps {
  navigation: { goBack: () => void };
  /** Injectable for tests. */
  routeFn?: typeof postRouteThrough;
}

const INITIAL_CENTER: [number, number] = [-79.8, 43.6];
const INITIAL_ZOOM = 8;
const DEBOUNCE_MS = 400;

export default function BuilderScreen(props: BuilderScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const route = props.routeFn ?? postRouteThrough;

  const center = useRef<[number, number]>(INITIAL_CENTER);
  const [state, setState] = useState<BuilderState>(EMPTY_BUILDER);
  const [snapped, setSnapped] = useState<RouteThroughOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // debounced live snap whenever the waypoint list changes
  useEffect(() => {
    if (!canRoute(state)) {
      setSnapped(null);
      setProblem(null);
      return;
    }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      route({ baseUrl: getApiBaseUrl(), sessionId }, { waypoints: state.waypoints })
        .then((r) => {
          if (!live) return;
          setSnapped(r);
          setProblem(null);
          setBusy(false);
        })
        .catch((err: unknown) => {
          if (!live) return;
          setSnapped(null);
          setBusy(false);
          setProblem(
            err instanceof ApiError
              ? err.message
              : err instanceof NetworkError
                ? 'Could not reach the server — check your connection.'
                : 'Could not route those points.',
          );
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const addCentre = (): void => {
    const [lng, lat] = center.current;
    setState((s) => addWaypoint(s, { lat, lng }));
  };

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        onCameraChanged={(s) => {
          const c = (s as unknown as { properties?: { center?: number[] } }).properties?.center;
          if (c && c.length >= 2) center.current = [c[0]!, c[1]!];
        }}
      >
        <Camera
          defaultSettings={{ centerCoordinate: INITIAL_CENTER, zoomLevel: INITIAL_ZOOM }}
          animationDuration={0}
        />
        {snapped && (
          <ShapeSource
            id="builder-line"
            shape={{ type: 'Feature', properties: {}, geometry: snapped.geometry }}
          >
            <LineLayer
              id="builder-line-layer"
              style={{ lineColor: AMBER, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}
            />
          </ShapeSource>
        )}
        {state.waypoints.length > 0 && (
          <ShapeSource
            id="builder-points"
            shape={{
              type: 'FeatureCollection',
              features: state.waypoints.map((p, i) => ({
                type: 'Feature' as const,
                properties: { idx: i },
                geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
              })),
            }}
          >
            <Mapbox.CircleLayer
              id="builder-points-layer"
              style={{
                circleRadius: 6,
                circleColor: AMBER,
                circleStrokeWidth: 2,
                circleStrokeColor: '#11151a',
              }}
            />
          </ShapeSource>
        )}
      </MapView>

      {/* crosshair (PickPoint precedent) */}
      <View pointerEvents="none" style={styles.crosshairWrap}>
        <View style={[styles.crosshairDot, { borderColor: colors.bg }]} />
      </View>

      <View
        style={[
          styles.panel,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.stats, { color: colors.text }]} accessibilityLabel="Route stats">
          {busy ? 'Routing…' : statsLine(snapped)}
        </Text>
        {problem !== null && (
          <Text style={[styles.problem, { color: colors.danger }]}>{problem}</Text>
        )}
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add point"
            onPress={addCentre}
            disabled={state.waypoints.length >= MAX_WAYPOINTS}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.primaryLabel, { color: colors.onAccent }]}>Add point</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo"
            onPress={() => setState(undoWaypoint)}
            disabled={state.waypoints.length === 0}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>Undo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close loop"
            onPress={() => setState(closeLoop)}
            disabled={!canRoute(state)}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>Close loop</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear"
            onPress={() => setState(clearWaypoints())}
            disabled={state.waypoints.length === 0}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.textMuted }]}>Clear</Text>
          </Pressable>
        </View>
        {snapped && (
          <SaveDriveButton
            route={toManualRoute(snapped, state.waypoints)}
            agentExplanation={null}
          />
        )}
        {snapped && <SafetyNote context="route" />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  crosshairWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: AMBER,
    borderWidth: 2,
  },
  panel: {
    borderTopWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  stats: { ...font.heading },
  problem: { ...font.caption },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  primaryBtn: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { ...font.button },
  secondaryBtn: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: { ...font.body },
});
