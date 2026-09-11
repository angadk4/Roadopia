/**
 * Safe-area helpers (device pass, 2026-09-04). Five screens render with
 * `headerShown: false`, which on an iPhone puts their first line under the
 * Dynamic Island unless they pad by the top inset themselves. App.tsx mounts
 * SafeAreaProvider; this is the one consumer, so the rule lives in one place:
 * a header-less screen pads its top by `useTopInset()`.
 */

import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The device's top inset (status bar / notch / Dynamic Island), in dp. */
export function useTopInset(): number {
  return useSafeAreaInsets().top;
}

/** The device's bottom inset (the home-indicator strip on Face ID phones), in
 *  dp. A control laid out inside it competes with the system home gesture. */
export function useBottomInset(): number {
  return useSafeAreaInsets().bottom;
}
