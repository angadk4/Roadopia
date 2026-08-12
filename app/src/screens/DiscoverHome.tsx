/**
 * Discover — "great drives near you" (R24 map-first). The region's best roads
 * GLOW as amber lines on a live map (the shared DriveLinesMap); a bottom rail of
 * drive cards is the per-drive detail + "Let's go" CTA. Tapping a card (or its
 * map line) launches the drive — instantly with the PRE-BUILT out-and-back route
 * when the backend attached one (skip Progress + /plan), else via the shared
 * generation flow as a fallback.
 *
 * Every Discover drive is an out-and-back (R24 decision): predictable, uniform,
 * pre-buildable. Honesty (Hard rule D — engagement not velocity): a curviness
 * WORD, the REAL measured total, the honest "~N min to the start". Empty menus
 * are stated plainly, never padded. Origin reuses the shared PlanDraft context +
 * device location (BD-27) — the lat/long readout is gone (map-first).
 */

import type {
  CoreDrive,
  DiscoverResult,
  DiscoverResultV2,
  LatLng,
  NearbyDrive,
} from '@shared/types';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import DriveLinesMap from '../components/DriveLinesMap';
import {
  buildDiscoverPlanRequest,
  coreDrivesBounds,
  coreDrivesToFeatureCollection,
  coreDriveToRoute,
  coreTripLabel,
  DISCOVER_V1_FALLBACK,
  DISCOVER_V2,
  DiscoverUnavailableError,
  discoverDrivesToFeatureCollection,
  driveDurationS,
  drivesBounds,
  fetchDiscoverCores,
  fetchDiscoverDrives,
  nearbyDriveToRoute,
} from '../lib/discover';
import { getCurrentLocation, type LocationResult } from '../lib/location';
import { usePlanDraft } from '../lib/plan_draft';
import { getApiBaseUrl } from '../lib/runtime';
import { sessionId } from '../lib/session';
import { AMBER, font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

type FetchFn = (origin: LatLng) => Promise<DiscoverResult>;

interface DiscoverNav {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
}

export interface DiscoverHomeProps {
  navigation: DiscoverNav;
  /** Injectable for tests; default = expo-location. */
  locate?: () => Promise<LocationResult>;
  /** Injectable for tests; default = POST /discover. */
  fetchDrives?: FetchFn;
  /** Injectable for tests; default = POST /discover with v:2 (null disables v2). */
  fetchCores?: ((origin: LatLng) => Promise<DiscoverResultV2>) | null;
}

type Phase =
  | { kind: 'need_origin' }
  | { kind: 'loading' }
  | { kind: 'loaded'; result: DiscoverResult }
  /** R29 Unit A: the v2 three-leg menu — the drive + get-there + get-home. */
  | { kind: 'loaded_v2'; result: DiscoverResultV2 }
  | { kind: 'empty'; disclosures: string[] }
  | { kind: 'unavailable' }
  | { kind: 'error' };

type LocState = 'idle' | 'fetching' | 'denied' | 'error';

/** Shared empties — one identity each, so "no drives" never invalidates a memo.
 *  Never mutated (the screen only ever reads these). */
const NO_DRIVES: NearbyDrive[] = [];
const NO_CORE_DRIVES: CoreDrive[] = [];

/** Whole minutes → a friendly duration ("45 min" / "1 h 50 min" / "2 h"). */
function fmtDur(s: number): string {
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} h` : `${h} h ${rem} min`;
}

/** Curviness → an engagement WORD (Hard rule D — never speed/velocity). */
function curveWord(c: number): string {
  if (c >= 2.0) return 'Very winding';
  if (c >= 1.0) return 'Winding';
  return 'Gentle bends';
}

export default function DiscoverHome(props: DiscoverHomeProps): ReactElement {
  const { colors } = useTheme();
  const { draft, setDraft } = usePlanDraft();
  const origin = draft.origin?.point ?? null;
  const locate = props.locate ?? getCurrentLocation;
  const fetchDrives =
    props.fetchDrives ??
    ((o: LatLng) => fetchDiscoverDrives({ baseUrl: getApiBaseUrl(), sessionId }, o));
  // `null` explicitly DISABLES v2 (tests pin the v1 path with it), so this must
  // distinguish null from undefined — `??` would treat both as "use the default"
  // and send test renders to the real network.
  const fetchCores =
    props.fetchCores !== undefined
      ? props.fetchCores
      : DISCOVER_V2
        ? (o: LatLng) => fetchDiscoverCores({ baseUrl: getApiBaseUrl(), sessionId }, o)
        : null;

  const [phase, setPhase] = useState<Phase>({ kind: 'need_origin' });
  const [locState, setLocState] = useState<LocState>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const useMyLocation = useCallback(() => {
    setLocState('fetching');
    locate()
      .then((res) => {
        if (res.status === 'ok') {
          setDraft({ origin: { source: 'current', point: res.point } });
          setLocState('idle');
        } else {
          setLocState(res.status === 'denied' ? 'denied' : 'error');
        }
      })
      .catch(() => setLocState('error'));
  }, [locate, setDraft]);

  // fetch the menu whenever the origin is (re)set
  useEffect(() => {
    if (!origin) {
      setPhase({ kind: 'need_origin' });
      return;
    }
    let live = true;
    setPhase({ kind: 'loading' });
    setSelectedId(null);
    const loadV1 = (): Promise<void> =>
      fetchDrives(origin).then((result) => {
        if (!live) return;
        setPhase(
          result.drives.length === 0
            ? { kind: 'empty', disclosures: result.disclosures }
            : { kind: 'loaded', result },
        );
      });
    // R29 Unit A: v2 (drive + get-there + get-home) is the product. U12c
    // (BD-180): an empty measured menu no longer silently loads v1
    // out-and-backs — the server's honest state says what is actually true of
    // the area, instead of a lower-quality lookalike wearing the same UI
    // (Recovery §15). Measured cost before flipping: 0 of 27 gold+holdout
    // origins return an empty v2 menu.
    const load = fetchCores
      ? fetchCores(origin).then((result) => {
          if (!live) return;
          if (result.drives.length === 0) {
            if (DISCOVER_V1_FALLBACK) return loadV1();
            setPhase({ kind: 'empty', disclosures: result.disclosures });
            return;
          }
          setPhase({ kind: 'loaded_v2', result });
        })
      : loadV1();
    load.catch((err: unknown) => {
      if (!live) return;
      setPhase(
        err instanceof DiscoverUnavailableError ? { kind: 'unavailable' } : { kind: 'error' },
      );
    });
    return () => {
      live = false;
    };
  }, [origin?.lat, origin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Memoized on `phase` so the two lists keep a stable identity between renders:
  // a fresh `[]` each render re-ran the map's FeatureCollection/bounds memos and
  // handed ShapeSource a new shape every time.
  const drives = useMemo(
    () => (phase.kind === 'loaded' ? phase.result.drives : NO_DRIVES),
    [phase],
  );
  const coreDrives = useMemo(
    () => (phase.kind === 'loaded_v2' ? phase.result.drives : NO_CORE_DRIVES),
    [phase],
  );
  const fc = useMemo(
    () =>
      coreDrives.length > 0
        ? coreDrivesToFeatureCollection(coreDrives)
        : discoverDrivesToFeatureCollection(drives),
    [drives, coreDrives],
  );
  const bounds = useMemo(
    () => (coreDrives.length > 0 ? coreDrivesBounds(coreDrives) : drivesBounds(drives)),
    [drives, coreDrives],
  );

  /** Launch a drive: instant Result with the pre-built route, else /plan flow. */
  const go = useCallback(
    (drive: NearbyDrive) => {
      const route = nearbyDriveToRoute(drive);
      if (route) {
        props.navigation.navigate('Result', { route });
      } else if (origin) {
        props.navigation.navigate('Progress', { request: buildDiscoverPlanRequest(drive, origin) });
      }
    },
    [origin, props.navigation],
  );

  /** R29: a v2 tap opens Result with the three legs concatenated into one
   *  Route whose `legs` field carries the measured split — RouteDetail's
   *  three-leg bar renders it without any screen surgery. */
  const goCore = useCallback(
    (d: CoreDrive) => {
      props.navigation.navigate('Result', { route: coreDriveToRoute(d) });
    },
    [props.navigation],
  );

  const onSelectLine = useCallback((p: Record<string, unknown>) => {
    if (typeof p.id === 'string') setSelectedId(p.id);
  }, []);

  const styles = makeStyles(colors);

  // Top overlay: title + compact origin control + status (no lat/long readout).
  const overlay = (
    <View pointerEvents="box-none" style={styles.top}>
      <View style={[styles.topCard, { backgroundColor: colors.surfaceRaised + 'F2' }]}>
        <Text style={styles.title}>Great drives near you</Text>
        <View style={styles.originButtons}>
          <Pressable accessibilityRole="button" onPress={useMyLocation} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>
              {locState === 'fetching'
                ? 'Locating…'
                : origin
                  ? 'Update location'
                  : 'Use my location'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => props.navigation.navigate('PickPoint', { target: 'origin' })}
            style={styles.smallBtn}
          >
            <Text style={styles.smallBtnText}>Pick on map</Text>
          </Pressable>
        </View>
        {locState === 'denied' && (
          <Text style={styles.note}>Location is off — drop a pin with “Pick on map” instead.</Text>
        )}
        {locState === 'error' && (
          <Text style={styles.note}>Couldn’t get your location — drop a pin instead.</Text>
        )}
        {phase.kind === 'need_origin' && (
          <Text style={styles.note}>
            Set your start point and we’ll light up the region’s best roads within reach.
          </Text>
        )}
        {phase.kind === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.note}>Scanning the region’s best roads within reach…</Text>
          </View>
        )}
        {phase.kind === 'empty' && (
          <Text style={styles.note}>
            {phase.disclosures[0] ??
              'No standout drives within reach of here — try a start closer to the hills.'}
          </Text>
        )}
        {phase.kind === 'unavailable' && (
          <Text style={styles.note}>Discover isn’t available right now. Planning still works.</Text>
        )}
        {phase.kind === 'error' && (
          <Text style={styles.note}>
            Couldn’t scan for drives — check your connection and try again.
          </Text>
        )}
      </View>
    </View>
  );

  // Bottom rail: one card per drive — the per-drive detail + "Let's go" CTA.
  const rail = (drives.length > 0 || coreDrives.length > 0) && (
    <View style={styles.railWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
        keyboardShouldPersistTaps="handled"
      >
        {coreDrives.map((d) => {
          const selected = d.id === selectedId;
          const honesty =
            d.barProfile === 'cell_relaxed'
              ? `best around here · ${Math.round(d.core.backroadShare * 100)}% backroad`
              : d.sameWayHome
                ? 'same way home — no good second road from here'
                : 'different way home';
          return (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={`Let's go — ${d.name}`}
              onPress={() => goCore(d)}
              onPressIn={() => setSelectedId(d.id)}
              style={({ pressed }) => [
                styles.card,
                { borderColor: selected ? AMBER : colors.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {d.name}
                </Text>
              </View>
              <Text style={styles.cardMeta}>
                {curveWord(d.core.curviness)} · {coreTripLabel(d)}
              </Text>
              <Text style={styles.cardSub}>{honesty}</Text>
              <View style={[styles.cta, { backgroundColor: colors.accent }]}>
                <Text style={[styles.ctaText, { color: colors.onAccent }]}>Let's go</Text>
              </View>
            </Pressable>
          );
        })}
        {drives.map((d) => {
          const selected = d.segmentId === selectedId;
          return (
            <Pressable
              key={d.segmentId}
              accessibilityRole="button"
              accessibilityLabel={`Let's go — ${d.name}`}
              onPress={() => go(d)}
              onPressIn={() => setSelectedId(d.segmentId)}
              style={({ pressed }) => [
                styles.card,
                { borderColor: selected ? AMBER : colors.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {d.name}
                </Text>
                {d.source === 'classic' && (
                  <View style={[styles.badge, { borderColor: AMBER }]}>
                    <Text style={[styles.badgeText, { color: AMBER }]}>Classic</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardMeta}>
                {curveWord(d.curviness)} · {fmtDur(driveDurationS(d))}
              </Text>
              <Text style={styles.cardSub}>
                ~{Math.round(d.driveTimeToStartS / 60)} min to the start
                {d.urbanShare < 0.15 ? ' · quiet & rural' : ''}
              </Text>
              <View style={[styles.cta, { backgroundColor: colors.accent }]}>
                <Text style={[styles.ctaText, { color: colors.onAccent }]}>Let’s go</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <DriveLinesMap
      featureCollection={fc}
      bounds={bounds}
      perLeg={coreDrives.length > 0}
      sourceId="discover-drives"
      onSelectLine={onSelectLine}
      banner={overlay}
      sheet={rail}
    />
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    top: { position: 'absolute', top: 0, left: 0, right: 0, padding: spacing.md },
    topCard: {
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    title: { ...font.title, color: colors.text },
    originButtons: { flexDirection: 'row', gap: spacing.sm },
    smallBtn: {
      minHeight: HIT_TARGET,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    smallBtnText: { ...font.body, color: colors.text },
    note: { ...font.caption, color: colors.textMuted },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    railWrap: { position: 'absolute', left: 0, right: 0, bottom: 44 },
    rail: { paddingHorizontal: spacing.md, gap: spacing.sm },
    card: {
      width: 232,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      gap: spacing.xs,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardName: { ...font.heading, color: colors.text, flex: 1 },
    badge: {
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 1,
    },
    badgeText: { ...font.caption, fontSize: 10, fontWeight: '700' },
    cardMeta: { ...font.body, color: colors.text },
    cardSub: { ...font.caption, color: colors.textMuted },
    cta: {
      marginTop: spacing.xs,
      minHeight: HIT_TARGET - 8,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaText: { ...font.button },
  });
}
