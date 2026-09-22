// Per-package Vitest config (M0-T05 base + M7-T01 app extensions):
//   - include .tsx tests (component smoke via react-test-renderer);
//   - alias 'react-native' + 'expo-constants' to node-safe stubs so OUR
//     components render in node without the native runtime. Pure lib modules
//     (api/sse/plan_stream) import neither and run unaliased.
import { fileURLToPath } from 'node:url';

import base from '../vitest.config';

export default {
  ...base,
  resolve: {
    // Redesign (SPEC "Shell chrome > Platform split"): `.ios.tsx` FIRST, so a
    // node test that imports `components/ui/native/SegmentedPicker` gets the
    // iOS tree — the `@expo/ui` swift-ui wrappers, rendered against the stub
    // aliased below — the same way Metro resolves it on an iPhone. The
    // `.android.tsx` twins are device-verified; `native.test.tsx` proves they
    // render by naming each `.android` path explicitly. tsc agrees through
    // `moduleSuffixes: ['.ios', '']` in tsconfig.json. The rest of the list is
    // Vite's own order for the extensions this tree uses.
    extensions: ['.ios.tsx', '.ios.ts', '.tsx', '.ts', '.mjs', '.js', '.json'],
    alias: {
      ...base.resolve.alias,
      'react-native': fileURLToPath(new URL('./src/test/rn-stub.tsx', import.meta.url)),
      'expo-constants': fileURLToPath(
        new URL('./src/test/expo-constants-stub.ts', import.meta.url),
      ),
      '@rnmapbox/maps': fileURLToPath(new URL('./src/test/rnmapbox-stub.tsx', import.meta.url)),
      'expo-location': fileURLToPath(new URL('./src/test/expo-location-stub.ts', import.meta.url)),
      'expo-keep-awake': fileURLToPath(
        new URL('./src/test/expo-keep-awake-stub.ts', import.meta.url),
      ),
      'react-native-safe-area-context': fileURLToPath(
        new URL('./src/test/safe-area-stub.ts', import.meta.url),
      ),
      // BD-204: the real Ionicons module reads NativeModules at import scope,
      // so one icon in a tested screen takes the suite down before it runs.
      // Both specifiers are aliased — tabs.tsx imports the deep path.
      '@expo/vector-icons/Ionicons': fileURLToPath(
        new URL('./src/test/vector-icons-stub.tsx', import.meta.url),
      ),
      '@expo/vector-icons': fileURLToPath(
        new URL('./src/test/vector-icons-stub.tsx', import.meta.url),
      ),
      // BD-205: the redesign's seven native libraries cannot load in node.
      // react-native-reanimated throws at import (its entry installs the
      // react-native-worklets runtime, which reads NativeModules at module
      // scope); react-native-gesture-handler resolves native view managers at
      // import; @expo/ui, expo-haptics, expo-blur, expo-linear-gradient and
      // expo-symbols each call requireNativeView / requireNativeModule at
      // module scope. One import in a tested screen would take the whole suite
      // down before an assertion ran, so each is aliased to a node-safe stub in
      // src/test/ that resolves animated values to plain numbers and strips
      // builders before any host element (every screen test asserts over
      // JSON.stringify(tree.toJSON()), so a cyclic host prop is suite-wide).
      //
      // Matching rule (Vite's bundled @rollup/plugin-alias): a string key
      // matches the specifier EXACTLY or as a prefix followed by '/'. So the
      // 'react-native' key above cannot capture 'react-native-reanimated',
      // '-worklets', '-gesture-handler' or '-safe-area-context' (no slash) —
      // but '@expo/ui/swift-ui' WOULD capture '@expo/ui/swift-ui/modifiers'
      // and rewrite it to '<stub>/modifiers', which is why each modifiers
      // subpath is listed BEFORE its bare parent (first match wins — the same
      // ordering the vector-icons pair relies on). All four @expo/ui specifiers
      // point at ONE file: the stub exports components and modifiers side by
      // side, iOS naming, and the app never imports a Compose-only component.
      'react-native-reanimated': fileURLToPath(
        new URL('./src/test/reanimated-stub.tsx', import.meta.url),
      ),
      'react-native-worklets': fileURLToPath(
        new URL('./src/test/worklets-stub.ts', import.meta.url),
      ),
      'react-native-gesture-handler': fileURLToPath(
        new URL('./src/test/gesture-handler-stub.tsx', import.meta.url),
      ),
      '@expo/ui/swift-ui/modifiers': fileURLToPath(
        new URL('./src/test/expo-ui-stub.tsx', import.meta.url),
      ),
      '@expo/ui/swift-ui': fileURLToPath(new URL('./src/test/expo-ui-stub.tsx', import.meta.url)),
      '@expo/ui/jetpack-compose/modifiers': fileURLToPath(
        new URL('./src/test/expo-ui-stub.tsx', import.meta.url),
      ),
      '@expo/ui/jetpack-compose': fileURLToPath(
        new URL('./src/test/expo-ui-stub.tsx', import.meta.url),
      ),
      'expo-haptics': fileURLToPath(new URL('./src/test/expo-haptics-stub.ts', import.meta.url)),
      'expo-blur': fileURLToPath(new URL('./src/test/expo-blur-stub.tsx', import.meta.url)),
      'expo-linear-gradient': fileURLToPath(
        new URL('./src/test/expo-linear-gradient-stub.tsx', import.meta.url),
      ),
      'expo-symbols': fileURLToPath(new URL('./src/test/expo-symbols-stub.tsx', import.meta.url)),
    },
  },
  test: {
    ...base.test,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
};
