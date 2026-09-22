/**
 * Press feedback for a BOUNDED control (redesign — SPEC "Shell chrome >
 * PressableScale"; expo-animation §7 and RECIPES "Press feedback").
 *
 * A `Pressable` whose visual box dips to `motion.pressScale` on press-in and
 * springs — no, EASES — back on press-out: a tap carries no momentum, so the
 * return is a 120ms strong ease-out, never a spring. The whole implementation
 * is a Reanimated CSS transition on `transform`: no shared value, no worklet,
 * no gesture — a two-state change is exactly what a CSS transition is for
 * (expo-animation §3: "a press scale is a CSS transition; a drag is a shared
 * value"). `setState` twice per press is fine; it is per press, not per frame.
 *
 * Feedback on press-IN, commit on press-OUT: the latency the user perceives is
 * the gap between touching and seeing something move, so the dip starts the
 * frame the finger lands. `scale` takes the label and any glyph with it, which
 * is what makes it read as physical rather than as a fade (an opacity dip fades
 * the label at the moment you are trying to read it).
 *
 * `hitSlop` 12 brings a small visual up to the 44pt target without growing it;
 * `pressRetentionOffset` 16 stops a slight finger drift from cancelling a press
 * the user meant.
 *
 * Reduce Motion is SHORTENED, never removed: 0.99 instead of 0.97. A control
 * with no feedback at all reads as broken.
 *
 * A full-width ROW must never use this — a row that scales drags its own text
 * sideways. `Row` tints instead.
 */

import { useState, type ReactNode } from 'react';
import {
  Pressable,
  type AccessibilityRole,
  type AccessibilityState,
  type Insets,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { motion } from '../../theme';

import { CSS_EASE_OUT, useReducedMotion } from './motion';

export interface PressableScaleProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  /** Extends the touch target without growing the visual. Default 12. */
  hitSlop?: number | Insets;
  /** How far a finger may drift before the press cancels. Default 16. */
  pressRetentionOffset?: number | Insets;
  testID?: string;
  /** The SCALED box — fill, border, padding go here. Merged LAST. */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export function PressableScale({
  onPress,
  onLongPress,
  disabled = false,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  hitSlop = 12,
  pressRetentionOffset = 16,
  testID,
  style,
  children,
}: PressableScaleProps): React.JSX.Element {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  const dip = reduced ? motion.pressScaleReduced : motion.pressScale;

  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
      {...(accessibilityHint !== undefined ? { accessibilityHint } : {})}
      accessibilityState={{ disabled, ...accessibilityState }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={hitSlop}
      pressRetentionOffset={pressRetentionOffset}
    >
      <Animated.View
        style={[
          {
            transform: [{ scale: pressed ? dip : 1 }],
            // transform ONLY: opacity and colour are the caller's, and a
            // disabled control recedes by its own rule, not by this one.
            transitionProperty: 'transform',
            transitionDuration: motion.press,
            transitionTimingFunction: CSS_EASE_OUT,
          },
          style,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
