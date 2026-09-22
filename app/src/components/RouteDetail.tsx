/**
 * The SHARED route-detail component (M7-T05; FR-070..074 — one component for
 * Result, saved and shared routes, §16 cohesion rule 1).
 *
 * Shows: the route on the map (amber line, bounds-fitted) · stats (km, ≈min —
 * the HONEST routed time per BD-42, twistiness, climb) · road flags · character
 * tags · the constraints panel reflecting the agent's ACTUAL verdicts (FR-044:
 * relaxed/violated always disclosed, never fabricated) · the grounded
 * explanation · the FR-400 safe-driving disclaimer. Save/share/navigate
 * actions belong to the HOST SCREEN, not here (result.test.tsx asserts a
 * standalone render contains no "Save"/"Share"/"Navigate"); the host hands
 * them in through the `hero` slot.
 *
 * Per-segment twisty highlighting (§19) needs segment scores the /plan payload
 * doesn't carry yet — deferred, logged in BD-51.
 *
 * REDESIGN (SPEC "RouteDetail (shared: Result · SavedRoute)") — an atlas PLATE.
 *   1. The map bleeds to both screen edges at radius 0 (it was a 16pt-rounded
 *      card inside the gutter), and the NUMBERS CARD rides over its lower
 *      edge — the composition of a printed chart: the picture, then the
 *      measurements laid on top of it. RouteDetail therefore OWNS THE GUTTER:
 *      everything under the plate is inset by `spacing.gutter`, and a host's
 *      scroll view passes no horizontal padding of its own.
 *   2. A `hero` slot sits directly under the numbers — the Apple-Maps "GO"
 *      position — so the host's Follow/Save land where the eye is, not three
 *      panels further down. `reveal` (default false) plays the host's
 *      three mount beats: plate fade, numbers rise, hero rise. `showName`
 *      (default false): the page's name is the native large title now; the
 *      M13 shared-link page, which has no header, may ask for it back.
 *   3. The inset `Surface` panels around Stops / Constraints / Why are
 *      CHAPTERS — a `Legend` kicker on an index rule — and the legs bar gets
 *      a `LegendKey` row that says what its two colours mean.
 * What did NOT change is the honesty: a hand-built or recorded drive still
 * OMITS twistiness rather than printing 0.0 (`Stat value={null}` renders
 * nothing), "≈" stays on the routed time (BD-42), false flags stay silent, and
 * the disclaimer is verbatim. The inline map is still a PREVIEW with gestures
 * off (a live map inside a vertical scroll is a full-width dead zone); the
 * paint — casing `#11151a` at 0.35, the amber line, the `#8a93a6` connectors,
 * the stop circles — is frozen.
 *
 * Motion (expo-animation gate). The legs bar draws left→right on mount: rare
 * tier, purpose "explanation" — a chart that draws itself says it is a
 * measurement. Each segment's inner fill is `scaleX` 0→1 (`withTiming` 520ms,
 * strong ease-out, 70ms stagger, `transformOrigin: 'left'`) — transform only,
 * on the UI thread, behind a mount-only ref guard so a re-render never replays
 * a chart the reader is looking at; instant under Reduce Motion. The reveal
 * beats are module-scope layout builders (stable identity; never rebuilt in
 * render) and play ONLY when the host asks.
 */

import Mapbox, { Camera, CircleLayer, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import type { ConstraintResult, Route, RouteStop } from '@shared/types';
import { useEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import '../lib/mapbox';
import type { Explanation } from '../lib/plan_run';
import type { DoneStatus } from '../lib/plan_stream';
import { AMBER, motion, radius, spacing, spotColor, useTheme, withAlpha } from '../theme';

import {
  Chapter,
  EASE_OUT,
  Legend,
  LegendKey,
  Rule,
  Stat,
  Surface,
  Symbol,
  Text,
  useReducedMotion,
  type SymbolKey,
  type TextTone,
} from './ui';

export interface RouteDetailProps {
  route: Route;
  explanation: Explanation | null;
  done: DoneStatus | null;
  /** Extra sections (reasoning view, understood chips) injected by the host,
   *  rendered inside the gutter after the chapters. */
  children?: ReactNode;
  /** The host's actions (Follow, Save), rendered directly under the numbers
   *  card — the "GO" position. RouteDetail draws no action of its own. */
  hero?: ReactNode;
  /** Play the three mount beats (plate · numbers · hero). Default false: a
   *  library item is already there; only a freshly planned drive arrives. */
  reveal?: boolean;
  /** Draw the drive's name above the plate. Default false — the name is the
   *  host's native large title. */
  showName?: boolean;
}

// --- The reveal beats (module scope: stable identity, never rebuilt) ------------

/** Beat 1: the plate fades in. */
const PLATE_IN = FadeIn.duration(motion.reveal);
/** Beat 2: the numbers rise onto the plate's edge, a stagger later. */
const NUMBERS_IN = FadeInDown.duration(motion.reveal).delay(motion.revealStagger).easing(EASE_OUT);
/** Beat 3: the hero rises under them. */
const HERO_IN = FadeInDown.duration(motion.reveal)
  .delay(motion.revealStagger * 2)
  .easing(EASE_OUT);
/** Under Reduce Motion every beat keeps its fade and loses its rise — told
 *  `Never`, or `System` would skip the fade too and the plate would pop. */
const BEAT_REDUCED = FadeIn.duration(motion.crossFade).reduceMotion(ReduceMotion.Never);

/** Verdict → glyph + tone (`ui/Symbol`: SF on iOS, Ionicons on Android; the
 *  old Unicode `✓ / ⚠ / ✕` fell through to Apple Color Emoji and ignored its
 *  tint, so the amber "relaxed" coding never rendered at all). */
function statusMark(status: ConstraintResult['status']): { name: SymbolKey; tone: TextTone } {
  return status === 'satisfied'
    ? { name: 'checkmarkCircleFill', tone: 'success' }
    : status === 'relaxed'
      ? { name: 'exclamationmarkTriangleFill', tone: 'notice' }
      : { name: 'xmarkCircleFill', tone: 'danger' };
}

/** "Ridge Café · coffee · ≈46 min in" (arrival honest-null → no time shown). */
export function stopLine(stop: RouteStop): string {
  const bits = [stop.name, stop.type];
  if (stop.arrival_s !== null) bits.push(`≈${Math.round(stop.arrival_s / 60)} min in`);
  return bits.join(' · ');
}

export default function RouteDetail(props: RouteDetailProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const { route, explanation, done, reveal = false, showName = false } = props;
  const reduced = useReducedMotion();

  /** The beat's `entering`, or nothing: an absent prop, never `undefined`. */
  const beat = (builder: typeof PLATE_IN): { entering?: typeof PLATE_IN } =>
    reveal ? { entering: reduced ? BEAT_REDUCED : builder } : {};

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
        // one spot palette for the whole app (was a divergent second copy here)
        properties: { color: spotColor(s.type) },
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

  const banner =
    done === 'relaxed'
      ? 'Some preferences were relaxed to make this drive work — details in the constraints below.'
      : done === 'best_so_far'
        ? "I ran out of time; here's the best I found."
        : null;

  return (
    <View style={styles.root}>
      {/* the name is the host's native title; a headerless host (the M13
          shared-link page) asks for it back with `showName` */}
      {showName && route.name !== undefined && route.name.trim() !== '' && (
        <Text variant="title" accessibilityRole="header" style={styles.gutter}>
          {route.name}
        </Text>
      )}

      {/* THE PLATE + THE NUMBERS: one block with no gap, so the card's
          negative top margin is measured from the plate's edge, not from a
          gap under it */}
      <View>
        <Animated.View {...beat(PLATE_IN)} style={styles.plate}>
          <View style={styles.mapWrap}>
            {/* the drive on the map — a PREVIEW, not a live map (see the header) */}
            <MapView
              style={styles.map}
              styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
              scaleBarEnabled={false}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              logoPosition={{ bottom: 4, left: 6 }}
              attributionPosition={{ bottom: 4, left: 92 }}
            >
              {bounds && (
                <Camera
                  bounds={{
                    ne: bounds.ne,
                    sw: bounds.sw,
                    paddingTop: 28,
                    // the numbers card covers the plate's lower edge, so the
                    // fit keeps the line clear of it
                    paddingBottom: 28 + spacing.xl,
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
              style={[styles.attrPill, { backgroundColor: withAlpha(colors.surfaceRaised, 0.92) }]}
            >
              {/* FR-014: never covered, and never flat grey on a translucent
                  surface either — an opaque-enough pill with real ink on it */}
              <Text variant="micro">© OpenStreetMap contributors · © Mapbox</Text>
            </View>
          </View>
          {/* the 1px lit edge where the plate meets the paper */}
          <View style={[styles.plateEdge, { backgroundColor: colors.topEdge }]} />
        </Animated.View>

        {/* the numbers (FR-070) — the payoff, riding over the plate's edge */}
        <Animated.View {...beat(NUMBERS_IN)} style={styles.numbersWrap}>
          <Surface level="raised" padding="md" style={styles.numbers}>
            <View style={styles.heroRow}>
              <Stat value={`${km} km`} label="distance" size="lg" style={styles.statCell} />
              <Stat value={`≈${min} min`} label="drive time" size="lg" style={styles.statCell} />
            </View>
            <Rule weight="contour" />
            <View style={styles.statsRow}>
              <Stat
                value={route.is_loop ? 'loop' : 'A → B'}
                label="shape"
                style={styles.statCell}
              />
              {/* A hand-built or recorded route has no measured curvature —
                  showing a flat 0.0 next to real measured stats claims a
                  measurement nobody made (Hard rule: never a claimed number),
                  and a "not measured" placeholder in a stat slot just draws
                  the eye to a gap. `null` renders NOTHING; the tile is simply
                  absent. */}
              <Stat
                value={
                  route.origin_type === 'ai' && route.curviness !== null
                    ? route.curviness.toFixed(1)
                    : null
                }
                label="twistiness"
                style={styles.statCell}
              />
              <Stat
                value={route.climb_m !== null ? `${Math.round(route.climb_m)} m` : null}
                label="climb"
                style={styles.statCell}
              />
            </View>
          </Surface>
        </Animated.View>
      </View>

      {/* the host's actions, in the "GO" position */}
      {props.hero !== undefined && props.hero !== null && (
        <Animated.View {...beat(HERO_IN)} style={styles.gutter}>
          {props.hero}
        </Animated.View>
      )}

      {/* honest status banner (§18 copy) — a MARGIN NOTE: the index rule runs
          down its left edge in the disclosure colour, so it cannot be
          mistaken for a control or for "this is selected" */}
      {banner !== null && (
        <View style={[styles.gutter, styles.marginNote, { borderLeftColor: colors.notice }]}>
          <View style={styles.mark}>
            <Symbol name="infoCircleFill" size="md" tone="notice" />
          </View>
          <Text variant="footnote" tone="notice" style={styles.flex}>
            {banner}
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
        <View style={[styles.gutter, styles.legsWrap]}>
          <LegsBar
            there={Math.max(1, route.legs.there_pct)}
            drive={Math.max(1, route.legs.drive_pct)}
            home={Math.max(1, route.legs.home_pct)}
          />
          {/* BD-203: measured seconds per leg when the trip carries them (a
              Discover drive's engine-priced connectors + stored core), else
              the distance share of the total — never a number that
              contradicts the card the user just tapped. */}
          <Text variant="footnote" tone="muted" style={styles.figures}>
            {`getting there ${Math.round((route.legs.there_s ?? (min * 60 * route.legs.there_pct) / 100) / 60)} min · `}
            <Text variant="footnote" style={[styles.legStrong, styles.figures]}>
              {`the drive ${Math.round((route.legs.drive_s ?? (min * 60 * route.legs.drive_pct) / 100) / 60)} min`}
              {route.legs.drive_backroad_pct !== null
                ? ` (${route.legs.drive_backroad_pct}% backroad)`
                : ''}
            </Text>
            {` · home ${Math.round((route.legs.home_s ?? (min * 60 * route.legs.home_pct) / 100) / 60)} min`}
          </Text>
          {/* the key: what the bar's two colours mean */}
          <View style={styles.keyRow}>
            <LegendKey color={colors.accent}>The drive</LegendKey>
            <LegendKey color={colors.contour}>Getting there / home</LegendKey>
          </View>
        </View>
      )}

      {/* character tags as legend pills; road flags as notice-edged pills */}
      {(flags.length > 0 || route.character_tags.length > 0) && (
        <View style={[styles.gutter, styles.pillRow]}>
          {route.character_tags.map((t) => (
            <View
              key={t}
              style={[styles.pill, { backgroundColor: colors.fill, borderColor: colors.hairline }]}
            >
              <Legend>{t}</Legend>
            </View>
          ))}
          {flags.map((f) => (
            <View
              key={f}
              style={[
                styles.pill,
                styles.flagPill,
                { backgroundColor: colors.fill, borderColor: colors.notice },
              ]}
            >
              <Symbol name="exclamationmarkTriangle" size="sm" tone="notice" />
              <Legend tone="notice">{f}</Legend>
            </View>
          ))}
        </View>
      )}

      {/* stops (R16-5: real spots, MEASURED arrivals — timing verdicts live in
          the constraints chapter below) */}
      {stops.length > 0 && (
        <Chapter title="Stops" style={styles.gutter}>
          {stops.map((s, i) => (
            <View key={`${s.name}-${i}`} style={styles.stopRow}>
              <View style={[styles.stopDot, { backgroundColor: spotColor(s.type) }]} />
              <Text variant="body" style={styles.flex}>
                {stopLine(s)}
              </Text>
            </View>
          ))}
        </Chapter>
      )}

      {/* constraints (FR-042/FR-044 — actual verdicts, never fabricated) */}
      {constraints.length > 0 && (
        <Chapter title="Your constraints" style={styles.gutter}>
          {constraints.map((c, i) => {
            const mark = statusMark(c.status);
            return (
              <View key={`${c.constraint}-${i}`} style={styles.constraintRow}>
                <View style={styles.mark}>
                  <Symbol name={mark.name} size="md" tone={mark.tone} />
                </View>
                <View style={styles.constraintBody}>
                  <Text variant="bodyStrong">{c.constraint.replace(/_/g, ' ')}</Text>
                  {c.detail.length > 0 && (
                    <Text variant="footnote" tone="muted">
                      {c.detail}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </Chapter>
      )}

      {/* grounded explanation */}
      {explanation && (
        <Chapter title="Why this route?" style={styles.gutter}>
          <Text variant="body">{explanation.text}</Text>
          {explanation.relaxed.length > 0 && (
            <View style={styles.relaxedList}>
              {explanation.relaxed.map((r) => (
                // the mark sits in its own box so a wrapped disclosure
                // hang-indents instead of running back under the glyph
                <View key={r} style={styles.constraintRow}>
                  <View style={styles.mark}>
                    <Symbol name="exclamationmarkTriangleFill" size="sm" tone="notice" />
                  </View>
                  <Text variant="footnote" tone="notice" style={styles.flex}>
                    {r}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Chapter>
      )}

      {props.children !== undefined && props.children !== null && (
        <View style={[styles.gutter, styles.children]}>{props.children}</View>
      )}

      {/* FR-400: persistent safe-driving disclaimer on generated routes.
          Left-aligned: iOS centres a single-line footnote, never a wrapped
          paragraph, and a ragged left edge is the generated-layout look. */}
      <Text variant="footnote" tone="muted" style={[styles.gutter, styles.disclaimer]}>
        Drive to conditions and obey all posted limits and laws. Roadopia plans enjoyable drives —
        the road always comes first.
      </Text>
    </View>
  );
}

/**
 * The three-leg bar, drawn left to right on mount.
 *
 * `flex` and `width` cannot animate off the JS thread, so each segment holds
 * its final layout share and an inner fill grows by `scaleX` from its left
 * edge — transform only (expo-animation §4), no measurement pass.
 */
function LegsBar(props: { there: number; drive: number; home: number }): ReactElement {
  const { colors } = useTheme();
  const segments = [
    { flex: props.there, color: colors.contour },
    { flex: props.drive, color: colors.accent },
    { flex: props.home, color: colors.contour },
  ];

  return (
    <View style={[styles.legsBar, { backgroundColor: colors.fill }]}>
      {segments.map((s, i) => (
        <LegSegment key={i} index={i} flex={s.flex} color={s.color} />
      ))}
    </View>
  );
}

/** One segment: a shared value 0 → 1 on mount, staggered by index; the ref
 *  guard makes it mount-only, so a re-render never replays the chart. */
function LegSegment(props: { index: number; flex: number; color: string }): ReactElement {
  const reduced = useReducedMotion();
  const draw = useSharedValue(reduced ? 1 : 0);
  const played = useRef(false);

  useEffect(() => {
    if (played.current) return;
    played.current = true;
    if (reduced) {
      draw.set(1);
      return;
    }
    draw.set(
      withDelay(
        props.index * motion.drawStagger,
        withTiming(1, { duration: motion.draw, easing: EASE_OUT }),
      ),
    );
    // Mount-only on purpose: `reduced` resolving a beat later must not restart
    // a chart mid-draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: draw.get() }] }));

  return (
    <View style={{ flex: props.flex }}>
      <Animated.View style={[styles.legFill, { backgroundColor: props.color }, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  /** RouteDetail owns the gutter: the plate bleeds, everything else is inset. */
  gutter: { marginHorizontal: spacing.gutter },
  plate: {},
  /** A ratio, not a pixel height: 343x260 on an SE is 1.32:1 and 408x260 on a
   *  16 Pro Max is 1.57:1, so a fixed height changed the composition — and the
   *  camera padding with it — on every different iPhone. Radius 0: a plate is
   *  bled to the edges, not a card. */
  mapWrap: { aspectRatio: 1.45, width: '100%', borderRadius: 0, overflow: 'hidden' },
  map: { flex: 1 },
  plateEdge: { height: 1 },
  attrPill: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  /** The card rides over the plate's lower edge by one chapter step. */
  numbersWrap: { marginTop: -spacing.xl, marginHorizontal: spacing.gutter },
  numbers: { gap: spacing.lg },
  heroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  /** grow to fill the line, never SHRINK: a shrinking cell makes Stat's
   *  single-line value truncate at AX text sizes, where what it should do is
   *  wrap onto its own full-width line. */
  statCell: { flexGrow: 1, flexShrink: 0 },
  marginNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderLeftWidth: 3,
    paddingLeft: spacing.md,
  },
  legsWrap: { gap: spacing.sm },
  legsBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
    gap: 2,
  },
  legFill: { flex: 1, transformOrigin: 'left' },
  legStrong: { fontWeight: '600' },
  figures: { fontVariant: ['tabular-nums'] },
  keyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  /** A capsule, not a rounded box: 8pt on a 26pt-tall chip reads as web. */
  pill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  flagPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stopDot: { width: spacing.md, height: spacing.md, borderRadius: radius.pill },
  constraintRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  /** 2pt of optical lead-in puts the mark on the line's cap height. */
  mark: { paddingTop: 2 },
  constraintBody: { flex: 1, gap: spacing.xs },
  relaxedList: { gap: spacing.sm },
  children: { gap: spacing.lg },
  flex: { flex: 1 },
  disclaimer: { paddingBottom: spacing.xl },
});
