/**
 * The one text component (BD-204).
 *
 * Screens stop touching `fontSize`. Every string in the app picks a ROLE from
 * the type scale, which is how the scale stays a hierarchy instead of drifting
 * back into "everything is 15 or 16".
 *
 * `tone` is separate from `variant` on purpose: size/weight and colour are
 * independent decisions, and collapsing them is what produced the previous
 * system's habit of reaching for the accent colour to signal emphasis (amber
 * ended up carrying twelve meanings). Emphasis inside a sentence is
 * `variant="bodyStrong"`, not a colour.
 */

import type { ReactNode } from 'react';
import {
  Text as RNText,
  StyleSheet,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { font, useTheme, type ThemeColors } from '../../theme';

export type TextVariant = keyof typeof font;

/** Semantic colour roles. `accent` is the amber FOREGROUND token, which is a
 *  different value from the amber fill in light mode (the fill measures
 *  2.08:1 on white). */
export type TextTone =
  | 'default'
  | 'muted'
  | 'accent'
  | 'notice'
  | 'success'
  | 'danger'
  | 'onAccent';

const TONE: Record<TextTone, keyof ThemeColors> = {
  default: 'text',
  muted: 'textMuted',
  accent: 'accentText',
  notice: 'notice',
  success: 'success',
  danger: 'danger',
  onAccent: 'onAccent',
};

export interface UITextProps extends Omit<TextProps, 'style'> {
  variant?: TextVariant;
  tone?: TextTone;
  /** Merged LAST, so a caller can adjust layout without forking the component. */
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}

export function Text({
  variant = 'body',
  tone = 'default',
  style,
  children,
  ...rest
}: UITextProps): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <RNText {...rest} style={[font[variant], { color: colors[TONE[tone]] }, style]}>
      {children}
    </RNText>
  );
}

/**
 * A map-legend label: uppercase, tracked, muted.
 *
 * The cartographic device of the direction, and the thing that gives a measured
 * number something to sit above. Kept as its own component because the
 * uppercasing belongs with the tracking — apply one without the other and it
 * reads as shouting rather than as a legend.
 *
 * Uppercased by `textTransform`, NOT by `toUpperCase()` (redesign — SPEC
 * "Verified facts"). Same look; the difference is what is in the tree: the
 * source-case string. A heading promoted to a Legend keeps matching the
 * case-sensitive copy assertions (`'Stops'`, `'Saved drives'`), and VoiceOver
 * reads the WORD rather than spelling out a run of capitals.
 */
export function Legend({
  children,
  tone = 'muted',
  style,
  ...rest
}: Omit<UITextProps, 'variant' | 'children'> & { children: string }): React.JSX.Element {
  return (
    <Text {...rest} variant="legend" tone={tone} style={[legendStyles.upper, style]}>
      {children}
    </Text>
  );
}

const legendStyles = StyleSheet.create({
  upper: { textTransform: 'uppercase' },
});
