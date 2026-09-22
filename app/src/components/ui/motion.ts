/**
 * The module-scope motion builders (redesign — SPEC "Shell chrome > Motion
 * tokens"; SPEC rule 10).
 *
 * Every screen imports its entrance, exit and reflow from HERE and never builds
 * one inline. Two reasons, both learned the hard way:
 *
 *   1. A builder built inside a component is a new object every render, which
 *      Reanimated treats as a new animation config — the cheap way to make an
 *      entrance replay under a reader who is already looking at it. Module
 *      scope makes identity stable for free.
 *   2. Six screens writing `FadeIn.duration(200)` by hand is six numbers that
 *      drift. The durations come from `theme.motion`; this file is the only
 *      place they meet Reanimated.
 *
 * Two forms of every ease, from ONE set of control points in `theme.motion.ease`:
 *   - `EASE_*`      Reanimated `Easing.bezier` — for `withTiming` and the
 *                   layout builders (`.easing(EASE_OUT)`).
 *   - `CSS_EASE_*`  Reanimated `cubicBezier` — for CSS transitions
 *                   (`transitionTimingFunction: CSS_EASE_OUT`). The CSS side
 *                   does not accept the `Easing` form, and a `'cubic-bezier(…)'`
 *                   string is not in its type.
 *
 * REDUCE MOTION (expo-animation §9: fewer and gentler, not zero). Reanimated's
 * default `ReduceMotion.System` does not soften a layout animation under the
 * OS switch — it skips it, so the element simply appears. That is right for
 * `ENTER` (the 12pt rise goes) but wrong for the fade that should remain, so
 * `ENTER_REDUCED` is the fade that still plays: `ReduceMotion.Never` on an
 * opacity-only builder at the cross-fade duration. `useEntering()` picks
 * between the two so a screen writes `entering={useEntering()}` and ships
 * Reduce Motion with the animation, not as a follow-up.
 *
 * `useReducedMotion` is Reanimated's — synchronous on the first render, no
 * cold-launch window (the one `ui/press.ts`'s cache documents). It is exported
 * under its Reanimated name; the legacy `useReduceMotion` (no "d") stays in
 * `press.ts` until the final sweep.
 */

import {
  cubicBezier,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useReducedMotion,
} from 'react-native-reanimated';

import { motion } from '../../theme';

// --- Eases -------------------------------------------------------------------

/** Strong ease-out for UI — entering, exiting, press. The default. */
export const EASE_OUT = Easing.bezier(...motion.ease.out);
/** On-screen movement and morphing. */
export const EASE_IN_OUT = Easing.bezier(...motion.ease.inOut);
/** The iOS sheet curve: a programmatic detent change (`withTiming(…, 300)`). */
export const EASE_SHEET = Easing.bezier(...motion.ease.sheet);

/** The same three curves for CSS transitions (`transitionTimingFunction`). */
export const CSS_EASE_OUT = cubicBezier(...motion.ease.out);
export const CSS_EASE_IN_OUT = cubicBezier(...motion.ease.inOut);
export const CSS_EASE_SHEET = cubicBezier(...motion.ease.sheet);

// --- Layout builders -----------------------------------------------------------

/** Content ARRIVING — it comes from somewhere, so it travels (a short rise).
 *  Never on a virtualised row (SPEC rule 10): animate the list container. */
export const ENTER = FadeInDown.duration(motion.enter).easing(EASE_OUT);

/** Content swapping IN PLACE — it did not come from anywhere, so it does not
 *  travel. Opacity only. */
export const ENTER_FADE = FadeIn.duration(motion.enterFade);

/** Exits are softer and shorter than entrances. */
export const EXIT = FadeOut.duration(motion.exit);

/** A list closing the gap a row left (`layout` / `itemLayoutAnimation`). */
export const REFLOW = LinearTransition.duration(motion.reflow);

/** The entrance under Reduce Motion: the fade stays, the rise goes. It must be
 *  told `Never`, or `System` would skip it too and the element would pop. */
export const ENTER_REDUCED = FadeIn.duration(motion.crossFade).reduceMotion(ReduceMotion.Never);

/** Stagger for the i-th sibling in a plain (non-virtualised) map, in ms.
 *  Capped so the tail of a long list never makes the reader wait. */
export function stagger(i: number): number {
  return Math.min(Math.max(0, i), motion.staggerCap) * motion.stagger;
}

/** `entering={useEntering()}` — `ENTER`, or `ENTER_REDUCED` under Reduce Motion. */
export function useEntering(): typeof ENTER | typeof ENTER_REDUCED {
  return useReducedMotion() ? ENTER_REDUCED : ENTER;
}

export { useReducedMotion };
