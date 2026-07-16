/**
 * Stops builder (R16-5) — rows of {Coffee | Food | Gas} × {Anytime | Early |
 * Midway | Late}, add/remove, duplicates allowed (plan_draft aggregates counts).
 * Every stop is a REAL spot from the corpus and the timing chips map to drive
 * fractions the planner verifies against MEASURED arrivals — nothing here is
 * decorative. Chips are real buttons: ≥44 pt targets, filled when active.
 */

import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  MAX_STOP_ROWS_CLIENT,
  type StopRow,
  type StopRowType,
  type StopWhen,
} from '../lib/plan_draft';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

const TYPE_LABELS: Record<StopRowType, string> = {
  coffee: 'Coffee',
  food: 'Food',
  fuel: 'Gas',
};
const TYPES: StopRowType[] = ['coffee', 'food', 'fuel'];

const WHEN_LABELS: Record<StopWhen, string> = {
  anytime: 'Anytime',
  early: 'Early',
  midway: 'Midway',
  late: 'Late',
};
const WHENS: StopWhen[] = ['anytime', 'early', 'midway', 'late'];

export interface StopsBuilderProps {
  stops: StopRow[];
  onChange: (stops: StopRow[]) => void;
}

export default function StopsBuilder(props: StopsBuilderProps): ReactElement {
  const { colors } = useTheme();
  const { stops, onChange } = props;

  const update = (index: number, patch: Partial<StopRow>): void => {
    onChange(stops.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const remove = (index: number): void => {
    onChange(stops.filter((_, i) => i !== index));
  };
  const add = (): void => {
    onChange([...stops, { type: 'coffee', when: 'anytime' }]);
  };

  return (
    <View style={styles.root}>
      {stops.map((row, i) => (
        <View
          key={i}
          style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <View style={styles.chipGroup}>
            {TYPES.map((t) => {
              const active = row.type === t;
              return (
                <Pressable
                  key={t}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Stop ${i + 1}: ${TYPE_LABELS[t]}`}
                  onPress={() => update(i, { type: t })}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: active ? colors.accent : 'transparent',
                      borderColor: active ? colors.accent : colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.chipLabel, { color: active ? colors.onAccent : colors.text }]}
                  >
                    {TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove stop ${i + 1}`}
              onPress={() => remove(i)}
              style={({ pressed }) => [styles.remove, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.removeLabel, { color: colors.textMuted }]}>Remove</Text>
            </Pressable>
          </View>
          <View style={styles.chipGroup}>
            {WHENS.map((w) => {
              const active = row.when === w;
              return (
                <Pressable
                  key={w}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Stop ${i + 1} timing: ${WHEN_LABELS[w]}`}
                  onPress={() => update(i, { when: w })}
                  style={({ pressed }) => [
                    styles.chipSmall,
                    {
                      backgroundColor: active ? colors.accent : 'transparent',
                      borderColor: active ? colors.accent : colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipSmallLabel,
                      { color: active ? colors.onAccent : colors.text },
                    ]}
                  >
                    {WHEN_LABELS[w]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {stops.length < MAX_STOP_ROWS_CLIENT && (
        <Pressable
          accessibilityRole="button"
          onPress={add}
          style={({ pressed }) => [
            styles.addButton,
            { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.addLabel, { color: colors.accent }]}>＋ Add a stop</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  row: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  chip: {
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: { ...font.button, fontSize: 14 },
  chipSmall: {
    minHeight: HIT_TARGET - 8,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSmallLabel: { ...font.button, fontSize: 13 },
  remove: {
    minHeight: HIT_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    marginLeft: 'auto',
  },
  removeLabel: { ...font.button, fontSize: 13 },
  addButton: {
    minHeight: HIT_TARGET,
    borderWidth: 1.5,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  addLabel: { ...font.button, fontSize: 15 },
});
