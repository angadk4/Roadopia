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
