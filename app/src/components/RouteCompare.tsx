/**
 * Original-vs-refined comparison (M7-T07; FR-254 — REAL computed deltas from
 * the two route payloads, never narrated numbers).
 */

import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { compareSummaries, type RouteSummary } from '../lib/refine';
import { font, radius, spacing, useTheme } from '../theme';

export interface RouteCompareProps {
  previous: RouteSummary;
  next: RouteSummary;
}

export default function RouteCompare(props: RouteCompareProps): ReactElement {
  const { colors } = useTheme();
  const rows = compareSummaries(props.previous, props.next);
  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Compared with the previous drive</Text>
      {rows.map((r) => (
        <View key={r.label} style={styles.row}>
          <Text style={[styles.label, { color: colors.textMuted }]}>{r.label}</Text>
          <Text style={[styles.values, { color: colors.text }]}>
            {r.before} → {r.after}
          </Text>
          <Text
            style={[
              styles.delta,
              { color: r.delta === 'no change' ? colors.textMuted : colors.accent },
            ]}
          >
            {r.delta}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { ...font.heading },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...font.caption, width: 80 },
  values: { ...font.body, flex: 1, fontVariant: ['tabular-nums'] },
  delta: { ...font.button, fontSize: 14, fontVariant: ['tabular-nums'] },
});
