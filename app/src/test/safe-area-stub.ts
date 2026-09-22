/** Node-safe stand-in for 'react-native-safe-area-context' (vitest alias).
 *  Insets are zero in node; on device the real provider supplies them. */

import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function useSafeAreaInsets(): EdgeInsets {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function SafeAreaProvider(props: { children?: ReactNode }): ReactElement {
  return createElement(Fragment, null, props.children);
}

/** BD-204: the real module exports metrics read synchronously from native at
 *  startup; App.tsx seeds the provider with them so header-less screens do not
 *  render one frame at inset 0 and snap. Null in node is what the real module
 *  returns off-device, and the provider treats it as "measure normally". */
export const initialWindowMetrics: {
  insets: EdgeInsets;
  frame: { x: number; y: number; width: number; height: number };
} | null = null;
