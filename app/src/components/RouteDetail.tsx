/**
 * The SHARED route-detail component (M7-T05; FR-070..074 — one component for
 * Result, saved and shared routes, §16 cohesion rule 1).
 *
 * Shows: the route on the map (amber line, bounds-fitted) · stats (km, ≈min —
 * the HONEST routed time per BD-42, twistiness, climb) · road flags · character
 * tags · the constraints panel reflecting the agent's ACTUAL verdicts (FR-044:
 * relaxed/violated always disclosed, never fabricated) · the grounded
 * explanation · the FR-400 safe-driving disclaimer. Save/share/navigate
 * actions arrive with accounts (M8) — no dead buttons before then.
 *
 * Per-segment twisty highlighting (§19) needs segment scores the /plan payload
 * doesn't carry yet — deferred, logged in BD-51.
 */

import Mapbox, { Camera, CircleLayer, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import type { ConstraintResult, Route, RouteStop } from '@shared/types';
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import '../lib/mapbox';
import type { Explanation } from '../lib/plan_run';
import type { DoneStatus } from '../lib/plan_stream';
import { AMBER, font, radius, spacing, useTheme, type ThemeColors } from '../theme';

export interface RouteDetailProps {
  route: Route;
  explanation: Explanation | null;
  done: DoneStatus | null;
  /** Extra sections (reasoning view, refinement) injected by the host screen. */
  children?: ReactNode;
}

function statusGlyph(status: ConstraintResult['status']): string {
  return status === 'satisfied' ? '✓' : status === 'relaxed' ? '⚠' : '✕';
}

/** Stop-marker colours by DB spot type (matches MapHome's spot palette). */
const STOP_COLORS: Record<string, string> = {
  coffee: '#b07b4f',
  food: '#d1704f',
  fuel: '#8a93a6',
  viewpoint: '#4fb0a5',
  rest: '#7f9a6b',
  great_road: AMBER,
};

/** "Ridge Café · coffee · ≈46 min in" (arrival honest-null → no time shown). */
export function stopLine(stop: RouteStop): string {
  const bits = [stop.name, stop.type];
  if (stop.arrival_s !== null) bits.push(`≈${Math.round(stop.arrival_s / 60)} min in`);
  return bits.join(' · ');
}

function statusColor(status: ConstraintResult['status'], colors: ThemeColors): string {
  return status === 'satisfied'
    ? colors.success
    : status === 'relaxed'
      ? colors.warn
      : colors.danger;
}

export default function RouteDetail(props: RouteDetailProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const { route, explanation, done } = props;

  // R30 (BD-146): when the served trip carries its three-leg split, the MAP
  // shows it — the drive amber, the get-there/get-home commutes grey — so the
  // picture says the same thing the legs bar under it says. Split by walking
  // the geometry to the legs' measured metre marks.
  const shape = useMemo(() => {
    const legs = route.legs;
    const coords = route.geometry.coordinates as Array<[number, number]>;
    if (!legs || coords.length < 4) {
      return {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { leg: 'core' },
            geometry: route.geometry,
          },
        ],
      };
    }
    const latM = 111_320;
    let acc = 0;
    let i1 = coords.length - 1;
    let i2 = coords.length - 1;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1]!;
      const b = coords[i]!;
      acc += Math.hypot(
        (b[1] - a[1]) * latM,
        (b[0] - a[0]) * latM * Math.cos((a[1] * Math.PI) / 180),
      );
      if (acc <= legs.there_m) i1 = i;
      if (acc <= legs.there_m + legs.drive_m) i2 = i;
    }
    const seg = (from: number, to: number, leg: string) => ({
      type: 'Feature' as const,
      properties: { leg },
      geometry: {
        type: 'LineString' as const,
        coordinates: coords.slice(from, to + 1),
      },
    });
    return {
      type: 'FeatureCollection' as const,
      features: [seg(0, i1, 'out'), seg(i1, i2, 'core'), seg(i2, coords.length - 1, 'home')],
    };
  }, [route.geometry, route.legs]);

  const bounds = useMemo(() => {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lng, lat] of route.geometry.coordinates) {
      if (lng! < west) west = lng!;
      if (lng! > east) east = lng!;
      if (lat! < south) south = lat!;
      if (lat! > north) north = lat!;
    }
    return Number.isFinite(west)
      ? { sw: [west, south] as [number, number], ne: [east, north] as [number, number] }
      : null;
  }, [route.geometry]);

  const km = (route.distance_m / 1000).toFixed(1);
  const min = Math.round(route.duration_s / 60);
  const constraints = (route.satisfied_constraints ?? []).filter(
    (c) => c.status !== 'not_applicable',
  );

  // R16-5: real stops in drive order — rows + typed map markers
  const stops = useMemo(
    () => [...(route.stops ?? [])].sort((a, b) => (a.arrival_s ?? 0) - (b.arrival_s ?? 0)),
    [route.stops],
  );
  const stopShape = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: stops.map((s, i) => ({
        type: 'Feature' as const,
        id: `stop-${i}`,
        properties: { color: STOP_COLORS[s.type] ?? '#8a93a6' },
        geometry: {
          type: 'Point' as const,
          coordinates: [s.location.lng, s.location.lat] as [number, number],
        },
      })),
    }),
    [stops],
  );

  const flags: string[] = [];
  if (route.highway_flag) flags.push('includes highway');
  if (route.toll_flag) flags.push('includes tolls');
  if (route.ferry_flag) flags.push('includes a ferry');
  if (route.unpaved_flag) flags.push('includes unpaved');

  return (
    <View style={styles.root}>
      {/* the drive on the map */}
      <View style={[styles.mapWrap, { borderColor: colors.border }]}>
        <MapView
          style={styles.map}
          styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
          scaleBarEnabled={false}
          logoPosition={{ bottom: 4, left: 6 }}
          attributionPosition={{ bottom: 4, left: 92 }}
        >
          {bounds && (
            <Camera
              bounds={{
                ne: bounds.ne,
                sw: bounds.sw,
                paddingTop: 28,
                paddingBottom: 28,
                paddingLeft: 28,
                paddingRight: 28,
              }}
              animationDuration={0}
            />
          )}
          <ShapeSource id="detail-route" shape={shape}>
            <LineLayer
              id="detail-route-casing"
              style={{
                lineColor: '#11151a',
                lineWidth: 6,
                lineOpacity: 0.35,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="detail-route-line"
              style={{
                // one plain-amber feature when there is no split; three
                // leg-tagged features (grey commutes) when there is
                lineColor: ['match', ['get', 'leg'], 'core', AMBER, '#8a93a6'],
                lineWidth: 3.5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          {stops.length > 0 && (
            <ShapeSource id="detail-stops" shape={stopShape}>
              <CircleLayer
                id="detail-stops-circles"
                style={{
                  circleRadius: 6,
                  circleColor: ['get', 'color'],
                  circleStrokeWidth: 2,
                  circleStrokeColor: '#ffffff',
                }}
              />
            </ShapeSource>
          )}
        </MapView>
        <View
          pointerEvents="none"
          style={[styles.attrPill, { backgroundColor: colors.surfaceRaised + 'CC' }]}
        >
          <Text style={[styles.attr, { color: colors.textMuted }]}>
            © OpenStreetMap contributors · © Mapbox
          </Text>
        </View>
      </View>

      {/* honest status banner (§18 copy) */}
      {done === 'relaxed' && (
        <View
          style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.warn }]}
        >
          <Text style={[styles.bannerText, { color: colors.warn }]}>
            Some preferences were relaxed to make this drive work — details in the constraints
            below.
          </Text>
        </View>
      )}
      {done === 'best_so_far' && (
        <View
          style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.warn }]}
        >
          <Text style={[styles.bannerText, { color: colors.warn }]}>
            I ran out of time; here's the best I found.
          </Text>
        </View>
      )}

      {/* R28 — the drive, separate from the commute to reach it.
          A "90 minute loop" from a suburban door measures ~28 % getting there,
          ~49 % drive, ~23 % home, and the ends are 83 % main road against 64 %
          in the middle (audit-v15). Showing one averaged number told the user
          their whole trip was the drive, which is why the road-class figure
          looked bad and no routing lever could move it. */}
      {route.legs && (
        <View style={styles.legsWrap}>
          <View style={styles.legsBar}>
            <View
              style={[
                styles.legSeg,
                { flex: Math.max(1, route.legs.there_pct), backgroundColor: colors.border },
              ]}
            />
            <View
              style={[
                styles.legSeg,
                { flex: Math.max(1, route.legs.drive_pct), backgroundColor: colors.accent },
              ]}
            />
            <View
              style={[
                styles.legSeg,
                { flex: Math.max(1, route.legs.home_pct), backgroundColor: colors.border },
              ]}
            />
          </View>
          <Text style={[styles.legsText, { color: colors.textMuted }]}>
            {`getting there ${Math.round((min * route.legs.there_pct) / 100)} min · `}
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {`the drive ${Math.round((min * route.legs.drive_pct) / 100)} min`}
              {route.legs.drive_backroad_pct !== null
                ? ` (${route.legs.drive_backroad_pct}% backroad)`
                : ''}
            </Text>
            {` · home ${Math.round((min * route.legs.home_pct) / 100)} min`}
          </Text>
        </View>
      )}

      {/* stats (FR-070) */}
      <View style={styles.statsRow}>
        <Stat label="distance" value={`${km} km`} colors={colors} />
        <Stat label="drive time" value={`≈${min} min`} colors={colors} />
        <Stat label="shape" value={route.is_loop ? 'loop' : 'A → B'} colors={colors} />
        {/* A hand-built or recorded route has no measured curvature — showing a
            flat 0.0 next to real measured stats claims a measurement nobody
            made (Hard rule: never a claimed number). */}
        {route.origin_type === 'ai' ? (
          <Stat label="twistiness" value={route.curviness.toFixed(1)} colors={colors} />
        ) : (
          <Stat label="twistiness" value="not measured" colors={colors} />
        )}
        {route.climb_m !== null && (
          <Stat label="climb" value={`↑ ${Math.round(route.climb_m)} m`} colors={colors} />
        )}
      </View>

      {(flags.length > 0 || route.character_tags.length > 0) && (
        <View style={styles.tagRow}>
          {route.character_tags.map((t) => (
            <View key={t} style={[styles.tag, { borderColor: colors.border }]}>
              <Text style={[styles.tagText, { color: colors.textMuted }]}>{t}</Text>
            </View>
          ))}
          {flags.map((f) => (
            <View key={f} style={[styles.tag, { borderColor: colors.warn }]}>
              <Text style={[styles.tagText, { color: colors.warn }]}>{f}</Text>
            </View>
          ))}
        </View>
      )}

      {/* stops (R16-5: real spots, MEASURED arrivals — timing verdicts live in
          the constraints panel below) */}
      {stops.length > 0 && (
        <View
          style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.panelTitle, { color: colors.text }]}>Stops</Text>
          {stops.map((s, i) => (
            <View key={`${s.name}-${i}`} style={styles.stopRow}>
              <View
                style={[styles.stopDot, { backgroundColor: STOP_COLORS[s.type] ?? '#8a93a6' }]}
              />
              <Text style={[styles.stopText, { color: colors.text }]}>{stopLine(s)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* constraints panel (FR-042/FR-044 — actual verdicts, never fabricated) */}
      {constraints.length > 0 && (
        <View
          style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.panelTitle, { color: colors.text }]}>Your constraints</Text>
          {constraints.map((c, i) => (
            <View key={`${c.constraint}-${i}`} style={styles.constraintRow}>
              <Text style={[styles.constraintGlyph, { color: statusColor(c.status, colors) }]}>
                {statusGlyph(c.status)}
              </Text>
              <View style={styles.constraintBody}>
                <Text style={[styles.constraintName, { color: colors.text }]}>
                  {c.constraint.replace(/_/g, ' ')}
                </Text>
                {c.detail.length > 0 && (
                  <Text style={[styles.constraintDetail, { color: colors.textMuted }]}>
                    {c.detail}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* grounded explanation */}
      {explanation && (
        <View
          style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.panelTitle, { color: colors.text }]}>Why this route?</Text>
          <Text style={[styles.explanation, { color: colors.text }]}>{explanation.text}</Text>
          {explanation.relaxed.length > 0 && (
            <View style={styles.relaxedList}>
              {explanation.relaxed.map((r) => (
                <Text key={r} style={[styles.relaxedItem, { color: colors.warn }]}>
                  ⚠ {r}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {props.children}

      {/* FR-400: persistent safe-driving disclaimer on generated routes */}
      <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
        Drive to conditions and obey all posted limits and laws. Roadopia plans enjoyable drives —
        the road always comes first.
      </Text>
    </View>
  );
}

function Stat(props: { label: string; value: string; colors: ThemeColors }): ReactElement {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: props.colors.text }]}>{props.value}</Text>
      <Text style={[styles.statLabel, { color: props.colors.textMuted }]}>{props.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  mapWrap: { height: 260, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1 },
  map: { flex: 1 },
  attrPill: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  attr: { fontSize: 9 },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  bannerText: { ...font.body },
  legsWrap: { marginTop: 10, marginBottom: 2 },
  legsBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 },
  legSeg: { height: 6 },
  legsText: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  stat: { gap: 2 },
  statValue: { ...font.heading, fontVariant: ['tabular-nums'] },
  statLabel: { ...font.caption },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tagText: { ...font.caption },
  panel: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  panelTitle: { ...font.heading },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stopDot: { width: 10, height: 10, borderRadius: 5 },
  stopText: { ...font.body, flex: 1 },
  constraintRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  constraintGlyph: { ...font.body, width: 20, textAlign: 'center' },
  constraintBody: { flex: 1, gap: 2 },
  constraintName: { ...font.body },
  constraintDetail: { ...font.caption, lineHeight: 16 },
  explanation: { ...font.body, lineHeight: 22 },
  relaxedList: { gap: spacing.xs },
  relaxedItem: { ...font.caption, lineHeight: 18 },
  disclaimer: { ...font.caption, lineHeight: 16, textAlign: 'center', paddingBottom: spacing.xl },
});
