/**
 * Minimal node-safe stand-in for 'react-native' (vitest alias — M7-T01).
 *
 * Lets component smoke tests render OUR screens with react-test-renderer in a
 * node environment: primitives become plain host elements ('rn-view' etc.), so
 * the tests catch real wiring failures (broken imports, hook misuse, crashing
 * render logic) without the native runtime. NOT a behavioural emulation.
 */

import { createElement, type ReactElement, type ReactNode } from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

function assertNoBareText(tag: string, children: ReactNode): void {
  // Mirror RN's invariant: raw strings/numbers may only sit inside <Text>.
  // On device this crashes ("Text strings must be rendered within a <Text>");
  // making it throw here turns that crash class into a CI failure.
  if (tag === 'rn-text') return;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'string' && child.trim() !== '') {
      throw new Error(`RN text invariant: bare string "${child}" inside <${tag}>`);
    }
    if (typeof child === 'number') {
      throw new Error(`RN text invariant: bare number ${child} inside <${tag}>`);
    }
  }
}

function host(tag: string) {
  return function Host(props: AnyProps): ReactElement {
    const { children, ...rest } = props;
    assertNoBareText(tag, children);
    return createElement(tag, rest, children);
  };
}

export const View = host('rn-view');
export const Text = host('rn-text');
export const ScrollView = host('rn-scrollview');
export const TextInput = host('rn-textinput');
export const ActivityIndicator = host('rn-activityindicator');

/** Pressable supports the style-as-function form used by our buttons. */
export function Pressable(
  props: AnyProps & { style?: unknown | ((state: { pressed: boolean }) => unknown) },
): ReactElement {
  const { children, style, ...rest } = props;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return createElement('rn-pressable', { ...rest, style: resolved }, children);
}

export const StyleSheet = {
  create<T>(styles: T): T {
    return styles;
  },
  flatten(style: unknown): unknown {
    return style;
  },
};

export const Platform = {
  OS: 'test',
  select<T>(options: { default?: T } & Record<string, T>): T | undefined {
    return options['test'] ?? options.default;
  },
};

export function useColorScheme(): 'dark' | 'light' {
  return 'dark';
}

export const AppState = {
  currentState: 'active' as const,
  addEventListener(): { remove(): void } {
    return { remove() {} };
  },
};
