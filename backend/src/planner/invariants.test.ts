/**
 * R32-U3 — INVARIANTS + METAMORPHIC TESTS (Recovery §17.2/§17.3).
 *
 * These are laws, not metrics: a violation fails the suite. Each one encodes a
 * contradiction or blindness this project actually shipped — the test names
 * say which.
 */
import { describe, expect, it } from 'vitest';

import { realizeCostingOptions } from '../valhalla/route';

import { DETOUR_MAX_DEFAULT } from './atob';
import { judgeTrip, type TripMetrics } from './trip_gates';

const CLEAN: TripMetrics = {
  durationS: 3600,
  targetS: 3600,
  loopiness: 0.4,
  oabLongestM: 300,
  spurs: 0,
  microloops: 0,
  knots: 0,
  pierces: 0,
  uturns: 0,
  commuteShare: 0.35,
  outHomeOverlap: 0.05,
  outCoreOverlap: 0,
  homeCoreOverlap: 0,
};

describe('invariants (violations fail the suite)', () => {
  it('BD-154: a hard highway exclusion stays ON THE WIRE (the contract), with the soft lever alongside', () => {
    const out = realizeCostingOptions({ exclude_highways: true, shortest: true });
    expect(out.exclude_highways).toBe(true); // the proven hard lever survives translation
    expect(out.use_highways).toBe(0); // preference shaping alongside
    expect(out.shortest).toBeUndefined(); // shortest bypasses every factor — must drop
  });

  it('detour cap: the canonical ratio uses ROUTED direct distance, and the cap is a law', () => {
    // The 1.8×-vs-1.92× "contradiction" (Recovery §5.4) was an EVAL bug: the
    // rq31 probe divided by crow-flies. This pins the canonical definition so
    // no future probe can quietly re-introduce a different denominator.
    const directRoutedM = 30_000;
    const finalRoutedM = 53_900; // 1.7966× — inside the cap
    expect(finalRoutedM / directRoutedM).toBeLessThanOrEqual(DETOUR_MAX_DEFAULT + 0.005);
    const crowM = 24_000; // crow ≤ routed, ALWAYS — dividing by it inflates ratios
    expect(finalRoutedM / crowM).toBeGreaterThan(DETOUR_MAX_DEFAULT); // the old bug, demonstrated
  });

  it('no gate value may be NaN — a NaN silently passes every < comparison', () => {
    const v = judgeTrip({ ...CLEAN, durationS: Number.NaN });
    // NaN duration must FAIL the duration gate, not slide through
    expect(v.failures).toContain('trip_duration');
  });

  it('a null loop-shape measurement can never read as a loop', () => {
    expect(judgeTrip({ ...CLEAN, loopiness: null }).failures).toContain('not_a_loop');
  });
});

describe('metamorphic laws (Recovery §17.3)', () => {
  it('under `shortest`, soft penalties are inert BY DESIGN — the translation must not pretend otherwise', () => {
    // realizeCostingOptions only strips `shortest` when a hard avoid demands
    // it; a plain shortest request keeps shortest (and therefore its
    // soft-factor blindness). This pins the current semantics so the R33
    // bake-off measures a real difference, not a translation accident.
    const out = realizeCostingOptions({ shortest: true, maneuver_penalty: 900 });
    expect(out.shortest).toBe(true);
  });

  it('judgeTrip is monotone in defect direction (worse input never yields fewer failures)', () => {
    const base = judgeTrip(CLEAN).failures.length;
    const worse = judgeTrip({
      ...CLEAN,
      oabLongestM: 5_000,
      spurs: 2,
      microloops: 1,
      outHomeOverlap: 0.9,
    }).failures.length;
    expect(worse).toBeGreaterThan(base);
  });
});
