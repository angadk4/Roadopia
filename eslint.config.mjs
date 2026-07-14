// @ts-check
//
// Roadopia shared ESLint flat config (M0-T04).
//
// NOTE on format: the backlog named `.eslintrc.cjs` (legacy eslintrc), but ESLint 9 is
// flat-config-first and no longer reads eslintrc by default. We use the modern flat config
// here; intent (consistent TS + import lint) is unchanged. Logged in BUILD_LOG / decision-log.
//
// Prettier owns formatting; `eslint-config-prettier` (last) disables ESLint's stylistic rules.
// The React Native-specific rules for `app/` land at SPK-01/M7, when RN code actually exists.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Global ignores (a config object with only `ignores` applies repo-wide).
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'data/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    plugins: { import: importPlugin },
    rules: {
      // TS resolves modules itself, so we skip resolver-dependent rules and keep import hygiene.
      'import/order': [
        'error',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
      'import/first': 'error',
    },
  },
  {
    // CommonJS tooling configs that Expo/React Native require as .js (metro,
    // babel) — SPK-01/M7 RN toolchain files. They legitimately use module/
    // require/__dirname; treat them as CJS with Node globals.
    files: ['**/metro.config.js', '**/babel.config.js', '**/*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettier,
);
