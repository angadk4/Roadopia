import { describe, expect, it } from 'vitest';

import {
  CORE_BACKROAD_SHARE_MIN,
  CORE_HIGHWAY_FLOOR_M,
  CORE_RIBBON_ENDPOINT_MIN_M,
  judgeCore,
  type CoreMetrics,
} from './core_bars';
import { TRACE_HIGHWAY_FLOOR_M } from './roadclass';

/** R25-U13 — one rulebook: the sweep, the live gate and eval all judge with
 *  THIS. Failures are named so the kill-condition histogram can name the
 *  binding constraint instead of guessing. */

const CLEAN_LOOP: CoreMetrics = {
  kind: 'loop',
  mix: { highwayShare: 0, mainShare: 0.25, backroadShare: 0.65, hoodShare: 0.03, otherShare: 0.07 },
  highwayM: 0,
  turnsPer10min: 3.1,
  uturns: 0,
  spursWide: 0,
  microloops: 0,
  loopiness: 0.4,
  corridorDoubling: null,
  endpointSeparationM: null,
  selfOverlap: null,
};

const CLEAN_RIBBON: CoreMetrics = {
  ...CLEAN_LOOP,
  kind: 'ribbon',
  loopiness: null, // NEVER judged on open geometry
  corridorDoubling: 0.05,
  endpointSeparationM: 12_000,
  selfOverlap: 0.02,
};

describe('judgeCore (R25-U13 shared rulebook)', () => {
  it('a clean loop core and a clean ribbon core pass', () => {
    expect(judgeCore(CLEAN_LOOP)).toEqual({ pass: true, failures: [] });
    expect(judgeCore(CLEAN_RIBBON)).toEqual({ pass: true, failures: [] });
  });

  it('every bar fails by NAME (the rejection histogram vocabulary)', () => {
    const bad = judgeCore({
      ...CLEAN_LOOP,
      mix: { highwayShare: 0.1, mainShare: 0.6, backroadShare: 0.2, hoodShare: 0.1, otherShare: 0 },
      highwayM: 5000,
      turnsPer10min: 7,
      uturns: 1,
      spursWide: 1,
      microloops: 1,
      loopiness: 0.1,
    });
    expect(bad.pass).toBe(false);
    expect(bad.failures).toEqual([
      'backroad_share',
      'main_share',
      'hood_share',
      'highway',
      'turns',
      'uturns',
      'spurs',
      'microloops',
      'loopiness',
    ]);
  });

  it('an untraced core NEVER passes (unknown is never sold as clean)', () => {
    const v = judgeCore({ ...CLEAN_LOOP, mix: null });
    expect(v.pass).toBe(false);
    expect(v.failures).toContain('untraced');
  });

  it('ribbons gate on their own shape bars, never loopiness', () => {
    const doubled = judgeCore({ ...CLEAN_RIBBON, corridorDoubling: 0.3 });
    expect(doubled.failures).toEqual(['corridor_doubling']);
    const tooShort = judgeCore({ ...CLEAN_RIBBON, endpointSeparationM: 3000 });
    expect(tooShort.failures).toEqual(['endpoint_separation']);
    // a figure-8 loopiness of 0 on a RIBBON is irrelevant
    expect(judgeCore({ ...CLEAN_RIBBON, loopiness: 0 }).pass).toBe(true);
  });

  it('the highway bar is the PRODUCT floor re-exported, not an invented twin', () => {
    expect(CORE_HIGHWAY_FLOOR_M).toBe(TRACE_HIGHWAY_FLOOR_M);
    expect(judgeCore({ ...CLEAN_LOOP, highwayM: CORE_HIGHWAY_FLOOR_M }).pass).toBe(true);
    expect(judgeCore({ ...CLEAN_LOOP, highwayM: CORE_HIGHWAY_FLOOR_M + 1 }).pass).toBe(false);
  });

  it('sanity: the bar constants say what ACP-001 promised', () => {
    expect(CORE_BACKROAD_SHARE_MIN).toBe(0.55);
    expect(CORE_RIBBON_ENDPOINT_MIN_M).toBe(8000);
  });
});
