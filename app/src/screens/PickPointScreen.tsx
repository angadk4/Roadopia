/**
 * Map point picker (M7-T03) — crosshair pattern: pan the map, the fixed centre
 * mark is the point; confirm writes it into the Plan draft (origin or
 * destination per route param) and returns. Serves the §18 permission-denied
 * fallback ("drop a pin instead"). The initial camera is a UX default view of
 * the served area only — the authoritative region check stays server-side
 * (§46; out-of-region → the friendly 400 message downstream).
 *
 * REDESIGN (SPEC "PickPoint"). A MODAL CARD now — a self-contained task the
 * user can abandon (expo-animation RECIPES screen-transitions: "A self-
 * contained task the user can abandon → presentation: 'modal'") — with the
 * card's compact header naming which point it is asking for ("Start point" /
 * "Destination", `pickPointTitle` → `nav/PlanStack`) and Cancel where iOS
 * puts it: the header's left. The in-panel Cancel is gone; this screen only
 * ever goes back (the presentation invariant). What it does is unchanged:
 * pan, confirm, the draft gets the point.
 *
 *   - THE MARK is exactly as it was: every element anchored to the map
 *     centre, the stem's TIP on the coordinate `confirm()` saves (the BD-204
 *     truth fix — `marginTop === -height`), the dark casing that keeps the
 *     amber legible on the light Mapbox style. Its lift while the map moves is
 *     a Reanimated shared value now, gated ONCE per gesture from
 *     `onCameraChanged` (never per frame): `withTiming(1, pressIn)` up,
 *     `withTiming(0, pressOut)` once the camera has settled; transform +
 *     opacity only, on the UI thread. Reduce Motion: no lift, no spread — the
 *     casing's 1 → 0.7 opacity remains the cue (fewer and gentler, not zero).
 *   - THE CONFIRM BAR is a Material (blur + paper tint) pinned to the bottom,
 *     padded by the home-indicator inset: the instruction, verbatim, and the
 *     one filled amber. Mapbox's logo and attribution ride above it (FR-014),
 *     by the bar's MEASURED height.
 *   - THE LOCATE PILL (`location.fill`, "Centre on my location") eases the
 *     camera to `getKnownLocation()` — the no-prompt check — and NEVER asks
 *     for permission: the in-context ask stays on the form's "Use my
 *     location". It renders only once a known location has resolved, so a
 *     control that could do nothing is never drawn (§18: no dead ends). It
 *     sits bottom-right above the measured bar — a placement relative to an
 *     edge this screen measures, rather than to a header height it cannot
 *     read (the header-height hook lives in a package the app does not
 *     declare), and where the thumb already is.
 *   - HAPTIC: one `impactAsync(Light)` on Use this point, the frame the card
 *     dismisses (expo-animation §8: "a drag commits → Light"; one per user
 *     action, never the only feedback — the dismiss is the visual).
 */

import Mapbox, { Camera, MapView } from '@rnmapbox/maps';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  Button,
  EASE_OUT,
  Material,
  PressableScale,
  Symbol,
  Text,
  useReducedMotion,
} from '../components/ui';
import { useBottomInset } from '../lib/insets';
import { getKnownLocation, type LocationResult } from '../lib/location';
import '../lib/mapbox';
import { usePlanDraft } from '../lib/plan_draft';
import { AMBER, motion, spacing, useTheme } from '../theme';

export type PickPointTarget = 'origin' | 'destination';

interface PickPointNav {
  goBack: () => void;
}

export interface PickPointScreenProps {
  navigation: PickPointNav;
  route: { params?: { target?: PickPointTarget } };
  /** Injectable for tests; defaults to the NO-PROMPT check (`getKnownLocation`). */
  knownLocation?: () => Promise<LocationResult>;
}

/** The modal card's title, by the point it asks for. Drawn by the native
 *  header (`PlanStack` → `modalTaskOptions`), never by this screen. */
export function pickPointTitle(target: PickPointTarget | undefined): string {
  return target === 'destination' ? 'Destination' : 'Start point';
}

/** Initial view only (not a region assumption): the current served area. */
const INITIAL_CENTER: [number, number] = [-79.8, 43.6];
/** No point chosen yet → the whole served area, because orientation is the
 *  problem to solve first. */
const REGION_ZOOM = 7.5;
/** A point IS already set → open where it can actually be adjusted. At region
 *  zoom a single pixel covers hundreds of metres, so "pan until the pin sits on
 *  your start point" promised a precision the camera could not give. */
const PLACED_ZOOM = 14;
/** The locate pill's camera travel — the same ease the home map uses. */
const CAMERA_EASE_MS = 650;

/** The mark, in pt. The stem's tip is the saved coordinate; every other number
 *  is derived from these two so the relationship cannot drift again. */
const DOT = 18;
const DOT_CASING = 28;
const STEM_H = 14;
const STEM_W = 3;
const STEM_CASING_W = 7;
/** How far the head lifts off its halo while the map is moving. */
const PIN_LIFT = 4;
/** The halo spreads and softens under the lifted head. The opacity is the
 *  cue that survives Reduce Motion. */
const CASING_SPREAD = 1.18;
const CASING_LIFTED_OPACITY = 0.7;
/** Camera-idle debounce: `onCameraChanged` fires continuously, so the mark
 *  settles only once the movement has actually stopped. */
const SETTLE_MS = 160;

/** Mapbox's logo is ~90pt wide; the attribution "i" sits past it (the same
 *  clearance DriveLinesMap uses). Map chrome, not a theme token. */
const ATTRIBUTION_LEFT = 100;

export default function PickPointScreen(props: PickPointScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const bottomInset = useBottomInset();
  const { draft, setDraft } = usePlanDraft();
  const target: PickPointTarget = props.route.params?.target ?? 'origin';
  const knownLocation = props.knownLocation ?? getKnownLocation;
  const reduced = useReducedMotion();

  const placed = target === 'origin' ? (draft.origin?.point ?? null) : (draft.destination ?? null);

  // Tracked via onCameraChanged — no re-render per frame needed.
  const center = useRef<[number, number]>(placed ? [placed.lng, placed.lat] : INITIAL_CENTER);
  const cameraRef = useRef<Camera>(null);

  /** The confirm bar's measured height: the attribution and the locate pill
   *  sit above it by exactly this. 0 until the first layout. */
  const [barH, setBarH] = useState(0);

  /** Where the device already is — resolved WITHOUT a prompt. The pill exists
   *  only once this is known. */
  const [known, setKnown] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let live = true;
    knownLocation()
      .then((res) => {
        if (live && res.status === 'ok') setKnown(res.point);
      })
      .catch(() => undefined); // never prompts, never blocks the pick
    return () => {
      live = false;
    };
  }, [knownLocation]);

  /** 0 = settled, 1 = the map is moving. A shared value driven from the
   *  camera handler ONCE per gesture — a re-render per camera frame is what
   *  makes panning stutter, and so is an animation restarted per frame. */
  const pan = useSharedValue(0);
  const moving = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const onCameraChanged = useCallback(
    (state: unknown): void => {
      const c = (state as { properties?: { center?: number[] } }).properties?.center;
      if (c && c.length >= 2) center.current = [c[0]!, c[1]!];
      if (!moving.current) {
        moving.current = true;
        pan.set(withTiming(1, { duration: motion.pressIn, easing: EASE_OUT }));
      }
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(() => {
        moving.current = false;
        pan.set(withTiming(0, { duration: motion.pressOut, easing: EASE_OUT }));
      }, SETTLE_MS);
    },
    [pan],
  );

  // The head rises and its halo spreads and softens beneath it — the physical
  // metaphor is that you are holding the pin while you pan and placing it when
  // you stop. Transform + opacity only, so it all stays on the UI thread.
  const headStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reduced ? 0 : -PIN_LIFT * pan.get() }],
  }));
  const casingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pan.get(), [0, 1], [1, CASING_LIFTED_OPACITY]),
    transform: [{ scale: reduced ? 1 : interpolate(pan.get(), [0, 1], [1, CASING_SPREAD]) }],
  }));

  const centreOnMe = useCallback(() => {
    // Re-check for a fresher fix, still without a prompt; fall back to the
    // point that made the pill appear.
    knownLocation()
      .then((res) => {
        const at = res.status === 'ok' ? res.point : known;
        if (!at) return;
        cameraRef.current?.setCamera({
          centerCoordinate: [at.lng, at.lat],
          zoomLevel: PLACED_ZOOM,
          animationMode: reduced ? 'moveTo' : 'easeTo',
          animationDuration: reduced ? 0 : CAMERA_EASE_MS,
        });
      })
      .catch(() => undefined);
  }, [knownLocation, known, reduced]);

  const confirm = useCallback(() => {
    const [lng, lat] = center.current;
    if (target === 'origin') setDraft({ origin: { source: 'pin', point: { lat, lng } } });
    else setDraft({ destination: { lat, lng } });
    // The commit — same frame as the card dismissing, never the only feedback.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    props.navigation.goBack();
  }, [target, setDraft, props.navigation]);

  const what = target === 'origin' ? 'start point' : 'destination';

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        styleURL={themeName === 'dark' ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Light}
        scaleBarEnabled={false}
        // FR-014: the logo and attribution clear the confirm bar by its
        // measured height.
        logoPosition={{ bottom: barH + spacing.sm, left: spacing.sm }}
        attributionPosition={{ bottom: barH + spacing.sm, left: ATTRIBUTION_LEFT }}
        onCameraChanged={onCameraChanged}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: center.current,
            zoomLevel: placed ? PLACED_ZOOM : REGION_ZOOM,
          }}
          animationDuration={0}
        />
      </MapView>

      {/* The mark. Every element is anchored to the map centre, and the stem's
          TIP is that centre — the coordinate confirm() saves. The dark halo is
          DriveLinesMap's casing technique (§663): `scrim` is the one token that
          is a dark translucent ink in BOTH palettes, which is what the amber
          needs behind it on the light map style. */}
      <View pointerEvents="none" style={styles.crosshairWrap}>
        <View style={[styles.stemCasing, { backgroundColor: colors.scrim }]} />
        <View style={[styles.stem, { backgroundColor: AMBER }]} />
        <Animated.View style={[styles.dotCasing, { backgroundColor: colors.scrim }, casingStyle]} />
        <Animated.View style={[styles.dot, { borderColor: colors.bg }, headStyle]} />
      </View>

      {/* The locate pill — only once the device's location is known. */}
      {known !== null && (
        <View style={[styles.locateWrap, { bottom: barH + spacing.md }]}>
          <PressableScale
            accessibilityLabel="Centre on my location"
            onPress={centreOnMe}
            // a 44pt visual needs no slop (expo-animation §7)
            hitSlop={0}
          >
            <Material role="pill">
              <Symbol name="locationFill" size="lg" tone="accent" />
            </Material>
          </PressableScale>
        </View>
      )}

      {/* The confirm bar: the instruction, verbatim, and the one filled amber.
          The header owns Cancel. */}
      <View
        style={styles.barWrap}
        onLayout={(e: LayoutChangeEvent) => setBarH(e.nativeEvent.layout.height)}
      >
        <Material
          role="bar"
          testID="pick-point-bar"
          style={[styles.bar, { paddingBottom: bottomInset + spacing.md }]}
        >
          <Text variant="body">{`Pan the map until the pin sits on your ${what}.`}</Text>
          <Button
            title="Use this point"
            accessibilityLabel={`Use this point as your ${what}`}
            variant="primary"
            block
            onPress={confirm}
          />
        </Material>
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
  },
  // tip exactly on the map centre: top 50% minus the stem's own height
  stem: {
    position: 'absolute',
    top: '50%',
    marginTop: -STEM_H,
    width: STEM_W,
    height: STEM_H,
  },
  stemCasing: {
    position: 'absolute',
    top: '50%',
    marginTop: -STEM_H,
    width: STEM_CASING_W,
    height: STEM_H,
    borderRadius: STEM_CASING_W / 2,
  },
  // the head's bottom edge IS the stem's top edge — no tuned gap
  dot: {
    position: 'absolute',
    top: '50%',
    marginTop: -(STEM_H + DOT),
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 3,
    backgroundColor: AMBER,
  },
  dotCasing: {
    position: 'absolute',
    top: '50%',
    marginTop: -(STEM_H + DOT + (DOT_CASING - DOT) / 2),
    width: DOT_CASING,
    height: DOT_CASING,
    borderRadius: DOT_CASING / 2,
  },
  locateWrap: { position: 'absolute', right: spacing.gutter },
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
});
