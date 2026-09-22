/**
 * EmptyState — Android (SPEC "Shell chrome > Platform split").
 *
 * The same composition as SwiftUI's `ContentUnavailableView`, on RN: a large
 * muted `Symbol` (Ionicons on this platform), the title in the `title` role,
 * the description in muted body, centred, with the one control beneath. Same
 * props as the iOS file.
 */

import { View } from 'react-native';

import { spacing } from '../../../theme';
import { Symbol } from '../Symbol';
import { Text } from '../Text';

import type { EmptyStateProps } from './index';

/** The system's empty-state glyph is large — twice the `xl` step. */
const GLYPH_PT = 56;

export function EmptyState({
  symbol,
  title,
  description,
  action,
  testID,
  style,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View
      {...(testID !== undefined ? { testID } : {})}
      style={[
        {
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.xl,
          paddingHorizontal: spacing.gutter,
        },
        style,
      ]}
    >
      <Symbol name={symbol} size={GLYPH_PT} tone="muted" />
      <Text variant="title" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {description !== undefined ? (
        <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
          {description}
        </Text>
      ) : null}
      {action !== undefined && action !== null ? (
        <View style={{ marginTop: spacing.sm }}>{action}</View>
      ) : null}
    </View>
  );
}
