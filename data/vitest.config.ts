// Per-package Vitest config — re-exports the shared root base (M0-T05). The data
// package keeps its source under `curvature/` (not `src/`), so widen the include
// to that tree while still re-using the root coverage/env settings.
import base from '../vitest.config';

export default {
  ...base,
  test: {
    ...base.test,
    include: ['curvature/**/*.{test,spec}.ts'],
  },
};
