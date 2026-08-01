import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { OAB_MIN_RUN_M, outAndBack } from './outandback';

/**
 * R27 — the detector that found what three shipped detectors missed. It is
 * about to be used to contradict the eval suite, so it gets pinned hard:
 * it must fire on a real out-and-back, stay silent on a clean loop, and NOT
 * mistake ordinary road furniture for a reversal.
 *
 * Geometry is built on a metre grid at ~44°N so lengths are predictable:
 * 0.00001° lat ≈ 1.11 m; 0.00001° lng ≈ 0.80 m at this latitude.
 */

const LAT0 = 44.0;
const LNG0 = -80.0;
const M_PER_DEG_LAT = 111_320;

/** A straight north-running line of `lengthM`, sampled every `stepM`. */
function northLine(lengthM: number, stepM = 20, lng = LNG0): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let d = 0; d <= lengthM; d += stepM) pts.push([lng, LAT0 + d / M_PER_DEG_LAT]);
  return pts;
}

const ls = (coordinates: Array<[number, number]>): LineString => ({
  type: 'LineString',
  coordinates,
});

describe('outAndBack — the R27 reversal detector', () => {
  it('fires on a true out-and-back: up a road and back down the SAME road', () => {
    const up = northLine(2000);
    const down = [...up].reverse();
    const r = outAndBack(ls([...up, ...down]));
    // the return leg retraces the outbound leg
    expect(r.longestM).toBeGreaterThan(1500);
    expect(r.runs.length).toBeGreaterThan(0);
  });

  it('is SILENT on a clean rectangular loop that never reuses a road', () => {
    const side = 1500;
    const dLat = side / M_PER_DEG_LAT;
    const dLng = side / (M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180));
    const pts: Array<[number, number]> = [];
    const push = (a: [number, number], b: [number, number]): void => {
      for (let t = 0; t <= 1; t += 0.02) {
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    };
    const c1: [number, number] = [LNG0, LAT0];
    const c2: [number, number] = [LNG0 + dLng, LAT0];
    const c3: [number, number] = [LNG0 + dLng, LAT0 + dLat];
    const c4: [number, number] = [LNG0, LAT0 + dLat];
    push(c1, c2);
    push(c2, c3);
    push(c3, c4);
    push(c4, c1);
    const r = outAndBack(ls(pts));
    expect(r.totalM).toBe(0);
    expect(r.longestM).toBe(0);
  });

  it('does NOT fire on a short reversal below the run floor (roundabouts, jughandles)', () => {
    // 120 m up and back — real geometry, but not something a driver calls an
    // out-and-back. Must stay under OAB_MIN_RUN_M and report nothing.
    const up = northLine(120, 10);
    const r = outAndBack(ls([...up, ...[...up].reverse()]));
    expect(r.longestM).toBeLessThan(OAB_MIN_RUN_M);
    expect(r.totalM).toBe(0);
  });

  it('does NOT fire when the SAME road is reused in the SAME direction', () => {
    // THE false positive that would invalidate the whole audit finding: a
    // figure-eight that drives one road twice, both times northbound, returning
    // to its foot the long way round. The road IS reused — but the driver never
    // turns around on it, so this must read zero. (An earlier version of this
    // test spliced two line ends directly, which teleports 2 km southward and
    // fires legitimately; that was a bad fixture, not a bad detector.)
    const dLng = 900 / (M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180));
    const leg = northLine(1200, 20, LNG0); // the reused road, northbound
    const seg = (a: [number, number], b: [number, number]): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      for (let t = 0; t <= 1; t += 0.02) {
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      return out;
    };
    const top: [number, number] = [LNG0, LAT0 + 1200 / M_PER_DEG_LAT];
    const foot: [number, number] = [LNG0, LAT0];
    const topE: [number, number] = [LNG0 + dLng, top[1]];
    const footE: [number, number] = [LNG0 + dLng, LAT0];
    const r = outAndBack(
      ls([
        ...leg, // northbound pass 1
        ...seg(top, topE), // east, well clear of the road
        ...seg(topE, footE), // south on a DIFFERENT road 900 m away
        ...seg(footE, foot), // west, back to the foot
        ...leg, // northbound pass 2 — same road, same direction
      ]),
    );
    expect(r.totalM).toBe(0);
  });

  it('reports WHERE the doubling is, so it can be inspected on a map', () => {
    const up = northLine(1200);
    const r = outAndBack(ls([...up, ...[...up].reverse()]));
    expect(r.runs[0]).toBeDefined();
    expect(r.runs[0]!.point[1]).toBeGreaterThan(LAT0);
    expect(r.runs[0]!.lengthM).toBeGreaterThanOrEqual(OAB_MIN_RUN_M);
  });

  it('is deterministic and safe on degenerate input', () => {
    expect(outAndBack(ls([]))).toEqual({ totalM: 0, longestM: 0, runs: [] });
    expect(outAndBack(ls([[LNG0, LAT0]]))).toEqual({ totalM: 0, longestM: 0, runs: [] });
    const g = ls([...northLine(800), ...[...northLine(800)].reverse()]);
    expect(outAndBack(g)).toEqual(outAndBack(g));
  });
});
