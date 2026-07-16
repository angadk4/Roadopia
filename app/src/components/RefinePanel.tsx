/**
 * Inline conversational refinement (M7-T07; FR-043/FR-160s, §34 — an inline
 * affordance ON Result, never a separate screen; §16 cohesion rule 2). One
 * follow-up per send; hard constraints persist server-side (mergeConstraints).
 */

import { useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MAX_BRIEF_CHARS } from '../lib/api';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface RefinePanelProps {
  onSend: (followUp: string) => void;
}

export default function RefinePanel(props: RefinePanelProps): ReactElement {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const trimmed = text.trim();

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Tweak this drive</Text>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Try “make it longer”, “more twisty”, “avoid highways” or “add a coffee stop”. Your hard
        constraints carry over.
      </Text>
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={(t) => setText(t.slice(0, MAX_BRIEF_CHARS))}
          placeholder="What should change?"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            { backgroundColor: colors.bg, borderColor: colors.border, color: colors.text },
          ]}
          accessibilityLabel="Refine this drive"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: trimmed.length === 0 }}
          disabled={trimmed.length === 0}
          onPress={() => {
            props.onSend(trimmed);
            setText('');
          }}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: trimmed.length === 0 ? colors.surface : colors.accent,
              borderColor: colors.border,
              borderWidth: trimmed.length === 0 ? 1 : 0,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.sendLabel,
              { color: trimmed.length === 0 ? colors.textMuted : colors.onAccent },
            ]}
          >
            Refine
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { ...font.heading },
  hint: { ...font.caption, lineHeight: 16 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  input: {
    flex: 1,
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    ...font.body,
  },
  send: {
    minHeight: HIT_TARGET,
    minWidth: 88,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sendLabel: { ...font.button },
});
