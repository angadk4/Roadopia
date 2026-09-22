/**
 * Stops builder (R16-5) — rows of {Coffee | Food | Gas} × {Anytime | Early |
 * Midway | Late}, add/remove, duplicates allowed (plan_draft aggregates counts).
 * Every stop is a REAL spot from the corpus and the timing choices map to drive
 * fractions the planner verifies against MEASURED arrivals — nothing here is
 * decorative. The controls changed; the semantics and the labels did not.
 *
 * REDESIGN (SPEC "StopsBuilder"). A stop is one inset row: a LEGEND kicker
 * ("STOP 1") with a `minus.circle.fill` remove at its trailing end, then the
 * two choices as the phone's own segmented controls — a 3-way and a 4-way,
 * both within the four segments a segmented control holds (expo-native-ui
 * controls.md) — through the `ui/native` wrapper, so this file never imports
 * `@expo/ui` (SPEC rule 7). The two recessed chip tracks and the raised card
 * around them are gone: the row IS the group.
 *
 * MOTION (expo-animation gate: occasional; purpose = preventing a jarring
 * change). A row ARRIVES with `ENTER` and LEAVES with `EXIT` (exits softer and
 * shorter than entrances), and the rows around it — and the page below —
 * close the gap with `REFLOW` (RECIPES: list reflow via `LinearTransition`;
 * a plain map of at most four rows, never a virtualised list). Reduce Motion:
 * Reanimated's `System` default skips the builders, so a row simply appears.
 * Haptic: the pickers tick their own selection; nothing on add or remove.
 *
 * STABLE KEYS. A `StopRow` carries no id, and keyed by index React would
 * unmount the LAST row whenever any row is removed — so the exit would play
 * on the wrong card while the others' contents shifted underneath. Ids are
 * minted here, in the two handlers that change the list, and the render
 * reconciles only against an outside change of length.
 */

import { useRef, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  MAX_STOP_ROWS_CLIENT,
  type StopRow,
  type StopRowType,
  type StopWhen,
} from '../lib/plan_draft';
import { spacing } from '../theme';

import { Button, ENTER, EXIT, Legend, PressableScale, REFLOW, Surface, Symbol } from './ui';
import { SegmentedPicker } from './ui/native';

const TYPE_LABELS: Record<StopRowType, string> = {
  coffee: 'Coffee',
  food: 'Food',
  fuel: 'Gas',
};
const TYPES: readonly StopRowType[] = ['coffee', 'food', 'fuel'];
const TYPE_OPTIONS: readonly string[] = TYPES.map((t) => TYPE_LABELS[t]);

const WHEN_LABELS: Record<StopWhen, string> = {
  anytime: 'Anytime',
  early: 'Early',
  midway: 'Midway',
  late: 'Late',
};
const WHENS: readonly StopWhen[] = ['anytime', 'early', 'midway', 'late'];
const WHEN_OPTIONS: readonly string[] = WHENS.map((w) => WHEN_LABELS[w]);

export interface StopsBuilderProps {
  stops: StopRow[];
  onChange: (stops: StopRow[]) => void;
}

export default function StopsBuilder(props: StopsBuilderProps): ReactElement {
  const { stops, onChange } = props;

  // Stable keys for id-less rows (see the header). Reconciling in render is
  // idempotent — it only runs when the list changed outside the handlers.
  const ids = useRef<number[]>([]);
  const nextId = useRef(0);
  while (ids.current.length < stops.length) ids.current.push(nextId.current++);
  if (ids.current.length > stops.length) ids.current.length = stops.length;

  const update = (index: number, patch: Partial<StopRow>): void => {
    onChange(stops.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const remove = (index: number): void => {
    ids.current.splice(index, 1);
    onChange(stops.filter((_, i) => i !== index));
  };
  const add = (): void => {
    ids.current.push(nextId.current++);
    onChange([...stops, { type: 'coffee', when: 'anytime' }]);
  };

  return (
    <Animated.View layout={REFLOW} style={styles.root}>
      {stops.map((row, i) => {
        const n = i + 1;
        return (
          <Animated.View key={ids.current[i]} entering={ENTER} exiting={EXIT} layout={REFLOW}>
            <Surface level="inset" padding="sm" style={styles.row}>
              <View style={styles.head}>
                <Legend accessibilityRole="header">{`Stop ${n}`}</Legend>
                {/* 22pt glyph + the default 12pt slop = a 46pt target,
                    without growing the visual (expo-animation §7). */}
                <PressableScale
                  accessibilityLabel={`Remove stop ${n}`}
                  onPress={() => remove(i)}
                  style={styles.remove}
                >
                  <Symbol name="minusCircleFill" size="lg" tone="danger" />
                </PressableScale>
              </View>
              <SegmentedPicker
                label={`Stop ${n} type`}
                options={TYPE_OPTIONS}
                selectedIndex={TYPES.indexOf(row.type)}
                accessibilityHint={`Stop ${n}: ${TYPE_LABELS[row.type]}`}
                onChange={(idx) => update(i, { type: TYPES[idx] ?? 'coffee' })}
              />
              <SegmentedPicker
                label={`Stop ${n} timing`}
                options={WHEN_OPTIONS}
                selectedIndex={WHENS.indexOf(row.when)}
                accessibilityHint={`Stop ${n} timing: ${WHEN_LABELS[row.when]}`}
                onChange={(idx) => update(i, { when: WHENS[idx] ?? 'anytime' })}
              />
            </Surface>
          </Animated.View>
        );
      })}
      {stops.length < MAX_STOP_ROWS_CLIENT && (
        <Animated.View layout={REFLOW} style={styles.addButton}>
          <Button
            variant="secondary"
            title="Add a stop"
            onPress={add}
            icon={<Symbol name="plus" size="md" />}
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  row: { gap: spacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  /** Trailing, inside the row's own padding — flush to the edge, a thumb
   *  aiming at it landed on the row instead. */
  remove: { alignItems: 'center', justifyContent: 'center' },
  addButton: { alignSelf: 'flex-start' },
});
