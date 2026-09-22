/**
 * The control-level platform boundary (redesign — SPEC "Shell chrome >
 * Platform split"; SPEC rules 7 and 8).
 *
 * `@expo/ui` is imported ONLY inside this directory, one thin wrapper per
 * control, each as an `.ios.tsx` (the `@expo/ui/swift-ui` tree inside a
 * `Host`) with an `.android.tsx` twin on RN primitives. A screen imports the
 * bare name from here and never learns which platform it got:
 *
 *   SegmentedPicker   a 2–4-way exclusive choice — iOS segmented Picker;
 *                     Android the Chip track
 *   MenuPicker        a longer exclusive choice (the 6-way drive time) — iOS
 *                     menu Picker as a labelled row; Android a Row that opens a
 *                     single-choice dialog
 *   NativeToggle      a boolean — iOS Toggle; Android RN Switch
 *   ConfirmDialog     the destructive confirmation (SPEC rule 15) — iOS
 *                     ConfirmationDialog with a destructive Button; Android
 *                     Alert.alert with a destructive style
 *   HeaderMenu        the `ellipsis.circle` bar button — iOS Menu; Android an
 *                     Alert-style action list
 *   EmptyState        iOS ContentUnavailableView; Android Symbol + title +
 *                     description
 *
 * HOW THE THREE RESOLVERS AGREE. Metro picks `.ios.tsx` / `.android.tsx` by
 * platform at bundle time. `tsc` reads `moduleSuffixes: ['.ios', '']`
 * (app/tsconfig.json), so `./SegmentedPicker` type-resolves to the iOS file
 * and the Android twin is type-checked as a root file of its own. Vitest reads
 * `resolve.extensions` with `.ios.tsx` first (app/vitest.config.ts), so a
 * node test exercises the iOS tree against the `@expo/ui` stub; the Android
 * twins are device-verified (SPEC "Risks"), and `native.test.tsx` proves they
 * render by importing each `.android` path explicitly.
 *
 * THE CONTRACTS LIVE HERE, not in either platform file, so neither twin is the
 * other's source of truth: both `import type` from this index (erased at
 * compile time — no runtime cycle) and implement the same props. Props are
 * RN-shaped — `options`, `selectedIndex`, `onChange(index)`, `label`,
 * `actions: [{ title, role?, accessibilityLabel?, onPress }]` — and every
 * callback calls the same handler the hand-rolled control called.
 *
 * HAPTICS (SPEC "Haptics policy"; expo-animation §8 — one per user action,
 * same frame as the visual, never the only feedback): a picker tick →
 * `selectionAsync()`; a destructive confirmation → `impactAsync(Medium)`.
 * Nothing on a toggle (UISwitch plays its own — expo-native-ui controls.md:
 * "Switch has built-in haptics, don't add extra"), nothing on a menu item (a
 * destructive one leads to a ConfirmDialog, which fires), nothing on an
 * empty state.
 */

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import type { SymbolKey } from '../Symbol';

// --- Pickers ------------------------------------------------------------------

/** A 2–4-way exclusive choice (SPEC rule 8: more than 4 is a `MenuPicker`;
 *  the one 7-way choice with map colours stays swatch `Chip`s). */
export interface SegmentedPickerProps {
  /** The segment labels, in display order. 2 to 4 of them — enforced in dev. */
  options: readonly string[];
  selectedIndex: number;
  /** The same handler the chip track called. Fires once per tick, never for
   *  the index that is already selected. */
  onChange: (index: number) => void;
  /** The group's name. iOS: the Picker label (VoiceOver reads it; a segmented
   *  control does not draw it). Android: the radiogroup's label. Required —
   *  without a label the SwiftUI Picker renders nothing at all. */
  label: string;
  /** Per-segment announced name: "Set visibility private" rather than
   *  "Private". Defaults to the option text. */
  segmentAccessibilityLabel?: (option: string, index: number) => string;
  accessibilityHint?: string;
  disabled?: boolean;
  testID?: string;
  /** Merged LAST on the outer box. */
  style?: StyleProp<ViewStyle>;
}

/** An exclusive choice too long for segments — one tap shows the whole set. */
export interface MenuPickerProps {
  options: readonly string[];
  selectedIndex: number;
  /** Fires once per tick, never for the index that is already selected. */
  onChange: (index: number) => void;
  /** The row's label ("Drive time"). Drawn on both platforms. */
  label: string;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// --- Toggle -------------------------------------------------------------------

export interface NativeToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** The row's label ("Avoid highways"). Required — a SwiftUI Toggle without
   *  one has no announced name. */
  label: string;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// --- Dialog -------------------------------------------------------------------

export type DialogActionRole = 'destructive' | 'cancel';

export interface DialogAction {
  title: string;
  /** `destructive` draws red and fires the Medium haptic; `cancel` sits where
   *  the platform puts Cancel. When no action is `cancel`, the platform adds
   *  its own Cancel. */
  role?: DialogActionRole;
  accessibilityLabel?: string;
  /** Runs ONLY from this action — the op is never called by the trigger
   *  (SPEC rule 15). */
  onPress: () => void;
}

export interface ConfirmDialogProps {
  isPresented: boolean;
  /** Called with `false` when an action fires or the dialog is dismissed. */
  onIsPresentedChange: (isPresented: boolean) => void;
  title: string;
  message?: string;
  actions: readonly DialogAction[];
  testID?: string;
}

// --- Header menu --------------------------------------------------------------

export interface MenuAction {
  title: string;
  /** `destructive` draws the item red. A menu has no cancel — dismissing IS
   *  cancel. */
  role?: 'destructive';
  /** A glyph beside the title, from the one semantic table. */
  symbol?: SymbolKey;
  accessibilityLabel?: string;
  onPress: () => void;
}

export interface HeaderMenuProps {
  actions: readonly MenuAction[];
  /** The announced name of the ellipsis button. Default "More actions". */
  accessibilityLabel?: string;
  testID?: string;
}

// --- Empty state --------------------------------------------------------------

export interface EmptyStateProps {
  symbol: SymbolKey;
  title: string;
  description?: string;
  /** The one control beneath — a `Button` the screen owns (Retry, Sign in,
   *  Exit), with its own handler and accessibilityLabel. */
  action?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// --- The six, platform-resolved -------------------------------------------------

export { ConfirmDialog } from './ConfirmDialog';
export { EmptyState } from './EmptyState';
export { HeaderMenu } from './HeaderMenu';
export { MenuPicker } from './MenuPicker';
export { NativeToggle } from './NativeToggle';
export { SegmentedPicker } from './SegmentedPicker';
