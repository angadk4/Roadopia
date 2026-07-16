/**
 * Reasoning-transparency view (M7-T06; Hard rule I; release gate RG-5).
 *
 * A collapsible "How this route was built" section inside route detail (§16
 * cohesion rule 3). It renders ONLY the four permitted kinds of content:
 * pipeline steps · tool calls · grounded results (counts) · validated-output
 * notes (parser/explain source details). There is NO other input: the data is
 * the same timeline the progress screen assembled from schema-validated
 * GenerationEvents — the wire schema has no field that could carry model
 * reasoning, and off-schema frames are dropped before decoding. The backend
 * additionally asserts no reasoning-like keys ever appear in any frame
 * (backend/src/routes/plan-sse.test.ts).
 */

import { useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { STEP_LABELS, toolLabel, type TimelineEntry } from '../lib/plan_run';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface ReasoningViewProps {
  timeline: TimelineEntry[];
}

export default function ReasoningView(props: ReasoningViewProps): ReactElement | null {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  if (props.timeline.length === 0) return null;

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="How this route was built"
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[styles.headerText, { color: colors.text }]}>How this route was built</Text>
        <Text style={[styles.chevron, { color: colors.textMuted }]}>{open ? '▾' : '▸'}</Text>
      </Pressable>

      {open && (
        <View style={styles.body}>
          <Text style={[styles.note, { color: colors.textMuted }]}>
            The deterministic pipeline's real steps and tool results from this generation — nothing
            is invented after the fact.
          </Text>
          {props.timeline.map((e, i) =>
            e.kind === 'step' ? (
              <View key={i} style={styles.row}>
                <Text style={[styles.mark, { color: colors.success }]}>
                  {e.status === 'completed' ? '✓' : '•'}
                </Text>
                <Text style={[styles.rowText, { color: colors.text }]}>
                  {STEP_LABELS[e.step]}
                  {e.detail ? <Text style={{ color: colors.textMuted }}> — {e.detail}</Text> : null}
                </Text>
              </View>
            ) : (
              <View key={i} style={[styles.row, styles.toolRow]}>
                <Text style={[styles.mark, { color: colors.textMuted }]}>
                  {e.ok === false ? '✕' : '⚙'}
                </Text>
                <Text style={[styles.rowText, { color: colors.textMuted }]}>
                  {toolLabel(e.tool)}
                  {e.count !== null ? ` — ${e.count} result${e.count === 1 ? '' : 's'}` : ''}
                </Text>
              </View>
            ),
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: radius.lg },
  header: {
    minHeight: HIT_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  headerText: { ...font.heading },
  chevron: { fontSize: 14 },
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  note: { ...font.caption, lineHeight: 16, marginBottom: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  toolRow: { paddingLeft: spacing.lg },
  mark: { ...font.caption, width: 16, textAlign: 'center', lineHeight: 18 },
  rowText: { ...font.caption, lineHeight: 18, flex: 1 },
});
