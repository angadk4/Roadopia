/**
 * Plan screen (M7-T03; FR-040, §15, §27.4).
 *
 * Inputs: free-text brief (≤ MAX_BRIEF_CHARS) · origin (current location
 * DEFAULT — BD-27 — or a dropped pin; place names belong in the brief, the
 * gazetteer resolves them server-side) · shape (loop | A→B + destination) ·
 * ONE preset chip (BD-30: presets only, no sliders — Hard rule L).
 *
 * §18 states handled here: location-permission-denied → rationale + "drop a
 * pin instead"; location errors → same fallback. Out-of-region briefs are the
 * SERVER's call (400 out_of_region rendered friendly on the progress screen —
 * the region polygon never ships client-side, §46).
 *
 * Submit → the generation-progress screen with a validated PlanRequest
 * (serializable route param). The M7 UI bar applies: real buttons, ≥44 pt,
 * deliberate contrast.
 */

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import PresetChips from '../components/PresetChips';
import { MAX_BRIEF_CHARS } from '../lib/api';
import { getCurrentLocation, type LocationResult } from '../lib/location';
import { buildPlanRequest, usePlanDraft } from '../lib/plan_draft';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

type LocationState = 'idle' | 'fetching' | 'denied' | 'error';

interface PlanScreenNav {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
}

export interface PlanScreenProps {
  navigation: PlanScreenNav;
  /** Injectable for tests; defaults to the expo-location wrapper. */
  locate?: () => Promise<LocationResult>;
}

function fmt(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`;
}

export default function PlanScreen(props: PlanScreenProps): ReactElement {
  const { colors } = useTheme();
  const { draft, setDraft } = usePlanDraft();
  const [locState, setLocState] = useState<LocationState>('idle');
  const locate = props.locate ?? getCurrentLocation;

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

  const build = useMemo(() => buildPlanRequest(draft), [draft]);

  const submit = useCallback(() => {
    if (build.ok) props.navigation.navigate('Progress', { request: build.request });
  }, [build, props.navigation]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: colors.text }]}>Plan a drive</Text>

      {/* brief */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>What kind of drive?</Text>
        <TextInput
          multiline
          value={draft.brief}
          onChangeText={(t) => setDraft({ brief: t.slice(0, MAX_BRIEF_CHARS) })}
          placeholder="e.g. a 90 minute twisty loop on quiet backroads with a coffee stop"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.brief,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          ]}
          accessibilityLabel="Describe the drive you want"
        />
        <Text style={[styles.counter, { color: colors.textMuted }]}>
          {draft.brief.length}/{MAX_BRIEF_CHARS}
        </Text>
      </View>

      {/* origin */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Start from</Text>
        {draft.origin ? (
          <View
            style={[
              styles.valueRow,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <Text style={[styles.value, { color: colors.text }]}>
              {draft.origin.source === 'current' ? 'Current location' : 'Dropped pin'} ·{' '}
              {fmt(draft.origin.point)}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDraft({ origin: null })}
              style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.clearLabel, { color: colors.textMuted }]}>Clear</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              onPress={useMyLocation}
              disabled={locState === 'fetching'}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: colors.accent,
                  opacity: pressed || locState === 'fetching' ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryLabel, { color: colors.accent }]}>
                {locState === 'fetching' ? 'Locating…' : 'Use my location'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => props.navigation.navigate('PickPoint', { target: 'origin' })}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.secondaryLabel, { color: colors.accent }]}>Pick on map</Text>
            </Pressable>
          </View>
        )}
        {locState === 'denied' && (
          <Text style={[styles.note, { color: colors.warn }]}>
            Location permission is off — you can drop a pin instead.
          </Text>
        )}
        {locState === 'error' && (
          <Text style={[styles.note, { color: colors.warn }]}>
            Couldn't get a fix — try again or drop a pin instead.
          </Text>
        )}
      </View>

      {/* shape */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Shape</Text>
        <View style={styles.buttonRow}>
          {(['loop', 'a_to_b'] as const).map((s) => {
            const active = draft.shape === s;
            return (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setDraft({ shape: s })}
                style={({ pressed }) => [
                  styles.shapeChip,
                  {
                    backgroundColor: active ? colors.accent : colors.surface,
                    borderColor: active ? colors.accent : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.secondaryLabel, { color: active ? colors.onAccent : colors.text }]}
                >
                  {s === 'loop' ? 'Loop' : 'A → B'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {draft.shape === 'a_to_b' && (
          <View style={styles.destRow}>
            {draft.destination ? (
              <View
                style={[
                  styles.valueRow,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              >
                <Text style={[styles.value, { color: colors.text }]}>
                  Destination · {fmt(draft.destination)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDraft({ destination: null })}
                  style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[styles.clearLabel, { color: colors.textMuted }]}>Clear</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => props.navigation.navigate('PickPoint', { target: 'destination' })}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.secondaryLabel, { color: colors.accent }]}>
                  Pick a destination on the map
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* presets — BD-30: presets only */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Character (optional)</Text>
        <PresetChips value={draft.preset} onChange={(preset) => setDraft({ preset })} />
      </View>

      {/* submit */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !build.ok }}
        onPress={submit}
        disabled={!build.ok}
        style={({ pressed }) => [
          styles.cta,
          {
            backgroundColor: build.ok ? colors.accent : colors.surface,
            borderColor: colors.border,
            borderWidth: build.ok ? 0 : 1,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={[styles.ctaLabel, { color: build.ok ? colors.onAccent : colors.textMuted }]}>
          Plan my drive
        </Text>
      </Pressable>
      {!build.ok && (
        <Text style={[styles.note, { color: colors.textMuted }]}>{build.problems.join(' ')}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xxl },
  title: { ...font.title },
  section: { gap: spacing.sm },
  label: { ...font.heading },
  brief: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    ...font.body,
    textAlignVertical: 'top',
  },
  counter: { ...font.caption, alignSelf: 'flex-end' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  secondaryButton: {
    minHeight: HIT_TARGET,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: { ...font.button, fontSize: 15 },
  shapeChip: {
    minHeight: HIT_TARGET,
    minWidth: 96,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueRow: {
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  value: { ...font.body, flex: 1 },
  clear: { minHeight: HIT_TARGET, justifyContent: 'center', paddingHorizontal: spacing.sm },
  clearLabel: { ...font.button, fontSize: 14 },
  destRow: { marginTop: spacing.xs },
  note: { ...font.body, fontSize: 13 },
  cta: {
    minHeight: HIT_TARGET + 8,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { ...font.button, fontSize: 17 },
});
