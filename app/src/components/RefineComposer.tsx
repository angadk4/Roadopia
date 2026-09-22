/**
 * Inline conversational refinement (M7-T07; FR-043/FR-160s, §34 — an inline
 * affordance ON Result, never a separate screen; §16 cohesion rule 2). One
 * follow-up per send; hard constraints persist server-side (mergeConstraints).
 *
 * Redesign (SPEC "RefinePanel → RefineComposer"): succeeds `RefinePanel`,
 * which stays on disk unused until the final sweep. The raised card in the
 * Result scroll became a PINNED, Messages-style composer bar at the bottom of
 * Result — still on Result (§34), but where a conversation's reply field
 * belongs: always in reach, riding the keyboard, over a `Material` so the
 * page's content shows through beneath it. The host (ResultScreen) owns the
 * pinning (absolute, above the tab bar, inside its `KeyboardAvoidingView`) and
 * measures this bar to pad its scroll; this component is the bar itself.
 *
 * What is IN it, verbatim from the panel it replaces: "Tweak this drive" and
 * "your hard constraints carry over" in the label line; the example phrases in
 * the placeholder ("more twisty" is vetted engagement framing — Hard rule D);
 * the runner-up note; the same `MAX_BRIEF_CHARS` cap; the same
 * accessibilityLabel "Refine this drive" on the field. Send clears the field
 * and hands the text to the host — `buildRefineRequest` is unchanged.
 *
 * The field is a CAPSULE on the `fill` tier with the index rule as its ring —
 * the one opaque tier inside the material (SPEC rule 9: a material's contents
 * are opaque tiers) — with `returnKeyType="send"` so the keyboard's own key is
 * the send key too. The send control is the 36pt `arrow.up.circle.fill` glyph
 * in the action colour with `hitSlop` to the 44pt floor (expo-native-ui:
 * "44×44 pt minimum touch target — add hitSlop, don't grow the visual").
 *
 * Motion (expo-animation gate): tens-of-times tier, purpose "state
 * indication" — the glyph's enabled/disabled is a CSS transition on `opacity`
 * (0.45 ↔ 1, the cross-fade duration). Nothing else moves. No haptic: the push
 * to Progress is the feedback.
 *
 * Keyboard: `react-native-keyboard-controller` (RECIPES) is a new dependency
 * and was refused; the host's `KeyboardAvoidingView` does the job.
 */

import { useState, type ReactElement } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { MAX_BRIEF_CHARS } from '../lib/api';
import { font, HIT_TARGET, motion, radius, spacing, useTheme } from '../theme';

import { CSS_EASE_OUT, Material, PressableScale, Symbol, Text } from './ui';

export interface RefineComposerProps {
  onSend: (followUp: string) => void;
  /** An extra line under the label (e.g. which drive a tweak applies to). */
  note?: string | null;
}

/** The send glyph, in pt. Smaller than the 44pt target; `hitSlop` closes the gap. */
const SEND_GLYPH = 36;
/** How far the send glyph recedes while there is nothing to send. */
const SEND_IDLE_OPACITY = 0.45;

export default function RefineComposer(props: RefineComposerProps): ReactElement {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const empty = trimmed.length === 0;

  const send = (): void => {
    if (empty) return;
    props.onSend(trimmed);
    setText('');
  };

  return (
    <Material role="bar">
      <View style={styles.inner}>
        <Text variant="label">Tweak this drive — your hard constraints carry over.</Text>
        {props.note && (
          <Text variant="footnote" tone="notice">
            {props.note}
          </Text>
        )}
        <View style={styles.row}>
          <TextInput
            value={text}
            onChangeText={(t) => setText(t.slice(0, MAX_BRIEF_CHARS))}
            placeholder="Try “make it longer”, “more twisty” or “add a coffee stop”"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Refine this drive"
            returnKeyType="send"
            enablesReturnKeyAutomatically
            onSubmitEditing={send}
            style={[
              styles.field,
              {
                backgroundColor: colors.fill,
                borderColor: colors.borderStrong,
                color: colors.text,
              },
            ]}
          />
          <PressableScale
            accessibilityLabel="Refine"
            disabled={empty}
            onPress={send}
            hitSlop={(HIT_TARGET - SEND_GLYPH) / 2}
            style={styles.send}
          >
            <Animated.View
              style={{
                opacity: empty ? SEND_IDLE_OPACITY : 1,
                transitionProperty: 'opacity',
                transitionDuration: motion.crossFade,
                transitionTimingFunction: CSS_EASE_OUT,
              }}
            >
              <Symbol name="arrowUpCircleFill" size={SEND_GLYPH} tone="accent" />
            </Animated.View>
          </PressableScale>
        </View>
      </View>
    </Material>
  );
}

const styles = StyleSheet.create({
  inner: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: {
    flex: 1,
    minHeight: HIT_TARGET,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    ...font.body,
  },
  send: { width: SEND_GLYPH, height: SEND_GLYPH, alignItems: 'center', justifyContent: 'center' },
});
