/**
 * Manual route builder (M9-T01/T02; FR-050..053). Crosshair pattern: pan the
 * map, "Add point" appends the centre; ≥2 points live-snap through POST
 * /route (debounced 400 ms — the AC's <2 s update budget is mostly the route
 * call itself). The snapped line renders as the single source of truth — the
 * product IS the snap (§21: hand-built routes still follow real roads).
 * Saving reuses SaveDriveButton (gated, FR-201) with origin_type='manual'.
 *
 * Device pass (2026-09-04) — "the dots don't stay where I put them and don't
 * snap to the road". Two causes, both fixed here:
 *   1. The crosshair was centred on the whole SCREEN while the map was only
 *      the part above the bottom panel, so every point landed north of the
 *      dot by half the panel height — and the panel grew after the first
 *      route, so the offset changed mid-session. The crosshair now lives
 *      INSIDE the map container, and the point is resolved from the map
 *      itself at press time (getCoordinateFromView of the container centre),
 *      so no layout or fling can put it anywhere but under the dot.
 *   2. The dots drew the RAW taps while the line was snapped. They now draw
 *      the engine's snapped locations once the route arrives, and dim while
 *      routing — the slide onto the road is visible.
 * Also: a tap that would do nothing (duplicate, cap, close-loop at the cap)
 * says so; a dot can be tapped to remove that point; a routing failure has a
 * Retry; a superseded request is aborted.
 */

import Mapbox, { Camera, CircleLayer, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import type { LatLng, RouteThroughOutput } from '@shared/types';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import '../lib/mapbox';
import SafetyNote from '../components/SafetyNote';
import SaveDriveButton from '../components/SaveDriveButton';
import { ApiError, NetworkError, postRouteThrough } from '../lib/api';
import {
  addWaypoint,
  canRoute,
  clearWaypoints,
  closeLoop,
  EMPTY_BUILDER,
  MAX_WAYPOINTS,
  removeWaypoint,
  statsLine,
  toManualRoute,
  undoWaypoint,
  whyCannotAdd,
  whyCannotCloseLoop,
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
/** Roads are individually visible from here — a point placed at region zoom
 *  (8) had ±30 km of slack under one finger. */
const INITIAL_ZOOM = 12;
const DEBOUNCE_MS = 400;

export default function BuilderScreen(props: BuilderScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const route = props.routeFn ?? postRouteThrough;

  const mapRef = useRef<MapView>(null);
  /** The map container's size in dp — its centre is the crosshair. */
  const size = useRef<{ w: number; h: number } | null>(null);
  /** Camera centre from the last camera event: the fallback when the map
   *  cannot answer (still loading). */
  const cameraCentre = useRef<[number, number]>(INITIAL_CENTER);

  const [state, setState] = useState<BuilderState>(EMPTY_BUILDER);
  const [snapped, setSnapped] = useState<RouteThroughOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Why the last tap did nothing, in words (never a silent no-op). */
  const [note, setNote] = useState<string | null>(null);
  /** Bumped by Retry so the effect re-requests the same points. */
  const [attempt, setAttempt] = useState(0);

  // debounced live snap whenever the waypoint list changes
  useEffect(() => {
    if (!canRoute(state)) {
      setSnapped(null);
      setProblem(null);
      setBusy(false); // Clear/Undo below two points must not leave "Routing…" up
      return;
    }
    let live = true;
    const controller = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      route(
        { baseUrl: getApiBaseUrl(), sessionId },
        { waypoints: state.waypoints },
        controller.signal,
      )
        .then((r) => {
          if (!live) return;
          setSnapped(r);
          setProblem(null);
          setBusy(false);
        })
        .catch((err: unknown) => {
          if (!live) return;
          if (err instanceof Error && err.name === 'AbortError') return; // superseded
          setSnapped(null);
          setBusy(false);
          setProblem(
            err instanceof ApiError || err instanceof NetworkError
              ? err.message
              : 'Could not route those points.',
          );
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
      controller.abort(); // a newer point list supersedes this request
    };
  }, [state, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The coordinate under the crosshair, asked of the MAP at press time. */
  const resolveCentre = async (): Promise<LatLng> => {
    const m = mapRef.current;
    const s = size.current;
    if (m && s) {
      try {
        const [lng, lat] = await m.getCoordinateFromView([s.w / 2, s.h / 2]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
      } catch {
        // fall through to the camera centre
      }
    }
    const [lng, lat] = cameraCentre.current;
    return { lat, lng };
  };

  const addCentre = (): void => {
    void (async () => {
      const p = await resolveCentre();
      const why = whyCannotAdd(state, p);
      if (why === 'full') {
        setNote(
          `That's the most points a drive can have (${MAX_WAYPOINTS}). Undo one to add another.`,
        );
        return;
      }
      if (why === 'duplicate') {
        setNote('That point is already the last one — pan the map first.');
        return;
      }
      setNote(null);
      setState((s) => addWaypoint(s, p));
    })();
  };

  const onCloseLoop = (): void => {
    const why = whyCannotCloseLoop(state);
    if (why === 'too_few') {
      setNote('Add at least two points before closing the loop.');
      return;
    }
    if (why === 'closed') {
      setNote('This drive already ends where it starts.');
      return;
    }
    if (why === 'full') {
      setNote(
        `Closing the loop needs one more point, and ${MAX_WAYPOINTS} is the most a drive can have — undo one first.`,
      );
      return;
    }
    setNote(null);
    setState(closeLoop);
  };

  const removeAt = (index: number): void => {
    setNote(`Removed point ${index + 1}.`);
    setState((s) => removeWaypoint(s, index));
  };

  // The dots: the engine's snapped positions once they line up with the
  // points, else the raw taps (dimmed while a new route is on its way).
  const snappedDots =
    snapped && !busy && snapped.locations && snapped.locations.length === state.waypoints.length
      ? snapped.locations
      : null;
  const dots = snappedDots ?? state.waypoints;

  const stats = busy
    ? 'Routing…'
    : snapped
      ? `${state.waypoints.length} points · ${statsLine(snapped)}`
      : statsLine(null);

  return (
    <View style={styles.root}>
      <View
        style={styles.mapWrap}
        onLayout={(e: LayoutChangeEvent) => {
          size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
        }}
      >
        <MapView
          ref={mapRef}
          style={styles.map}
          styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
          scaleBarEnabled={false}
          onCameraChanged={(s) => {
            const c = (s as unknown as { properties?: { center?: number[] } }).properties?.center;
            if (c && c.length >= 2) cameraCentre.current = [c[0]!, c[1]!];
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
          {dots.length > 0 && (
            <ShapeSource
              id="builder-points"
              shape={{
                type: 'FeatureCollection',
                features: dots.map((p, i) => ({
                  type: 'Feature' as const,
                  properties: { idx: i },
                  geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
                })),
              }}
              hitbox={{ width: 32, height: 32 }}
              onPress={(e) => {
                const idx = (e.features[0]?.properties as { idx?: unknown } | undefined)?.idx;
                if (typeof idx === 'number') removeAt(idx);
              }}
            >
              <CircleLayer
                id="builder-points-layer"
                style={{
                  circleRadius: 7,
                  circleColor: AMBER,
                  circleOpacity: snappedDots ? 1 : 0.55,
                  circleStrokeWidth: 2,
                  circleStrokeColor: '#11151a',
                }}
              />
            </ShapeSource>
          )}
        </MapView>

        {/* crosshair — INSIDE the map container, so it is the map's centre */}
        <View pointerEvents="none" style={styles.crosshairWrap}>
          <View style={[styles.crosshairDot, { borderColor: colors.bg }]} />
        </View>
      </View>

      <View
        style={[
          styles.panel,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.stats, { color: colors.text }]} accessibilityLabel="Route stats">
          {stats}
        </Text>
        {problem !== null && (
          <View style={styles.row}>
            <Text style={[styles.problem, { color: colors.danger }]}>{problem}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry routing"
              onPress={() => setAttempt((a) => a + 1)}
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.secondaryLabel, { color: colors.text }]}>Retry</Text>
            </Pressable>
          </View>
        )}
        {note !== null && problem === null && (
          <Text style={[styles.problem, { color: colors.textMuted }]}>{note}</Text>
        )}
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Pan until the dot sits on the road, then Add point. Tap a dot to remove it.
        </Text>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add point"
            onPress={addCentre}
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
            onPress={() => {
              setNote(null);
              setState(undoWaypoint);
            }}
            disabled={state.waypoints.length === 0}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>Undo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close loop"
            onPress={onCloseLoop}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>Close loop</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear"
            onPress={() => {
              setNote(null);
              setState(clearWaypoints());
            }}
            disabled={state.waypoints.length === 0}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.textMuted }]}>Clear</Text>
          </Pressable>
        </View>
        {/* Only offer the save while the shown snap MATCHES the waypoints.
            Mid-debounce they disagree, and saving then persists the previous
            geometry against the new points — including a wrong is_loop. */}
        {snapped && !busy && (
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
  mapWrap: { flex: 1 },
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
  problem: { ...font.caption, flexShrink: 1 },
  hint: { ...font.caption },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' },
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
