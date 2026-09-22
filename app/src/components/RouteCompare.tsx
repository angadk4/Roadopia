/**
 * Original-vs-refined comparison (M7-T07; FR-254 — REAL computed deltas from
 * the two route payloads, never narrated numbers).
 *
 * BD-204 presentation. Three things were wrong and none of them were the data:
 *
 *  1. The delta was AMBER for any non-zero change, so "+15 min" and "−15 min"
 *     were the same colour in the one panel whose entire job is direction.
 *     Direction is now carried by an arrow and by weight; the number keeps the
 *     default ink. Deliberately NOT red/green: a longer drive is not "bad" if
 *     the user asked for longer, and colouring it as bad editorialises a
 *     measured number.
 *  2. The label column was a hardcoded 80pt inside `alignItems: 'center'`, so
 *     at large Dynamic Type "twistiness" wrapped to three lines and dragged
 *     the values off their shared line. Each row is now a legend ABOVE its
 *     numbers, which has no column to overflow.
 *  3. Explicitly NOT a count-up: rolling 60.0 → 67.8 would imply the
 *     measurement passed through those values, and FR-254's whole point is
 *     that these are two computed endpoints.
 *
 * Redesign (SPEC "Shared pieces > RouteCompare"): the inset panel became the
 * chapter COMPARED WITH THE PREVIOUS DRIVE — a `Legend` kicker on an index
 * rule — and the row stagger is deleted: the comparison arrives with the page
 * it belongs to (expo-animation RECIPES: entrances are for content the user is
 * waiting on, and the page's own reveal already covers this). The arrow is
 * `arrow.up`, rotated 180° for a decrease — never a name containing "down"
 * (`ui/Symbol` refuses one in either namespace).
 */

import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { compareSummaries, type CompareRow, type RouteSummary } from '../lib/refine';
import { spacing } from '../theme';

import { Chapter, Legend, Symbol, Text } from './ui';

export interface RouteCompareProps {
  previous: RouteSummary;
  next: RouteSummary;
}

export default function RouteCompare(props: RouteCompareProps): ReactElement {
  const rows = compareSummaries(props.previous, props.next);
  return (
    <Chapter title="Compared with the previous drive">
      {rows.map((r) => (
        <CompareLine key={r.label} row={r} />
      ))}
    </Chapter>
  );
}

function CompareLine(props: { row: CompareRow }): ReactElement {
  const { row } = props;
  const unchanged = row.delta === 'no change';
  // "−" first: a signed string starting with the minus sign is a decrease.
  const decrease = row.delta.startsWith('−') || row.delta.startsWith('-');

  return (
    <View style={styles.row}>
      <Legend>{row.label}</Legend>
      <View style={styles.numbers}>
        <Text variant="body" style={styles.values}>
          {row.before} → {row.after}
        </Text>
        <View style={styles.delta}>
          {unchanged ? (
            <Symbol name="minus" size="sm" tone="muted" />
          ) : (
            // one arrow, rotated for the other direction (see the header)
            <Symbol name="arrowUp" size="sm" tone="muted" style={decrease ? styles.flip : null} />
          )}
          <Text
            variant={unchanged ? 'footnote' : 'label'}
            tone={unchanged ? 'muted' : 'default'}
            style={styles.deltaText}
          >
            {row.delta}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Legend over numbers: nothing to overflow at AX text sizes. */
  row: { gap: spacing.xs },
  numbers: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  values: { flex: 1, fontVariant: ['tabular-nums'] },
  delta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  deltaText: { fontVariant: ['tabular-nums'] },
  flip: { transform: [{ rotate: '180deg' }] },
});
