import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { TraceEdge } from '../valhalla/trace';

import { corridorDoublingRatio, curvyShareOf, loopiness } from './overlap';
import { arterialShareOf } from './residential';

/**
 * R18-0 — essence metrics (report-only this unit; gated later). Synthetic
 * fixtures with known answers: the metrics MUST see what the audit saw
 * (arterial domination, thin out-and-backs, parallel-corridor doubling) and
 * MUST NOT flag legitimate shapes (circles, switchbacks).
 */

const LAT0 = 43.2; // module planar-scaling latitude
const LAT_M = 111_320;
const LNG_M = 111_320 * Math.cos((43.2 * Math.PI) / 180);

/** Point dx/dy metres from a base point (planar, module convention). */
function at(dxM: number, dyM: number, base: [number, number] = [-79.9, LAT0]): [number, number] {
  return [base[0] + dxM / LNG_M, base[1] + dyM / LAT_M];
}

function line(coords: Array<[number, number]>): LineString {
  return { type: 'LineString', coordinates: coords };
}

function edge(roadClass: string, lengthM: number, use?: string): TraceEdge {
  return { roadClass, lengthM, ...(use !== undefined ? { use } : {}) };
}

describe('arterialShareOf (R18-0)', () => {
  it('length-weighted share of motorway/trunk/primary/secondary', () => {
    const share = arterialShareOf([
      edge('secondary', 4000),
      edge('primary', 1000),
      edge('tertiary', 3000),
      edge('unclassified', 2000),
    ]);
    expect(share).toBeCloseTo(0.5, 5); // 5000/10000
  });

  it('ramps/turn channels and _link classes count as arterial', () => {
    const share = arterialShareOf([
      edge('tertiary', 400, 'ramp'),
      edge('tertiary', 100, 'turn_channel'),
      edge('primary_link', 500),
      edge('unclassified', 1000),
    ]);
    expect(share).toBeCloseTo(0.5, 5);
  });

  it('pure backroads → 0; pure arterial → 1; empty → null (unknown ≠ clean)', () => {
    expect(arterialShareOf([edge('tertiary', 1000), edge('unclassified', 500)])).toBe(0);
    expect(arterialShareOf([edge('motorway', 1000), edge('trunk', 200)])).toBe(1);
    expect(arterialShareOf([])).toBeNull();
  });
});

describe('curvyShareOf (R18-0)', () => {
  it('route half on a chosen segment, half elsewhere ≈ 0.5', () => {
    // segment: 3 km west-east line; route: the same 3 km + 3 km north elsewhere
    const seg = line([at(0, 0), at(1500, 0), at(3000, 0)]);
    const route = line([at(0, 0), at(1500, 0), at(3000, 0), at(3000, 1500), at(3000, 3000)]);
    const share = curvyShareOf(route, [{ geometry: seg }]);
    expect(share).not.toBeNull();
    expect(share!).toBeGreaterThan(0.4);
    expect(share!).toBeLessThan(0.6);
  });

  it('driving a DIAGONAL segment via a phase-shifting lead-in still measures ~1 (anti-aliasing)', () => {
    // the adversarial refutation scenario for the old cell-edge version: a 45°
    // road reached after a 73 m lead-in measured as low as 0.33; the exact-
    // distance predicate must not care about resample phase
    const diag: Array<[number, number]> = [];
    for (let i = 0; i <= 40; i++) diag.push(at(i * 75, i * 75)); // 3 km at 45°
    const seg = line(diag);
    const route = line([at(-73, -10), ...diag]); // lead-in shifts the phase
    const share = curvyShareOf(route, [{ geometry: seg }]);
    expect(share).not.toBeNull();
    expect(share!).toBeGreaterThan(0.9);
  });

  it('crossings earn only the small documented floor (perpendicular ≈ 0)', () => {
    const seg = line([at(-2000, 500), at(2000, 500)]); // west-east at y=500
    // route crosses it going straight north over 4 km
    const cross = curvyShareOf(line([at(0, -1500), at(0, 500), at(0, 2500)]), [{ geometry: seg }]);
    expect(cross).not.toBeNull();
    expect(cross!).toBeLessThan(0.08); // ~3 pts within 90 m of the crossing
  });

  it('route nowhere near any segment → 0; no segments → 0; degenerate geometry never throws', () => {
    const seg = line([at(0, 10_000), at(3000, 10_000)]);
    const route = line([at(0, 0), at(3000, 0)]);
    expect(curvyShareOf(route, [{ geometry: seg }])).toBe(0);
    expect(curvyShareOf(route, [])).toBe(0);
    // degenerate segment row from the DB must be skipped, not crash the brief
    expect(curvyShareOf(route, [{ geometry: { type: 'LineString', coordinates: [] } }])).toBe(0);
    expect(curvyShareOf({ type: 'LineString', coordinates: [] }, [{ geometry: seg }])).toBeNull();
  });
});

describe('loopiness (R18-0)', () => {
  function circle(radiusM: number, n = 128): LineString {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= n; i++) {
      const t = (2 * Math.PI * i) / n;
      pts.push(at(radiusM * Math.cos(t), radiusM * Math.sin(t)));
    }
    return line(pts);
  }

  it('a circle scores near 1', () => {
    const q = loopiness(circle(3000));
    expect(q).not.toBeNull();
    expect(q!).toBeGreaterThan(0.9);
  });

  it('a thin out-and-back scores under the soft floor (0.10)', () => {
    // out 6 km, back the same way, 100 m lateral separation (parallel corridor):
    // encloses only a 0.6 km² sliver → Q ≈ 0.05, far below any real loop
    const q = loopiness(
      line([at(0, 0), at(3000, 0), at(6000, 0), at(6000, 100), at(3000, 100), at(0, 100)]),
    );
    expect(q).not.toBeNull();
    expect(q!).toBeLessThan(0.1);
  });

  it('a square loop scores well above the out-and-back band (π/4 ≈ 0.785)', () => {
    const q = loopiness(line([at(0, 0), at(4000, 0), at(4000, 4000), at(0, 4000), at(0, 0)]));
    expect(q).not.toBeNull();
    expect(q!).toBeGreaterThan(0.7);
  });

  it('KNOWN CAVEAT pinned: a symmetric figure-8 cancels to ~0 (signed shoelace)', () => {
    // documents the adversarial finding rather than hiding it: opposite-winding
    // lobes cancel, so a legitimate pretzel reads as a non-loop. Report-only +
    // p20-aggregated; revisit before ever gating on loopiness.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 64; i++) {
      const t = (2 * Math.PI * i) / 64;
      pts.push(at(1500 + 1500 * Math.cos(Math.PI + t), 1500 * Math.sin(t))); // right lobe CCW
    }
    for (let i = 0; i <= 64; i++) {
      const t = (2 * Math.PI * i) / 64;
      pts.push(at(-1500 + 1500 * Math.cos(t), 1500 * Math.sin(t))); // left lobe opposite winding
    }
    const q = loopiness(line(pts));
    expect(q).not.toBeNull();
    expect(q!).toBeLessThan(0.05); // cancellation — the pinned current behavior
  });
});

describe('corridorDoublingRatio (R18-0)', () => {
  it('out-and-back on the SAME road → high ratio (the classic there-and-back)', () => {
    const r = corridorDoublingRatio(
      line([at(0, 0), at(4000, 0), at(8000, 0), at(4000, 1), at(0, 2)]),
    );
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.4);
  });

  it('out on X, back on a PARALLEL road 250 m away → still detected (≤ 350 m lateral)', () => {
    const r = corridorDoublingRatio(
      line([at(0, 0), at(4000, 0), at(8000, 0), at(8000, 250), at(4000, 250), at(0, 250)]),
    );
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.4);
  });

  it('two DISTINCT roads 500 m apart are NOT the same corridor (exact predicate, phase-immune)', () => {
    // the adversarial finding: the cell-membership version scored this 0.909
    // or 0.000 depending on grid phase; with the exact 350 m lateral bound it
    // must be 0 in every phase — test two lateral placements
    for (const y0 of [0, 130]) {
      const r = corridorDoublingRatio(
        line([
          at(0, y0),
          at(4000, y0),
          at(8000, y0),
          at(8000, y0 + 500),
          at(4000, y0 + 500),
          at(0, y0 + 500),
        ]),
      );
      expect(r).not.toBeNull();
      expect(r!).toBe(0);
    }
  });

  it('a single shallow self-crossing earns only the documented small floor', () => {
    // long loop that crosses its outbound leg once at a shallow angle: flags
    // only the ~2·lateral band around the crossing, a few % of the route
    const r = corridorDoublingRatio(
      line([
        at(0, 0),
        at(6000, 0), // out east
        at(9000, 2500),
        at(6000, 5000),
        at(3000, 2500), // cuts back down…
        at(2500, -800), // …crossing the outbound leg at a shallow angle
        at(-2000, -1500),
        at(-2000, 0),
      ]),
    );
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(0.15);
  });

  it('a circle → ~0 (opposite sides are far apart geographically)', () => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 128; i++) {
      const t = (2 * Math.PI * i) / 128;
      pts.push(at(2500 * Math.cos(t), 2500 * Math.sin(t)));
    }
    const r = corridorDoublingRatio(line(pts));
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(0.05);
  });

  it('a switchback stack (opposing legs, <2 km apart along-route) → 0', () => {
    // three 800 m legs, 120 m apart laterally: adjacent legs oppose in bearing
    // but sit far under CORRIDOR_MIN_SEPARATION_M along-route; legs 1↔3 run the
    // SAME direction (no opposition). (Very deep stacks can pair their first
    // and last legs — at route scale that contributes ~1 % to the ratio and is
    // threshold-immunized; the whole-route fixture here stays realistic.)
    const r = corridorDoublingRatio(
      line([at(0, 0), at(800, 0), at(800, 120), at(0, 120), at(0, 240), at(800, 240)]),
    );
    expect(r).not.toBeNull();
    expect(r!).toBe(0);
  });

  it('origin grace exempts the shared approach corridor', () => {
    // out-and-back entirely within 2.5 km of the origin → all graced → 0
    const origin = { lat: LAT0, lng: -79.9 };
    const r = corridorDoublingRatio(
      line([at(0, 0), at(1200, 0), at(2200, 0), at(1200, 1), at(0, 2)]),
      origin,
    );
    expect(r).not.toBeNull();
    expect(r!).toBe(0);
  });
});
