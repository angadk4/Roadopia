/**
 * A measured value with its legend (BD-204).
 *
 * On the result screen "67.8 km" and the word "Stops" were rendered as the
 * IDENTICAL object — same size, same weight, same colour — so the screen's
 * payoff had no more visual weight than a section label. Here the number is
 * `stat`/`statLg` over an 11pt tracked uppercase legend, which is the
 * cartographic device of the direction and gives the number something to sit
 * above.
 *
 * HONESTY (Master Spec §18): a value that was never measured is NOT rendered as
 * a zero or a dash-in-a-stat-slot. Pass `value={null}` and the component
 * renders nothing at all — the caller omits the tile. RouteDetail already does
 * this deliberately for twistiness on hand-built and recorded drives, and that
 * behaviour is preserved rather than papered over with a placeholder.
 *
 * Hard rule D: these are MEASUREMENTS — distance, duration, climb, the record
 * clock. Never framed as timing, pace or anything velocity-shaped.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { spacing } from '../../theme';

import { Legend, Text, type TextTone } from './Text';

export interface StatProps {
  /** The measured value, pre-formatted. `null` renders NOTHING (see header). */
  value: string | null;
  /** The legend beneath — rendered uppercase and tracked. */
  label: string;
  /** `lg` for the one value a screen is actually about. */
  size?: 'md' | 'lg';
  tone?: TextTone;
  /** Legend above the value instead of below — for a dense row of tiles. */
  labelFirst?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Stat({
  value,
  label,
  size = 'md',
  tone = 'default',
  labelFirst = false,
  testID,
  style,
}: StatProps): React.JSX.Element | null {
  if (value === null) return null;

  const number = (
    <Text
      variant={size === 'lg' ? 'statLg' : 'stat'}
      tone={tone}
      numberOfLines={1}
      style={styles.figures}
    >
      {value}
    </Text>
  );
  const legend = <Legend>{label}</Legend>;

  return (
    <View
      testID={testID}
      // One accessible string: VoiceOver reads "67.8 km, distance", not two
      // disconnected fragments in an unpredictable order.
      accessible
      accessibilityLabel={`${value}, ${label}`}
      style={[{ gap: spacing.xs }, style]}
    >
      {labelFirst ? legend : number}
      {labelFirst ? number : legend}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Every Stat value is a measured number, and some of them tick in place (the
   *  record clock, the live distance and fix count on the capture HUD). Tabular
   *  figures stop the digits shifting sideways as they change — the craft the
   *  hand-rolled stat rows had before they adopted this primitive. */
  figures: { fontVariant: ['tabular-nums'] },
});
