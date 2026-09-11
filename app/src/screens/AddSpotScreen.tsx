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
 */

import Mapbox, { Camera, MapView } from '@rnmapbox/maps';
import { useRef, useState, type ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import '../lib/mapbox';
import { sessionProblem } from '../lib/auth_state';
import { DataError, type SpotRow } from '../lib/data';
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
import { AMBER, font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface AddSpotScreenParams {
  /** Loaded map spots, for the FR-033 client-side proximity nudge. */
  knownSpots?: SpotRow[];
  /** The view the user came from [lng, lat] — opening on a hard-coded city
   *  instead would throw away the road they were looking at. */
  startAt?: [number, number];
}

export interface AddSpotScreenProps {
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

export default function AddSpotScreen(props: AddSpotScreenProps): ReactElement {
  const { name: themeName, colors } = useTheme();
  const { gate, freshAccessToken } = useAuth();
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
        <Text style={[styles.savedText, { color: colors.success }]} accessibilityLabel="Spot saved">
          Spot added ✓
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the map"
          onPress={props.navigation.goBack}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.saveLabel, { color: colors.onAccent }]}>Back to the map</Text>
        </Pressable>
      </View>
    );
  }

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
          }}
        >
          <Camera
            defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: INITIAL_ZOOM }}
            animationDuration={0}
          />
        </MapView>

        {/* crosshair — INSIDE the map container, so it is the map's centre */}
        <View pointerEvents="none" style={styles.crosshairWrap}>
          <View style={[styles.crosshairDot, { borderColor: colors.bg }]} />
        </View>
      </View>

      <ScrollView
        style={[
          styles.panel,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ]}
        contentContainerStyle={styles.panelContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.heading, { color: colors.text }]}>
          Pan the map to pin the spot, then say what it is.
        </Text>
        <View style={styles.typeRow}>
          {SPOT_TYPES.map((t) => {
            const active = t.type === type;
            return (
              <Pressable
                key={t.type}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Type ${t.label}`}
                onPress={() => setType(t.type)}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor: active ? colors.accent : colors.surface,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text style={[styles.typeLabel, { color: active ? colors.onAccent : colors.text }]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          accessibilityLabel="Spot name"
          placeholder="Name (required)"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={(t) => setName(t.slice(0, SPOT_NAME_MAX))}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        />
        <TextInput
          accessibilityLabel="Spot description"
          placeholder="What makes it worth stopping? (optional)"
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={(t) => setDescription(t.slice(0, SPOT_DESC_MAX))}
          maxLength={SPOT_DESC_MAX}
          multiline
          style={[
            styles.input,
            styles.multiline,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        />
        <TextInput
          accessibilityLabel="Spot tags"
          placeholder="Tags, comma-separated (optional)"
          placeholderTextColor={colors.textMuted}
          value={tagsText}
          onChangeText={setTagsText}
          autoCapitalize="none"
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        />
        {state.kind === 'nudge' && (
          <Text style={[styles.nudge, { color: colors.warn }]}>{state.message}</Text>
        )}
        {state.kind === 'problem' && (
          <Text style={[styles.nudge, { color: colors.danger }]}>{state.message}</Text>
        )}
        {state.kind === 'dropped' && (
          <Text style={[styles.nudge, { color: colors.textMuted }]}>
            Not saved — sign in to keep this spot.
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state.kind === 'nudge' ? 'Save anyway' : 'Save spot'}
          disabled={state.kind === 'saving'}
          onPress={onSavePress}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: colors.accent,
              opacity: pressed || state.kind === 'saving' ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.saveLabel, { color: colors.onAccent }]}>
            {state.kind === 'saving'
              ? 'Saving…'
              : state.kind === 'nudge'
                ? 'Save anyway'
                : 'Save spot'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  crosshairWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: AMBER,
    borderWidth: 2,
  },
  panel: { flexGrow: 0, flexShrink: 1, maxHeight: '55%', borderTopWidth: 1 },
  panelContent: { padding: spacing.md, gap: spacing.sm },
  heading: { ...font.body },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeLabel: { ...font.body },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: HIT_TARGET,
    ...font.body,
  },
  multiline: { minHeight: HIT_TARGET * 1.6, textAlignVertical: 'top' },
  nudge: { ...font.caption, lineHeight: 18 },
  saveBtn: {
    minHeight: HIT_TARGET + 4,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: { ...font.button },
  savedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  savedText: { ...font.heading },
});
