/**
 * Report-this-content (M10-T06; FR-300/304). Works signed-out (§55 allows
 * anonymous reports). The thanks-line is honest about what happens next:
 * a person reviews it — no status tracking is promised because reporters
 * cannot read the reports table (by design).
 *
 * BD-204 presentation, three fixes and no copy changes:
 *
 *  1. The CONFIRMATION was smaller than the affordance. Pressing a real
 *     button and getting back a 12pt muted line reads as "nothing happened".
 *     "Thanks — someone will look at it." is now an iconed row at the size of
 *     the control it replaced, and it fades in so the change is visible.
 *  2. The report field was INVISIBLE in light mode: a `surfaceRaised` input
 *     inside a `surface` box was white on white, separated only by a 1.35:1
 *     hairline. It now sits on the recessed `fill` tier with the index rule,
 *     which is what those tokens exist for.
 *  3. Its height was `HIT_TARGET * 1.4` — a touch-target floor used as a
 *     typographic unit, so at AX5 the field showed less than one line. It is
 *     three lines of whatever size the user chose.
 *
 * Redesign (SPEC "Shared pieces > ReportButton"): the foot-of-page `flag`
 * link (footnote, never amber — reporting is never the page's primary action)
 * opening the inline form in place; no new route. It is ALSO reachable from
 * SpotDetail's header menu, through the `ref` handle's `open()` — the same
 * form, the same state, one more way in. Press feedback is `PressableScale`;
 * the form and the thanks-line arrive on the module-scope fade.
 */

import { useImperativeHandle, useState, type ReactElement, type Ref } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { DataError } from '../lib/data';
import { REPORT_REASON_MAX, submitReport, type ReportTarget } from '../lib/report';
import { getSupabaseConfig } from '../lib/runtime';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, squircle, useTheme } from '../theme';

import { Button, ENTER_FADE, PressableScale, Surface, Symbol, Text } from './ui';

/** What a host can do to the button from outside: open the form in place. */
export interface ReportButtonHandle {
  open(): void;
}

export interface ReportButtonProps {
  targetType: ReportTarget;
  targetId: string;
  /** A header menu's "Report this" opens the same inline form. */
  ref?: Ref<ReportButtonHandle>;
  /** Injectable for tests. */
  cfg?: { url: string; anonKey: string };
  submitFn?: typeof submitReport;
}

type Phase =
  | { kind: 'collapsed' }
  | { kind: 'open' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'problem'; message: string };

export default function ReportButton(props: ReportButtonProps): ReactElement {
  const { freshAccessToken } = useAuth();
  const cfg = props.cfg ?? getSupabaseConfig();
  const submit = props.submitFn ?? submitReport;
  const [phase, setPhase] = useState<Phase>({ kind: 'collapsed' });
  const [reason, setReason] = useState('');

  useImperativeHandle(
    props.ref,
    () => ({
      // Opening is idempotent: a form already open (or sending, or sent) is
      // left exactly as it is.
      open: () => setPhase((p) => (p.kind === 'collapsed' ? { kind: 'open' } : p)),
    }),
    [],
  );

  if (phase.kind === 'sent') return <ReportSent />;

  if (phase.kind === 'collapsed') {
    return <ReportLink onPress={() => setPhase({ kind: 'open' })} />;
  }

  const send = (): void => {
    setPhase({ kind: 'sending' });
    void (async () => {
      try {
        const token = await freshAccessToken(); // null when anonymous — allowed
        await submit(cfg, token, {
          target_type: props.targetType,
          target_id: props.targetId,
          reason,
        });
        setPhase({ kind: 'sent' });
      } catch (err) {
        setPhase({
          kind: 'problem',
          message: err instanceof DataError ? err.message : 'Could not send the report right now.',
        });
      }
    })();
  };

  return (
    <ReportForm
      reason={reason}
      onReason={setReason}
      sending={phase.kind === 'sending'}
      problem={phase.kind === 'problem' ? phase.message : null}
      onSend={send}
      onCancel={() => setPhase({ kind: 'collapsed' })}
    />
  );
}

/** The quiet entry point. Not a Button: amber has exactly one job per screen
 *  and reporting is never the primary action on the page it sits at the foot of.
 *  Bounded, so it may scale (a row may not). */
function ReportLink(props: { onPress: () => void }): ReactElement {
  return (
    <View style={styles.linkWrap}>
      <PressableScale
        accessibilityLabel="Report this content"
        onPress={props.onPress}
        style={styles.link}
      >
        <Symbol name="flag" size="sm" tone="muted" />
        <Text variant="footnote" tone="muted">
          Report this
        </Text>
      </PressableScale>
    </View>
  );
}

/** Grows out of the link it replaced, rather than appearing mid-scroll. */
function ReportForm(props: {
  reason: string;
  onReason: (t: string) => void;
  sending: boolean;
  problem: string | null;
  onSend: () => void;
  onCancel: () => void;
}): ReactElement {
  const { colors } = useTheme();
  return (
    <Animated.View entering={ENTER_FADE}>
      <Surface level="raised" padding="md" corner="md" style={styles.box}>
        <Text variant="bodyStrong">What’s wrong with it?</Text>
        <TextInput
          accessibilityLabel="Report reason"
          placeholder="Wrong location, offensive, spam…"
          placeholderTextColor={colors.textMuted}
          value={props.reason}
          onChangeText={(t) => props.onReason(t.slice(0, REPORT_REASON_MAX))}
          multiline
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.fill },
          ]}
        />
        {props.problem !== null && (
          <View style={styles.problem}>
            <View style={styles.mark}>
              <Symbol name="exclamationmarkCircleFill" size="sm" tone="danger" />
            </View>
            <Text variant="footnote" tone="danger" style={styles.flex}>
              {props.problem}
            </Text>
          </View>
        )}
        <View style={styles.row}>
          <Button
            title={props.sending ? 'Sending…' : 'Send report'}
            accessibilityLabel="Send report"
            variant="primary"
            disabled={props.sending}
            onPress={props.onSend}
            style={styles.flex}
          />
          <Button
            title="Cancel"
            accessibilityLabel="Cancel report"
            variant="secondary"
            onPress={props.onCancel}
          />
        </View>
      </Surface>
    </Animated.View>
  );
}

/** Never smaller than the affordance it replaced (see the header). */
function ReportSent(): ReactElement {
  return (
    <Animated.View entering={ENTER_FADE}>
      <Surface level="inset" padding="sm" corner="md" style={styles.sent}>
        <Symbol name="checkmarkCircleFill" size="lg" tone="success" />
        <Text variant="body" style={styles.flex} accessibilityLabel="Report sent">
          Thanks — someone will look at it.
        </Text>
      </Surface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** Hugs the link, so the target is the link and not the whole line. */
  linkWrap: { alignSelf: 'flex-start' },
  link: {
    minHeight: HIT_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    ...squircle,
  },
  box: { gap: spacing.md },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    // three lines of whatever size the reader chose — never a magic multiple
    // of the touch-target floor
    minHeight: font.body.lineHeight * 3 + spacing.md * 2,
    textAlignVertical: 'top',
    ...font.body,
    ...squircle,
  },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  mark: { paddingTop: 2 },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  sent: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
