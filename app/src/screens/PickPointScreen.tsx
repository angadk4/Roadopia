/**
 * Map point picker (M7-T03) — crosshair pattern: pan the map, the fixed centre
 * mark is the point; confirm writes it into the Plan draft (origin or
 * destination per route param) and returns. Serves the §18 permission-denied
 * fallback ("drop a pin instead"). The initial camera is a UX default view of
 * the served area only — the authoritative region check stays server-side
 * (§46; out-of-region → the friendly 400 message downstream).
 */

import Mapbox, { Camera, MapView } from '@rnmapbox/maps';
import { useCallback, useRef, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import '../lib/mapbox';
import { usePlanDraft } from '../lib/plan_draft';
import { AMBER, font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

interface PickPointNav {
  goBack: () => void;
}

export interface PickPointScreenProps {
  navigation: PickPointNav;
  route: { params?: { target?: 'origin' | 'destination' } };
}

/** Initial view only (not a region assumption): the current served area. */
const INITIAL_CENTER: [number, number] = [-79.8, 43.6];
const INITIAL_ZOOM = 7.5;

export default function PickPointScreen(props: PickPointScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const { draft, setDraft } = usePlanDraft();
  const target = props.route.params?.target ?? 'origin';

  // Tracked via onCameraChanged — no re-render per frame needed.
  const center = useRef<[number, number]>(
    target === 'origin' && draft.origin
      ? [draft.origin.point.lng, draft.origin.point.lat]
      : target === 'destination' && draft.destination
        ? [draft.destination.lng, draft.destination.lat]
        : INITIAL_CENTER,
  );

  const confirm = useCallback(() => {
    const [lng, lat] = center.current;
    if (target === 'origin') setDraft({ origin: { source: 'pin', point: { lat, lng } } });
    else setDraft({ destination: { lat, lng } });
    props.navigation.goBack();
  }, [target, setDraft, props.navigation]);

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        onCameraChanged={(state) => {
          const c = (state as unknown as { properties?: { center?: number[] } }).properties?.center;
          if (c && c.length >= 2) center.current = [c[0]!, c[1]!];
        }}
      >
        <Camera
          defaultSettings={{ centerCoordinate: center.current, zoomLevel: INITIAL_ZOOM }}
          animationDuration={0}
        />
      </MapView>

      {/* fixed crosshair over the map centre */}
      <View pointerEvents="none" style={styles.crosshairWrap}>
        <View style={[styles.crosshairDot, { borderColor: colors.bg }]} />
        <View style={styles.crosshairStem} />
      </View>

      <View
        style={[
          styles.panel,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Pan the map until the pin sits on your{' '}
          {target === 'origin' ? 'start point' : 'destination'}.
        </Text>
        <View style={styles.panelButtons}>
          <Pressable
            accessibilityRole="button"
            onPress={() => props.navigation.goBack()}
            style={({ pressed }) => [
              styles.cancel,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.cancelLabel, { color: colors.text }]}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={confirm}
            style={({ pressed }) => [
              styles.confirm,
              { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.confirmLabel, { color: colors.onAccent }]}>Use this point</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  crosshairWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: AMBER,
    borderWidth: 3,
    marginBottom: 14, // dot sits above the true centre; stem points at it
  },
  crosshairStem: {
    position: 'absolute',
    top: '50%',
    width: 3,
    height: 12,
    marginTop: -5,
    backgroundColor: AMBER,
  },
  panel: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  hint: { ...font.body },
  panelButtons: { flexDirection: 'row', gap: spacing.sm },
  cancel: {
    flex: 1,
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: { ...font.button },
  confirm: {
    flex: 2,
    minHeight: HIT_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLabel: { ...font.button },
});
