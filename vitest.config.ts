/**
 * Shared Vitest base config for the Roadopia monorepo (M0-T05).
 *
 * Each workspace package has a thin `vitest.config.ts` that re-exports this, so
 * `pnpm -r test` runs `vitest run` in every package scoped to that package's own
 * `src/` — one shared set of settings, deterministic per-package test discovery.
 *
 * This is a plain config object (not wrapped in `defineConfig`) on purpose: a bare
 * `vitest/config` import here would be pulled into each package's config bundle and
 * trip a spurious UNRESOLVED_IMPORT warning. Vitest accepts a plain object directly.
 */
export default {
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
    },
  },
};
