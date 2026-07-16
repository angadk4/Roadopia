/**
 * Honest placeholder screens for tabs whose features land at later milestones
 * (§18 empty-state rule: a friendly prompt, never a dead end or a fake).
 * Create/Record = M9; Saved/Profile = M8.
 */

import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { font, spacing, useTheme } from '../theme';

function Placeholder(props: { title: string; body: string }): ReactElement {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.text }]}>{props.title}</Text>
      <Text style={[styles.body, { color: colors.textMuted }]}>{props.body}</Text>
    </View>
  );
}

export function CreateScreen(): ReactElement {
  return (
    <Placeholder
      title="Create"
      body="Build a route by hand or record a drive you loved — both arrive in a later build (M9). Planning with a brief already works from the Plan tab."
    />
  );
}

export function SavedScreen(): ReactElement {
  return (
    <Placeholder
      title="Saved"
      body="Sign-in, saved routes and favourites arrive with accounts (M8). Routes you generate now live in this session."
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.xl, gap: spacing.md, justifyContent: 'center' },
  title: { ...font.title },
  body: { ...font.body, lineHeight: 21 },
});
