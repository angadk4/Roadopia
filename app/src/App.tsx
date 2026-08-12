/**
 * Roadopia root component (M7-T01). Replaces the SPK-01 rig screen (deleted —
 * recorded in the decision log 2026-07-16): providers + bottom-tab shell.
 * Theme follows the OS (dark-first, §19); both palettes ship (§663 contrast).
 */

import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import SignInSheet from './components/SignInSheet';
import { secureSessionStore } from './lib/session_store_secure';
import { AuthProvider } from './lib/use_auth';
import RootTabs from './nav/tabs';
import { colorsFor, useTheme } from './theme';

function navTheme(name: 'dark' | 'light'): Theme {
  const base = name === 'dark' ? DarkTheme : DefaultTheme;
  const c = colorsFor(name);
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.bg,
      card: c.surfaceRaised,
      text: c.text,
      border: c.border,
    },
  };
}

export default function App(): ReactElement {
  const { name } = useTheme();
  return (
    <SafeAreaProvider>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      {/* M8-T01: auth wraps the shell; the sheet renders once at the root and
          appears only when a gated action fires while anonymous (FR-201). */}
      <AuthProvider store={secureSessionStore}>
        <NavigationContainer theme={navTheme(name)}>
          <RootTabs />
        </NavigationContainer>
        <SignInSheet />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
