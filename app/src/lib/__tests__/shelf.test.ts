/**
 * The shelf's physics, pinned without a device (redesign — SPEC "Test
 * changes": `project`, `rubberband`, `nearestDetent` (velocity wins over
 * distance), `cameraInsetFor`).
 *
 * These are the numbers behind every drag of the MapHome and Builder shelves.
 * The feel is still judged on a release build on the slowest supported phone;
 * what a node test can hold is that the maths is the recipe's maths and that
 * a release decides by where the flick was going, not by where it let go.
 */

import { describe, expect, it } from 'vitest';

import { spacing } from '../../theme';
import { cameraInsetFor, nearestDetent, project, rubberband, sortDetents } from '../shelf';

/** MapHome's three detents at the iPhone 14 Pro size: collapsed / half / full. */
const HEIGHTS = [132, 409, 796] as const;

describe('project', () => {
  it('is Apple’s exponential-decay projection: ~499 pt for a 1000 pt/s flick', () => {
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(-1000)).toBeCloseTo(-499, 0);
    expect(project(0)).toBe(0);
  });

  it('scales linearly with velocity and steepens with a slower deceleration rate', () => {
    expect(project(500)).toBeCloseTo(project(1000) / 2, 6);
    expect(project(1000, 0.999)).toBeGreaterThan(project(1000, 0.998));
  });
});

describe('rubberband', () => {
  it('passes a value inside the range through untouched', () => {
    expect(rubberband(300, 132, 796)).toBe(300);
    expect(rubberband(132, 132, 796)).toBe(132);
    expect(rubberband(796, 132, 796)).toBe(796);
  });

  it('follows the finger past the top, less and less the further it goes', () => {
    const over100 = rubberband(896, 132, 796);
    const over200 = rubberband(996, 132, 796);
    expect(over100).toBeGreaterThan(796);
    expect(over100).toBeLessThan(896);
    expect(over200).toBeGreaterThan(over100);
    // Diminishing: the second 100 pt of overshoot moves the sheet less than the first.
    expect(over200 - over100).toBeLessThan(over100 - 796);
  });

  it('resists past the bottom symmetrically', () => {
    const under = rubberband(32, 132, 796);
    expect(under).toBeLessThan(132);
    expect(under).toBeGreaterThan(32);
    expect(132 - under).toBeCloseTo(rubberband(896, 132, 796) - 796, 6);
  });

  it('never stops dead — a single-detent sheet still gives a little', () => {
    // Never Ship: "hard stop at a boundary → rubber-band resistance".
    const give = rubberband(260, 160, 160);
    expect(give).toBeGreaterThan(160);
    expect(give).toBeLessThan(260);
  });
});

describe('nearestDetent', () => {
  it('with no velocity, lands on the nearest detent to where the finger let go', () => {
    expect(nearestDetent(200, 0, HEIGHTS)).toBe(0);
    expect(nearestDetent(300, 0, HEIGHTS)).toBe(1);
    expect(nearestDetent(700, 0, HEIGHTS)).toBe(2);
  });

  it('velocity wins over distance: a flick past the midpoint the wrong way lands where it points', () => {
    // Dragged from half (409) up to 620 — past the 602.5 midpoint, so distance
    // alone would say "full" — then flicked back DOWN at 400 pt/s. Projection
    // carries it ~200 pt back to 420, and it lands on half.
    expect(nearestDetent(620, -400, HEIGHTS)).toBe(1);
    // The mirror: let go just below the midpoint but flicking UP → full.
    expect(nearestDetent(590, 400, HEIGHTS)).toBe(2);
  });

  it('a hard flick may pass a detent — projection, not one step at a time', () => {
    // From collapsed, dragged to 252 and flicked up at 900 pt/s: projected
    // ~701, nearer full than half. That is the recipe's "a quick flick
    // dismisses even a few pixels down", applied to a sheet that opens.
    expect(nearestDetent(252, 900, HEIGHTS)).toBe(2);
    expect(nearestDetent(700, -1200, HEIGHTS)).toBe(0);
  });

  it('a projection past either end clamps to the end detent', () => {
    expect(nearestDetent(796, 3000, HEIGHTS)).toBe(2);
    expect(nearestDetent(132, -3000, HEIGHTS)).toBe(0);
  });

  it('ties go to the lower detent, and an empty list is index 0', () => {
    expect(nearestDetent(270.5, 0, HEIGHTS)).toBe(0); // equidistant from 132 and 409
    expect(nearestDetent(300, 0, [])).toBe(0);
  });
});

describe('cameraInsetFor', () => {
  it('is the committed detent height plus spacing.md — the map the shelf leaves visible', () => {
    expect(cameraInsetFor(409)).toBe(409 + spacing.md);
    expect(cameraInsetFor(0)).toBe(spacing.md);
  });
});

describe('sortDetents', () => {
  it('orders a record by height, ascending, keeping the keys', () => {
    expect(sortDetents({ full: 796, collapsed: 132, half: 409 })).toEqual([
      { key: 'collapsed', height: 132 },
      { key: 'half', height: 409 },
      { key: 'full', height: 796 },
    ]);
    expect(sortDetents({})).toEqual([]);
  });
});
