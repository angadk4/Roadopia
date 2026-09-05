/**
 * Best-effort external hand-off UI (M9-T07; FR-115..117). Every offer here is
 * honestly framed as an approximation: the external app re-routes with its
 * own engine, Apple takes no waypoints at all, and a loop is NEVER claimed to
 * survive the trip (verification §17). Follow-mode stays the primary way to
 * drive the actual shape — this section exists for "I just want my usual nav
 * app" moments, within documented limits.
 *
 * Device pass (2026-09-04, owner decision: Apple stays A→B-only): the loop
 * caption now SAYS Apple Maps cannot take a loop, so its absence reads as
 * intended rather than broken; the Apple button exists only on iOS; and a
 * refused open is shown instead of swallowed.
 */

import type { Route } from '@shared/types';
import { useState, type ReactElement } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { buildHandoffOptions } from '../lib/handoff';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface HandoffSectionProps {
  route: Route;
  /** Injectable for tests. */
  openFn?: (url: string) => Promise<unknown>;
  /** Injectable: Apple Maps exists only on iOS. Defaults to Platform.OS. */
  platform?: string;
}

export default function HandoffSection(props: HandoffSectionProps): ReactElement | null {
  const { colors } = useTheme();
  const open = props.openFn ?? ((url: string) => Linking.openURL(url));
  const isIos = (props.platform ?? Platform.OS) === 'ios';
  const options = buildHandoffOptions(props.route);
  const [problem, setProblem] = useState<string | null>(null);

  const hasAnything =
    options.atob !== null || options.googleLoop !== null || options.legs.length > 0;
  if (!hasAnything) return null;

  const launch = (url: string): void => {
    setProblem(null);
    // Linking.openURL rejects when no app can take the URL; unhandled, the
    // button silently did nothing.
    open(url).catch(() => setProblem('Couldn’t open that app on this phone.'));
  };

  const pair = (label: string, apple: string | null, google: string | null): ReactElement => (
    <View style={styles.row} key={label}>
      <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      {isIos && apple !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${label} in Apple Maps`}
          onPress={() => launch(apple)}
          style={[styles.btn, { borderColor: colors.border }]}
        >
          <Text style={[styles.btnLabel, { color: colors.text }]}>Apple</Text>
        </Pressable>
      )}
      {google !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${label} in Google Maps`}
          onPress={() => launch(google)}
          style={[styles.btn, { borderColor: colors.border }]}
        >
          <Text style={[styles.btnLabel, { color: colors.text }]}>Google</Text>
        </Pressable>
      )}
    </View>
  );

  const caption = props.route.is_loop
    ? `${isIos ? 'Apple Maps can’t take a loop, so it isn’t offered here. ' : ''}Google gets a rough approximation and re-routes with its own engine. Follow it here to drive the real shape.`
    : 'The external app picks its own roads — it may not match this route. Follow it here to drive the real shape.';

  return (
    <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.text }]}>Open in another app</Text>
      <Text style={[styles.caption, { color: colors.textMuted }]}>{caption}</Text>
      {options.atob !== null && pair('This drive (A→B)', options.atob.apple, options.atob.google)}
      {options.googleLoop !== null && pair('Rough loop (Google only)', null, options.googleLoop)}
      {options.legs.map((leg) => pair(`To ${leg.name}`, leg.apple, leg.google))}
      {problem !== null && (
        <Text style={[styles.caption, { color: colors.danger }]}>{problem}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { ...font.heading },
  caption: { ...font.caption, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowLabel: { ...font.body, flex: 1 },
  btn: {
    minHeight: HIT_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: { ...font.body },
});
