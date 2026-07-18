// Per-package Vitest config — extends the shared root base (M0-T05) so
// `pnpm -r test` scopes this run to backend/src.
//
// R18-3: live-engine e2e files are split into their own SERIAL project. Five
// files drive the one pinned local Valhalla for real; under parallel workers
// they contend for the engine, and the heaviest brief (twisty + coffee +
// no-highways) tips over its honest 25 s wall-clock budget — a test-infra
// artifact, not a planner defect (each file passes in isolation). Serializing
// only the live files keeps the unit suite fully parallel.
//
// NOTE: `extends: true` union-merges array options (mergeConfig semantics), so
// the base `include` glob must NOT sit on this package's root `test` — a
// project-level include would be unioned with it and match every file again.
import base from '../vitest.config';

const baseTest = { ...base.test };
delete (baseTest as { include?: string[] }).include;

const LIVE_ENGINE = [
  'src/planner/planner-e2e.test.ts',
  'src/planner/atob.test.ts',
  'src/planner/loop.test.ts',
  'src/routes/plan-sse.test.ts',
  'src/routes/route-match.test.ts',
];

export default {
  ...base,
  test: {
    ...baseTest,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.{test,spec}.ts'],
          exclude: LIVE_ENGINE,
        },
      },
      {
        extends: true,
        test: {
          name: 'live-engine',
          include: LIVE_ENGINE,
          fileParallelism: false,
        },
      },
    ],
  },
};
