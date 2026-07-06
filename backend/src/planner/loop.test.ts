import type { LatLng } from '@shared/types';
import { beforeAll, describe, expect, it } from 'vitest';

import { routeThrough } from '../valhalla/route';

import type { WaypointCandidate } from './candidates';
import { assembleLoop, EPSILON_CLOSURE_M } from './loop';
import { selfOverlapRatio } from './overlap';

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
