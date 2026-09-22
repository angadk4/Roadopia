/**
 * The Roadopia primitive library (BD-204).
 *
 * One import site for every shared visual primitive, so a screen never reaches
 * past it for a raw `View` + hardcoded style. Tokens live in `src/theme.ts`;
 * these components are the only things allowed to consume them structurally.
 *
 *   Surface / Rule   panels and separators — replaces five copy-pasted cards
 *   Text / Legend    every string picks a ROLE from the type scale
 *   Button           the tappable control, with real press feedback
 *   Chip             a choice in a group — a pill, not a rounded box
 *   Row              a full-width tappable line; tints, never scales
 *   Stat             a MEASURED value over its legend; null renders nothing
 *
 * The redesign's shell (SPEC "Shell chrome", BD-205) adds:
 *
 *   Symbol           SF Symbols on iOS, Ionicons on Android, one semantic table
 *   Material         blur + paper tint + lit edge; never nested; solid under
 *                    Reduce Transparency
 *   PressableScale   the CSS-transition press dip every bounded control uses
 *   motion.ts        module-scope Reanimated builders (ENTER / EXIT / REFLOW …)
 *                    and the eases, in both Reanimated and CSS form
 *   Chapter          a Legend kicker on an index rule — the chapter opening
 *   LegendKey        a swatch dot + Legend — "this colour means this"
 *   StatusScrim      the paper-to-nothing gradient under the status bar on a
 *                    headerless full-bleed screen
 *   Shelf            the app-owned gesture sheet (Reanimated + gesture-handler)
 *                    over the map; its physics in lib/shelf.ts
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Chapter, type ChapterProps } from './Chapter';
export { Chip, type ChipProps } from './Chip';
export { LegendKey, SWATCH_SIZE, type LegendKeyProps } from './LegendKey';
export {
  Material,
  reduceTransparencyEnabled,
  useReduceTransparency,
  type MaterialProps,
  type MaterialRole,
} from './Material';
export {
  CSS_EASE_IN_OUT,
  CSS_EASE_OUT,
  CSS_EASE_SHEET,
  EASE_IN_OUT,
  EASE_OUT,
  EASE_SHEET,
  ENTER,
  ENTER_FADE,
  ENTER_REDUCED,
  EXIT,
  REFLOW,
  stagger,
  useEntering,
  useReducedMotion,
} from './motion';
export { PressableScale, type PressableScaleProps } from './PressableScale';
export { Row, ROW_TINT_ALPHA, type RowProps } from './Row';
export { SHELF_PAN_TEST_ID, Shelf, type ShelfHandle, type ShelfProps } from './Shelf';
export { Stat, type StatProps } from './Stat';
export { STATUS_SCRIM_ALPHA, StatusScrim, type StatusScrimProps } from './StatusScrim';
export { Rule, RULE_W, Surface, type SurfaceLevel, type SurfaceProps } from './Surface';
export {
  assertSafeSymbol,
  Symbol,
  SYMBOL_SIZE,
  SYMBOLS,
  type SymbolGlyph,
  type SymbolKey,
  type SymbolProps,
} from './Symbol';
export { Legend, Text, type TextTone, type TextVariant, type UITextProps } from './Text';

// BD-205 final sweep: `Icon`, `Reveal`/`Swap` and `press.ts` (usePressScale /
// usePressFill / useEnter / useReduceMotion) were deleted once the last screen
// migrated off them. Their successors are `Symbol`, Reanimated's
// `entering`/`exiting`/`layout` from `./motion`, and `PressableScale`.
