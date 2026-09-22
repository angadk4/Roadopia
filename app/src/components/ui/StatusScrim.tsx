/**
 * The status-bar scrim on a headerless, full-bleed screen (redesign — SPEC
 * "Shell chrome > Status bar").
 *
 * MapHome and Follow have no native header, so the clock and the signal bars
 * sit straight on map tiles — legible on some tiles, not on others. This is a
 * single `expo-linear-gradient` from the paper (`bg` at 0.72) to nothing, the
 * height of the top inset, laid over the top edge: the status bar reads on any
 * tile, and the map under it is still the map. It replaces Follow's four
 * stacked `SCRIM_BANDS` views.
 *
 * The far stop is the SAME hue at alpha 0, not the `'transparent'` keyword:
 * `transparent` is rgba(0,0,0,0), and a CAGradientLayer interpolates towards it
 * through half-black, which paints a grey band across the middle of the fade.
 * Fading `bg` to `bg`-at-zero keeps the ramp clean in both themes.
 *
 * `pointerEvents="none"`: it must never take a touch from the map beneath it.
 */

import { LinearGradient } from 'expo-linear-gradient';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTopInset } from '../../lib/insets';
import { useTheme, withAlpha } from '../../theme';

/** The scrim's opacity at the top edge — how much paper sits under the clock. */
export const STATUS_SCRIM_ALPHA = 0.72;

export interface StatusScrimProps {
  /** Merged LAST: a caller extends the height when its controls sit under it. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function StatusScrim({ style, testID }: StatusScrimProps): React.JSX.Element {
  const { colors } = useTheme();
  const top = useTopInset();
  return (
    <LinearGradient
      testID={testID}
      pointerEvents="none"
      colors={[withAlpha(colors.bg, STATUS_SCRIM_ALPHA), withAlpha(colors.bg, 0)]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[{ position: 'absolute', top: 0, left: 0, right: 0, height: top }, style]}
    />
  );
}
