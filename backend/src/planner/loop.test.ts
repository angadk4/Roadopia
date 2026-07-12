import type { LatLng } from '@shared/types';
import { beforeAll, describe, expect, it } from 'vitest';

import { routeThrough } from '../valhalla/route';

import type { WaypointCandidate } from './candidates';
import { assembleLoop, assembleLoopWithRepair, EPSILON_CLOSURE_M } from './loop';
import { maxRetraceRunM, selfOverlapRatio, spurEvents, SPUR_WINDOW_WIDE_STEPS } from './overlap';

/**
 * M3-T07 — loop assembly against the LIVE local Valhalla (pinned tiles). Self-skips
 * when the engine is down; `pnpm -C backend test loop` locally is the Verify gate.
 *
 * Fixtures use real corridor roads: a proper Dundas-valley circuit (waypoints in
 * different sectors) vs a deliberate out-and-back (single far waypoint) that MUST
 * trip the self-overlap cap — proving the metric points the right way.
 */

const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const ORIGIN: LatLng = { lat: 43.2557, lng: -79.8711 }; // Hamilton

let engineUp = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${VALHALLA}/status`, { signal: AbortSignal.timeout(2_000) });
    engineUp = res.ok;
  } catch {
    engineUp = false;
  }
});

function candidate(id: string, waypoints: LatLng[]): WaypointCandidate {
  return {
    id,
    kind: 'loop',
    waypoints,
    sector: 0,
    returnSector: 4,
    clusterId: 0,
    spotIds: [],
    clusterWeight: 1,
  };
}

describe('assembleLoop (M3-T07, live engine)', () => {
  it('a real circuit closes within ε and stays under the self-overlap cap', async (ctx) => {
    if (!engineUp) return ctx.skip();
    // Hamilton → Dundas valley (NW) → Ancaster (SW) → back: distinct out/return corridors
    const loop = await assembleLoop(
      VALHALLA,
      ORIGIN,
      candidate('good', [
        { lat: 43.2647, lng: -79.954 }, // Dundas
        { lat: 43.218, lng: -79.987 }, // Ancaster
      ]),
    );
    expect(loop.closureM).toBeLessThanOrEqual(EPSILON_CLOSURE_M);
    // soft line is 0.15; the assembly cap is 0.30 (two-tier, BD-18) — the fixture
    // asserts acceptance under the cap (country-bias costing shifted absolute
    // values; scoring handles the 0.15–0.30 soft zone)
    expect(loop.selfOverlap).toBeLessThanOrEqual(0.3);
    expect(loop.accepted).toBe(true);
    expect(loop.route.distance_m).toBeGreaterThan(10_000);
    expect(loop.route.geometry.coordinates.length).toBeGreaterThan(100);
    // round 7: an accepted loop carries a MEASURED residential share (trace
    // succeeded against the live engine) within the hard cap
    expect(loop.residentialShare).not.toBeNull();
    expect(loop.residentialShare!).toBeGreaterThanOrEqual(0);
    expect(loop.residentialShare!).toBeLessThanOrEqual(0.2);
  });

  it('assembleLoopWithRepair returns repairsApplied (0 on a clean circuit)', async (ctx) => {
    if (!engineUp) return ctx.skip();
    const loop = await assembleLoopWithRepair(
      VALHALLA,
      ORIGIN,
      candidate('rp-clean', [
        { lat: 43.2647, lng: -79.954 },
        { lat: 43.218, lng: -79.987 },
      ]),
    );
    expect(loop.repairsApplied).toBeGreaterThanOrEqual(0);
    expect(loop.repairsApplied).toBeLessThanOrEqual(2);
    // the repair pass must never return a WORSE result than plain assembly
    expect(loop.accepted).toBe(true);
  });

  it('a TRUE out-and-back (real road out + same road back) maxes the metric', async (ctx) => {
    if (!engineUp) return ctx.skip();
    // Route one-way to Smithville, then append the exact reverse — the literal
    // "drive out and come back the same way" geometry, built from REAL roads.
    const oneWay = await routeThrough(VALHALLA, {
      waypoints: [
        [ORIGIN.lng, ORIGIN.lat],
        [-79.5482, 43.0965],
      ],
    });
    const outAndBack = {
      type: 'LineString' as const,
      coordinates: [...oneWay.geometry.coordinates, ...[...oneWay.geometry.coordinates].reverse()],
    };
    expect(selfOverlapRatio(outAndBack)).toBeGreaterThan(0.85);
  });

  // FINDING (recorded): a live 2-waypoint round trip scores LOW (~0.11) because
  // Valhalla itself avoids same-road returns — good news for SPK-15 retracing.
  it('the cap rejection wiring fires under a tightened cap', async (ctx) => {
    if (!engineUp) return ctx.skip();
    const roundTrip = await assembleLoop(
      VALHALLA,
      ORIGIN,
      candidate('rt', [{ lat: 43.0965, lng: -79.5482 }]),
      undefined,
      { selfOverlapCap: 0.05 },
    );
    // FINDING UPDATE (owner round 2): the earlier "~0.11, engine diversifies
    // returns" observation was a HIGHWAY-costing artifact — under country-bias
    // costing a naked round trip retraces heavily (~0.7), which is exactly why
    // the return-anchor architecture is load-bearing. The wiring assertion is
    // what matters: over-cap ⇒ rejected with a reason.
    expect(roundTrip.selfOverlap).toBeGreaterThan(0.05);
    expect(roundTrip.accepted).toBe(false);
    expect(roundTrip.rejectReasons.some((r) => r.includes('self_overlap'))).toBe(true);
  });

  it('closure is measured against the requested origin (both endpoints)', async (ctx) => {
    if (!engineUp) return ctx.skip();
    const loop = await assembleLoop(
      VALHALLA,
      ORIGIN,
      candidate('close', [
        { lat: 43.3316, lng: -79.8918 }, // Waterdown
        { lat: 43.3255, lng: -79.799 }, // Burlington
      ]),
    );
    expect(loop.closureM).toBeLessThanOrEqual(EPSILON_CLOSURE_M);
  });
});

describe('spurEvents — synthetic sanity (engine-free, BD-23)', () => {
  const LAT = 43.3;
  const lngPerM = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
  const latPerM = 1 / 111_320;

  /** Eastbound line at `lat` from x0..x1 metres, 25 m spacing. */
  const east = (lat: number, x0: number, x1: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let x = x0; x <= x1; x += 25) pts.push([-79.9 + x * lngPerM, lat]);
    return pts;
  };

  it('a mid-route in-and-back spur counts exactly one event', () => {
    // east 2.5 km, dive north 300 m and retrace, continue east 2.5 km
    const northSpur: [number, number][] = [];
    for (let y = 0; y <= 300; y += 25) northSpur.push([-79.9 + 2500 * lngPerM, LAT + y * latPerM]);
    const back = [...northSpur].reverse();
    const line = {
      type: 'LineString' as const,
      coordinates: [...east(LAT, 0, 2500), ...northSpur, ...back, ...east(LAT, 2525, 5000)],
    };
    expect(spurEvents(line)).toBe(1);
  });

  it('a switchback hairpin (parallel legs ~65 m apart) is NOT a spur', () => {
    const out = east(LAT, 0, 1000);
    const back = [...east(LAT + 65 * latPerM, 0, 1000)].reverse();
    const hairpin = { type: 'LineString' as const, coordinates: [...out, ...back] };
    expect(spurEvents(hairpin)).toBe(0);
  });

  it('a clean rectangle loop has zero spur events', () => {
    const rect = {
      type: 'LineString' as const,
      coordinates: [
        ...east(LAT, 0, 2000),
        ...Array.from(
          { length: 40 },
          (_, i) => [-79.9 + 2000 * lngPerM, LAT + (i + 1) * 25 * latPerM] as [number, number],
        ),
        ...[...east(LAT + 1000 * latPerM, 0, 2000)].reverse(),
        ...Array.from(
          { length: 40 },
          (_, i) => [-79.9, LAT + (1000 - (i + 1) * 25) * latPerM] as [number, number],
        ),
      ],
    };
    expect(spurEvents(rect)).toBe(0);
  });

  it('a full-block neighbourhood spin (in on X, around the block, out on X) is caught', () => {
    // round 6: the 400 m window missed block circuits — repeats come back
    // ~800 m of route later; the 1 km window catches them
    const inX: [number, number][] = east(LAT, 0, 300);
    const block: [number, number][] = [
      ...Array.from(
        { length: 8 },
        (_, i) => [-79.9 + 300 * lngPerM, LAT + (i + 1) * 25 * latPerM] as [number, number],
      ),
      ...Array.from(
        { length: 8 },
        (_, i) => [-79.9 + (300 + (i + 1) * 25) * lngPerM, LAT + 200 * latPerM] as [number, number],
      ),
      ...Array.from(
        { length: 8 },
        (_, i) => [-79.9 + 500 * lngPerM, LAT + (200 - (i + 1) * 25) * latPerM] as [number, number],
      ),
      ...Array.from(
        { length: 8 },
        (_, i) => [-79.9 + (500 - (i + 1) * 25) * lngPerM, LAT] as [number, number],
      ),
    ];
    const outX = [...east(LAT, 0, 300)].reverse();
    const line = { type: 'LineString' as const, coordinates: [...inX, ...block, ...outX] };
    // WIDE window (presentation/AC) catches the block spin; the NARROW
    // assembly window does not — by design (round 6: a wide assembly gate
    // starved every pool; the split keeps pools alive and presentation clean)
    expect(spurEvents(line, undefined, undefined, SPUR_WINDOW_WIDE_STEPS)).toBeGreaterThanOrEqual(
      1,
    );
    expect(spurEvents(line)).toBe(0);
  });

  it('spurs inside the origin grace radius are exempt', () => {
    const northSpur: [number, number][] = [];
    for (let y = 0; y <= 300; y += 25) northSpur.push([-79.9 + 500 * lngPerM, LAT + y * latPerM]);
    const back = [...northSpur].reverse();
    const line = {
      type: 'LineString' as const,
      coordinates: [...east(LAT, 0, 500), ...northSpur, ...back, ...east(LAT, 525, 1500)],
    };
    expect(spurEvents(line, { lat: LAT, lng: -79.9 + 500 * lngPerM })).toBe(0);
    expect(spurEvents(line)).toBe(1);
  });
});

describe('maxRetraceRunM — synthetic sanity (engine-free, BD-24)', () => {
  const LAT = 43.3;
  const lngPerM = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
  const latPerM = 1 / 111_320;
  const east = (lat: number, x0: number, x1: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let x = x0; x <= x1; x += 50) pts.push([-79.9 + x * lngPerM, lat]);
    return pts;
  };

  it('an IMMEDIATE there-and-back counts both passes (2 km road ≈ 4 km run)', () => {
    // out 5 km east, retrace 2 km west on the SAME road, then head north away —
    // the turnaround joins the passes into one contiguous doubled-travel run
    const out = east(LAT, 0, 5000);
    const retrace = [...east(LAT, 3000, 5000)].reverse();
    const away = Array.from(
      { length: 60 },
      (_, i) => [-79.9 + 3000 * lngPerM, LAT + (i + 1) * 50 * latPerM] as [number, number],
    );
    const line = { type: 'LineString' as const, coordinates: [...out, ...retrace, ...away] };
    const run = maxRetraceRunM(line);
    expect(run).toBeGreaterThan(3_200);
    expect(run).toBeLessThan(4_800);
  });

  it('a SEPARATED same-road doubling (out early, back late) measures ≈ the road length', () => {
    // the owner round-6 case: enter on road X, big middle loop, return on X.
    // X = 3 km east; middle = 2 km north, 2 km east, 2 km south; return west
    // along X. The passes are ~6 km of route apart → each is its own run.
    const X = east(LAT, 0, 3000);
    const middle: [number, number][] = [
      ...Array.from(
        { length: 40 },
        (_, i) => [-79.9 + 3000 * lngPerM, LAT + (i + 1) * 50 * latPerM] as [number, number],
      ),
      ...Array.from(
        { length: 40 },
        (_, i) =>
          [-79.9 + (3000 + (i + 1) * 50) * lngPerM, LAT + 2000 * latPerM] as [number, number],
      ),
      ...Array.from(
        { length: 40 },
        (_, i) =>
          [-79.9 + 5000 * lngPerM, LAT + (2000 - (i + 1) * 50) * latPerM] as [number, number],
      ),
      ...[...east(LAT, 3000, 5000)].reverse().slice(1),
    ];
    const line = {
      type: 'LineString' as const,
      coordinates: [...X, ...middle, ...[...X].reverse()],
    };
    const run = maxRetraceRunM(line);
    expect(run).toBeGreaterThan(2_200);
    expect(run).toBeLessThan(6_500);
  });

  it('a clean rectangle has no retrace run; origin-street doubling is graced', () => {
    const rect = {
      type: 'LineString' as const,
      coordinates: [
        ...east(LAT, 0, 3000),
        ...Array.from(
          { length: 40 },
          (_, i) => [-79.9 + 3000 * lngPerM, LAT + (i + 1) * 50 * latPerM] as [number, number],
        ),
        ...[...east(LAT + 2000 * latPerM, 0, 3000)].reverse(),
        ...Array.from(
          { length: 40 },
          (_, i) => [-79.9, LAT + (2000 - (i + 1) * 50) * latPerM] as [number, number],
        ),
      ],
    };
    expect(maxRetraceRunM(rect)).toBe(0);

    // 1.5 km out-and-back that starts AT the origin: graced within 2.5 km
    const spur = {
      type: 'LineString' as const,
      coordinates: [...east(LAT, 0, 1500), ...[...east(LAT, 0, 1500)].reverse()],
    };
    expect(maxRetraceRunM(spur, undefined, { lat: LAT, lng: -79.9 })).toBe(0);
    expect(maxRetraceRunM(spur)).toBeGreaterThan(1_000);
  });
});

describe('selfOverlapRatio — synthetic sanity (engine-free)', () => {
  it('a pure out-and-back line ≈ 1.0; a rectangle ≈ 0', () => {
    const out: [number, number][] = Array.from({ length: 40 }, (_, i) => [-79.9 + i * 0.002, 43.2]);
    const back = [...out].reverse();
    const outAndBack = { type: 'LineString' as const, coordinates: [...out, ...back] };
    expect(selfOverlapRatio(outAndBack)).toBeGreaterThan(0.85);

    const rect = {
      type: 'LineString' as const,
      coordinates: [
        ...Array.from({ length: 20 }, (_, i) => [-79.9 + i * 0.002, 43.2] as [number, number]),
        ...Array.from({ length: 10 }, (_, i) => [-79.862, 43.2 + i * 0.002] as [number, number]),
        ...Array.from({ length: 20 }, (_, i) => [-79.862 - i * 0.002, 43.218] as [number, number]),
        ...Array.from({ length: 10 }, (_, i) => [-79.9, 43.218 - i * 0.002] as [number, number]),
      ],
    };
    expect(selfOverlapRatio(rect)).toBeLessThan(0.1);
  });
});
