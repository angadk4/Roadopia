/**
 * Plan screen (M7-T03, sections restructured R16-5; FR-040, §15, §27.4).
 *
 * Inputs: free-text brief (≤ MAX_BRIEF_CHARS) · origin (current location
 * DEFAULT — BD-27 — or a dropped pin; place names belong in the brief, the
 * gazetteer resolves them server-side) · shape (loop | A→B + destination) ·
 * the R16-5 fine-tune sections (ALL optional — the brief alone plans):
 *   Road character (Direct | Backroads) · Scenery (Prefer views) · On the
 *   route (avoid highways / paved only + the stops builder).
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
 *
 * REDESIGN (SPEC "PlanForm"). What the screen IS changed, not what it does:
 *
 *   - THE TITLE IS THE NAVIGATOR'S. A native large title ("Plan a drive",
 *     `nav/PlanStack` → `pageOptions`) that collapses into the bar as the form
 *     scrolls; the `ScrollView` is the page's first child with
 *     `contentInsetAdjustmentBehavior="automatic"`, which is what makes the
 *     collapse happen natively. No display-role title on the page, no
 *     hand-rolled top inset (expo-native-ui: "ALWAYS use a navigation stack
 *     title instead of a custom text element on the page").
 *   - SECTIONS ARE CHAPTERS. Each section opens on a 2pt index rule with a
 *     tracked LEGEND kicker (`Chapter`), the atlas device, instead of a
 *     `headline` over a chip track.
 *   - THE CONTROLS ARE THE PHONE'S. A one-of-two choice (Shape, Road
 *     character) is a segmented control; the six-way drive time is a menu
 *     picker (one tap shows the whole set — segmented holds at most four,
 *     expo-native-ui controls.md); each boolean is a toggle. All through the
 *     `ui/native` wrappers (SPEC rule 7 — no screen imports `@expo/ui`), and
 *     every change calls the SAME `touch(field)` + `setDraft` the chips did,
 *     so quick-fill's touched/autoFilled logic is untouched.
 *   - THE SUBMIT IS PINNED. "Plan my drive" and the sentence that says why it
 *     is disabled sit in a Material bar above the tab bar, and the bar rides
 *     the keyboard (`KeyboardAvoidingView`) — the CTA is never under the fold
 *     again, and never under the keyboard. The blocker sits ABOVE the button,
 *     where the eye lands before the tap.
 *
 * Provenance ("· from your text") stays muted weight — amber is the action
 * colour. The brief is still the one raised card: it is the actual product
 * input.
 */

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated from 'react-native-reanimated';

import StopsBuilder from '../components/StopsBuilder';
import {
  Button,
  Chapter,
  ENTER_FADE,
  EXIT,
  Legend,
  Material,
  REFLOW,
  Rule,
  Surface,
  Symbol,
  Text,
} from '../components/ui';
import { MenuPicker, NativeToggle, SegmentedPicker } from '../components/ui/native';
import { MAX_BRIEF_CHARS } from '../lib/api';
import { useTabBarHeight } from '../lib/insets';
import { getCurrentLocation, type LocationResult } from '../lib/location';
import {
  buildPlanRequest,
  DURATION_CHOICES,
  usePlanDraft,
  type DriveStyle,
} from '../lib/plan_draft';
import { type QuickFillField } from '../lib/quick_fill';
import { useQuickFill } from '../lib/use_quick_fill';
import { font, HIT_TARGET, radius, spacing, squircle, useTheme } from '../theme';

/** The page's title — drawn by the native large-title header (`PlanStack`),
 *  never by this screen. Exported so the stack and the test share one string. */
export const PLAN_FORM_TITLE = 'Plan a drive';

type LocationState = 'idle' | 'fetching' | 'denied' | 'error';

interface PlanScreenNav {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
}

export interface PlanScreenProps {
  navigation: PlanScreenNav;
  /** Injectable for tests; defaults to the expo-location wrapper. */
  locate?: () => Promise<LocationResult>;
}

/** The segmented controls' options, in display order — the index IS the value. */
const SHAPES = ['loop', 'a_to_b'] as const;
const SHAPE_LABELS = ['Loop', 'A → B'] as const;
const STYLES: readonly DriveStyle[] = ['simple', 'backroads'];
const STYLE_LABELS = ['Direct', 'Backroads'] as const;
/** "Any" = surprise me, then the R24-U12 budgets. Six > four, so a menu. */
const DURATION_LABELS: readonly string[] = ['Any', ...DURATION_CHOICES.map((c) => c.label)];

/**
 * The provenance mark beside a chapter kicker. An annotation, not an action —
 * weight and tone, never the action colour (which used to make it look
 * selectable).
 */
function FromText(): ReactElement {
  return (
    <Text variant="footnote" tone="muted">
      · from your text
    </Text>
  );
}

export default function PlanScreen(props: PlanScreenProps): ReactElement {
  const { colors } = useTheme();
  const tabBarHeight = useTabBarHeight();
  const { draft, setDraft } = usePlanDraft();
  const [locState, setLocState] = useState<LocationState>('idle');
  /** The pinned bar's measured height — what the scroll content pads by so
   *  the last chapter can rise above it. 0 until the first layout. */
  const [barH, setBarH] = useState(0);
  const locate = props.locate ?? getCurrentLocation;

  // R25-U16d quick-fill: the text populates untouched controls, visibly; a
  // tapped control joins `touched` and the parse never moves it again.
  const [touched, setTouched] = useState<ReadonlySet<QuickFillField>>(new Set());
  const touch = useCallback((f: QuickFillField) => {
    setTouched((prev) => new Set(prev).add(f));
  }, []);
  const quickFill = useQuickFill({ brief: draft.brief, draft, setDraft, touched });
  const fromText = useCallback(
    (...fields: QuickFillField[]): ReactElement | undefined =>
      fields.some((f) => quickFill.fromText.includes(f)) ? <FromText /> : undefined,
    [quickFill.fromText],
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

  // R27: controls quick-fill guessed from the brief are withheld from the
  // request so the server's LLM parse — measurably better than the rules parse
  // driving these controls — decides them instead of being overwritten by its
  // own weaker sibling. A control the user TOUCHED enters `touched` and is
  // still sent.
  const autoFilled = useMemo(
    () => new Set(quickFill.fromText.filter((f) => !touched.has(f))),
    [quickFill.fromText, touched],
  );
  const build = useMemo(
    () => buildPlanRequest(draft, autoFilled, quickFill.hasDestination),
    [draft, autoFilled, quickFill.hasDestination],
  );

  const submit = useCallback(() => {
    if (build.ok) props.navigation.navigate('Progress', { request: build.request });
  }, [build, props.navigation]);

  // --- the controls' index ↔ draft mapping -----------------------------------
  const shapeIndex = SHAPES.indexOf(draft.shape);
  // style:null (the text decides — quick-fill's "twisty" clears it) selects no
  // segment: honest, and the picker renders it as exactly that.
  const styleIndex = draft.style === null ? -1 : STYLES.indexOf(draft.style);
  const durationIndex =
    draft.durationTargetS === null
      ? 0
      : DURATION_CHOICES.findIndex((c) => c.seconds === draft.durationTargetS) + 1;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* FIRST CHILD: the scroll view the native large title collapses over. */}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          // Under the pinned bar and the translucent tab bar — the content
          // scrolls under both, so the last chapter pads past them.
          { paddingBottom: barH + tabBarHeight + spacing.lg },
        ]}
        scrollIndicatorInsets={{ bottom: barH + tabBarHeight }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {/* the brief — the one raised card: it is the actual product input */}
        <Surface level="raised" padding="md" style={styles.card}>
          <View style={styles.kicker}>
            <Rule weight="index" />
            <Legend accessibilityRole="header">The brief</Legend>
          </View>
          <Text variant="headline">Add places or a vibe</Text>
          <TextInput
            multiline
            value={draft.brief}
            onChangeText={(t) => setDraft({ brief: t.slice(0, MAX_BRIEF_CHARS) })}
            placeholder="e.g. through the Forks of the Credit, ending near Elora — quiet and scenic"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.brief,
              {
                backgroundColor: colors.fill,
                borderColor: colors.borderStrong,
                color: colors.text,
              },
            ]}
            accessibilityLabel="Add places or a vibe for your drive"
          />
          {/* tabular figures: the counter changes every keystroke and was
              re-flowing its own width as it counted */}
          <Text variant="footnote" tone="muted" style={styles.counter}>
            {draft.brief.length}/{MAX_BRIEF_CHARS}
          </Text>
          {/* R25-U16d: place mentions the parse found — visible BEFORE submit
              (display-only legend pills: the text is their source of truth;
              edit the text to change them — so no control role, no press) */}
          {quickFill.pins.length > 0 && (
            <View style={styles.pinRow}>
              {quickFill.pins.map((p) => (
                <View
                  key={`${p.kind}:${p.text}`}
                  style={[
                    styles.pinChip,
                    { borderColor: colors.accent, backgroundColor: colors.accentTint },
                  ]}
                >
                  <Text variant="footnote" tone="accent">
                    {p.kind === 'through' ? 'via' : p.kind === 'near' ? 'near' : 'avoiding'}{' '}
                    {p.text}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Surface>

        {/* START FROM */}
        <Chapter title="Start from">
          {draft.origin ? (
            <Surface level="inset" padding="none" style={styles.valueRow}>
              <Text variant="body" style={styles.value}>
                {draft.origin.source === 'current'
                  ? 'Starting from your current location'
                  : 'Starting from the pin you dropped'}
              </Text>
              <Button variant="ghost" title="Clear" onPress={() => setDraft({ origin: null })} />
            </Surface>
          ) : (
            <View style={styles.buttonRow}>
              <Button
                variant="secondary"
                title={locState === 'fetching' ? 'Locating…' : 'Use my location'}
                disabled={locState === 'fetching'}
                onPress={useMyLocation}
                icon={<Symbol name="location" size="sm" />}
              />
              <Button
                variant="secondary"
                title="Pick on map"
                onPress={() => props.navigation.navigate('PickPoint', { target: 'origin' })}
                icon={<Symbol name="map" size="sm" />}
              />
            </View>
          )}
          {locState === 'denied' && (
            <Text variant="footnote" tone="notice">
              Location permission is off — you can drop a pin instead.
            </Text>
          )}
          {locState === 'error' && (
            <Text variant="footnote" tone="notice">
              Couldn't get a fix — try again or drop a pin instead.
            </Text>
          )}
        </Chapter>

        {/* SHAPE — one of two: the phone's segmented control */}
        <Chapter title="Shape" trailing={fromText('shape')}>
          <SegmentedPicker
            label="Shape"
            options={SHAPE_LABELS}
            selectedIndex={shapeIndex}
            onChange={(i) => {
              touch('shape');
              setDraft({ shape: SHAPES[i] ?? 'loop' });
            }}
          />
          {draft.shape === 'a_to_b' &&
            (draft.destination ? (
              <Surface level="inset" padding="none" style={styles.valueRow}>
                <Text variant="body" style={styles.value}>
                  Destination pinned on the map
                </Text>
                <Button
                  variant="ghost"
                  title="Clear"
                  onPress={() => setDraft({ destination: null })}
                />
              </Surface>
            ) : (
              <Button
                variant="secondary"
                title="Pick a destination on the map"
                onPress={() => props.navigation.navigate('PickPoint', { target: 'destination' })}
                icon={<Symbol name="mappin" size="sm" />}
                style={styles.startAligned}
              />
            ))}
          {/* A → B time is set by the endpoints, so there is no time control
              for it — said, rather than a control that does nothing. */}
          {draft.shape !== 'loop' && (
            <Text variant="footnote" tone="muted">
              Drive time for an A → B drive comes from the two endpoints, so there is no time
              control here.
            </Text>
          )}
        </Chapter>

        {/* DRIVE TIME (R24-U12) — a real time budget; loops only. Six choices,
            so a menu: one tap shows the whole set. "Any" = surprise me. */}
        {draft.shape === 'loop' && (
          <Chapter title="Drive time" trailing={fromText('duration')}>
            <MenuPicker
              label="Drive time"
              options={DURATION_LABELS}
              selectedIndex={durationIndex}
              onChange={(i) => {
                touch('duration');
                setDraft({
                  durationTargetS: i === 0 ? null : (DURATION_CHOICES[i - 1]?.seconds ?? null),
                });
              }}
            />
            {quickFill.note !== null && (
              <Text variant="footnote" tone="muted">
                {quickFill.note}
              </Text>
            )}
          </Chapter>
        )}

        {/* --- R16-5 fine-tune chapters (all optional; the brief alone plans).
            The split is STRUCTURE: an index rule and a part of space. */}
        <View style={styles.part}>
          <Rule weight="index" />
          <Text variant="footnote" tone="muted">
            Everything below is optional — these fine-tune your drive.
          </Text>
        </View>

        {/* ROAD CHARACTER (R25-U17 relabel: it selects WHICH ROADS the drive is
            built from — costing profile + character bundle — never pace). */}
        <Chapter title="Road character" trailing={fromText('style')}>
          <SegmentedPicker
            label="Road character"
            options={STYLE_LABELS}
            selectedIndex={styleIndex}
            onChange={(i) => {
              touch('style');
              setDraft({ style: STYLES[i] ?? null });
            }}
          />
          <Text variant="footnote" tone="muted">
            Changes which roads we build the drive from — not how fast you drive it. Backroads
            favours quiet, characterful country roads; Direct keeps it straightforward. Name places
            or roads in the text box and the drive will go through them.
          </Text>
        </Chapter>

        {/* SCENERY — an independent boolean: a toggle */}
        <Chapter title="Scenery" trailing={fromText('preferViews')}>
          <NativeToggle
            label="Prefer views"
            value={draft.preferViews}
            onChange={(v) => {
              touch('preferViews');
              setDraft({ preferViews: v });
            }}
          />
          {draft.preferViews && (
            <Text variant="footnote" tone="muted">
              We'll aim for a viewpoint on the way — and tell you honestly if none fit.
            </Text>
          )}
        </Chapter>

        {/* ON THE ROUTE — two independent booleans, then the stops */}
        <Chapter title="On the route" trailing={fromText('avoidHighways', 'pavedOnly')}>
          <NativeToggle
            label="Avoid highways"
            value={draft.routeOptions.avoidHighways}
            onChange={(v) => {
              touch('avoidHighways');
              setDraft({ routeOptions: { ...draft.routeOptions, avoidHighways: v } });
            }}
          />
          <NativeToggle
            label="Paved roads only"
            value={draft.routeOptions.pavedOnly}
            onChange={(v) => {
              touch('pavedOnly');
              setDraft({ routeOptions: { ...draft.routeOptions, pavedOnly: v } });
            }}
          />
          <Legend accessibilityRole="header" style={styles.sublabel}>
            Stops along the way
          </Legend>
          <StopsBuilder stops={draft.stops} onChange={(stops) => setDraft({ stops })} />
        </Chapter>
      </ScrollView>

      {/* THE PINNED BAR — above the tab bar, riding the keyboard. `behavior`
          is iOS-only: Android resizes the window for the keyboard itself, and
          padding on top of that would double it (the AddSpot precedent).
          `keyboardVerticalOffset` is 0, not the header height, because this
          header is TRANSPARENT: the screen content is full-window, so the
          view's own frame — which is what RN's KeyboardAvoidingView measures
          (`frame.y + frame.height - keyboardY`, parent-relative) — already
          sits in window coordinates. An offset here would float the bar that
          far above the keyboard. Device-verify with the keyboard up. */}
      <KeyboardAvoidingView
        style={[styles.pinned, { bottom: tabBarHeight }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        pointerEvents="box-none"
      >
        <View onLayout={(e: LayoutChangeEvent) => setBarH(e.nativeEvent.layout.height)}>
          <Material role="bar" testID="plan-pinned-bar" style={styles.bar}>
            {/* why the CTA cannot be tapped yet — ABOVE the button, where the
                eye lands before the tap. Its arrival and departure cross-fade
                and the button glides rather than jumps (tens of times a day:
                near-imperceptible — expo-animation §1). */}
            {!build.ok && (
              <Animated.View entering={ENTER_FADE} exiting={EXIT} layout={REFLOW}>
                <Text variant="footnote" tone="muted">
                  {build.problems.join(' ')}
                </Text>
              </Animated.View>
            )}
            <Animated.View layout={REFLOW}>
              <Button
                title="Plan my drive"
                variant="primary"
                size="lg"
                block
                disabled={!build.ok}
                onPress={submit}
              />
            </Animated.View>
          </Material>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  card: { gap: spacing.md },
  kicker: { gap: spacing.sm },
  /** The part break before the optional chapters: a chapter step of space,
   *  an index rule, one sentence. */
  part: { gap: spacing.md, marginTop: spacing.xl },
  // R25-U16d quick-fill affordance: a pill, tinted rather than outlined-only
  pinRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  pinChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  brief: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    ...font.body,
    ...squircle,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', fontVariant: ['tabular-nums'] },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  valueRow: {
    minHeight: HIT_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  value: { flex: 1 },
  startAligned: { alignSelf: 'flex-start' },
  sublabel: { marginTop: spacing.sm },
  /** The bar's slot: full width, above the tab bar; the keyboard pads it up. */
  pinned: { position: 'absolute', left: 0, right: 0 },
  bar: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
});
