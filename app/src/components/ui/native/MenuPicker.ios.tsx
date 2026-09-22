/**
 * MenuPicker — iOS (SPEC "Shell chrome > Platform split"; PlanForm chapter
 * DRIVE TIME: "Drive time ▸ 1 hr" — 6 > 4, so a menu; one tap shows the set).
 *
 * A labelled row: `HStack { Text(label) · Spacer · Picker(.menu) }` inside a
 * `Host` that matches SwiftUI's height and stretches to the page column. The
 * Picker keeps `label` for VoiceOver but hides it (`labelsHidden`) because the
 * row's own `Text` draws it — in Contour ink (`foregroundStyle(colors.text)`),
 * since a SwiftUI Text otherwise draws in the system label colour. The menu
 * button itself is tinted `accentText`, the one action colour as foreground.
 * `frame({ minHeight: HIT_TARGET })` keeps the row on the owner's 44pt floor
 * without fighting `matchContents` from the RN side.
 *
 * The options are `Text` tags carrying their INDEX; the selection travelling
 * to and from native is a number. Haptic: one `selectionAsync()` per tick,
 * never for the index that is already selected.
 */

import { Host, HStack, Picker, Spacer, Text } from '@expo/ui/swift-ui';
import {
  disabled as disabledModifier,
  foregroundStyle,
  frame,
  labelsHidden,
  pickerStyle,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { selectionAsync } from 'expo-haptics';

import { HIT_TARGET, useTheme } from '../../../theme';

import type { MenuPickerProps } from './index';

export function MenuPicker({
  options,
  selectedIndex,
  onChange,
  label,
  disabled = false,
  testID,
  style,
}: MenuPickerProps): React.JSX.Element {
  const { name, colors } = useTheme();

  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={name}
      {...(testID !== undefined ? { testID } : {})}
      style={[{ alignSelf: 'stretch' }, style]}
    >
      <HStack modifiers={[frame({ minHeight: HIT_TARGET })]}>
        <Text modifiers={[foregroundStyle(colors.text)]}>{label}</Text>
        <Spacer />
        <Picker
          label={label}
          selection={selectedIndex}
          onSelectionChange={(index) => {
            if (index === selectedIndex) return;
            void selectionAsync();
            onChange(index);
          }}
          modifiers={[
            pickerStyle('menu'),
            labelsHidden(),
            tint(colors.accentText),
            ...(disabled ? [disabledModifier(true)] : []),
          ]}
        >
          {options.map((option, index) => (
            <Text key={option} modifiers={[tag(index)]}>
              {option}
            </Text>
          ))}
        </Picker>
      </HStack>
    </Host>
  );
}
