/**
 * Shared test utilities for Roadopia packages (M0-T05).
 *
 * Grows as the deterministic planner + AI-output tests need fixtures/helpers.
 * Import relatively within `shared`, or via the `@shared/*` alias elsewhere.
 */

/** True if `actual` is within `tolerance` (a fraction, e.g. 0.1 = ±10%) of `expected`. */
export function isWithinTolerance(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= Math.abs(expected) * tolerance;
}
