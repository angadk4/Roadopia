/**
 * The Create tab's home: the two creation modes (M9; Master Spec §16).
 *
 * Redesign (SPEC "CreateHome"). It WAS a headerless, vertically centred column
 * — "Create" in `display` and two `Row` cards that staggered in through
 * `useEnter`. It IS a page under the native large title (`CreateStack` sets
 * `pageOptions('Create')`; the title collapses into the bar as the page
 * scrolls — `contentInsetAdjustmentBehavior="automatic"` on the ScrollView is
 * what makes that native), and the two modes are top-aligned atlas plates: a
 * tall raised card led by its 44 pt symbol and a tracked LEGEND kicker (BY
 * HAND · AS YOU DRIVE), the mode in `title`, the honest sentence in `body`,
 * and a trailing chevron because the plate navigates.
 *
 * No entrance animation. A tab root is opened dozens of times a day, and the
 * expo-animation frequency gate puts that tier at "no animation" — the
 * stagger the old cards carried is deleted rather than ported. The press is
 * `PressableScale`: a bounded card may scale (a full-width row may not), and
 * the 120 ms dip is the near-imperceptible feedback that tier allows.
 *
 * Copy is unchanged, word for word (§18): both modes exist and each sentence
 * promises exactly what the screen behind it keeps. The accessibility labels
 * ("Build a route by hand" / "Record a drive") are the ones the test presses.
 */

import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Legend, PressableScale, Surface, Symbol, Text, type SymbolKey } from '../components/ui';
import { useTabBarHeight } from '../lib/insets';
import { spacing, useTheme } from '../theme';

export interface CreateHomeProps {
  navigate: (screen: string) => void;
}

/** A plate is tall enough to read as a page in its own right, not a row. */
const PLATE_MIN_H = 168;
/** The mode's symbol leads the plate at the payoff-mark size. */
const PLATE_SYMBOL = 44;

/**
 * One creation mode as an atlas plate: symbol top-left, kicker, title, the
 * sentence, chevron trailing. The whole card is the target.
 */
function ModePlate(props: {
  symbol: SymbolKey;
  kicker: string;
  title: string;
  body: string;
  label: string;
  onPress: () => void;
}): ReactElement {
  return (
    // hitSlop 0: the plate already clears the 44 pt floor by four times, and
    // slop between two stacked plates would make the gap ambiguous.
    <PressableScale onPress={props.onPress} accessibilityLabel={props.label} hitSlop={0}>
      <Surface level="raised" padding="lg" style={styles.plate}>
        <View style={styles.plateColumn}>
          <Symbol name={props.symbol} size={PLATE_SYMBOL} tone="accent" />
          <View style={styles.plateText}>
            <Legend>{props.kicker}</Legend>
            <Text variant="title">{props.title}</Text>
            <Text variant="body" tone="muted">
              {props.body}
            </Text>
          </View>
        </View>
        {/* `chevronRight` — never a name containing "down" (see Symbol). */}
        <Symbol name="chevronRight" size="md" tone="muted" />
      </Surface>
    </PressableScale>
  );
}

export default function CreateHome(props: CreateHomeProps): ReactElement {
  const { colors } = useTheme();
  const tabBarHeight = useTabBarHeight();
  return (
    <ScrollView
      style={[styles.page, { backgroundColor: colors.bg }]}
      // The large title collapses natively over this; without it the header
      // is a static bar and the first plate sits under it.
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        styles.content,
        // Content scrolls under the translucent tab bar — pad by its height so
        // the last plate can be reached (SPEC "Shell chrome > Tab bar").
        { paddingBottom: tabBarHeight + spacing.xl },
      ]}
    >
      <ModePlate
        symbol="pencilAndOutline"
        kicker="By hand"
        title="Build by hand"
        body="Drop points on the map — the route snaps to real roads as you go."
        label="Build a route by hand"
        onPress={() => props.navigate('Builder')}
      />
      <ModePlate
        symbol="recordCircle"
        kicker="As you drive"
        title="Record a drive"
        body="Capture a drive you love as you drive it — snapped to real roads when you stop."
        label="Record a drive"
        onPress={() => props.navigate('Record')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  /** `gutter` is the ONE screen-edge padding; group spacing between plates.
   *  Top-aligned like a page — at accessibility text sizes the plates outgrow
   *  the screen, and a page scrolls where a centred column clipped. */
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  plate: {
    minHeight: PLATE_MIN_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  plateColumn: { flex: 1, gap: spacing.md },
  plateText: { gap: spacing.xs },
});
