/**
 * A map-legend key (redesign — SPEC "Shell chrome > LegendKey").
 *
 * A 10pt swatch dot in the colour something is DRAWN in, then a `Legend`: the
 * device every atlas uses to say "this colour means this". It is the kicker on
 * a drive card (amber dot · the curve word), the legs-bar key on RouteDetail
 * ("● THE DRIVE" in `accent`, "● GETTING THERE / HOME" in `contour`), the spot
 * type on SpotDetail in the spot's own map colour, and the breathing
 * RECORDING dot on the capture HUD — a colour that already has a meaning on
 * the map, carried into the chrome without inventing a second one.
 *
 * The dot is decoration: hidden from assistive tech, so the row reads as its
 * label. The label is source-case in the tree (`Legend` uppercases with
 * `textTransform`).
 */

import { View, type StyleProp, type ViewStyle } from 'react-native';

import { spacing } from '../../theme';

import { Legend, type TextTone } from './Text';

/** The swatch diameter, in pt. */
export const SWATCH_SIZE = 10;

export interface LegendKeyProps {
  /** The colour the keyed thing is drawn in — a theme token or a `spotColor`. */
  color: string;
  /** The label, in source case. */
  children: string;
  tone?: TextTone;
  /** Merged LAST: layout only. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function LegendKey({
  color,
  children,
  tone = 'muted',
  style,
  testID,
}: LegendKeyProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, style]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          width: SWATCH_SIZE,
          height: SWATCH_SIZE,
          borderRadius: SWATCH_SIZE / 2,
          backgroundColor: color,
        }}
      />
      <Legend tone={tone}>{children}</Legend>
    </View>
  );
}
