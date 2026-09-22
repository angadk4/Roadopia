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
 *      the engine's snapped locations once the route arrives, cross-faded from
 *      the taps they replace (see the presentation note below).
 * Also: a tap that would do nothing (duplicate, cap, close-loop at the cap)
 * says so; a dot can be tapped to remove that point; a routing failure has a
 * Retry; a superseded request is aborted.
 *
 * Presentation pass (BD-204): the snap is a real CROSS-FADE on the map's own
 * render thread (`builder-taps` holds the raw finger positions, `builder-
 * points` the authoritative dots; their `circleOpacity` swaps when the engine
 * answers), the crosshair is a RETICLE with an open centre, and the metrics
 * are a Stat row whose joined "N points · 42 km · 51 min" survives verbatim as
 * the group's accessibility label. The route line stays AMBER (#f4a319,
 * SPK-01 device-verified).
 *
 * REDESIGN (SPEC "Builder"). It WAS a map above a fixed floating panel that
 * grew ~200 pt in one frame when a route landed. It IS the map bled under a
 * transparent native header ("Build a route", `mapTaskOptions` in
 * CreateStack — the header owns Clear while there are points) with the
 * `Shelf` primitive as a two-detent TOOL SHEET over it:
 *
 *   tools   the sheet's header — the stats slot, the honest lines, Add point,
 *           Undo / Close loop — at its MEASURED height (floored at 160);
 *   full    60 % of the window — adds Follow, the name field + Save and the
 *           safety note in the scrolling body, mounted only while the shown
 *           snap matches the waypoints (never a hidden detent).
 *
 * When the first route lands the shelf RISES to `full` once on the no-finger
 * settle spring (`{ duration: 400, dampingRatio: 1 }` — nothing pushed it, so
 * no overshoot; expo-animation §5), and the user can pull it back: the growth
 * that used to be a one-frame jump is a detent the finger owns. The shelf
 * sits at `bottom: tabBarHeight` (the tab bar stays on Builder) over a
 * `flex: 1` map, so the map container's layout — and therefore the reticle's
 * centre that `getCoordinateFromView` is asked about — never changes with the
 * sheet (SPEC "Risks"). The map's attribution and logo ride above the
 * COMMITTED detent (FR-014: never covered), moving on commit, never per frame.
 *
 * MOTION (expo-animation gate). Shelf drag: the primitive's own physics. The
 * stats slot swaps in place (opacity only, `ENTER_FADE`, keyed on its state).
 * The reticle lifts while the camera moves — a Reanimated shared value on
 * `transform` only, off under Reduce Motion (§9: drop scale; the map itself
 * moving is the cue). Haptic: ONE `impactAsync(Light)` when Add point lands a
 * dot, the same frame the dot appears; nothing on a refused tap, nothing on
 * Undo, nothing per frame of the drag (§8).
 */

import Mapbox, { Camera, CircleLayer, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import type { LatLng, RouteThroughOutput } from '@shared/types';
import { ImpactFeedbackStyle, impactAsync } from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  type LayoutChangeEvent,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import '../lib/mapbox';
import SafetyNote from '../components/SafetyNote';
import SaveDriveButton from '../components/SaveDriveButton';
import {
  Button,
  EASE_OUT,
  ENTER_FADE,
  Legend,
  Shelf,
  Stat,
  Symbol,
  Text,
  useReducedMotion,
  type ShelfHandle,
} from '../components/ui';
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
import { useTabBarHeight } from '../lib/insets';
import { getApiBaseUrl } from '../lib/runtime';
import { sessionId } from '../lib/session';
import { AMBER, elevation, HIT_TARGET, motion, spacing, useTheme, withAlpha } from '../theme';

export interface BuilderScreenProps {
  navigation: {
    goBack: () => void;
    /** Present in CreateStack: opens follow-mode on the built drive. */
    navigate?: (screen: string, params?: Record<string, unknown>) => void;
    /** Present in CreateStack: puts Clear in the native header while there are
     *  points (`null` takes it out). The in-page ghost Clear stays either way —
     *  a bare render has no header — and both call the same handler. */
    setClear?: (onClear: (() => void) | null) => void;
  };
  /** Injectable for tests. */
  routeFn?: typeof postRouteThrough;
}

const INITIAL_CENTER: [number, number] = [-79.8, 43.6];
/** Roads are individually visible from here — a point placed at region zoom
 *  (8) had ±30 km of slack under one finger. */
const INITIAL_ZOOM = 12;
const DEBOUNCE_MS = 400;
/** How long the snapped dots take to replace the raw taps, on the map's own
 *  render thread. Long enough to read as the engine moving them, short enough
 *  that the next tap is never waiting on it. */
const SNAP_FADE_MS = 240;

/** The tool detent's floor, in pt — what the sheet shows before its header has
 *  reported a height (the first frame, and a node render). */
const TOOLS_MIN_H = 160;
/** The `full` detent: 60 % of the window (SPEC "Builder"). */
const FULL_FRACTION = 0.6;
/**
 * The Shelf's grabber strip above the header (`paddingTop spacing.sm` + the
 * 5 pt grabber + `paddingBottom spacing.xs`), which the measured header does
 * not include. Duplicated from `ui/Shelf.tsx` because the primitive does not
 * export it — see the report's not_done: the Shelf should, so this cannot
 * drift.
 */
const GRABBER_STRIP_H = spacing.sm + 5 + spacing.xs;
/** How far the reticle shrinks while the camera moves (1 → 0.85). */
const RETICLE_LIFT = 0.15;

export default function BuilderScreen(props: BuilderScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const route = props.routeFn ?? postRouteThrough;
  const tabBarHeight = useTabBarHeight();
  const { height: windowH } = useWindowDimensions();

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

  // --- the tool sheet ---------------------------------------------------------
  const shelf = useRef<ShelfHandle>(null);
  /** The tool block's measured height — the `tools` detent is made of it. */
  const [toolsH, setToolsH] = useState(0);
  /** Which detent is committed — the attribution rides above it (FR-014). */
  const [detent, setDetent] = useState<'tools' | 'full'>('tools');
  const toolsDetent = Math.max(TOOLS_MIN_H, Math.round(toolsH + GRABBER_STRIP_H));
  const fullDetent = Math.round(windowH * FULL_FRACTION);
  const detents = useMemo(
    () => ({ tools: toolsDetent, full: fullDetent }),
    [toolsDetent, fullDetent],
  );
  const committedH = detent === 'full' ? fullDetent : toolsDetent;
  /** Once per mount: the first route to land lifts the sheet to `full`. */
  const rose = useRef(false);

  // The reticle lifts while the camera is moving and plants when it settles —
  // a shared value on `transform` only, so a pan never touches the JS thread.
  // Under Reduce Motion the scale is dropped (§9), not shortened: the map
  // moving under the reticle is already the cue.
  const reduced = useReducedMotion();
  const lift = useSharedValue(0);
  const moving = useRef(false);
  const setMoving = (next: boolean): void => {
    if (moving.current === next) return;
    moving.current = next;
    lift.set(
      withTiming(next ? 1 : 0, {
        duration: next ? motion.pressIn : motion.pressOut,
        easing: EASE_OUT,
        reduceMotion: ReduceMotion.System,
      }),
    );
  };
  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduced ? 1 : 1 - RETICLE_LIFT * lift.get() }],
  }));

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

  // The first route to land lifts the sheet to `full` — the no-finger settle,
  // once. Follow / Save / Safety mount in the body the same render, so the
  // rise reveals them rather than a jump revealing them. SILENT: no finger
  // caused this and the user was not waiting on this frame, so the detent
  // haptic would be a buzz out of nowhere (expo-animation §8; SPEC haptics
  // policy "one per user action … nothing on entrances").
  useEffect(() => {
    if (snapped === null || busy || rose.current) return;
    rose.current = true;
    shelf.current?.snapTo('full', { settle: true, silent: true });
  }, [snapped, busy]);

  // The header's Clear exists exactly while there are points. The adapter is
  // read through a ref: the stack hands a new object every render, and a
  // `setOptions` per render would re-render the stack, which would hand a new
  // object — a loop.
  const navRef = useRef(props.navigation);
  navRef.current = props.navigation;
  const hasPoints = state.waypoints.length > 0;
  const clear = useCallback((): void => {
    setNote(null);
    setState(clearWaypoints());
  }, []);
  useEffect(() => {
    navRef.current.setClear?.(hasPoints ? clear : null);
  }, [hasPoints, clear]);

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
      // The drag-commit haptic, the frame the dot lands (§8) — paired with the
      // dot's cross-fade on the map, never the only feedback.
      void impactAsync(ImpactFeedbackStyle.Light);
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
  // points, else the raw taps. Both sets stay on the map and swap by opacity,
  // so the move onto the road is a cross-fade rather than a jump.
  const snappedDots =
    snapped && !busy && snapped.locations && snapped.locations.length === state.waypoints.length
      ? snapped.locations
      : null;
  const dots = snappedDots ?? state.waypoints;
  const onRoad = snappedDots !== null;

  const pointFeatures = (pts: readonly LatLng[]) => ({
    type: 'FeatureCollection' as const,
    features: pts.map((p, i) => ({
      type: 'Feature' as const,
      properties: { idx: i },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })),
  });

  // "42 km · 51 min" split back into its two measured halves, so each number
  // gets its own legend instead of sharing one middot-joined line. The joined
  // form survives verbatim as the group's accessibility label.
  const statParts = snapped ? statsLine(snapped).split(' · ') : [];
  const statsLabel = snapped
    ? `${state.waypoints.length} points · ${statsLine(snapped)}`
    : statsLine(null);
  /** Keys the stats slot so a state change fades the new content in place. */
  const slotKey = busy ? 'busy' : snapped ? 'stats' : 'empty';

  /** Only offer Follow / Save while the shown snap MATCHES the waypoints.
   *  Mid-debounce they disagree, and saving then persists the previous
   *  geometry against the new points — including a wrong is_loop. */
  const routed = snapped !== null && !busy;

  /** The map's ornaments sit above the committed detent (and the tab bar the
   *  sheet sits on), never under the sheet — FR-014. */
  const ornamentBottom = tabBarHeight + committedH + spacing.sm;

  /** The tool block: everything visible at the `tools` detent. Measured, so
   *  the detent is its real height at any text size. */
  const tools = (
    <View
      style={styles.tools}
      onLayout={(e: LayoutChangeEvent) => setToolsH(e.nativeEvent.layout.height)}
    >
      <View style={styles.headerRow}>
        <Animated.View key={slotKey} entering={ENTER_FADE} style={styles.headerSlot}>
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.accentText} />
              <Text variant="footnote" tone="muted">
                Routing…
              </Text>
            </View>
          ) : snapped ? (
            // One utterance for VoiceOver, and the two MEASURED values get
            // the weight; the point count is the input, so it sits in the
            // legend above them rather than competing at 22pt.
            <View accessible accessibilityLabel={statsLabel} style={styles.statGroup}>
              <Legend>{`${state.waypoints.length} points`}</Legend>
              <View style={styles.statRow}>
                <Stat value={statParts[0] ?? null} label="distance" />
                <Stat value={statParts[1] ?? null} label="duration" />
              </View>
            </View>
          ) : (
            <Text variant="footnote" tone="muted">
              {statsLine(null)}
            </Text>
          )}
        </Animated.View>
        {hasPoints && (
          <Button title="Clear" variant="ghost" accessibilityLabel="Clear" onPress={clear} />
        )}
      </View>

      {problem !== null && (
        <Animated.View entering={ENTER_FADE} style={styles.problemRow}>
          <Text variant="footnote" tone="danger" style={styles.problemText}>
            {problem}
          </Text>
          <Button
            title="Retry"
            variant="secondary"
            accessibilityLabel="Retry routing"
            icon={<Symbol name="arrowClockwise" size="md" />}
            onPress={() => setAttempt((a) => a + 1)}
          />
        </Animated.View>
      )}
      {note !== null && problem === null && (
        <Animated.View entering={ENTER_FADE}>
          <Text variant="footnote" tone="muted">
            {note}
          </Text>
        </Animated.View>
      )}
      {/* A first-run coach line, not permanent help text: it yields once
          the drive has two points and the affordance has been learned. */}
      {state.waypoints.length <= 1 && (
        <Text variant="footnote" tone="muted">
          Pan until the dot sits on the road, then Add point. Tap a dot to remove it.
        </Text>
      )}

      <Button
        title="Add point"
        // One filled amber per state: before a line exists this IS the
        // terminal action; once it does, Save owns the amber and the
        // picker becomes the tool it always was.
        variant={snapped ? 'secondary' : 'primary'}
        size="lg"
        block
        accessibilityLabel="Add point"
        icon={<Symbol name="plus" size="md" tone={snapped ? 'default' : 'onAccent'} />}
        onPress={addCentre}
      />
      <View style={styles.toolRow}>
        <Button
          title="Undo"
          variant="secondary"
          style={styles.tool}
          accessibilityLabel="Undo"
          icon={<Symbol name="arrowUturnBackward" size="md" />}
          disabled={state.waypoints.length === 0}
          onPress={() => {
            setNote(null);
            setState(undoWaypoint);
          }}
        />
        <Button
          title="Close loop"
          variant="secondary"
          style={styles.tool}
          accessibilityLabel="Close loop"
          icon={<Symbol name="arrowTriangle2Circlepath" size="md" />}
          onPress={onCloseLoop}
        />
      </View>
    </View>
  );

  return (
    // the drive-name field is in the sheet's body: without this the iOS
    // keyboard covered it and the Save button (review finding). The header is
    // transparent, so this view spans the window and needs no vertical offset.
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
          logoPosition={{ bottom: ornamentBottom, left: spacing.md }}
          attributionPosition={{ bottom: ornamentBottom, right: spacing.md }}
          onCameraChanged={(s) => {
            setMoving(true);
            const c = (s as unknown as { properties?: { center?: number[] } }).properties?.center;
            if (c && c.length >= 2) cameraCentre.current = [c[0]!, c[1]!];
          }}
          onMapIdle={() => setMoving(false)}
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
                style={{
                  lineColor: AMBER,
                  lineWidth: 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineWidthTransition: { duration: SNAP_FADE_MS, delay: 0 },
                }}
              />
            </ShapeSource>
          )}
          {/* Where the finger actually landed. Stays mounted so its opacity
              can TRANSITION to zero when the engine answers — a layer that
              unmounts cannot cross-fade. Never interactive. */}
          {state.waypoints.length > 0 && (
            <ShapeSource id="builder-taps" shape={pointFeatures(state.waypoints)}>
              <CircleLayer
                id="builder-taps-layer"
                style={{
                  circleRadius: 7,
                  circleColor: AMBER,
                  circleOpacity: onRoad ? 0 : 0.55,
                  circleStrokeWidth: 2,
                  circleStrokeColor: colors.bg,
                  circleStrokeOpacity: onRoad ? 0 : 0.55,
                  circleOpacityTransition: { duration: SNAP_FADE_MS, delay: 0 },
                  circleStrokeOpacityTransition: { duration: SNAP_FADE_MS, delay: 0 },
                }}
              />
            </ShapeSource>
          )}
          {dots.length > 0 && (
            <ShapeSource
              id="builder-points"
              shape={pointFeatures(dots)}
              hitbox={{ width: HIT_TARGET, height: HIT_TARGET }}
              onPress={(e) => {
                const idx = (e.features[0]?.properties as { idx?: unknown } | undefined)?.idx;
                if (typeof idx === 'number') removeAt(idx);
              }}
            >
              <CircleLayer
                id="builder-points-layer"
                // Radius settles from 11 to 9 as the fill arrives, so the dot
                // reads as landing on the road rather than blinking there.
                style={{
                  circleRadius: onRoad ? 9 : 11,
                  circleColor: AMBER,
                  circleOpacity: onRoad ? 1 : 0,
                  circleStrokeWidth: 2,
                  circleStrokeColor: colors.bg,
                  circleStrokeOpacity: onRoad ? 1 : 0,
                  circleOpacityTransition: { duration: SNAP_FADE_MS, delay: 0 },
                  circleStrokeOpacityTransition: { duration: SNAP_FADE_MS, delay: 0 },
                  circleRadiusTransition: { duration: SNAP_FADE_MS, delay: 0 },
                }}
              />
            </ShapeSource>
          )}
        </MapView>

        {/* crosshair — INSIDE the map container, so it is the map's centre */}
        <View pointerEvents="none" style={styles.reticleWrap}>
          <Animated.View
            style={[styles.reticleHalo, { borderColor: withAlpha(colors.bg, 0.5) }, haloStyle]}
          >
            <View style={styles.reticleRing}>
              <View style={styles.reticleCore} />
            </View>
          </Animated.View>
        </View>
      </View>

      {/* The tool sheet, over the map, on the tab bar. The map is OUTSIDE its
          gesture detector: tiles are the map's at every detent. */}
      <Shelf
        ref={shelf}
        detents={detents}
        initial="tools"
        onDetent={(key) => setDetent(key === 'full' ? 'full' : 'tools')}
        header={tools}
        style={{ bottom: tabBarHeight }}
        testID="builder-shelf"
      >
        {routed && (
          <View style={styles.body}>
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
                    route: toManualRoute(snapped, state.waypoints),
                  })
                }
              />
            )}
            <SaveDriveButton
              route={toManualRoute(snapped, state.waypoints)}
              agentExplanation={null}
            />
            <SafetyNote context="route" />
          </View>
        )}
      </Shelf>
    </KeyboardAvoidingView>
  );
}

/** The reticle's outer ring, in pt. Big enough to aim with a thumb on the
 *  glass, open in the middle so the road pixel underneath stays visible. */
const RETICLE = 30;

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** A dark/bright outer stroke so the reticle survives both map styles, and
   *  a shadow so it reads as sitting ABOVE the tiles rather than printed on
   *  them. */
  reticleHalo: {
    width: RETICLE,
    height: RETICLE,
    borderRadius: RETICLE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.raised,
  },
  reticleRing: {
    width: RETICLE - 8,
    height: RETICLE - 8,
    borderRadius: (RETICLE - 8) / 2,
    borderWidth: 3,
    borderColor: AMBER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleCore: { width: 4, height: 4, borderRadius: 2, backgroundColor: AMBER },
  /** The sheet's header: `gutter` at the sides, the tool rhythm inside. */
  tools: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  /** The sheet's body at `full`, under the tools. */
  body: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xs,
    gap: spacing.md,
  },
  /** Holds its height across busy / routed / empty so the tools do not jump
   *  every time the slot's contents change shape. */
  headerSlot: { flex: 1, minHeight: HIT_TARGET, justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statGroup: { gap: spacing.xs },
  statRow: { flexDirection: 'row', gap: spacing.xl },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  problemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  problemText: { flexShrink: 1 },
  toolRow: { flexDirection: 'row', gap: spacing.sm },
  tool: { flex: 1 },
});
