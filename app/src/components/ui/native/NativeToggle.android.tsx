/**
 * NativeToggle — Android (SPEC "Shell chrome > Platform split").
 *
 * An RN `Switch` as the trailing accessory of a `Row` (the row itself is not
 * pressable: the switch is the one control, and it carries the label, so
 * TalkBack announces "Avoid highways, switch, off" exactly once). Track and
 * thumb come from the palette — the on-track is the one action colour, the
 * off-track the index rule, so the off state is DRAWN and not merely dimmed.
 *
 * No haptic (see the iOS file). `onValueChange` is RN's name; the screen gets
 * `onChange(value)`.
 */

import { Switch } from 'react-native';

import { useTheme } from '../../../theme';
import { Row } from '../Row';
import { Text } from '../Text';

import type { NativeToggleProps } from './index';

export function NativeToggle({
  value,
  onChange,
  label,
  disabled = false,
  testID,
  style,
}: NativeToggleProps): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <Row
      style={style}
      accessory={
        <Switch
          {...(testID !== undefined ? { testID } : {})}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          accessibilityLabel={label}
          trackColor={{ false: colors.borderStrong, true: colors.accent }}
          thumbColor={colors.surfaceRaised}
          hitSlop={12}
        />
      }
    >
      <Text variant="body">{label}</Text>
    </Row>
  );
}
