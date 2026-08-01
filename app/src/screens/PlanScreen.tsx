/**
 * Plan screen (M7-T03, sections restructured R16-5; FR-040, §15, §27.4).
 *
 * Inputs: free-text brief (≤ MAX_BRIEF_CHARS) · origin (current location
 * DEFAULT — BD-27 — or a dropped pin; place names belong in the brief, the
 * gazetteer resolves them server-side) · shape (loop | A→B + destination) ·
 * the R16-5 fine-tune sections (ALL optional — the brief alone plans):
 *   Drive style (Twisty | Simple) · Scenery (Prefer views) · On the route
 *   (avoid highways / mostly backroads / paved only + the stops builder).
 * BD-30 still holds: the sections compose onto the ONE preset slot server-side
 * (plan_draft.buildPlanRequest) — presets only, no sliders (Hard rule L).
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

import StopsBuilder from '../components/StopsBuilder';
import { MAX_BRIEF_CHARS } from '../lib/api';
import { getCurrentLocation, type LocationResult } from '../lib/location';
import {
  buildPlanRequest,
  DURATION_CHOICES,
  usePlanDraft,
  type DriveStyle,
} from '../lib/plan_draft';
import { type QuickFillField } from '../lib/quick_fill';
import { useQuickFill } from '../lib/use_quick_fill';
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

  // R25-U16d quick-fill: the text populates untouched controls, visibly; a
  // tapped control joins `touched` and the parse never moves it again.
  const [touched, setTouched] = useState<ReadonlySet<QuickFillField>>(new Set());
  const touch = useCallback((f: QuickFillField) => {
    setTouched((prev) => new Set(prev).add(f));
  }, []);
  const quickFill = useQuickFill({ brief: draft.brief, draft, setDraft, touched });
  const fromText = useCallback(
    (f: QuickFillField): ReactElement | null =>
      quickFill.fromText.includes(f) ? (
        <Text style={[styles.fromText, { color: colors.accent }]}> · from your text</Text>
      ) : null,
    [quickFill.fromText, colors.accent],
  );

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

  // R27: chips quick-fill guessed from the brief are withheld from the request
  // so the server's LLM parse — measurably better than the rules parse driving
  // these chips — decides them instead of being overwritten by its own weaker
  // sibling. A chip the user TAPPED enters `touched` and is still sent.
  const autoFilled = useMemo(
    () => new Set(quickFill.fromText.filter((f) => !touched.has(f))),
    [quickFill.fromText, touched],
  );
  const build = useMemo(() => buildPlanRequest(draft, autoFilled), [draft, autoFilled]);

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
        <Text style={[styles.label, { color: colors.text }]}>Add places or a vibe</Text>
        <TextInput
          multiline
          value={draft.brief}
          onChangeText={(t) => setDraft({ brief: t.slice(0, MAX_BRIEF_CHARS) })}
          placeholder="e.g. through the Forks of the Credit, ending near Elora — quiet and scenic"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.brief,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
          ]}
          accessibilityLabel="Add places or a vibe for your drive"
        />
        <Text style={[styles.counter, { color: colors.textMuted }]}>
          {draft.brief.length}/{MAX_BRIEF_CHARS}
        </Text>
        {/* R25-U16d: place mentions the parse found — visible BEFORE submit
            (display-only: the text is their source of truth; edit the text to
            change them) */}
        {quickFill.pins.length > 0 && (
          <View style={styles.buttonRow}>
            {quickFill.pins.map((p) => (
              <View
                key={`${p.kind}:${p.text}`}
                style={[styles.pinChip, { borderColor: colors.accent }]}
              >
                <Text style={[styles.pinLabel, { color: colors.accent }]}>
                  {p.kind === 'through' ? 'via' : p.kind === 'near' ? 'near' : 'avoiding'} {p.text}
                </Text>
              </View>
            ))}
          </View>
        )}
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
        <Text style={[styles.label, { color: colors.text }]}>Shape{fromText('shape')}</Text>
        <View style={styles.buttonRow}>
          {(['loop', 'a_to_b'] as const).map((s) => {
            const active = draft.shape === s;
            return (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  touch('shape');
                  setDraft({ shape: s });
                }}
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

      {/* how long (R24-U12) — a real time budget; loops only (A → B time is set
          by the endpoints). "Any" = surprise me. */}
      {draft.shape === 'loop' && (
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.text }]}>How long{fromText('duration')}</Text>
          <View style={styles.buttonRow}>
            {[{ label: 'Any', seconds: null }, ...DURATION_CHOICES].map((c) => {
              const active = draft.durationTargetS === c.seconds;
              return (
                <Pressable
                  key={c.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    touch('duration');
                    setDraft({ durationTargetS: c.seconds });
                  }}
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
                    style={[
                      styles.secondaryLabel,
                      { color: active ? colors.onAccent : colors.text },
                    ]}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {quickFill.note !== null && (
            <Text style={[styles.note, { color: colors.textMuted }]}>{quickFill.note}</Text>
          )}
        </View>
      )}

      {/* --- R16-5 fine-tune sections (all optional; brief alone plans) --- */}
      <Text style={[styles.optionalHint, { color: colors.textMuted }]}>
        Everything below is optional — these fine-tune your drive.
      </Text>

      {/* road character (R25-U17 relabel: it selects WHICH ROADS the drive is
          built from — costing profile + character bundle — never pace).
          R25-U16b: the third chip makes style:null REACHABLE (the duration
          control's "Any" precedent) — preset:null revives the three tag-driven
          bundles and unseals RefinePanel's if_unset "more twisty". */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>
          Road character{fromText('style')}
        </Text>
        <View style={styles.buttonRow}>
          {(
            [
              { value: 'simple', label: 'Direct' },
              { value: 'backroads', label: 'Fun & Explorative' },
              { value: null, label: 'No preference' },
            ] as ReadonlyArray<{ value: DriveStyle | null; label: string }>
          ).map((s) => {
            const active = draft.style === s.value;
            return (
              <Pressable
                key={s.label}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  touch('style');
                  setDraft({ style: s.value });
                }}
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
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.note, { color: colors.textMuted }]}>
          Changes which roads we build the drive from — not how fast you drive it. Fun & Explorative
          favours quiet, characterful roads; Direct keeps it straightforward; No preference lets
          your own words decide.
        </Text>
      </View>

      {/* scenery */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>Scenery{fromText('preferViews')}</Text>
        <View style={styles.buttonRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: draft.preferViews }}
            onPress={() => {
              touch('preferViews');
              setDraft({ preferViews: !draft.preferViews });
            }}
            style={({ pressed }) => [
              styles.shapeChip,
              {
                backgroundColor: draft.preferViews ? colors.accent : colors.surface,
                borderColor: draft.preferViews ? colors.accent : colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.secondaryLabel,
                { color: draft.preferViews ? colors.onAccent : colors.text },
              ]}
            >
              Prefer views
            </Text>
          </Pressable>
        </View>
        {draft.preferViews && (
          <Text style={[styles.note, { color: colors.textMuted }]}>
            We'll aim for a viewpoint on the way — and tell you honestly if none fit.
          </Text>
        )}
      </View>

      {/* on the route */}
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>
          On the route{fromText('avoidHighways')}
          {fromText('pavedOnly')}
        </Text>
        <View style={styles.buttonRow}>
          {(
            [
              ['avoidHighways', 'Avoid highways'],
              ['pavedOnly', 'Paved roads only'],
            ] as const
          ).map(([key, label]) => {
            const active = draft.routeOptions[key];
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  touch(key);
                  setDraft({ routeOptions: { ...draft.routeOptions, [key]: !active } });
                }}
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
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.sublabel, { color: colors.text }]}>Stops along the way</Text>
        <StopsBuilder stops={draft.stops} onChange={(stops) => setDraft({ stops })} />
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
  // R25-U16d quick-fill affordances
  fromText: { ...font.caption },
  pinChip: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pinLabel: { ...font.caption, fontWeight: '600' },
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
  optionalHint: { ...font.caption, lineHeight: 16 },
  sublabel: { ...font.body, fontWeight: '600', marginTop: spacing.sm },
  cta: {
    minHeight: HIT_TARGET + 8,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { ...font.button, fontSize: 17 },
});
