import type { LatLng } from '@shared/types';
import { beforeAll, describe, expect, it } from 'vitest';

import { assembleAtoB, DETOUR_MAX_DEFAULT } from './atob';
import type { WaypointCandidate } from './candidates';

/**
 * M3-T08 — A→B assembly against the LIVE local Valhalla. Self-skips when the
 * engine is down; `pnpm -C backend test atob` locally is the Verify gate.
 */

const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const HAMILTON: LatLng = { lat: 43.2557, lng: -79.8711 };
const STC: LatLng = { lat: 43.1594, lng: -79.2469 };

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
    spotIds: [],
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
  });
});
