/**
 * The six preset chips (M7-T03; FR-350; [GATE-W]/BD-30: presets ONLY — no
 * sliders). Single-select; tapping the active chip clears it (the planner then
 * uses the brief-parsed preset or the frozen defaults). Chips are real buttons:
 * ≥44 pt targets, filled when active (the owner's M7 UI bar).
 * Hard rule D: engagement/character labels, never speed.
 */

import { PresetSchema, type Preset } from '@shared/types';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

const LABELS: Record<Preset, string> = {
  scenic: 'Scenic',
  twisty: 'Twisty',
  chill: 'Chill',
  backroads: 'Backroads',
  coffee_stop: 'Coffee stop',
  avoid_highways: 'Avoid highways',
};

export interface PresetChipsProps {
  value: Preset | null;
  onChange: (preset: Preset | null) => void;
}

export default function PresetChips(props: PresetChipsProps): ReactElement {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {PresetSchema.options.map((p) => {
        const active = props.value === p;
        return (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => props.onChange(active ? null : p)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: active ? colors.accent : colors.surface,
                borderColor: active ? colors.accent : colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={[styles.label, { color: active ? colors.onAccent : colors.text }]}>
              {LABELS[p]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...font.button, fontSize: 15 },
});
