/**
 * EmptyState — iOS (SPEC "Shell chrome > Platform split"; the dead ends and
 * empties on Saved, SavedRoute, Spot, Result, Follow).
 *
 * SwiftUI's `ContentUnavailableView` (iOS 17+): the large symbol, the bold
 * title, the secondary description, laid out the way the system lays out its
 * own "No Results" — inside a `Host` that matches its height and stretches to
 * the column. The glyph comes from the one semantic table (`SYMBOLS[symbol].sf`).
 * The one control beneath (`action`) is an RN `Button` the screen owns — it
 * keeps its handler and its accessibilityLabel ("Retry loading drives"), so
 * the honest copy and the control stay findable in a bare render exactly as
 * before.
 *
 * `colorScheme` follows the app theme so the system's label colours pick the
 * right scheme; the text itself stays the system's — native structure on the
 * Contour ground, not a repainted control.
 */

import { ContentUnavailableView, Host } from '@expo/ui/swift-ui';
import { View } from 'react-native';

import { spacing, useTheme } from '../../../theme';
import { SYMBOLS } from '../Symbol';

import type { EmptyStateProps } from './index';

export function EmptyState({
  symbol,
  title,
  description,
  action,
  testID,
  style,
}: EmptyStateProps): React.JSX.Element {
  const { name } = useTheme();

  return (
    <View
      {...(testID !== undefined ? { testID } : {})}
      style={[{ alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xl }, style]}
    >
      <Host matchContents={{ vertical: true }} colorScheme={name} style={{ alignSelf: 'stretch' }}>
        <ContentUnavailableView
          title={title}
          systemImage={SYMBOLS[symbol].sf}
          {...(description !== undefined ? { description } : {})}
        />
      </Host>
      {action ?? null}
    </View>
  );
}
