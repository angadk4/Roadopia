// Per-package Vitest config — re-exports the shared root base (M0-T05) so
// `pnpm -r test` scopes this run to shared/src.
export { default } from '../vitest.config';
