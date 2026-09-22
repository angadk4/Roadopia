/**
 * DriveLinesMap (R24-U8) — the ONE shared amber-line map surface.
 *
 * MapHome's two modes — the seed routes (All roads) and the Discover scan
 * (Near you) — both render roads as amber polylines over a theme-styled Mapbox
 * map with a bounds-fitted camera and always-on OSM/Mapbox attribution. Keeping
 * that core in one component means the amber casing/line style, the camera
 * padding and the attribution strip can never drift between the two (§663 /
 * FR-014). RouteDetail's plate and the follow map draw their own lines; this
 * is the BROWSE surface.
 *
 * Screen-specific bits stay with the screen via slots:
 *   - `children` — extra in-map layers (MapHome's clustered spot pins);
 *   - `banner`   — overlays above the map (the status scrim, the control column);
 *   - `sheet`    — the shelf over the map (MapHome's `HomeShelf`).
 *
 * REDESIGN (SPEC "MapHome", item 1). The attribution strip RIDES the shelf:
 * `attributionOffset` lifts the OSM/Mapbox credit, the SDK logo and its ⓘ by
 * the shelf's COMMITTED detent (plus the tab bar), so the strip sits above the
 * shelf's edge at every detent (FR-014: never covered) and moves only on a
 * commit — never per frame of a drag. Placement only; every colour here is
 * frozen.
 *
 * Real map behaviour is verified on device (M7-T09); the vitest rnmapbox stub
 * renders primitives as host tokens so screen smoke tests exercise our wiring.
 *
 * BD-204 follow-up — three defects the redesign audit found in the map surface,
 * all of them about GEOMETRY and MOTION (every colour here is SPK-01
 * device-verified against both Mapbox styles and is deliberately untouched):
 *
 *   1. The camera padding was a constant that knew nothing about the chrome the
 *      screens float OVER the map. The merged home's shelf covers roughly half
 *      the window at its resting detent, against 60pt of padding, so the
 *      fitted drive was drawn underneath it. `cameraInsets` lets each screen
 *      hand down what its own chrome actually covers.
 *   2. Every fit was `animationDuration={0}` — a teleport. The map now travels.
 *   3. The tap target for a drive line was 24×24, narrowing rnmapbox's 44×44
 *      default on the PRIMARY map interaction; it is `HIT_TARGET` now.
 */

import Mapbox, { Camera, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import type { LatLng } from '@shared/types';
import type { FeatureCollection } from 'geojson';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';

import '../lib/mapbox'; // side-effect: pk. token set before MapView mounts
import type { Bounds } from '../lib/data';
import { AMBER, font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

import { useReducedMotion } from './ui';

/** Any GeoJSON FeatureCollection of amber lines (route / drive spans). The
 *  concrete prop shapes assign via geojson's GeoJsonProperties; the tap handler
 *  narrows `properties` back to a plain record. */
export type LineFeatureCollection = FeatureCollection;

/** Connector legs (get-there / get-home) — readable on both styles, and clearly
 *  subordinate to the amber drive. */
const CONNECTOR_GREY = '#8a93a6';

// Hoisted so the memoised ShapeSource element below sees stable props:
// rnmapbox's ShapeSource JSON.stringifies its shape on every render it is
// asked to do, and fresh style/hitbox objects asked for one each time (review).
type LineStyle = NonNullable<ComponentProps<typeof LineLayer>['style']>;

/** Tapping a drive line is the primary interaction on this surface, and it was
 *  the one control in the app below the HIT_TARGET floor: this overrode
 *  rnmapbox's 44×44 default down to 24×24, on a target the user aims at with a
 *  thumb over moving tiles. Still module-level and now literally frozen — a
 *  fresh object per render makes ShapeSource re-register its press handler. */
const HITBOX = Object.freeze({ width: HIT_TARGET, height: HIT_TARGET });

/** Paint transition for line opacity: geometry EASES to its settled opacity
 *  instead of being switched on at full strength the instant the source loads.
 *  Timing only — every opacity value and every colour below is unchanged. */
const LINE_FADE = { duration: 280, delay: 0 } as const;

const CASING_STYLE: LineStyle = {
  lineColor: '#11151a',
  lineWidth: 6,
  lineOpacity: 0.35,
  lineOpacityTransition: LINE_FADE,
  lineCap: 'round',
  lineJoin: 'round',
};
// The drive is the product; the commute is context. Amber on the core, grey
// on the connectors, so the map says the same thing the card says ("the
// drive 42 min · getting there 18 · home 21").
const LINE_STYLE: LineStyle = {
  lineColor: AMBER,
  lineWidth: 3.5,
  // The amber carries no explicit lineOpacity (it draws at the paint default),
  // so today this governs the casing's settle and any future change to the
  // line's own opacity — it cannot invent a fade for a value that never moves.
  lineOpacityTransition: LINE_FADE,
  lineCap: 'round',
  lineJoin: 'round',
};
const LINE_STYLE_PER_LEG: LineStyle = {
  ...LINE_STYLE,
  lineColor: ['match', ['get', 'leg'], 'core', AMBER, CONNECTOR_GREY],
};

/**
 * How much of each map edge the SCREEN's own floating chrome covers, in pt. The
 * camera fits the geometry inside what is left, so the drive is drawn in the
 * part of the map the user can actually see.
 *
 * Every edge is optional and falls back to `DEFAULT_CAMERA_INSETS`, which are
 * exactly the numbers this camera shipped with — a caller that passes nothing
 * fits identically to before the prop existed.
 */
export interface CameraInsets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** The pre-`cameraInsets` constant padding, kept as the fallback AND as the
 *  floor each screen clamps its derived insets to: an un-measured first frame
 *  must never fit TIGHTER than the map did before this prop existed. */
export const DEFAULT_CAMERA_INSETS: Readonly<Required<CameraInsets>> = Object.freeze({
  top: 60,
  bottom: 120,
  left: 40,
  right: 40,
});

/** Where the SDK's logo and ⓘ sit above the map's bottom edge, in pt, before
 *  any screen chrome lifts them (`attributionOffset`). */
const ORNAMENT_BOTTOM = 6;

/** Where the SDK's compass sits below the map's top edge, in pt, before any
 *  screen chrome pushes it down (`compassOffset`). */
const ORNAMENT_TOP = 6;

/** How long the camera takes to travel to a NEW fit. The fit was
 *  `animationDuration={0}` — every arrival was a cut, which is what made the
 *  map read as a picture being swapped rather than a view that moved. */
const CAMERA_FIT_MS = 650;

/** Zoom for an opening camera that has a PLACE but nothing to fit: close enough
 *  that the roads around the user are legible, wide enough that a drive
 *  starting a town away is still on screen. */
export const NEARBY_ZOOM = 10.5;

/** A place for the camera to open at when there is no geometry to fit yet. */
export interface MapCenter {
  point: LatLng;
  /** Defaults to `NEARBY_ZOOM`. */
  zoom?: number;
}

export interface DriveLinesMapProps {
  /** R29: color lines by their `leg` property (core amber, connectors grey). */
  perLeg?: boolean;
  /** The amber lines to draw (null while loading). */
  featureCollection: LineFeatureCollection | null;
  /** Camera fit; null falls through to `center`, then to the style's own
   *  default (never crashes on empty data). */
  bounds: Bounds | null;
  /**
   * Where the camera opens when there is nothing to fit — normally the user.
   *
   * Before this existed, `bounds: null` mounted NO camera at all, so every map
   * in the app opened on Mapbox's own default view (the world) and stayed there
   * until data arrived. On the tab the app launches into that is the first
   * thing a person sees: a world map, above a button asking them to say where
   * they are. A fit, once there is one, still wins — this is the opening
   * position, not a competing camera.
   */
  center?: MapCenter | null;
  /** What the screen's own floating chrome covers — see `CameraInsets`. */
  cameraInsets?: CameraInsets;
  /** ShapeSource id — distinct per screen so two maps never collide. */
  sourceId?: string;
  /** Tapped line → its feature `properties` (the screen maps back to its model). */
  onSelectLine?: (props: Record<string, unknown>) => void;
  /** Extra in-map layers rendered after the amber lines (e.g. spot pins). */
  children?: ReactNode;
  /** Overlays above the map (loading/error banners). */
  banner?: ReactNode;
  /** The tap detail sheet (screen-specific content). */
  sheet?: ReactNode;
  /** Current map centre [lng, lat] as the user pans — lets a screen hand the
   *  view it is looking at to the next one instead of a hard-coded default. */
  onCenterChanged?: (center: [number, number]) => void;
  /**
   * How far up from the container's bottom edge the attribution strip (and
   * the SDK's own logo + ⓘ) sits, in pt — what the screen's bottom chrome
   * covers: MapHome passes the shelf's COMMITTED detent plus the tab bar
   * (FR-014). Default 0: the strip sits at the bottom edge exactly as before.
   */
  attributionOffset?: number;
  /**
   * How far DOWN from the container's top edge the SDK's compass sits, in pt —
   * what the screen's top-right chrome occupies: MapHome passes the bottom of
   * its control column, so the compass appears UNDER the two pills instead of
   * stacked on them (SPEC MapHome: "Mapbox compass under the column").
   * Default 0: the compass sits at the top edge exactly as before.
   */
  compassOffset?: number;
}

/**
 * The shared amber-line map. The casing (dark, semi-transparent) keeps the amber
 * legible on the light style too; both live here so the two screens can't drift.
 */
export default function DriveLinesMap(props: DriveLinesMapProps): ReactElement {
  const { featureCollection, bounds, center = null, onSelectLine, children, banner, sheet } = props;
  const { name: themeName, colors } = useTheme();
  // Reanimated's own hook: synchronous, so the FIRST fit of a cold launch
  // already knows the setting (the old cached hook resolved a frame later,
  // which is exactly when a map's opening fit happens).
  const reduceMotion = useReducedMotion();
  const sourceId = props.sourceId ?? 'drive-lines';
  const perLeg = props.perLeg ?? false;
  const attributionOffset = props.attributionOffset ?? 0;
  const compassOffset = props.compassOffset ?? 0;

  const insetTop = props.cameraInsets?.top ?? DEFAULT_CAMERA_INSETS.top;
  const insetBottom = props.cameraInsets?.bottom ?? DEFAULT_CAMERA_INSETS.bottom;
  const insetLeft = props.cameraInsets?.left ?? DEFAULT_CAMERA_INSETS.left;
  const insetRight = props.cameraInsets?.right ?? DEFAULT_CAMERA_INSETS.right;

  /** The geometry the camera has already been fitted to, set AFTER the commit
   *  that fitted it — so the render doing the fitting can still tell whether it
   *  is the first one. */
  const fitted = useRef<Bounds | null>(null);
  useEffect(() => {
    if (bounds !== null) fitted.current = bounds;
  }, [bounds]);

  const onPress = useCallback(
    (e: { features: Array<{ properties?: unknown }> }) => {
      const p = e.features[0]?.properties as Record<string, unknown> | undefined;
      if (p) onSelectLine?.(p);
    },
    [onSelectLine],
  );

  /**
   * The fit, as one memoised element.
   *
   * WHEN IT TRAVELS. A fit to NEW geometry eases over `CAMERA_FIT_MS`, because
   * there is a view to travel from and the travel is what tells you the map
   * moved rather than changed. Two fits deliberately stay instant:
   *   - the FIRST fit of this mount (`fitted.current === null`) — the map is
   *     arriving at its data, and there is no previous view to move from;
   *   - a fit to the SAME geometry with different insets — the padding was
   *     wrong, not the view, so correcting it must not look like a journey.
   * The second case is also why a caller must keep its insets stable for chrome
   * the USER summons (MapHome's tap sheet): a changed inset re-pads immediately,
   * and re-padding under a tap would move the map out from under the thumb.
   *
   * REDUCE MOTION shortens rather than removes, and for a camera fit the
   * shortened form IS the instant one — the view still arrives, it just does not
   * travel. There is no smaller honest version of "the map is now here".
   *
   * `'moveTo'` — NOT `'none'` — is the instant mode: rnmapbox's iOS native
   * constants expose Flight/Ease/Linear/Move only, so `'none'` resolves to
   * undefined there and the native side falls back to a zero-duration FLIGHT.
   * Move maps to a plain set-camera on both platforms.
   */
  const camera = useMemo(() => {
    if (!bounds) {
      // No geometry yet. Open where the screen says, if it knows — and use
      // `defaultSettings`, not `centerCoordinate`, so this positions the map
      // ONCE and then lets go: a controlled centre would drag the view back
      // every render and the user could not pan away from themselves.
      if (!center) return null;
      return (
        <Camera
          defaultSettings={{
            centerCoordinate: [center.point.lng, center.point.lat],
            zoomLevel: center.zoom ?? NEARBY_ZOOM,
          }}
        />
      );
    }
    const travels = fitted.current !== null && fitted.current !== bounds && !reduceMotion;
    return (
      <Camera
        bounds={{
          ne: bounds.ne,
          sw: bounds.sw,
          paddingTop: insetTop,
          paddingBottom: insetBottom,
          paddingLeft: insetLeft,
          paddingRight: insetRight,
        }}
        animationDuration={travels ? CAMERA_FIT_MS : 0}
        animationMode={travels ? 'easeTo' : 'moveTo'}
      />
    );
  }, [bounds, center, insetTop, insetBottom, insetLeft, insetRight, reduceMotion]);

  // one element identity per (collection, id, style, handler): a banner or
  // sheet re-render must not re-serialise every line geometry
  const lines = useMemo(
    () =>
      featureCollection && featureCollection.features.length > 0 ? (
        <ShapeSource id={sourceId} shape={featureCollection} onPress={onPress} hitbox={HITBOX}>
          {/* dark casing keeps the amber legible on the light style too (§663) */}
          <LineLayer id={`${sourceId}-casing`} style={CASING_STYLE} />
          <LineLayer id={`${sourceId}-line`} style={perLeg ? LINE_STYLE_PER_LEG : LINE_STYLE} />
        </ShapeSource>
      ) : null,
    [featureCollection, sourceId, perLeg, onPress],
  );

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        logoPosition={{ bottom: ORNAMENT_BOTTOM + attributionOffset, left: 8 }}
        attributionPosition={{ bottom: ORNAMENT_BOTTOM + attributionOffset, left: 100 }}
        compassPosition={{ top: ORNAMENT_TOP + compassOffset, right: 8 }}
        {...(props.onCenterChanged
          ? {
              onCameraChanged: (state: unknown) => {
                const c = (state as { properties?: { center?: number[] } }).properties?.center;
                if (c && c.length >= 2) props.onCenterChanged!([c[0]!, c[1]!]);
              },
            }
          : {})}
      >
        {camera}

        {lines}

        {children}
      </MapView>

      {/* attribution — always visible (FR-014). The SDK logo + ⓘ sit bottom-left
          (positioned above); our OSM credit sits bottom-right in a legible pill.
          Both ride above the screen's committed bottom chrome. */}
      <View
        pointerEvents="none"
        style={[styles.attrWrap, { bottom: spacing.sm + attributionOffset }]}
      >
        <View style={[styles.attrPill, { backgroundColor: colors.surfaceRaised + 'CC' }]}>
          <Text style={[styles.attr, { color: colors.textMuted }]}>
            © OpenStreetMap contributors · © Mapbox
          </Text>
        </View>
      </View>

      {banner}
      {sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  attrWrap: { position: 'absolute', right: spacing.sm, bottom: spacing.sm },
  attrPill: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  attr: { ...font.caption, fontSize: 10 },
});
