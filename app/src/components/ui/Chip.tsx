/**
 * Selectable chip (BD-204).
 *
 * PlanScreen rendered 13 geometrically identical 96x44 rounded boxes, so a
 * binary toggle, a two-way choice and a six-way choice were visually the same
 * object — and each then needed a prose paragraph underneath to explain what it
 * was. Two fixes live here:
 *
 *   1. A chip is a PILL. At radius 12 a 44pt control is a rounded box; the iOS
 *      capsule is what makes it read as a choice rather than a button.
 *   2. Selection is TWO signals, not one. The amber fill plus the label flipping
 *      to the on-accent ink. Unselected carries the index rule and a recessed
 *      fill, so the alternatives are visible at all — previously the unselected
 *      half of every group was drawn only by a 1.49:1 outline.
 *
 * `accessibilityRole` is 'radio' in a single-choice group and 'checkbox' in a
 * multi-select one: VoiceOver announces "selected" for both, but only radio
 * implies the others deselect. The announced NAME is overridable — a chip in a
 * labelled group needs to carry the group's name into the announcement, and not
 * being able to was why three screens built their own pill rather than use this.
 *
 * REDESIGN (SPEC "What is deleted"): `Chip` survives — for the 7-way spot type
 * and as the Android twin inside `native/SegmentedPicker.android.tsx` — but its
 * press dip now comes from `PressableScale` (a Reanimated CSS transition), not
 * from `press.ts`'s RN-`Animated` `usePressScale`, which the final sweep deletes.
 */

import { type StyleProp, type ViewStyle } from 'react-native';

import { HIT_TARGET, radius, spacing, useTheme } from '../../theme';

import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** 'one' = a single-choice group (radio); 'many' = multi-select (checkbox). */
  choice?: 'one' | 'many';
  /**
   * Override the announced name. Defaults to the visible `label`, which is right
   * for a standalone chip and wrong for a chip inside a labelled group: the
   * visibility track has to say "Set visibility unlisted", not "Unlisted", and a
   * spot-type pill "Type Viewpoint", not "Viewpoint". Hard-coding this to
   * `label` is why three screens hand-rolled their own pill instead.
   */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Chip({
  label,
  selected = false,
  onPress,
  disabled = false,
  choice = 'one',
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ChipProps): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <PressableScale
      testID={testID}
      accessibilityRole={choice === 'one' ? 'radio' : 'checkbox'}
      accessibilityState={{ selected, checked: selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          minHeight: HIT_TARGET,
          justifyContent: 'center',
          paddingHorizontal: spacing.lg,
          borderRadius: radius.pill,
          backgroundColor: selected ? colors.accent : colors.fill,
          borderWidth: 1,
          borderColor: selected ? colors.accent : colors.borderStrong,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <Text variant="label" tone={selected ? 'onAccent' : 'default'} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}
