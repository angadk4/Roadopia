/**
 * One row of the home shelf (redesign — SPEC "The Shelf": "Row = DriveCard").
 *
 * WHAT IT WAS. Discover's rail card: a 232–300 pt floating card in a
 * horizontal ScrollView, a filled "Let's go" block inside each, an RN-Animated
 * selection ring, an entrance stagger per card.
 *
 * WHAT IT IS. An ATLAS ENTRY in a vertical list, on an opaque `Surface
 * level="raised"` (the shelf is a Material, and inside a material everything
 * is an opaque tier — SPEC rule 9):
 *
 *   kicker     `LegendKey` — the line's swatch colour + the curve WORD
 *              ("Winding", never a number — Hard rule D), with a second legend
 *              beside it when the drive is a Classic; All roads rows key
 *              "Loop" / "A → B" instead.
 *   name       `title`, two lines.
 *   figures    a `Stat` row (the drive's minutes over "the drive"; distance and
 *              duration on a seed row — `null` renders nothing, never a
 *              placeholder), then the 4 pt legs bar when the row carries the
 *              three-leg split, with the honest `coreTripLabel` beneath it in
 *              tabular footnote.
 *   footnote   the honesty line, verbatim ("different way home", "~18 min to
 *              the start · quiet & rural").
 *   trailing   "Let's go" as TEXT in `accentText` + `arrow.right` — the whole
 *              card is the target, so the action is its label, not a nested
 *              button; a seed row shows the disclosure chevron instead.
 *
 * SELECTION (a line tapped on the map) is a 2 pt `accent` ring on a Reanimated
 * CSS transition on `borderColor` — a two-state change, so a CSS transition
 * and not a shared value (expo-animation §3). The duration is the theme's
 * cross-fade (140 ms; the SPEC's 150 would be a literal outside `theme.ts` —
 * rule 17). The list scrolls the selected row into view; that is the screen's
 * job.
 *
 * MOTION GATE. Tens of times a day (a list the user scrolls past) → press
 * feedback only: `PressableScale`. NO `entering` on this component — it is a
 * virtualized row, and a recycled row would replay its entrance every time it
 * scrolled back into view (expo-animation RECIPES "never `entering` on a
 * virtualized row"); the list container fades in once when a menu lands.
 */

import { type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { motion, radius, spacing, useTheme } from '../theme';

import { CSS_EASE_OUT, Legend, LegendKey, PressableScale, Stat, Surface, Symbol, Text } from './ui';

export interface DriveCardStat {
  /** MEASURED and pre-formatted; `null` renders nothing (`Stat`). */
  value: string | null;
  label: string;
}

export interface DriveCardProps {
  /** The atlas kicker: the swatch colour the line is drawn in + the word. */
  kicker: { color: string; label: string };
  /** A second legend beside the kicker ("Classic"). */
  badge?: string;
  name: string;
  stats?: readonly DriveCardStat[];
  /** The three-leg split, in seconds — draws the 4 pt legs bar. */
  legs?: { there: number; drive: number; home: number };
  /** The tabular line under the bar (`coreTripLabel`). */
  figures?: string;
  /** The honesty footnote, verbatim. */
  footnote?: string;
  /** Legend pills (character tags). */
  tags?: readonly string[];
  /** `go`: "Let's go" + arrow (the card launches the drive); `open`: a
   *  disclosure chevron (the card opens its detail). */
  trailing: 'go' | 'open';
  /** The line tapped on the map — the accent ring. */
  selected?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

/** The selection ring's weight, in pt. */
const RING_W = 2;

export default function DriveCard(props: DriveCardProps): ReactElement {
  const { colors } = useTheme();
  const selected = props.selected === true;

  return (
    <PressableScale
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={props.onPress}
      hitSlop={0}
    >
      {/* The ring is its own layer around the card: a border on the Surface
          would shift its padding when it appeared. Transitioning `borderColor`
          alone means nothing else about the row moves. */}
      <Animated.View
        style={[
          styles.ring,
          {
            borderColor: selected ? colors.accent : 'transparent',
            transitionProperty: 'borderColor',
            transitionDuration: motion.crossFade,
            transitionTimingFunction: CSS_EASE_OUT,
          },
        ]}
      >
        <Surface level="raised" padding="sm" style={styles.card}>
          <View style={styles.kickerRow}>
            <LegendKey color={props.kicker.color}>{props.kicker.label}</LegendKey>
            {props.badge !== undefined && <Legend tone="accent">{props.badge}</Legend>}
          </View>

          <Text variant="title" numberOfLines={2}>
            {props.name}
          </Text>

          {props.stats !== undefined && props.stats.some((s) => s.value !== null) && (
            <View style={styles.statRow}>
              {props.stats.map((s) => (
                <Stat key={s.label} value={s.value} label={s.label} />
              ))}
            </View>
          )}

          {props.legs !== undefined && (
            <LegsBar there={props.legs.there} drive={props.legs.drive} home={props.legs.home} />
          )}
          {props.figures !== undefined && (
            <Text variant="footnote" tone="muted" numberOfLines={2} style={styles.figures}>
              {props.figures}
            </Text>
          )}
          {props.footnote !== undefined && (
            <Text variant="footnote" tone="muted" style={styles.figures}>
              {props.footnote}
            </Text>
          )}

          {props.tags !== undefined && props.tags.length > 0 && (
            <View style={styles.tagRow}>
              {props.tags.map((t) => (
                <View key={t} style={[styles.tag, { backgroundColor: colors.fill }]}>
                  <Legend>{t.replace('_', ' ')}</Legend>
                </View>
              ))}
            </View>
          )}

          <View style={styles.trailing}>
            {props.trailing === 'go' ? (
              <>
                <Text variant="label" tone="accent">
                  Let’s go
                </Text>
                <Symbol name="arrowRight" size="sm" tone="accent" />
              </>
            ) : (
              <Symbol name="chevronRight" size="sm" tone="muted" />
            )}
          </View>
        </Surface>
      </Animated.View>
    </PressableScale>
  );
}

/**
 * The trip's three legs as one 4 pt bar: getting there (`contour`), THE DRIVE
 * (`accent`), home (`contour`) — the same key RouteDetail's bar uses, so the
 * card says what the result page will say. Static here (a list row draws no
 * chart on mount); RouteDetail's draws once, on the one page that is about it.
 */
function LegsBar(props: { there: number; drive: number; home: number }): ReactElement {
  const { colors } = useTheme();
  const segments = [
    { flex: Math.max(1, props.there), color: colors.contour },
    { flex: Math.max(1, props.drive), color: colors.accent },
    { flex: Math.max(1, props.home), color: colors.contour },
  ];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.legsBar, { backgroundColor: colors.fill }]}
    >
      {segments.map((s, i) => (
        <View key={i} style={{ flex: s.flex, backgroundColor: s.color }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: RING_W,
    // Concentric with the card beneath (inner radius + ring width).
    borderRadius: radius.lg + RING_W,
    borderCurve: 'continuous',
  },
  card: { gap: spacing.sm },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statRow: { flexDirection: 'row', gap: spacing.xl },
  legsBar: {
    flexDirection: 'row',
    height: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
    gap: 2,
    marginTop: spacing.xs,
  },
  figures: { fontVariant: ['tabular-nums'] },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
});
