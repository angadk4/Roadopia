/**
 * Persistent safe-driving disclaimer (M9-T08; FR-400, spec §59). Mounted on
 * every generated-route surface and on follow-mode — quiet but always there
 * (§59: persistent, not dismissible). Wording honesty (verification §8): the
 * planner's road choices are BIASES over measured data, never guarantees of
 * conditions — say exactly that, plainly.
 *
 * BD-204 presentation: this is an INLINE NOTE, not a panel. It used to be
 * drawn as the same bordered box as the hand-off tool and the report form, so
 * a non-interactive disclosure carried the exact visual weight of a control.
 * A box implies something to press. An icon, a hanging indent and footnote
 * type say "read this" without pretending to be tappable — and the copy is
 * untouched, because the plain-spoken version IS the product.
 *
 * Redesign (SPEC "Shared pieces > SafetyNote"): unchanged in form — the glyph
 * is now the one semantic `Symbol` (`info.circle` on iOS, its Ionicons twin on
 * Android). Both sentences verbatim; never dismissible; no motion.
 */

import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../theme';

import { Symbol, Text } from './ui';

export type SafetyContext = 'route' | 'follow';

export default function SafetyNote(props: { context: SafetyContext }): ReactElement {
  return (
    <View style={styles.note}>
      {/* the glyph sits in its own box so a wrapped sentence hang-indents
          under itself rather than under the icon */}
      <View style={styles.mark}>
        <Symbol name="infoCircle" size="sm" tone="muted" />
      </View>
      <Text variant="footnote" tone="muted" style={styles.text}>
        {props.context === 'follow'
          ? 'Drive safely and follow the rules of the road. Keep your eyes on the road — glance at guidance only when it’s safe.'
          : 'Drive safely and obey all speed limits and road rules. Road picks are biases from measured map data, not guarantees — conditions, closures and surfaces can differ on the day.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  /** 2pt of optical lead-in so a 14pt glyph sits on the footnote's x-height. */
  mark: { paddingTop: 2 },
  text: { flex: 1 },
});
