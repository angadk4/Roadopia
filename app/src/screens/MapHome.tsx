/**
 * Map home (M7-T02) — the never-empty anonymous map (FR-010..014, §10/§19).
 *
 *   - Seed routes as amber polylines — data via migration 0007's map_routes.
 *     The map surface (MapView + bounds camera + amber casing/line + OSM/Mapbox
 *     attribution) is the shared DriveLinesMap (R24-U8), so the amber style can't
 *     drift from Discover's.
 *   - Clustered OSM spot pins (planner_find_spots — OSM-only by construction),
 *     passed as extra in-map layers; type distinction = colour + letter marker.
 *   - Tap route/spot → detail sheet. Camera fits the seeded routes — region-
 *     centred by DATA, never a hard-coded bbox (config-driven portability, §46).
 *   - §18 states: loading skeleton; route-data failure → friendly banner +
 *     retry with the map still interactive; spot failure is non-fatal.
 */

import { CircleLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import DriveLinesMap from '../components/DriveLinesMap';
import {
  fetchMapRoutes,
  fetchMapSpots,
  routesBounds,
  routesToFeatureCollection,
  spotsToFeatureCollection,
  type MapRouteRow,
  type SpotRow,
  type SupabaseConfig,
} from '../lib/data';
import { getSupabaseConfig } from '../lib/runtime';
import { AMBER, font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

type RoutesPhase =
  | { phase: 'loading' }
  | { phase: 'loaded'; rows: MapRouteRow[] }
  | { phase: 'error' };

interface Selected {
  kind: 'route' | 'spot';
  title: string;
  line: string;
  tags: string[];
  /** Spot id — present on spot selections (M10: opens the detail screen). */
  spotId?: string;
}

/** Marker colours per spot type (†type distinction pre-iconography). */
const SPOT_COLORS: [string, string, ...string[]] = [
  'coffee',
  '#b07b4f',
  'food',
  '#d1704f', // restaurants + fast food (R16-1)
  'viewpoint',
  '#4fb0a5',
  'fuel',
  '#8a93a6',
  'rest',
  '#7f9a6b',
  'great_road',
  AMBER,
  'meetup',
  '#a97fd1',
];

export interface MapHomeProps {
  /** Injectable loaders for tests; default to the live Supabase reads. */
  loadRoutes?: (cfg: SupabaseConfig) => Promise<MapRouteRow[]>;
  loadSpots?: (cfg: SupabaseConfig) => Promise<SpotRow[]>;
  /** Present when mounted in MapStack (M10) — absent in bare test renders. */
  navigation?: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
    addFocusListener?: (cb: () => void) => () => void;
  };
}

export default function MapHome(props: MapHomeProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const [routes, setRoutes] = useState<RoutesPhase>({ phase: 'loading' });
  const [spots, setSpots] = useState<SpotRow[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);

  const loadRoutes = props.loadRoutes ?? fetchMapRoutes;
  const loadSpots = props.loadSpots ?? fetchMapSpots;

  const load = useCallback(() => {
    const cfg = getSupabaseConfig();
    setRoutes({ phase: 'loading' });
    loadRoutes(cfg)
      .then((rows) => setRoutes({ phase: 'loaded', rows }))
      .catch(() => setRoutes({ phase: 'error' }));
    // Spot pins load in parallel (region-wide via map_spots — FB-1); their
    // failure is enrichment-only and never blocks the map (§18).
    loadSpots(cfg)
      .then(setSpots)
      .catch(() => {});
  }, [loadRoutes, loadSpots]);

  useEffect(() => {
    load();
  }, [load]);

  // M10: returning from AddSpot re-pulls pins so the new one is visible (§18)
  useEffect(() => {
    const sub = props.navigation?.addFocusListener?.(() => {
      loadSpots(getSupabaseConfig())
        .then(setSpots)
        .catch(() => {});
    });
    return sub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const routeShape = useMemo(
    () => (routes.phase === 'loaded' ? routesToFeatureCollection(routes.rows) : null),
    [routes],
  );
  const spotShape = useMemo(() => spotsToFeatureCollection(spots), [spots]);
  const bounds = useMemo(
    () => (routes.phase === 'loaded' ? routesBounds(routes.rows) : null),
    [routes],
  );

  const onRoutePress = useCallback((p: Record<string, unknown>) => {
    const name = typeof p.name === 'string' ? p.name : undefined;
    if (!name) return;
    const km = typeof p.distance_m === 'number' ? (p.distance_m / 1000).toFixed(1) : '?';
    const min = typeof p.duration_s === 'number' ? Math.round(p.duration_s / 60) : null;
    setSelected({
      kind: 'route',
      title: name,
      line: `${km} km${min !== null ? ` · ≈${min} min` : ''}${p.is_loop ? ' · loop' : ''}`,
      tags: Array.isArray(p.character_tags) ? (p.character_tags as string[]) : [],
    });
  }, []);

  const onSpotPress = useCallback((e: { features: Array<{ properties?: unknown }> }) => {
    const p = e.features[0]?.properties as
      | { id?: string; name?: string; type?: string; point_count?: number }
      | undefined;
    if (!p || p.point_count !== undefined) return; // cluster taps: zoom gesture instead
    setSelected({
      kind: 'spot',
      title: p.name || 'Unnamed spot',
      line: (p.type ?? '').replace('_', ' '),
      tags: [],
      ...(typeof p.id === 'string' ? { spotId: p.id } : {}),
    });
  }, []);

  const spotLayers = spotShape.features.length > 0 && (
    <ShapeSource
      id="spots"
      shape={spotShape}
      cluster
      clusterRadius={45}
      clusterMaxZoomLevel={14}
      onPress={onSpotPress}
    >
      <CircleLayer
        id="spot-clusters"
        filter={['has', 'point_count']}
        style={{
          circleColor: themeName === 'dark' ? '#2b3138' : '#e6eaef',
          circleRadius: 16,
          circleStrokeColor: AMBER,
          circleStrokeWidth: 2,
        }}
      />
      <SymbolLayer
        id="spot-cluster-count"
        filter={['has', 'point_count']}
        style={{
          textField: ['get', 'point_count_abbreviated'],
          textSize: 12,
          textColor: themeName === 'dark' ? '#ffffff' : '#171c22',
        }}
      />
      <CircleLayer
        id="spot-pin"
        filter={['!', ['has', 'point_count']]}
        style={{
          circleColor: ['match', ['get', 'type'], ...SPOT_COLORS, '#8a93a6'],
          circleRadius: 9,
          circleStrokeColor: themeName === 'dark' ? '#11151a' : '#ffffff',
          circleStrokeWidth: 2,
        }}
      />
      <SymbolLayer
        id="spot-pin-label"
        filter={['!', ['has', 'point_count']]}
        style={{
          textField: ['get', 'label'],
          textSize: 10,
          textColor: '#ffffff',
          textAllowOverlap: true,
        }}
      />
    </ShapeSource>
  );

  const banner = (
    <>
      {routes.phase === 'loading' && (
        <View
          style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.bannerText, { color: colors.textMuted }]}>Loading routes…</Text>
        </View>
      )}
      {routes.phase === 'error' && (
        <View
          style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.bannerText, { color: colors.danger }]}>
            Couldn't load routes — the map still works. Check the connection and try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={load}
            style={({ pressed }) => [
              styles.bannerButton,
              { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.bannerButtonLabel, { color: colors.onAccent }]}>Retry</Text>
          </Pressable>
        </View>
      )}
    </>
  );

  const sheet = selected && (
    <View
      style={[styles.sheet, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
    >
      <View style={styles.sheetHeader}>
        <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={2}>
          {selected.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close details"
          onPress={() => setSelected(null)}
          style={({ pressed }) => [styles.sheetClose, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.sheetCloseLabel, { color: colors.textMuted }]}>✕</Text>
        </Pressable>
      </View>
      <Text style={[styles.sheetLine, { color: colors.textMuted }]}>{selected.line}</Text>
      {selected.tags.length > 0 && (
        <View style={styles.tagRow}>
          {selected.tags.map((t) => (
            <View key={t} style={[styles.tag, { borderColor: colors.border }]}>
              <Text style={[styles.tagText, { color: colors.textMuted }]}>{t}</Text>
            </View>
          ))}
        </View>
      )}
      {selected.kind === 'spot' && selected.spotId !== undefined && props.navigation && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Spot details"
          onPress={() =>
            props.navigation!.navigate('Spot', { id: selected.spotId, name: selected.title })
          }
          style={({ pressed }) => [
            styles.sheetAction,
            { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.sheetActionLabel, { color: colors.accent }]}>Details</Text>
        </Pressable>
      )}
    </View>
  );

  const addButton = props.navigation && (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a spot"
      onPress={() => props.navigation!.navigate('AddSpot', { knownSpots: spots })}
      style={({ pressed }) => [
        styles.addBtn,
        { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[styles.addBtnLabel, { color: colors.onAccent }]}>＋ Add spot</Text>
    </Pressable>
  );

  return (
    <DriveLinesMap
      featureCollection={routeShape}
      bounds={bounds}
      sourceId="seed-routes"
      onSelectLine={onRoutePress}
      banner={banner}
      sheet={
        <>
          {addButton}
          {sheet}
        </>
      }
    >
      {spotLayers}
    </DriveLinesMap>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: spacing.xl + spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  bannerText: { ...font.body },
  bannerButton: {
    minHeight: HIT_TARGET,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerButtonLabel: { ...font.button },
  sheet: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 40, // clears the attribution strip (FR-014: never covered)
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  sheetTitle: { ...font.heading, flex: 1 },
  sheetClose: {
    minWidth: HIT_TARGET,
    minHeight: HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -spacing.sm,
    marginRight: -spacing.sm,
  },
  sheetCloseLabel: { fontSize: 18, fontWeight: '600' },
  sheetLine: { ...font.body },
  sheetAction: {
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetActionLabel: { ...font.button },
  addBtn: {
    position: 'absolute',
    right: spacing.md,
    bottom: 104, // above the detail-sheet zone + attribution
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnLabel: { ...font.button },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tagText: { ...font.caption },
});
