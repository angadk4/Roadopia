/**
 * Reasoning-transparency view (M7-T06; Hard rule I; release gate RG-5).
 *
 * A collapsible "How this route was built" section inside route detail (§16
 * cohesion rule 3). It renders ONLY the four permitted kinds of content:
 * pipeline steps · tool calls · grounded results (counts) · validated-output
 * notes (parser/explain source details). There is NO other input: the data is
 * the same timeline the progress screen assembled from schema-validated
 * GenerationEvents — the wire schema has no field that could carry model
 * reasoning, and off-schema frames are dropped before decoding. The backend
 * additionally asserts no reasoning-like keys ever appear in any frame
 * (backend/src/routes/plan-sse.test.ts).
 *
 * Redesign (SPEC "Shared pieces > ReasoningView"; "Why this and not the
 * others"): the disclosure stays HAND-ROLLED — a SwiftUI `DisclosureGroup`
 * that resizes its Host inside an RN scroll is a device risk with no feature
 * gain, and `reasoning.test` stays verbatim. What changed is how it moves:
 *   - The header's press tint and the chevron's 90° turn are Reanimated CSS
 *     TRANSITIONS (expo-animation §3: "a state-driven change with no gesture"
 *     is a transition, not a shared value). The chevron is `chevron.right`
 *     rotated — never a name containing "down" (`ui/Symbol` refuses one).
 *   - Rows arrive with `FadeIn 200` and NO stagger (SPEC): the reader opened
 *     the disclosure and is waiting on exactly this content, so it fades in
 *     as one block rather than crawling in over a second.
 *
 * The body stays CONDITIONALLY MOUNTED, not hidden: reasoning.test.tsx asserts
 * the collapsed tree contains none of the step labels, and that is the right
 * contract — a disclosure that is merely invisible is still disclosed.
 */

import { useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { STEP_LABELS, toolLabel, type TimelineEntry } from '../lib/plan_run';
import { HIT_TARGET, motion, spacing, useTheme, withAlpha } from '../theme';

import {
  CSS_EASE_OUT,
  ENTER_FADE,
  ROW_TINT_ALPHA,
  Surface,
  Symbol,
  Text,
  useReducedMotion,
  type SymbolKey,
} from './ui';

export interface ReasoningViewProps {
  timeline: TimelineEntry[];
}

export default function ReasoningView(props: ReasoningViewProps): ReactElement | null {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [pressed, setPressed] = useState(false);

  if (props.timeline.length === 0) return null;

  return (
    <Surface level="inset" padding="none" style={styles.panel}>
      {/* The header is a full-width row, so it TINTS on press and never
          scales (SPEC "Shell chrome > PressableScale": a row that scales drags
          its own text). Same transition `Row` uses; not `Row` itself because
          the disclosure needs `accessibilityState.expanded`. */}
      <Animated.View
        style={{
          backgroundColor: pressed ? withAlpha(colors.accent, ROW_TINT_ALPHA) : 'transparent',
          transitionProperty: 'backgroundColor',
          transitionDuration: motion.press,
          transitionTimingFunction: CSS_EASE_OUT,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel="How this route was built"
          onPress={() => setOpen((o) => !o)}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={styles.header}
        >
          <Text variant="headline">How this route was built</Text>
          {/* 0° → 90°: the chevron points at the content it revealed. A
              rotation that explains a state change is kept under Reduce
              Motion (expo-animation §9), only shortened to a cut. */}
          <Animated.View
            style={{
              transform: [{ rotate: open ? '90deg' : '0deg' }],
              transitionProperty: 'transform',
              transitionDuration: reduced ? 0 : motion.reflow,
              transitionTimingFunction: CSS_EASE_OUT,
            }}
          >
            <Symbol name="chevronRight" size="md" tone="muted" />
          </Animated.View>
        </Pressable>
      </Animated.View>

      {open && (
        <View style={styles.body}>
          <Text variant="footnote" tone="muted" style={styles.note}>
            The deterministic pipeline's real steps and tool results from this generation — nothing
            is invented after the fact.
          </Text>
          {props.timeline.map((e, i) => (
            <TimelineRow key={i} entry={e} />
          ))}
        </View>
      )}
    </Surface>
  );
}

function TimelineRow(props: { entry: TimelineEntry }): ReactElement {
  const e = props.entry;

  const mark: { name: SymbolKey; tone: 'success' | 'muted' | 'danger' } =
    e.kind === 'step'
      ? e.status === 'completed'
        ? { name: 'checkmarkCircleFill', tone: 'success' }
        : { name: 'circle', tone: 'muted' }
      : e.ok === false
        ? { name: 'xmarkCircleFill', tone: 'danger' }
        : { name: 'gearshape', tone: 'muted' };

  return (
    <Animated.View entering={ENTER_FADE} style={[styles.row, e.kind === 'tool' && styles.toolRow]}>
      {/* the mark lives in its own fixed box so a wrapped line hang-indents */}
      <View style={styles.mark}>
        <Symbol name={mark.name} size="sm" tone={mark.tone} />
      </View>
      {e.kind === 'step' ? (
        <Text variant="footnote" style={styles.rowText}>
          {STEP_LABELS[e.step]}
          {e.detail ? (
            <Text variant="footnote" tone="muted">
              {' '}
              — {e.detail}
            </Text>
          ) : null}
        </Text>
      ) : (
        <Text variant="footnote" tone="muted" style={styles.rowText}>
          {toolLabel(e.tool)}
          {e.count !== null ? ` — ${e.count} result${e.count === 1 ? '' : 's'}` : ''}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** The header's press tint is a full-bleed rectangle; the panel clips it. */
  panel: { overflow: 'hidden' },
  header: {
    minHeight: HIT_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  note: { marginBottom: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  toolRow: { paddingLeft: spacing.lg },
  /** 2pt lead-in aligns a 14pt glyph with the footnote's cap height. */
  mark: { width: 16, alignItems: 'center', paddingTop: 2 },
  rowText: { flex: 1 },
});
