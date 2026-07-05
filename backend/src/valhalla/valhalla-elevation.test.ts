import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { computeClimb, mapHeightResponse } from './elevation';

/**
 * M2-T05 — recorded /height response (2026-07-05, v3.7.0): the engine has NO
 * elevation dataset loaded, so heights are null → the wrapper's honest-null path.
 * The climb math is covered with a synthetic non-null series.
 */
const NULL_HEIGHTS = JSON.parse(
  readFileSync(new URL('./__fixtures__/height-corridor-5pts.json', import.meta.url), 'utf8'),
) as unknown;

/** Same 5 points AFTER the Tilezen elevation build (real corridor metres ASL). */
const REAL_HEIGHTS = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/height-corridor-5pts-elevated.json', import.meta.url),
    'utf8',
  ),
) as unknown;

describe('mapHeightResponse', () => {
  it('returns null when the engine has no elevation data (recorded state)', () => {
    expect(mapHeightResponse(NULL_HEIGHTS)).toBeNull();
  });

  it('maps the recorded real-elevation corridor profile (post elevation build)', () => {
    const out = mapHeightResponse(REAL_HEIGHTS);
    expect(out).not.toBeNull();
    expect(out!.series).toHaveLength(5);
    // WGH/Niagara lakeshore corridor sits ~75–130 m ASL
    for (const p of out!.series) {
      expect(p.elev_m).toBeGreaterThan(60);
      expect(p.elev_m).toBeLessThan(130);
    }
    expect(out!.climb_m).toBeGreaterThan(0);
  });

  it('maps a real series and computes climb_m (positive deltas only)', () => {
    const out = mapHeightResponse({
      range_height: [
        [0, 100],
        [1000, 150], // +50
        [2000, 120], // -30 (ignored)
        [3000, 180], // +60
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.series).toHaveLength(4);
    expect(out!.climb_m).toBe(110);
  });

  it('drops null points but keeps a partial series', () => {
    const out = mapHeightResponse({
      range_height: [
        [0, 100],
        [500, null],
        [1000, 130],
      ],
    });
    expect(out!.series).toHaveLength(2);
    expect(out!.climb_m).toBe(30);
  });

  it('computeClimb is 0 for flat/descending series', () => {
    expect(
      computeClimb([
        { dist_m: 0, elev_m: 200 },
        { dist_m: 1000, elev_m: 150 },
      ]),
    ).toBe(0);
  });
});
