/**
 * The Create/Record flow stack (M9; Master Spec §16). CreateHome offers the
 * two creation modes; Build lands at T01/T02, Record joins at T03..T05 in the
 * same stack (until then the card says so honestly — §18, never a fake).
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import BuilderScreen from '../screens/BuilderScreen';
import RecordScreen from '../screens/RecordScreen';
import { font, HIT_TARGET, radius, spacing, useTheme } from '../theme';

export type CreateStackParamList = {
  CreateHome: undefined;
  Builder: undefined;
  Record: undefined;
};

const Stack = createNativeStackNavigator<CreateStackParamList>();

function CreateHome(props: { navigate: (screen: string) => void }): ReactElement {
  const { colors } = useTheme();
  return (
    <View style={[styles.home, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.text }]}>Create</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Build a route by hand"
        onPress={() => props.navigate('Builder')}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text style={[styles.cardTitle, { color: colors.text }]}>Build by hand</Text>
        <Text style={[styles.cardBody, { color: colors.textMuted }]}>
          Drop points on the map — the route snaps to real roads as you go.
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Record a drive"
        onPress={() => props.navigate('Record')}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text style={[styles.cardTitle, { color: colors.text }]}>Record a drive</Text>
        <Text style={[styles.cardBody, { color: colors.textMuted }]}>
          Capture a drive you love as you drive it — snapped to real roads when you stop.
        </Text>
      </Pressable>
    </View>
  );
}

export default function CreateStack(): ReactElement {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surfaceRaised },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="CreateHome" options={{ headerShown: false }}>
        {(p) => <CreateHome navigate={(screen) => p.navigation.navigate(screen as never)} />}
      </Stack.Screen>
      <Stack.Screen name="Builder" options={{ title: 'Build a route' }}>
        {(p) => <BuilderScreen navigation={{ goBack: () => p.navigation.goBack() }} />}
      </Stack.Screen>
      <Stack.Screen name="Record" options={{ title: 'Record a drive' }}>
        {(p) => <RecordScreen navigation={{ goBack: () => p.navigation.goBack() }} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1, padding: spacing.xl, gap: spacing.md, justifyContent: 'center' },
  title: { ...font.title },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    minHeight: HIT_TARGET,
  },
  cardTitle: { ...font.heading },
  cardBody: { ...font.body, lineHeight: 20 },
});
