/**
 * DriveLinesMap (R24-U8) — the ONE shared amber-line map surface.
 *
 * MapHome (seed routes) and DiscoverHome (great drives near you) both render
 * roads as amber polylines over a theme-styled Mapbox map with a bounds-fitted
 * camera and always-on OSM/Mapbox attribution. Extracting that core into one
 * component means the amber casing/line style, the camera padding and the
 * attribution strip can never drift between the two screens (§663 / FR-014).
 *
 * Screen-specific bits stay with the screen via slots:
 *   - `children` — extra in-map layers (MapHome's clustered spot pins);
 *   - `banner`   — loading/error overlays;
 *   - `sheet`    — the tap detail sheet (route info vs. drive "Let's go").
 *
 * Real map behaviour is verified on device (M7-T09); the vitest rnmapbox stub
 * renders primitives as host tokens so screen smoke tests exercise our wiring.
 */

import Mapbox, { Camera, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import type { FeatureCollection } from 'geojson';
import { useCallback, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import '../lib/mapbox'; // side-effect: pk. token set before MapView mounts
import type { Bounds } from '../lib/data';
import { AMBER, font, radius, spacing, useTheme } from '../theme';

/** Any GeoJSON FeatureCollection of amber lines (route / drive spans). The
 *  concrete prop shapes assign via geojson's GeoJsonProperties; the tap handler
 *  narrows `properties` back to a plain record. */
export type LineFeatureCollection = FeatureCollection;

/** Connector legs (get-there / get-home) — readable on both styles, and clearly
 *  subordinate to the amber drive. */
const CONNECTOR_GREY = '#8a93a6';

export interface DriveLinesMapProps {
  /** R29: color lines by their `leg` property (core amber, connectors grey). */
  perLeg?: boolean;
  /** The amber lines to draw (null while loading). */
  featureCollection: LineFeatureCollection | null;
  /** Camera fit; null leaves the default camera (never crashes on empty data). */
  bounds: Bounds | null;
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
}

/**
 * The shared amber-line map. The casing (dark, semi-transparent) keeps the amber
 * legible on the light style too; both live here so the two screens can't drift.
 */
export default function DriveLinesMap(props: DriveLinesMapProps): ReactElement {
  const { featureCollection, bounds, onSelectLine, children, banner, sheet } = props;
  const { name: themeName, colors } = useTheme();
  const sourceId = props.sourceId ?? 'drive-lines';
  const perLeg = props.perLeg ?? false;

  const onPress = useCallback(
    (e: { features: Array<{ properties?: unknown }> }) => {
      const p = e.features[0]?.properties as Record<string, unknown> | undefined;
      if (p) onSelectLine?.(p);
    },
    [onSelectLine],
  );

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        logoPosition={{ bottom: 6, left: 8 }}
        attributionPosition={{ bottom: 6, left: 100 }}
      >
        {bounds && (
          <Camera
            bounds={{
              ne: bounds.ne,
              sw: bounds.sw,
              paddingTop: 60,
              paddingBottom: 120,
              paddingLeft: 40,
              paddingRight: 40,
            }}
            animationDuration={0}
          />
        )}

        {featureCollection && featureCollection.features.length > 0 && (
          <ShapeSource
            id={sourceId}
            shape={featureCollection}
            onPress={onPress}
            hitbox={{ width: 24, height: 24 }}
          >
            {/* dark casing keeps the amber legible on the light style too (§663) */}
            <LineLayer
              id={`${sourceId}-casing`}
              style={{
                lineColor: '#11151a',
                lineWidth: 6,
                lineOpacity: 0.35,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id={`${sourceId}-line`}
              style={{
                // The drive is the product; the commute is context. Amber on the
                // core, grey on the connectors, so the map says the same thing the
                // card says ("the drive 42 min · getting there 18 · home 21").
                lineColor: perLeg
                  ? ['match', ['get', 'leg'], 'core', AMBER, CONNECTOR_GREY]
                  : AMBER,
                lineWidth: 3.5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {children}
      </MapView>

      {/* attribution — always visible (FR-014). The SDK logo + ⓘ sit bottom-left
          (positioned above); our OSM credit sits bottom-right in a legible pill. */}
      <View pointerEvents="none" style={styles.attrWrap}>
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
