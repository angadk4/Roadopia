/**
 * A chapter opening inside a long page (redesign — SPEC "Shell chrome >
 * Chapter").
 *
 * The atlas device that replaces the inset `Surface` panels RouteDetail drew
 * around Stops / Constraints / Why, and the `headline`-titled chip tracks on
 * PlanForm: a 2pt INDEX RULE with a tracked `Legend` kicker under it, then the
 * chapter's content. `spacing.xl` above (the chapter step of the scale),
 * `spacing.md` inside. The rule is drawn by `Rule weight="index"` — the one
 * neutral token allowed to do structural work — never re-drawn as a border on
 * the text, so the rule weight cannot drift from the rest of the system.
 *
 * The kicker is announced as a HEADER, so VoiceOver's heading rotor walks the
 * page chapter by chapter. It is source-case in the tree (`Legend` uppercases
 * with `textTransform`), so a test that asserts `'Stops'` still finds it.
 *
 * Composition over configuration: `title`, an optional `trailing` slot for a
 * count beside the kicker ("SAVED DRIVES · 4"), and `children`. Nothing else.
 */

import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { spacing } from '../../theme';

import { Rule } from './Surface';
import { Legend } from './Text';

export interface ChapterProps {
  /** The kicker, in source case — `Legend` draws it uppercase. */
  title: string;
  /** Sits at the trailing end of the kicker line — a count, a `Legend`. */
  trailing?: ReactNode;
  children?: ReactNode;
  /** Merged LAST: layout only (a caller flattens the top margin for a first chapter). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Chapter({
  title,
  trailing,
  children,
  style,
  testID,
}: ChapterProps): React.JSX.Element {
  return (
    <View testID={testID} style={[{ marginTop: spacing.xl, gap: spacing.md }, style]}>
      <View style={{ gap: spacing.sm }}>
        <Rule weight="index" />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: spacing.md,
          }}
        >
          <Legend accessibilityRole="header">{title}</Legend>
          {trailing}
        </View>
      </View>
      {children}
    </View>
  );
}
