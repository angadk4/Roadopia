/**
 * The shelf's physics and geometry (redesign — SPEC "Shell chrome > Shelf").
 *
 * PURE and node-tested. `ui/Shelf.tsx` is the gesture sheet; everything in it
 * that can be wrong in a way a unit test would catch — where a flick was going,
 * how far past an edge a finger is followed, which detent a release lands on,
 * how much map a detent leaves — lives here instead, so the numbers are pinned
 * without a device. The Shelf calls these from inside worklets (its pan
 * callbacks run on the UI thread), which is why each carries the `'worklet'`
 * directive: a plain function called from a worklet throws on device while
 * working fine in the debugger (expo-animation §6).
 *
 * AXIS. `y` is the sheet's VISIBLE HEIGHT in pt, measured up from the bottom of
 * its container — the same unit the detents are declared in — so "bigger" is
 * "more sheet". A gesture-handler `velocityY` points DOWN the screen; the Shelf
 * flips its sign before handing it here, and the maths below never sees a
 * screen coordinate.
 */

import { spacing } from '../theme';

/** One detent: its key (what `onDetent` reports) and its visible height. */
export interface Detent {
  readonly key: string;
  readonly height: number;
}

/**
 * Where a flick would come to rest if the finger kept decelerating — Apple's
 * exponential-decay form, not the v²/2a from physics class (expo-animation
 * RECIPES "Two worklets you'll need everywhere"). `velocity` in pt/s; the
 * answer in pt. At the default rate a 1000 pt/s flick projects ~499 pt, which
 * is what lets a short, fast swipe commit while a long, slow one does not.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  'worklet';
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * A boundary that resists instead of stopping dead. Inside `[min, max]` the
 * value passes through; past either end the overshoot is scaled down the
 * further it goes (the recipe's `(o · d · c) / (d + c · |o|)`), so the sheet
 * follows a finger over the edge but never far. `dimension` is the sheet's
 * height — the top detent — as in the recipe; a locked single-detent sheet
 * still gives a little, which is the point (Never Ship: "hard stop at a
 * boundary").
 */
export function rubberband(y: number, min: number, max: number, dimension: number = max): number {
  'worklet';
  if (y >= min && y <= max) return y;
  const edge = y > max ? max : min;
  const overshoot = y - edge;
  const constant = 0.55;
  const dim = Math.max(dimension, 1);
  return edge + (overshoot * dim * constant) / (dim + constant * Math.abs(overshoot));
}

/**
 * The detent a release lands on: the one nearest to where the flick was GOING
 * (`y + project(velocity)`), not to where the finger let go. Velocity therefore
 * wins over distance — a sheet dragged past the midpoint towards one detent
 * and flicked back still lands where the flick points — and a hard flick may
 * pass a detent, which is projection doing its job rather than a bug.
 *
 * `heights` ascending; returns the INDEX into it (the Shelf maps that to a key
 * and a spring target). Ties go to the lower detent.
 */
export function nearestDetent(y: number, velocity: number, heights: readonly number[]): number {
  'worklet';
  const target = y + project(velocity);
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < heights.length; i += 1) {
    const height = heights[i];
    if (height === undefined) continue;
    const distance = Math.abs(height - target);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The map's bottom camera inset for a COMMITTED detent (SPEC MapHome: "bottom
 * = committed shelf detent height + spacing.md"). Committed, never in flight:
 * the camera fits into the map the shelf leaves visible and never re-fits on a
 * free drag.
 */
export function cameraInsetFor(detentHeight: number): number {
  return detentHeight + spacing.md;
}

/** The detent record as an ascending list — the shape the worklets read. */
export function sortDetents(detents: Readonly<Record<string, number>>): Detent[] {
  return Object.entries(detents)
    .map(([key, height]) => ({ key, height }))
    .sort((a, b) => a.height - b.height);
}
