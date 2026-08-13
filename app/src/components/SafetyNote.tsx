/**
 * Persistent safe-driving disclaimer (M9-T08; FR-400, spec §59). Mounted on
 * every generated-route surface and on follow-mode — quiet but always there
 * (§59: persistent, not dismissible). Wording honesty (verification §8): the
 * planner's road choices are BIASES over measured data, never guarantees of
 * conditions — say exactly that, plainly.
 */

import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { font, radius, spacing, useTheme } from '../theme';

export type SafetyContext = 'route' | 'follow';

export default function SafetyNote(props: { context: SafetyContext }): ReactElement {
  const { colors } = useTheme();
  return (
    <View style={[styles.note, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.text, { color: colors.textMuted }]}>
        {props.context === 'follow'
          ? 'Drive safely and follow the rules of the road. Keep your eyes on the road — glance at guidance only when it’s safe.'
          : 'Drive safely and obey all speed limits and road rules. Road picks are biases from measured map data, not guarantees — conditions, closures and surfaces can differ on the day.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  text: { ...font.caption, lineHeight: 18 },
});
