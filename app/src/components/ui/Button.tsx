/**
 * The one button (BD-204).
 *
 * The owner's recorded UI bar is that buttons must LOOK tappable and every hit
 * target clears HIT_TARGET. The failure this replaces was subtler than a small
 * target: an unselected/secondary control was drawn ONLY by a 1.49:1 outline on
 * a 1.12:1 fill, so on device half of every choice was effectively not drawn.
 * `secondary` here carries a real recessed fill AND the index rule, so it is
 * visible as a control before it is read as a label.
 *
 * The primary fill takes a 1px AMBER_BRIGHT top edge. That is the same hex the
 * map already uses for its high-curvature highlight — one value, two jobs, both
 * about light catching an edge, and it ties the chrome to the route line
 * without inventing a colour.
 *
 * Press feedback is `PressableScale` (redesign — SPEC "Shell chrome >
 * PressableScale"): a scale dip on a 120 ms CSS transition, never an opacity
 * fade — fading a button fades its label at the moment you are trying to read
 * it. `hitSlop` is 0 here, not PressableScale's 12: every size of this control
 * already clears the 44pt floor, and slop on a full-size control only makes
 * two stacked buttons (Undo / Close loop, Try again / Discard) ambiguous in
 * the gap between them (expo-animation §7: add hitSlop when the VISUAL is
 * smaller than the target — it is not).
 *
 * `danger` is an OUTLINED control, not a filled one, and that is a measured
 * decision rather than a taste one. Filled, it put the `onAccent` ink on a
 * `danger` ground, which measures 2.19:1 in light (#2a1f06 on #a4231c) against a
 * 4.5:1 body floor — illegible. Danger as a FOREGROUND clears the floor on every
 * ground in both palettes (5.02:1 at the tightest, dark `surfaceRaised`), so the
 * label and the ring are both drawn in it over whatever ground the caller used.
 * A faint danger TINT behind them was measured too and rejected: at 12% over
 * dark `surfaceRaised` it pulls the label down to 4.15:1, and a primitive has to
 * be safe on every surface it can be dropped onto. theme.test.ts measures the
 * pairing this variant actually uses, on both palettes, so the trap cannot come
 * back. It is also what all three screen clusters hand-built anyway — the
 * library trash rows and the armed Discard ring on Record.
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { AMBER_BRIGHT, HIT_TARGET, radius, spacing, squircle, useTheme } from '../../theme';

import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Rendered before the title — a Symbol, never free text. */
  icon?: ReactNode;
  /** Fill the available width. A screen's single primary action usually does. */
  block?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  /** Merged LAST: callers adjust layout, not identity. */
  style?: StyleProp<ViewStyle>;
}

const SIZE = {
  md: { minHeight: HIT_TARGET, paddingHorizontal: spacing.lg, gap: spacing.sm },
  lg: { minHeight: 52, paddingHorizontal: spacing.xl, gap: spacing.md },
} as const;

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  block = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps): React.JSX.Element {
  const { colors } = useTheme();
  const inactive = disabled || loading;

  // `danger` joins `ghost` here: it is drawn by its ring and its label, never by
  // a fill. See the header for the measurements behind that.
  const fill =
    variant === 'primary' ? colors.accent : variant === 'secondary' ? colors.fill : 'transparent';

  const tone =
    variant === 'primary'
      ? ('onAccent' as const)
      : variant === 'danger'
        ? ('danger' as const)
        : variant === 'ghost'
          ? ('accent' as const)
          : ('default' as const);

  // The wrapper carries LAYOUT (`block`, the caller's `style`) outside the
  // pressable, exactly where the old outer Animated.View carried it; the
  // scaled box inside carries the visual. A column stretches its child by
  // default, so the pressable and the box fill whatever the wrapper is given.
  return (
    <View style={[block && { alignSelf: 'stretch' }, style]}>
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        {...(accessibilityHint ? { accessibilityHint } : {})}
        accessibilityState={{ busy: loading }}
        disabled={inactive}
        onPress={onPress}
        hitSlop={0}
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: fill,
            borderRadius: radius.md,
            // Disabled is communicated by the whole control receding, which
            // keeps the label's contrast against its own fill intact.
            opacity: inactive ? 0.45 : 1,
            ...SIZE[size],
          },
          squircle,
          // The index rule is the only NEUTRAL token allowed to draw a control
          // edge — `hairline` never is. A SEMANTIC control may draw its own, and
          // `danger` earns it by measurement: 5.02:1 at the tightest ground,
          // against the 3:1 boundary floor (theme.test.ts).
          variant === 'secondary' && { borderWidth: 1, borderColor: colors.borderStrong },
          variant === 'danger' && { borderWidth: 1, borderColor: colors.danger },
          variant === 'primary' && { borderTopWidth: 1, borderTopColor: AMBER_BRIGHT },
        ]}
      >
        {loading ? (
          <ActivityIndicator
            color={
              variant === 'primary'
                ? colors.onAccent
                : variant === 'danger'
                  ? colors.danger
                  : colors.accentText
            }
          />
        ) : (
          <>
            {icon !== undefined && icon !== null ? <View>{icon}</View> : null}
            <Text variant="label" tone={tone} numberOfLines={1}>
              {title}
            </Text>
          </>
        )}
      </PressableScale>
    </View>
  );
}
