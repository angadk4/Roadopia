import type { LatLng } from '@shared/types';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  assembleAtoB,
  ATOB_DURATION_RATIO_MAX,
  atobCrossingCount,
  atobDefectCount,
  atobStructuralDefects,
  DETOUR_MAX_DEFAULT,
  routeDirectBaseline,
} from './atob';
import type { WaypointCandidate } from './candidates';

/**
 * M3-T08 — A→B assembly against the LIVE local Valhalla. Self-skips when the
 * engine is down; `pnpm -C backend test atob` locally is the Verify gate.
 * BD-203 adds the shared direct baseline, the duration guard and the
 * assembly-measured structural defects (pure contracts live in atob_law.test.ts).
 */

const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const HAMILTON: LatLng = { lat: 43.2557, lng: -79.8711 };
const STC: LatLng = { lat: 43.1594, lng: -79.2469 };
const NO_AVOID = { highways: false, tolls: false, ferries: false, unpaved: false };

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
    kind: 'atob',
    waypoints,
    sector: 2,
    returnSector: null,
    clusterId: 0,
    stops: [],
    clusterWeight: 1,
  };
}

describe('assembleAtoB (M3-T08, live engine)', () => {
  it('a sane on-way stop stays under the detour cap and is accepted', async (ctx) => {
    if (!engineUp) return ctx.skip();
    // Grimsby sits on the way Hamilton → St. Catharines
    const out = await assembleAtoB(
      VALHALLA,
      HAMILTON,
      STC,
      candidate('sane', [{ lat: 43.2, lng: -79.562 }]),
    );
    expect(out.detourRatio).toBeLessThan(DETOUR_MAX_DEFAULT);
    expect(out.accepted).toBe(true);
    expect(out.tspOrdered).toBe(false); // 3 locations < 4 ⇒ progress order stands
    expect(out.route.distance_m).toBeGreaterThan(40_000);
  });

  it('an absurd detour (via Port Colborne) is rejected with a reason', async (ctx) => {
    if (!engineUp) return ctx.skip();
    const out = await assembleAtoB(
      VALHALLA,
      HAMILTON,
      STC,
      candidate('absurd', [
        { lat: 42.8866, lng: -79.2515 }, // Port Colborne — way south of the corridor
      ]),
    );
    expect(out.detourRatio).toBeGreaterThan(DETOUR_MAX_DEFAULT);
    expect(out.accepted).toBe(false);
    expect(out.rejectReasons.some((r) => r.includes('detour'))).toBe(true);
  });

  it('≥4 locations triggers TSP ordering; stops still visited; route completes', async (ctx) => {
    if (!engineUp) return ctx.skip();
    // deliberately scrambled middle order: TSP (or progress) must untangle it
    const out = await assembleAtoB(
      VALHALLA,
      HAMILTON,
      STC,
      candidate('tsp', [
        { lat: 43.16, lng: -79.4 }, // mid-corridor (given LAST geographically? no—2nd)
        { lat: 43.2, lng: -79.562 }, // Grimsby (earlier along the way)
      ]),
      { detourMax: 2.0 },
    );
    expect(out.tspOrdered).toBe(true);
    expect(out.accepted).toBe(true);
    expect(out.detourRatio).toBeLessThan(2.0);
  });

  it('a shared direct baseline is honoured (no re-route of the baseline)', async (ctx) => {
    if (!engineUp) return ctx.skip();
    const out = await assembleAtoB(
      VALHALLA,
      HAMILTON,
      STC,
      candidate('shared', [{ lat: 43.2, lng: -79.562 }]),
      { directDistanceM: 56_543 },
    );
    expect(out.detourRatio).toBeGreaterThan(0.9);
    expect(out.detourRatio).toBeLessThan(1.5);
    expect(out.durationRatio).toBeNull(); // no baseline duration → guard not armed
  });
});

describe('BD-203 — duration guard, assembly-measured defects, the direct baseline (live)', () => {
  it('the duration guard rejects with a "duration" reason against the shared baseline', async (ctx) => {
    if (!engineUp) return ctx.skip();
    const cand = candidate('dur', [{ lat: 43.2, lng: -79.562 }]);
    // a 10-minute "direct" makes any real Hamilton→STC drive > 1.5× — rejected
    const tight = await assembleAtoB(VALHALLA, HAMILTON, STC, cand, {
      directDistanceM: 56_543,
      directDurationS: 600,
    });
    expect(tight.durationRatio).not.toBeNull();
    expect(tight.durationRatio!).toBeGreaterThan(ATOB_DURATION_RATIO_MAX);
    expect(tight.accepted).toBe(false);
    expect(tight.rejectReasons.some((r) => r.startsWith('duration'))).toBe(true);
    // a generous baseline duration arms the guard without tripping it
    const loose = await assembleAtoB(VALHALLA, HAMILTON, STC, cand, {
      directDistanceM: 56_543,
      directDurationS: 100_000,
    });
    expect(loose.durationRatio!).toBeLessThan(ATOB_DURATION_RATIO_MAX);
    expect(loose.rejectReasons.some((r) => r.startsWith('duration'))).toBe(false);
  });

  it('defects are measured at assembly with the judge’s detectors and grace — one measurement', async (ctx) => {
    if (!engineUp) return ctx.skip();
    const out = await assembleAtoB(
      VALHALLA,
      HAMILTON,
      STC,
      candidate('defects', [{ lat: 43.2, lng: -79.562 }]),
      { directDistanceM: 56_543 },
    );
    expect(out.spursWide).toBe(out.defects.spurs.length);
    expect(out.microloops).toBe(out.defects.crescents.length);
    expect(out.crossings).toBe(atobCrossingCount(out.defects));
    expect(out.retraceRunM).toBeGreaterThanOrEqual(0);
    // what the judge would see on this exact route is what assembly saw
    const judge = atobStructuralDefects(out.route, HAMILTON, STC);
    expect(atobDefectCount(judge)).toBe(atobDefectCount(out.defects));
  });

  it('routeDirectBaseline: engine-fastest once, traced, avoid set honoured', async (ctx) => {
    if (!engineUp) return ctx.skip();
    const b = await routeDirectBaseline(VALHALLA, HAMILTON, STC, NO_AVOID);
    expect(b.distanceM).toBeGreaterThan(40_000);
    expect(b.durationS).toBeGreaterThan(0);
    expect(b.avoidHonoured).toBe(true);
    expect(b.route.distance_m).toBe(b.distanceM);
    if (b.classMix !== null) {
      expect(b.classMix.backroadShare).toBeGreaterThanOrEqual(0);
      expect(b.classMix.backroadShare).toBeLessThanOrEqual(1);
    }
    // a toll avoid the engine can honour on this corridor: no toll on the line
    const tollFree = await routeDirectBaseline(VALHALLA, HAMILTON, STC, {
      ...NO_AVOID,
      tolls: true,
    });
    expect(tollFree.avoidHonoured).toBe(true);
    expect(tollFree.route.has_toll).toBe(false);
  });
});
