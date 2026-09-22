/**
 * The one panel primitive (BD-204).
 *
 * It replaces `{ borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg }`
 * copy-pasted into five files (ProgressScreen, RefinePanel, RouteCompare,
 * RouteDetail, ReasoningView) with no shared component. Because every one of
 * those was identical, a data panel, an input panel and a disclosure panel were
 * the same object, and the result screen read as a queue of six rectangles
 * rather than a composition.
 *
 * The measured problem it fixes: a "card" sat 1.12:1 above its ground with a
 * 1.49:1 border, which is below what an eye resolves on device. So depth here is
 * THREE signals, not one — a real fill step, a shadow, and a 1px top edge where
 * light would catch.
 *
 * LEVELS are semantic, not decorative:
 *   1 `inset`    grouped content that belongs to the page. No shadow.
 *   2 `raised`   a card — the payoff panel, a drive card.
 *
 * BD-205: the old level 3 `floating` is gone — chrome over the live map and
 * sheets are `Material` (blur + paper tint + lit edge), not a shadowed panel.
 *
 * Composition over configuration: this takes `children`, never `title`/`footer`
 * content props. A Surface with twelve content props outlives nothing.
 */

import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { elevation, radius, spacing, squircle, useTheme } from '../../theme';

export type SurfaceLevel = 'inset' | 'raised';

export interface SurfaceProps {
  level?: SurfaceLevel;
  /** Inner padding. `none` when the child manages its own (a list, an image). */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Corner scale. Defaults to `lg`. */
  corner?: 'sm' | 'md' | 'lg' | 'xl';
  /** Draw the decorative contour edge. Off by default — the fill step and the
   *  shadow already separate the surface, and an outline on every panel is the
   *  uniformity this replaces. */
  outlined?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

const PADDING = {
  none: 0,
  sm: spacing.md,
  md: spacing.lg,
  lg: spacing.xl,
} as const;

export function Surface({
  level = 'inset',
  padding = 'md',
  corner,
  outlined = false,
  style,
  children,
  testID,
}: SurfaceProps): React.JSX.Element {
  const { colors } = useTheme();

  const background = level === 'inset' ? colors.surface : colors.surfaceRaised;
  const depth = level === 'raised' ? elevation.raised : elevation.flat;
  const borderRadius = radius[corner ?? 'lg'];

  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: background,
          borderRadius,
          padding: PADDING[padding],
        },
        squircle,
        depth,
        // A 1px lit edge reads as a physical surface catching light. On an
        // inset level there is nothing above it to catch light, so it is
        // omitted rather than faked.
        level !== 'inset' && {
          borderTopWidth: 1,
          borderTopColor: colors.topEdge,
        },
        outlined && { borderWidth: 1, borderColor: colors.hairline },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The two rule weights in pt. Exported because the index rule is also drawn by
 * things that are NOT this component — the tab bar owns its top edge as a
 * border on a style object the navigator hands to React Navigation — and that
 * edge had been a `hairlineWidth` while every in-page `Rule weight="index"` drew
 * at 2pt. One structural job must not draw at two weights, and a second literal
 * `2` somewhere else is how it silently becomes two weights again.
 */
export const RULE_W = Object.freeze({ contour: 1, index: 2 });

/**
 * A horizontal rule.
 *
 * Two weights, and which one you use is a real decision: `contour` is
 * decorative texture and is deliberately sub-3:1; `index` does structural work
 * and clears 3:1 on both themes. A separator that has to be SEEN is an index
 * rule — a hairline will simply not be visible on device.
 */
export function Rule({
  weight = 'contour',
  style,
}: {
  weight?: 'contour' | 'index';
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          height: RULE_W[weight],
          backgroundColor: weight === 'index' ? colors.borderStrong : colors.hairline,
        },
        style,
      ]}
    />
  );
}
