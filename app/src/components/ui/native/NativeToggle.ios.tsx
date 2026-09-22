/**
 * NativeToggle — iOS (SPEC "Shell chrome > Platform split"; PlanForm
 * chapters SCENERY and ON THE ROUTE: "Prefer views", "Avoid highways",
 * "Paved roads only").
 *
 * A SwiftUI `Toggle` with a string label — which SwiftUI draws as the full
 * row, label leading and the switch trailing, the whole row tappable — inside
 * a `Host` that matches its height and stretches to the page column. The
 * label is drawn in Contour ink (`foregroundStyle(colors.text)`) and the
 * switch's on-state is the one action colour (`tint(colors.accent)`: a toggle
 * that is on IS a selection). `frame({ minHeight: HIT_TARGET })` keeps the
 * row on the owner's 44pt floor.
 *
 * No haptic here, on purpose: UISwitch plays its own (expo-native-ui
 * controls.md — "Switch has built-in haptics, don't add extra"), and two on
 * one flip is the glitch the policy forbids. `onIsOnChange` is the real
 * callback name (not `onValueChange`); the wrapper hands the screen an
 * RN-shaped `onChange(value)`, and never for the value it already holds
 * (native echoes the current value on appear).
 */

import { Host, Toggle } from '@expo/ui/swift-ui';
import {
  disabled as disabledModifier,
  foregroundStyle,
  frame,
  tint,
  toggleStyle,
} from '@expo/ui/swift-ui/modifiers';

import { HIT_TARGET, useTheme } from '../../../theme';

import type { NativeToggleProps } from './index';

export function NativeToggle({
  value,
  onChange,
  label,
  disabled = false,
  testID,
  style,
}: NativeToggleProps): React.JSX.Element {
  const { name, colors } = useTheme();

  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={name}
      {...(testID !== undefined ? { testID } : {})}
      style={[{ alignSelf: 'stretch' }, style]}
    >
      <Toggle
        isOn={value}
        label={label}
        onIsOnChange={(isOn) => {
          if (isOn === value) return;
          onChange(isOn);
        }}
        modifiers={[
          toggleStyle('switch'),
          tint(colors.accent),
          foregroundStyle(colors.text),
          frame({ minHeight: HIT_TARGET }),
          ...(disabled ? [disabledModifier(true)] : []),
        ]}
      />
    </Host>
  );
}
