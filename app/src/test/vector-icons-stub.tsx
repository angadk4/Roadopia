/**
 * Node-safe stand-in for '@expo/vector-icons/Ionicons' (BD-204).
 *
 * The real module crashes at IMPORT time in node: `ensure-native-module-
 * available.js` and `create-icon-set.js` both read
 * `NativeModules.RNVectorIconsManager` at module scope, so a single icon in a
 * tested screen takes the whole suite down before any assertion runs. The tab
 * bar already ships real Ionicons on device (nav/tabs.tsx:14), so this stub is
 * what lets the rest of the UI stop drawing icons as Unicode glyphs.
 *
 * The icon's NAME is rendered as a prop, not as text: four suites assert
 * `not.toContain('down')` on the serialised tree as a raw-error tripwire
 * (screens.test.tsx, saved_screen, builder_screen, record_screen), and an icon
 * named `chevron-down` inside a <Text> child would trip every one of them.
 * Kept as a prop it is still inspectable by a test that wants it, without
 * poisoning substring assertions.
 */

import { createElement, type ReactElement } from 'react';

interface IconProps {
  name?: string;
  size?: number;
  color?: string;
  style?: unknown;
  accessibilityLabel?: string;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: string;
  testID?: string;
}

export default function Ionicons(props: IconProps): ReactElement {
  return createElement('rn-icon', { ...props, iconName: props.name });
}

export { Ionicons };
