/**
 * A full-width tappable row (BD-204).
 *
 * Rows are the app's most repeated interactive shape — a saved drive, a spot, a
 * Discover card, a settings line — and they were the worst served: a row's only
 * press feedback was an opacity dip, which fades the row's own text at the
 * moment you touch it.
 *
 * A row must NEVER scale. Scaling a full-bleed element drags its text sideways
 * and reads as a rendering bug rather than as feedback. It tints instead
 * (redesign — SPEC "Shell chrome > PressableScale": "`Row` never scales — its
 * press tint is a CSS transition on `backgroundColor` 120 ms to
 * `withAlpha(accent, 0.12)`"). A Reanimated CSS transition is the whole
 * implementation: a two-state colour change is exactly what a transition is
 * for (expo-animation §3), it runs off the JS thread, and `setState` twice per
 * press is per press, not per frame. Reduce Motion keeps it — a colour change
 * that explains a state is what §9 says to KEEP.
 *
 * Composition over configuration: `children`, plus a trailing accessory slot.
 * No `title`/`subtitle`/`badge` props — a row with twelve content props
 * outlives nothing.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { HIT_TARGET, motion, radius, spacing, squircle, useTheme, withAlpha } from '../../theme';

import { CSS_EASE_OUT } from './motion';
import { Symbol } from './Symbol';

/** The press tint's alpha over the row's rest ground. */
export const ROW_TINT_ALPHA = 0.12;

export interface RowProps {
  onPress?: () => void;
  disabled?: boolean;
  /** Draw the chevron affordance. Only when the row NAVIGATES somewhere. */
  chevron?: boolean;
  /** Replaces the chevron — a switch, a value, a count. */
  accessory?: ReactNode;
  /** Sits before the children — a Symbol or a colour dot. */
  leading?: ReactNode;
  /** 'plain' sits on the page; 'inset' carries its own recessed ground. */
  variant?: 'plain' | 'inset';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: 'button' | 'link' | 'none';
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export function Row({
  onPress,
  disabled = false,
  chevron = false,
  accessory,
  leading,
  variant = 'plain',
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  testID,
  style,
  children,
}: RowProps): React.JSX.Element {
  const { colors } = useTheme();
  const [pressed, setPressed] = useState(false);
  const rest = variant === 'inset' ? colors.surface : 'transparent';

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: HIT_TARGET,
        paddingVertical: spacing.md,
        paddingHorizontal: variant === 'inset' ? spacing.lg : 0,
      }}
    >
      {leading}
      <View style={{ flex: 1, gap: spacing.xs }}>{children}</View>
      {accessory}
      {/* `chevronRight` — NEVER a name containing "down" (see Symbol). */}
      {chevron && !accessory ? <Symbol name="chevronRight" size="md" tone="muted" /> : null}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View
        testID={testID}
        style={[{ backgroundColor: rest, borderRadius: radius.md }, squircle, style]}
      >
        {body}
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        {
          backgroundColor: pressed ? withAlpha(colors.accent, ROW_TINT_ALPHA) : rest,
          // backgroundColor ONLY — a row never scales, and its opacity is the
          // disabled rule's, not the press's.
          transitionProperty: 'backgroundColor',
          transitionDuration: motion.press,
          transitionTimingFunction: CSS_EASE_OUT,
          borderRadius: radius.md,
          opacity: disabled ? 0.45 : 1,
        },
        squircle,
        style,
      ]}
    >
      <Pressable
        testID={testID}
        accessibilityRole={accessibilityRole}
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        {...(accessibilityHint ? { accessibilityHint } : {})}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}
