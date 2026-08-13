/**
 * Best-effort external hand-off UI (M9-T07; FR-115..117). Every offer here is
 * honestly framed as an approximation: the external app re-routes with its
 * own engine, Apple takes no waypoints at all, and a loop is NEVER claimed to
 * survive the trip (verification §17). Follow-mode stays the primary way to
 * drive the actual shape — this section exists for "I just want my usual nav
 * app" moments, within documented limits.
 */

import type { Route } from '@shared/types';
import type { ReactElement } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { buildHandoffOptions } from '../lib/handoff';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export interface HandoffSectionProps {
  route: Route;
  /** Injectable for tests. */
  openFn?: (url: string) => Promise<unknown>;
}

export default function HandoffSection(props: HandoffSectionProps): ReactElement | null {
  const { colors } = useTheme();
  const open = props.openFn ?? ((url: string) => Linking.openURL(url));
  const options = buildHandoffOptions(props.route);

  const hasAnything =
    options.atob !== null || options.googleLoop !== null || options.legs.length > 0;
  if (!hasAnything) return null;

  const pair = (label: string, apple: string | null, google: string | null): ReactElement => (
    <View style={styles.row} key={label}>
      <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      {apple !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${label} in Apple Maps`}
          onPress={() => void open(apple)}
          style={[styles.btn, { borderColor: colors.border }]}
        >
          <Text style={[styles.btnLabel, { color: colors.text }]}>Apple</Text>
        </Pressable>
      )}
      {google !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${label} in Google Maps`}
          onPress={() => void open(google)}
          style={[styles.btn, { borderColor: colors.border }]}
        >
          <Text style={[styles.btnLabel, { color: colors.text }]}>Google</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <View style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.text }]}>Open in another app</Text>
      <Text style={[styles.caption, { color: colors.textMuted }]}>
        {props.route.is_loop
          ? 'External apps can’t drive this loop faithfully — Google gets a rough approximation and re-routes with its own engine; Apple can only take single destinations. Follow it here to drive the real shape.'
          : 'The external app picks its own roads — it may not match this route. Follow it here to drive the real shape.'}
      </Text>
      {options.atob !== null && pair('This drive (A→B)', options.atob.apple, options.atob.google)}
      {options.googleLoop !== null && pair('Rough loop (Google only)', null, options.googleLoop)}
      {options.legs.map((leg) => pair(`To ${leg.name}`, leg.apple, leg.google))}
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
