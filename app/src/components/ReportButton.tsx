/**
 * Report-this-content (M10-T06; FR-300/304). Works signed-out (§55 allows
 * anonymous reports). The thanks-line is honest about what happens next:
 * a person reviews it — no status tracking is promised because reporters
 * cannot read the reports table (by design).
 */

import { useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { DataError } from '../lib/data';
import { REPORT_REASON_MAX, submitReport, type ReportTarget } from '../lib/report';
import { getSupabaseConfig } from '../lib/runtime';
import { useAuth } from '../lib/use_auth';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface ReportButtonProps {
  targetType: ReportTarget;
  targetId: string;
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
  const { colors } = useTheme();
  const { freshAccessToken } = useAuth();
  const cfg = props.cfg ?? getSupabaseConfig();
  const submit = props.submitFn ?? submitReport;
  const [phase, setPhase] = useState<Phase>({ kind: 'collapsed' });
  const [reason, setReason] = useState('');

  if (phase.kind === 'sent') {
    return (
      <Text style={[styles.sent, { color: colors.textMuted }]} accessibilityLabel="Report sent">
        Thanks — someone will look at it.
      </Text>
    );
  }

  if (phase.kind === 'collapsed') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report this content"
        onPress={() => setPhase({ kind: 'open' })}
        style={styles.link}
      >
        <Text style={[styles.linkLabel, { color: colors.textMuted }]}>Report this</Text>
      </Pressable>
    );
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
    <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.prompt, { color: colors.text }]}>What’s wrong with it?</Text>
      <TextInput
        accessibilityLabel="Report reason"
        placeholder="Wrong location, offensive, spam…"
        placeholderTextColor={colors.textMuted}
        value={reason}
        onChangeText={(t) => setReason(t.slice(0, REPORT_REASON_MAX))}
        multiline
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
        ]}
      />
      {phase.kind === 'problem' && (
        <Text style={[styles.problem, { color: colors.danger }]}>{phase.message}</Text>
      )}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send report"
          disabled={phase.kind === 'sending'}
          onPress={send}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: colors.accent,
              opacity: pressed || phase.kind === 'sending' ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.sendLabel, { color: colors.onAccent }]}>
            {phase.kind === 'sending' ? 'Sending…' : 'Send report'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel report"
          onPress={() => setPhase({ kind: 'collapsed' })}
          style={[styles.cancelBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.cancelLabel, { color: colors.text }]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: HIT_TARGET, justifyContent: 'center' },
  linkLabel: { ...font.caption, textDecorationLine: 'underline' },
  sent: { ...font.caption, paddingVertical: spacing.sm },
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  prompt: { ...font.body },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: HIT_TARGET * 1.4,
    textAlignVertical: 'top',
    ...font.body,
  },
  problem: { ...font.caption },
  row: { flexDirection: 'row', gap: spacing.sm },
  sendBtn: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: { ...font.button },
  cancelBtn: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: { ...font.body },
});
