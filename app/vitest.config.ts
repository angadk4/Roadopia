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
    alias: {
      ...base.resolve.alias,
      'react-native': fileURLToPath(new URL('./src/test/rn-stub.tsx', import.meta.url)),
      'expo-constants': fileURLToPath(
        new URL('./src/test/expo-constants-stub.ts', import.meta.url),
      ),
      '@rnmapbox/maps': fileURLToPath(new URL('./src/test/rnmapbox-stub.tsx', import.meta.url)),
      'expo-location': fileURLToPath(new URL('./src/test/expo-location-stub.ts', import.meta.url)),
    },
  },
  test: {
    ...base.test,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
};
