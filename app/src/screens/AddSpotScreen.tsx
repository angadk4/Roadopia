/**
 * Add a car spot (M10-T01/T03; FR-030/031/033). Crosshair pattern (PickPoint
 * precedent): pan the map, the centre IS the pin. Type + name required; the
 * save is a gated action (FR-201) through the 0027 RPC (owner + source
 * forced server-side).
 *
 * FR-033: saving near an existing SAME-type spot warns first — "there's
 * already one N m away" — and a second press saves anyway. A nudge, never a
 * block: parallel viewpoints on one ridge are real.
 *
 * Device pass (2026-09-04): the crosshair now lives INSIDE the map container
 * and the pin is resolved from the map at press time (the old '55 %'
 * crosshair and '45 %' panel only lined up when the panel was exactly at its
 * cap — a 5 % mismatch at zoom 13 is ~290 m, more than the whole nudge
 * radius); the form rides above the keyboard, so Save is never hidden behind
 * it; a dismissed sign-in sheet says the spot was not saved.
 *
 * Redesign (SPEC "AddSpot"). A MODAL CARD — "New spot", Cancel where iOS puts
 * it (the header's left; the stack registers `modalTaskOptions`) — so the
 * in-page Cancel is gone. The map bleeds under the transparent header; the
 * form sits on a `Material` panel over it, its footer pinned on an opaque
 * `surface` tier so a nudge or a problem grows the panel UPWARD and Save
 * never moves out from under the thumb reaching for it (FR-033's second press
 * is meant to be deliberate — a correctness fix, not a polish one).
 *
 * The seven type chips stay chips (SPEC rule 8): each option's colour IS the
 * map legend, and a native picker cannot carry a swatch per row — so every
 * chip leads with its `spotColor` swatch. The reticle is unchanged (its dark
 * casing literal stays: it sits on tiles, not on the app ground) and lifts on
 * a Reanimated shared value while the camera moves. The payoff is the
 * system's own bouncing checkmark, "Spot added" in `display`.
 *
 * Haptics (SPEC policy): `notificationAsync(Success)` on `saved`, `Error` on
 * `problem`; nothing on the nudge — a question, not an outcome.
 */

import Mapbox, { Camera, MapView } from '@rnmapbox/maps';
import { NotificationFeedbackType, notificationAsync } from 'expo-haptics';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import '../lib/mapbox';
import {
  Button,
  Chapter,
  EASE_OUT,
  ENTER_FADE,
  Material,
  PressableScale,
  REFLOW,
  SWATCH_SIZE,
  Symbol,
  Text,
  useReducedMotion,
} from '../components/ui';
import { sessionProblem } from '../lib/auth_state';
import { DataError, type SpotRow } from '../lib/data';
import { useBottomInset } from '../lib/insets';
import { getSupabaseConfig } from '../lib/runtime';
import {
  createSpot,
  nearestSameType,
  parseTags,
  SPOT_DESC_MAX,
  SPOT_NAME_MAX,
  SPOT_TYPES,
  validateSpotDraft,
} from '../lib/spots';
import { useAuth } from '../lib/use_auth';
import {
  AMBER,
  font,
  HIT_TARGET,
  motion,
  radius,
  spacing,
  spotColor,
  squircle,
  useTheme,
} from '../theme';

export interface AddSpotScreenParams {
  /** Loaded map spots, for the FR-033 client-side proximity nudge. */
  knownSpots?: SpotRow[];
  /** The view the user came from [lng, lat] — opening on a hard-coded city
   *  instead would throw away the road they were looking at. */
  startAt?: [number, number];
}

export interface AddSpotScreenProps {
  /** A modal card only ever goes back (SPEC "The presentation invariant"). */
  navigation: { goBack: () => void };
  route: { params?: AddSpotScreenParams };
  /** Injectable for tests. */
  cfg?: { url: string; anonKey: string };
  createFn?: typeof createSpot;
}

const FALLBACK_CENTER: [number, number] = [-79.8, 43.6];
/** Close enough that the 150 m nudge radius is a visible distance, not a
 *  sub-pixel one (at zoom 9 the whole nudge radius is under a pixel). */
const INITIAL_ZOOM = 13;

/**
 * The reticle, outside-in. The three rings are flush by construction
 * (36 − 2×1.5 = 33; 33 − 2×3 = 27), which is what makes the amber read as a
 * cased line rather than as a ring with a gap around it — the same
 * dark-under-amber treatment the route line uses, so the pin is legible on the
 * dark AND the light Mapbox style. The centre stays transparent: a filled disc
 * hides the exact road you are pinning.
 */
const RETICLE = { casing: 36, ring: 33, core: 5 } as const;
/** The dark casing. Deliberately a literal, not a theme token: it must stay
 *  dark on BOTH themes because it sits on map tiles, not on the app ground. */
const RETICLE_CASING = 'rgba(12,11,9,0.6)';
/** The lift while the camera moves: a short rise and a small swell,
 *  transform only (expo-animation §4). */
const LIFT_Y = 5;
const LIFT_SCALE = 0.12;

type SaveState =
  | { kind: 'idle' }
  /** `about` records exactly WHAT was acknowledged. Re-checking against it is
   *  what stops a warning about a coffee spot from silently licensing a
   *  viewpoint saved 40 km away. */
  | { kind: 'nudge'; message: string; about: { type: string; lat: number; lng: number } }
  | { kind: 'saving' }
  | { kind: 'saved' }
  /** The sign-in sheet was dismissed with this save parked — nothing saved. */
  | { kind: 'dropped' }
  | { kind: 'problem'; message: string };

interface Draft {
  lat: number;
  lng: number;
  type: string;
  name: string;
  description: string;
  tags: string[];
}

/** Did the user move or re-type since acknowledging the nudge? */
function nudgeStillApplies(
  about: { type: string; lat: number; lng: number },
  draft: { type: string; lat: number; lng: number },
): boolean {
  return (
    about.type === draft.type &&
    Math.abs(about.lat - draft.lat) < 0.0005 && // ~55 m
    Math.abs(about.lng - draft.lng) < 0.0007
  );
}

/**
 * One of the seven types: a capsule chip led by the type's own map colour.
 * Chips, not a picker (SPEC rule 8): the swatch is the legend, and a menu
 * cannot carry one per row. The announced name carries the group's noun —
 * "Type Viewpoint", not "Viewpoint" — and the role is radio, so VoiceOver says
 * the others deselect.
 */
function TypeChip(props: {
  label: string;
  color: string;
  selected: boolean;
  onPress: () => void;
}): ReactElement {
  const { colors } = useTheme();
  const { label, color, selected, onPress } = props;
  return (
    <View>
      <PressableScale
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
        accessibilityLabel={`Type ${label}`}
        onPress={onPress}
        hitSlop={0}
        style={[
          styles.typeChip,
          {
            backgroundColor: selected ? colors.accent : colors.fill,
            borderColor: selected ? colors.accent : colors.borderStrong,
          },
        ]}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[
            styles.swatch,
            // On the amber fill a great-road swatch IS amber: the on-accent
            // ring is what keeps it a dot rather than nothing.
            { backgroundColor: color, borderColor: selected ? colors.onAccent : 'transparent' },
          ]}
        />
        <Text variant="label" tone={selected ? 'onAccent' : 'default'} numberOfLines={1}>
          {label}
        </Text>
      </PressableScale>
    </View>
  );
}

/** The payoff: the system's own bouncing checkmark (expo-native-ui icons.md
 *  "Animated Symbols — bounce"; rare tier, delight) and the one `display`
 *  role this screen ever uses. */
function SavedConfirmation({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <View style={styles.block}>
      <Symbol
        name="checkmarkCircleFill"
        size={HIT_TARGET}
        tone="success"
        animationSpec={{ effect: { type: 'bounce', direction: 'up' } }}
      />
      <Text variant="display" tone="success" accessibilityLabel="Spot saved">
        Spot added
      </Text>
      <Button
        title="Back to the map"
        accessibilityLabel="Back to the map"
        onPress={onBack}
        size="lg"
        block
      />
    </View>
  );
}

export default function AddSpotScreen(props: AddSpotScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const { gate, freshAccessToken } = useAuth();
  const { height } = useWindowDimensions();
  const bottomInset = useBottomInset();
  const reduced = useReducedMotion();
  const cfg = props.cfg ?? getSupabaseConfig();
  const create = props.createFn ?? createSpot;
  const knownSpots = props.route.params?.knownSpots ?? [];

  const initialCenter = props.route.params?.startAt ?? FALLBACK_CENTER;
  const mapRef = useRef<MapView>(null);
  const size = useRef<{ w: number; h: number } | null>(null);
  /** Camera centre from the last camera event — the fallback when the map
   *  cannot answer yet. */
  const cameraCentre = useRef<[number, number]>(initialCenter);
  const [type, setType] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  /** The reticle lifts while the camera moves and settles when it stops — the
   *  map-pin metaphor every iPhone user already knows. A shared value driven
   *  from the camera handler, transform only, no overshoot (nothing pushed
   *  it); under Reduce Motion it does not lift at all. */
  const lift = useSharedValue(0);
  const lifted = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -LIFT_Y * lift.get() }, { scale: 1 + LIFT_SCALE * lift.get() }],
  }));

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );

  // One haptic per outcome, the frame its message lands (expo-animation §8).
  // The nudge is a question, not an outcome — nothing plays for it.
  useEffect(() => {
    if (state.kind === 'saved') void notificationAsync(NotificationFeedbackType.Success);
    else if (state.kind === 'problem') void notificationAsync(NotificationFeedbackType.Error);
  }, [state]);

  const onCameraMoved = (): void => {
    // Camera events arrive every frame of a pan, so the lift starts ONCE per
    // gesture; only the settle timer is pushed back on each event.
    if (!lifted.current) {
      lifted.current = true;
      if (!reduced) lift.set(withTiming(1, { duration: motion.pressIn, easing: EASE_OUT }));
    }
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      lifted.current = false;
      lift.set(withTiming(0, { duration: motion.pressOut, easing: EASE_OUT }));
    }, motion.pressOut);
  };

  /** The pin: asked of the map at press time, else the last camera centre. */
  const resolvePin = async (): Promise<{ lat: number; lng: number }> => {
    const m = mapRef.current;
    const s = size.current;
    if (m && s) {
      try {
        const [lng, lat] = await m.getCoordinateFromView([s.w / 2, s.h / 2]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
      } catch {
        // fall through
      }
    }
    return { lat: cameraCentre.current[1], lng: cameraCentre.current[0] };
  };

  const draftOf = async (): Promise<Draft> => {
    const pin = await resolvePin();
    return {
      lat: pin.lat,
      lng: pin.lng,
      type: type ?? '',
      name,
      description,
      tags: parseTags(tagsText),
    };
  };

  const acknowledgedRef = useRef<{ type: string; lat: number; lng: number } | null>(null);

  const onDismiss = (): void => setState({ kind: 'dropped' });

  const doSave = (draft: Draft): void => {
    setState({ kind: 'saving' });
    void (async () => {
      let token: string | null;
      try {
        token = await freshAccessToken();
      } catch (err) {
        // a transient refresh failure: still signed in, say so, retry is a tap
        setState({ kind: 'problem', message: sessionProblem(err) });
        return;
      }
      if (!token) {
        // session lapsed between the tap and the save — re-gate the SAME save
        setState({ kind: 'idle' });
        gate(() => doSave(draft), { onDismiss });
        return;
      }
      try {
        await create(cfg, token, draft);
        setState({ kind: 'saved' });
      } catch (err) {
        setState({
          kind: 'problem',
          message: err instanceof DataError ? err.message : 'Could not save the spot.',
        });
        // the duplicate was already acknowledged — a network blip must not make
        // the user argue with the same warning again
        acknowledgedRef.current = { type: draft.type, lat: draft.lat, lng: draft.lng };
      }
    })();
  };

  /** Re-entry guard: resolving the pin is async, so without this a double
   *  tap (or one tap during a slow map round-trip) reached create() twice
   *  before `saving` could disable the button — two identical spot rows
   *  (review finding). */
  const pressing = useRef(false);

  const onSavePress = (): void => {
    if (pressing.current) return;
    pressing.current = true;
    void (async () => {
      try {
        await onSave();
      } finally {
        pressing.current = false;
      }
    })();
  };

  const onSave = async (): Promise<void> => {
    {
      const draft = await draftOf();
      const invalid = validateSpotDraft(draft);
      if (invalid !== null) {
        setState({ kind: 'problem', message: invalid });
        return;
      }
      // FR-033: warn once about a very close same-type spot; a second press on
      // the SAME pin and type saves anyway. Changing either re-arms the check.
      const acknowledged =
        (state.kind === 'nudge' && nudgeStillApplies(state.about, draft)) ||
        (acknowledgedRef.current !== null && nudgeStillApplies(acknowledgedRef.current, draft));
      if (!acknowledged) {
        const near = nearestSameType(knownSpots, draft, draft.type);
        if (near !== null) {
          setState({
            kind: 'nudge',
            about: { type: draft.type, lat: draft.lat, lng: draft.lng },
            message: `There's already a ${draft.type.replace('_', ' ')} spot ${Math.round(near.distanceM)} m away — “${near.name}”. Save yours anyway?`,
          });
          return;
        }
      }
      gate(() => doSave(draft), { onDismiss });
    }
  };

  if (state.kind === 'saved') {
    return (
      <View style={[styles.savedWrap, { backgroundColor: colors.bg }]}>
        <SavedConfirmation onBack={props.navigation.goBack} />
      </View>
    );
  }

  const inputStyle = [
    styles.input,
    { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.fill },
  ];
  /** A deliberate panel height rather than a percentage: '55%' was 464pt on an
   *  iPhone 14 and 526pt on a 16 Pro Max, neither of them chosen. */
  const panelMax = Math.min(460, Math.round(height * 0.56));

  return (
    <KeyboardAvoidingView
      style={styles.root}
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
          onCameraChanged={(s) => {
            const c = (s as unknown as { properties?: { center?: number[] } }).properties?.center;
            if (c && c.length >= 2) cameraCentre.current = [c[0]!, c[1]!];
            onCameraMoved();
          }}
        >
          <Camera
            defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: INITIAL_ZOOM }}
            animationDuration={0}
          />
        </MapView>

        {/* reticle — INSIDE the map container, so it is the map's centre */}
        <View pointerEvents="none" style={styles.crosshairWrap}>
          <Animated.View style={liftStyle}>
            <View style={styles.reticleCasing}>
              <View style={styles.reticleRing}>
                <View style={styles.reticleCore} />
              </View>
            </View>
          </Animated.View>
        </View>
      </View>

      {/* The form, on a material over the map; everything inside it that
          carries ink sits on an opaque tier (chips and inputs on `fill`, the
          footer on `surface`). */}
      <Material
        role="panel"
        style={[styles.panel, { maxHeight: panelMax, marginBottom: bottomInset + spacing.sm }]}
      >
        <ScrollView contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
          <Chapter title="What is it" style={styles.firstChapter}>
            <Text variant="footnote" tone="muted">
              Pan the map to pin the spot, then say what it is.
            </Text>
            <View style={styles.typeRow}>
              {SPOT_TYPES.map((t) => (
                <TypeChip
                  key={t.type}
                  label={t.label}
                  color={spotColor(t.type)}
                  selected={t.type === type}
                  onPress={() => setType(t.type)}
                />
              ))}
            </View>
          </Chapter>
          <Chapter title="Name it" style={styles.chapter}>
            <TextInput
              accessibilityLabel="Spot name"
              placeholder="Name (required)"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={(t) => setName(t.slice(0, SPOT_NAME_MAX))}
              style={inputStyle}
            />
            <TextInput
              accessibilityLabel="Spot description"
              placeholder="What makes it worth stopping? (optional)"
              placeholderTextColor={colors.textMuted}
              value={description}
              onChangeText={(t) => setDescription(t.slice(0, SPOT_DESC_MAX))}
              maxLength={SPOT_DESC_MAX}
              multiline
              style={[...inputStyle, styles.multiline]}
            />
            <TextInput
              accessibilityLabel="Spot tags"
              placeholder="Tags, comma-separated (optional)"
              placeholderTextColor={colors.textMuted}
              value={tagsText}
              onChangeText={setTagsText}
              autoCapitalize="none"
              style={inputStyle}
            />
          </Chapter>
        </ScrollView>

        {/* Pinned, opaque: a message grows the panel UPWARD, so the CTA never
            moves out from under a thumb already reaching for it (FR-033's
            second press is meant to be deliberate). */}
        <Animated.View
          layout={REFLOW}
          style={[
            styles.panelFooter,
            { backgroundColor: colors.surface, borderTopColor: colors.hairline },
          ]}
        >
          {state.kind === 'nudge' && (
            <Animated.View key="nudge" entering={ENTER_FADE} style={styles.messageRow}>
              <Symbol name="exclamationmarkTriangleFill" size="md" tone="notice" />
              <Text variant="footnote" tone="notice" style={styles.flex}>
                {state.message}
              </Text>
            </Animated.View>
          )}
          {state.kind === 'problem' && (
            <Animated.View key="problem" entering={ENTER_FADE} style={styles.messageRow}>
              <Symbol name="xmarkCircleFill" size="md" tone="danger" />
              <Text variant="footnote" tone="danger" style={styles.flex}>
                {state.message}
              </Text>
            </Animated.View>
          )}
          {state.kind === 'dropped' && (
            <Animated.View key="dropped" entering={ENTER_FADE}>
              <Text variant="footnote" tone="muted">
                Not saved — sign in to keep this spot.
              </Text>
            </Animated.View>
          )}
          <Button
            title={
              state.kind === 'saving'
                ? 'Saving…'
                : state.kind === 'nudge'
                  ? 'Save anyway'
                  : 'Save spot'
            }
            accessibilityLabel={state.kind === 'nudge' ? 'Save anyway' : 'Save spot'}
            size="lg"
            block
            disabled={state.kind === 'saving'}
            onPress={onSavePress}
          />
        </Animated.View>
      </Material>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /** A floor under the map: with the keyboard up the panel used to squeeze the
   *  reticle — the entire point of the screen — towards nothing. */
  mapWrap: { flex: 1, minHeight: 220 },
  map: { flex: 1 },
  crosshairWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleCasing: {
    width: RETICLE.casing,
    height: RETICLE.casing,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: RETICLE_CASING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleRing: {
    width: RETICLE.ring,
    height: RETICLE.ring,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: AMBER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleCore: {
    width: RETICLE.core,
    height: RETICLE.core,
    borderRadius: radius.pill,
    backgroundColor: AMBER,
  },
  /** Floats over the map with a small margin, so every corner of the panel
   *  role reads; shrinks with the keyboard, never below the map's floor. */
  panel: {
    flexGrow: 0,
    flexShrink: 1,
    marginHorizontal: spacing.sm,
  },
  panelContent: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  firstChapter: { marginTop: 0 },
  chapter: { marginTop: spacing.lg },
  panelFooter: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: {
    minHeight: HIT_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: SWATCH_SIZE / 2,
    borderWidth: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: HIT_TARGET,
    ...font.body,
    ...squircle,
  },
  multiline: { minHeight: HIT_TARGET * 2, textAlignVertical: 'top' },
  savedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.gutter,
  },
  block: { alignSelf: 'stretch', maxWidth: 480, gap: spacing.lg },
});
