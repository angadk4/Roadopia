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
 *
 * BD-204 presentation. The row was `label + two 44pt buttons` with no
 * `flexWrap` and `numberOfLines={1}` on the label, so at large Dynamic Type
 * the buttons alone overflowed the row and the label collapsed to "This
 * drive…" — losing exactly the meaning the caption above had just set up. The
 * destination now gets its own full-width line with the buttons beneath it,
 * which costs one line at default type and stops being broken at AX sizes.
 *
 * Redesign (SPEC "Shared pieces > HandoffSection"): the inset panel with a
 * `headline` became the chapter OPEN IN ANOTHER APP — a `Legend` kicker on an
 * index rule, the same atlas device every long page uses now, so the hand-off
 * reads as a section of the page rather than as one more card. Each button
 * carries `arrow.up.forward.app` (the "leaves this app" glyph); the
 * accessibilityLabels ("Open This drive (A→B) in Apple Maps") and every
 * sentence are unchanged. No motion: a section the reader scrolls to should
 * already be there.
 */

import type { Route } from '@shared/types';
import { useState, type ReactElement } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { buildHandoffOptions } from '../lib/handoff';
import { spacing } from '../theme';

import { Button, Chapter, Rule, Symbol, Text } from './ui';

export interface HandoffSectionProps {
  route: Route;
  /** Injectable for tests. */
  openFn?: (url: string) => Promise<unknown>;
  /** Injectable: Apple Maps exists only on iOS. Defaults to Platform.OS. */
  platform?: string;
}

export default function HandoffSection(props: HandoffSectionProps): ReactElement | null {
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

  const pair = (
    label: string,
    apple: string | null,
    google: string | null,
    index: number,
  ): ReactElement => (
    <View style={styles.destination} key={label}>
      {index > 0 && <Rule weight="contour" style={styles.rule} />}
      {/* full width, no truncation: the destination IS the meaning here */}
      <Text variant="bodyStrong">{label}</Text>
      <View style={styles.buttons}>
        {isIos && apple !== null && (
          <Button
            title="Apple"
            variant="secondary"
            icon={<Symbol name="arrowUpForwardApp" size="sm" tone="default" />}
            accessibilityLabel={`Open ${label} in Apple Maps`}
            onPress={() => launch(apple)}
          />
        )}
        {google !== null && (
          <Button
            title="Google"
            variant="secondary"
            icon={<Symbol name="arrowUpForwardApp" size="sm" tone="default" />}
            accessibilityLabel={`Open ${label} in Google Maps`}
            onPress={() => launch(google)}
          />
        )}
      </View>
    </View>
  );

  const caption = props.route.is_loop
    ? `${isIos ? 'Apple Maps can’t take a loop, so it isn’t offered here. ' : ''}Google gets a rough approximation and re-routes with its own engine. Follow it here to drive the real shape.`
    : 'The external app picks its own roads — it may not match this route. Follow it here to drive the real shape.';

  let index = 0;
  const rows: ReactElement[] = [];
  if (options.atob !== null) {
    rows.push(pair('This drive (A→B)', options.atob.apple, options.atob.google, index++));
  }
  if (options.googleLoop !== null) {
    rows.push(pair('Rough loop (Google only)', null, options.googleLoop, index++));
  }
  for (const leg of options.legs) {
    rows.push(pair(`To ${leg.name}`, leg.apple, leg.google, index++));
  }

  return (
    <Chapter title="Open in another app">
      <Text variant="footnote" tone="muted">
        {caption}
      </Text>
      {rows}
      {problem !== null && (
        <View style={styles.problem}>
          <View style={styles.problemMark}>
            <Symbol name="exclamationmarkCircleFill" size="sm" tone="danger" />
          </View>
          <Text variant="footnote" tone="danger" style={styles.problemText}>
            {problem}
          </Text>
        </View>
      )}
    </Chapter>
  );
}

const styles = StyleSheet.create({
  destination: { gap: spacing.sm },
  /** A rule ABOVE each destination after the first: they are siblings, not one list. */
  rule: { marginTop: spacing.xs },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  problemMark: { paddingTop: 2 },
  problemText: { flex: 1 },
});
