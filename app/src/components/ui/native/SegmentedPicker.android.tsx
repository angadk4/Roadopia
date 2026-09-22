/**
 * SegmentedPicker — Android (SPEC "Shell chrome > Platform split").
 *
 * The existing Chip track: the recessed `Surface` that binds a mutually
 * exclusive group into one object, with a `Chip` per option (radio role,
 * amber fill when selected, the index rule when not), inside a radiogroup
 * named by `label`. Same props as the iOS file — the screen never learns
 * which one it got.
 *
 * Haptic: one `selectionAsync()` per tick, never for the selected index.
 * Guarded in dev: 2–4 options, or it is a `MenuPicker` (SPEC rule 8).
 */

import { selectionAsync } from 'expo-haptics';
import { View } from 'react-native';

import { spacing } from '../../../theme';
import { Chip } from '../Chip';
import { Surface } from '../Surface';

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

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      {...(testID !== undefined ? { testID } : {})}
      style={[{ alignSelf: 'stretch' }, style]}
    >
      <Surface
        level="inset"
        corner="lg"
        padding="none"
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.sm,
          padding: spacing.xs,
        }}
      >
        {options.map((option, index) => (
          <Chip
            key={option}
            label={option}
            selected={index === selectedIndex}
            choice="one"
            disabled={disabled}
            {...(segmentAccessibilityLabel !== undefined
              ? { accessibilityLabel: segmentAccessibilityLabel(option, index) }
              : {})}
            {...(accessibilityHint !== undefined ? { accessibilityHint } : {})}
            onPress={() => {
              if (index === selectedIndex) return;
              void selectionAsync();
              onChange(index);
            }}
          />
        ))}
      </Surface>
    </View>
  );
}
