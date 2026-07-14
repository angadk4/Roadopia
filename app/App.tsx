import Mapbox, {
  Camera,
  CircleLayer,
  LineLayer,
  MapView,
  ShapeSource,
  SymbolLayer,
} from '@rnmapbox/maps';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { useState, type ReactElement } from 'react';
import { Platform, StyleSheet, Text, useColorScheme, View } from 'react-native';

/**
 * SPK-01 spike screen — the minimal proof the mobile foundation renders on a
 * real device (Dependency Verification §21):
 *   MapView (stock style) + clustered pin source + amber route line + a distinct
 *   high-curvature overlay, on the New Architecture, with attribution visible.
 * A theme toggle exercises the dark+light contrast check (§663/§667). The custom
 * Studio style + real seeded data land at M7-T02 — this proves the native path.
 */

const MAPBOX_TOKEN =
  (Constants.expoConfig?.extra?.['mapboxPublicToken'] as string | undefined) ??
  process.env['EXPO_PUBLIC_MAPBOX_TOKEN'] ??
  '';
Mapbox.setAccessToken(MAPBOX_TOKEN);

// Sample content around Ancaster/Dundas (the SPK-19 corridor) — stand-in data.
const ROUTE: Feature<LineString> = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.98, 43.22],
      [-79.95, 43.24],
      [-79.93, 43.25],
      [-79.9, 43.26],
      [-79.88, 43.24],
      [-79.9, 43.22],
      [-79.94, 43.21],
      [-79.98, 43.22],
    ],
  },
};

// The high-curvature stretch, drawn as a distinct brighter/thicker overlay (§663).
const CURVY_OVERLAY: Feature<LineString> = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.93, 43.25],
      [-79.9, 43.26],
      [-79.88, 43.24],
    ],
  },
};

const SPOTS: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: (
    [
      ['coffee', -79.97, 43.225],
      ['viewpoint', -79.94, 43.248],
      ['viewpoint', -79.905, 43.258],
      ['fuel', -79.885, 43.242],
      ['coffee', -79.915, 43.222],
      ['rest', -79.945, 43.212],
      ['viewpoint', -79.96, 43.235],
      ['coffee', -79.925, 43.255],
    ] as Array<[string, number, number]>
  ).map(
    ([type, lng, lat], i): Feature<Point> => ({
      type: 'Feature',
      id: i,
      properties: { type },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    }),
  ),
};

const AMBER = '#f4a319';
const AMBER_BRIGHT = '#ffd54a';

export default function App(): ReactElement {
  const system = useColorScheme();
  const [override, setOverride] = useState<'dark' | 'light' | null>(null);
  const theme = override ?? system ?? 'dark';
  const styleURL = theme === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light;
  const tokenMissing = MAPBOX_TOKEN.length === 0;

  return (
    <View style={styles.root}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      {tokenMissing ? (
        <View style={styles.center}>
          <Text style={styles.err}>
            EXPO_PUBLIC_MAPBOX_TOKEN is not set. Add your Mapbox public (pk.) token as an EAS env
            var / secret and rebuild.
          </Text>
        </View>
      ) : (
        <MapView style={styles.map} styleURL={styleURL} scaleBarEnabled={false}>
          <Camera centerCoordinate={[-79.93, 43.24]} zoomLevel={11.5} animationDuration={0} />

          {/* amber route line + distinct high-curvature overlay (§663) */}
          <ShapeSource id="route" shape={ROUTE}>
            <LineLayer
              id="route-line"
              style={{ lineColor: AMBER, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }}
            />
          </ShapeSource>
          <ShapeSource id="curvy" shape={CURVY_OVERLAY}>
            <LineLayer
              id="curvy-glow"
              style={{
                lineColor: AMBER_BRIGHT,
                lineWidth: 12,
                lineOpacity: 0.35,
                lineCap: 'round',
              }}
            />
            <LineLayer
              id="curvy-line"
              style={{ lineColor: AMBER_BRIGHT, lineWidth: 6, lineCap: 'round', lineJoin: 'round' }}
            />
          </ShapeSource>

          {/* clustered spot pins (FR-012) */}
          <ShapeSource id="spots" shape={SPOTS} cluster clusterRadius={45} clusterMaxZoomLevel={14}>
            <CircleLayer
              id="clusters"
              filter={['has', 'point_count']}
              style={{
                circleColor: theme === 'dark' ? '#2b3138' : '#d8dee6',
                circleRadius: 18,
                circleStrokeColor: AMBER,
                circleStrokeWidth: 2,
              }}
            />
            <SymbolLayer
              id="cluster-count"
              filter={['has', 'point_count']}
              style={{
                textField: ['get', 'point_count_abbreviated'],
                textSize: 13,
                textColor: theme === 'dark' ? '#ffffff' : '#11151a',
              }}
            />
            <CircleLayer
              id="pin"
              filter={['!', ['has', 'point_count']]}
              style={{
                circleColor: AMBER,
                circleRadius: 7,
                circleStrokeColor: theme === 'dark' ? '#11151a' : '#ffffff',
                circleStrokeWidth: 2,
              }}
            />
          </ShapeSource>
        </MapView>
      )}

      {/* SPK-01 eyeball panel + theme toggle (dark/light contrast, §663) */}
      <View style={styles.hudWrap} pointerEvents="box-none">
        <View style={[styles.hud, theme === 'dark' ? styles.hudDark : styles.hudLight]}>
          <Text style={[styles.hudTitle, theme === 'dark' ? styles.txtDark : styles.txtLight]}>
            SPK-01 · {theme} · {Platform.OS}
          </Text>
          <Text style={[styles.hudLine, theme === 'dark' ? styles.txtDark : styles.txtLight]}>
            map renders · clusters · amber line + curvy overlay
          </Text>
          <Text
            onPress={() => setOverride(theme === 'dark' ? 'light' : 'dark')}
            style={styles.toggle}
          >
            ↺ toggle theme (check contrast)
          </Text>
          {/* OSM + Mapbox attribution — FR-014/§61 (Mapbox logo also shown by the SDK) */}
          <Text style={[styles.attr, theme === 'dark' ? styles.txtDark : styles.txtLight]}>
            © OpenStreetMap contributors · © Mapbox
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  err: { color: '#ff6b6b', fontSize: 15, textAlign: 'center' },
  hudWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  hud: { margin: 12, padding: 12, borderRadius: 12, alignSelf: 'stretch' },
  hudDark: { backgroundColor: 'rgba(17,21,26,0.82)' },
  hudLight: { backgroundColor: 'rgba(255,255,255,0.9)' },
  hudTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  hudLine: { fontSize: 12, opacity: 0.85 },
  toggle: { fontSize: 14, fontWeight: '600', marginTop: 8, color: AMBER },
  attr: { fontSize: 10, opacity: 0.7, marginTop: 8 },
  txtDark: { color: '#f4f6f8' },
  txtLight: { color: '#11151a' },
});
