/**
 * SegmentedPicker — iOS (SPEC "Shell chrome > Platform split").
 *
 * A SwiftUI segmented `Picker` inside a `Host`. The options are `Text` tags
 * carrying their INDEX, so the selection travelling to and from native is a
 * number and the screen never sees a tag value it did not choose. The `Host`
 * matches SwiftUI's height only (`matchContents: { vertical: true }`) and
 * stretches to the page column, because a segmented control outside a Form
 * sizes to its labels and the chip track it replaces was full width.
 *
 * The `label` is required by the contract for a reason visible in the Swift
 * (`PickerView.makePicker`): with neither a string label nor a label slot the
 * picker renders NOTHING. Segmented style does not draw it; VoiceOver reads it.
 *
 * Haptic: one `selectionAsync()` per tick, the frame the segment moves, and
 * never for the index that is already selected (native can echo the current
 * value on appear). Guarded in dev: 2–4 options, or it is a `MenuPicker`.
 */

import { Host, Picker, Text } from '@expo/ui/swift-ui';
import {
  accessibilityHint as accessibilityHintModifier,
  accessibilityLabel,
  disabled as disabledModifier,
  pickerStyle,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { selectionAsync } from 'expo-haptics';

import { useTheme } from '../../../theme';

import type { SegmentedPickerProps } from './index';

/** SPEC rule 8, enforced where a dev sees it. No-op in a release bundle. */
function assertSegmentCount(options: readonly string[]): void {
  if (process.env.NODE_ENV === 'production') return;
  if (options.length < 2 || options.length > 4) {
    throw new Error(
      `SegmentedPicker: ${options.length} options — a segmented control holds 2 to 4 choices; ` +
        'more is a MenuPicker (one tap shows the whole set).',
    );
  }
}

export function SegmentedPicker({
  options,
  selectedIndex,
  onChange,
  label,
  segmentAccessibilityLabel,
  accessibilityHint,
  disabled = false,
  testID,
  style,
}: SegmentedPickerProps): React.JSX.Element {
  assertSegmentCount(options);
  const { name } = useTheme();

  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={name}
      {...(testID !== undefined ? { testID } : {})}
      style={[{ alignSelf: 'stretch' }, style]}
    >
      <Picker
        label={label}
        selection={selectedIndex}
        onSelectionChange={(index) => {
          if (index === selectedIndex) return;
          void selectionAsync();
          onChange(index);
        }}
        modifiers={[
          pickerStyle('segmented'),
          ...(accessibilityHint !== undefined
            ? [accessibilityHintModifier(accessibilityHint)]
            : []),
          ...(disabled ? [disabledModifier(true)] : []),
        ]}
      >
        {options.map((option, index) => (
          <Text
            key={option}
            modifiers={
              segmentAccessibilityLabel !== undefined
                ? [tag(index), accessibilityLabel(segmentAccessibilityLabel(option, index))]
                : [tag(index)]
            }
          >
            {option}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
