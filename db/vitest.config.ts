// Per-package Vitest config — re-exports the shared root base (M0-T05). The db
// package keeps integration tests under `tests/` (SQL migrations have no src/).
import base from '../vitest.config';

export default {
  ...base,
  test: {
    ...base.test,
    include: ['tests/**/*.{test,spec}.ts'],
    // Integration tests share ONE local database — run files serially so
    // seed/cleanup in one file can never race another's assertions.
    fileParallelism: false,
  },
};
