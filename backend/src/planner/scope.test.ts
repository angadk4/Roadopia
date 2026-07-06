import type { GetIsochroneInput, GetIsochroneOutput, LatLng } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { ALPHA_LOOP, buildScope, MIN_TAU_S, ringToGeoJsonPolygon } from './scope';

/**
 * M3-T03 — scope module unit tests with an injected fake isochrone: the fake
 * returns a square ring whose half-size grows linearly with time_s, so polygon
 * scaling with duration is directly observable without a live engine.
 */

const HAMILTON: LatLng = { lat: 43.2557, lng: -79.8711 };
const STC: LatLng = { lat: 43.1594, lng: -79.2469 };

const calls: GetIsochroneInput[] = [];
async function fakeIso(input: GetIsochroneInput): Promise<GetIsochroneOutput> {
  calls.push(input);
  const half = input.time_s / 3600; // degrees per hour of budget — linear growth
  const { lat, lng } = input.origin;
  return {
    polygon: [
      { lat: lat - half, lng: lng - half },
      { lat: lat - half, lng: lng + half },
      { lat: lat + half, lng: lng + half },
      { lat: lat + half, lng: lng - half },
    ],
  };
}

function ringArea(ring: LatLng[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a.lng * b.lat - b.lng * a.lat;
  }
  return Math.abs(s / 2);
}

describe('buildScope (M3-T03)', () => {
  it('loop: single ring at τ_out = α·T*, polygon scales with duration', async () => {
    calls.length = 0;
    const short = await buildScope(
      'unused',
      { origin: HAMILTON, shape: 'loop', durationS: 3600 },
      fakeIso,
    );
    const long = await buildScope(
      'unused',
      { origin: HAMILTON, shape: 'loop', durationS: 10800 },
      fakeIso,
    );

    expect(short.rings).toHaveLength(1);
    expect(short.tauOutS).toBe(Math.round(3600 * ALPHA_LOOP));
    expect(long.tauOutS).toBe(Math.round(10800 * ALPHA_LOOP));
    // 3× the duration ⇒ 3× the linear size ⇒ ~9× the area on the fake engine
    const ratio = ringArea(long.rings[0]!) / ringArea(short.rings[0]!);
    expect(ratio).toBeGreaterThan(8);
    expect(ratio).toBeLessThan(10);
    expect(calls.every((c) => c.costing === 'auto')).toBe(true);
  });

  it('a_to_b: two rings (origin + destination) — differs sensibly from loop', async () => {
    calls.length = 0;
    const scope = await buildScope(
      'unused',
      { origin: HAMILTON, shape: 'a_to_b', durationS: 5400, destination: STC },
      fakeIso,
    );
    expect(scope.rings).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.origin).toEqual(HAMILTON);
    expect(calls[1]!.origin).toEqual(STC);
    // the two rings are centred differently — the corridor covers both ends
    expect(scope.rings[0]![0]!.lng).not.toBeCloseTo(scope.rings[1]![0]!.lng, 1);
  });

  it('a_to_b without a destination throws', async () => {
    await expect(
      buildScope('unused', { origin: HAMILTON, shape: 'a_to_b', durationS: 3600 }, fakeIso),
    ).rejects.toThrow(/destination/);
  });

  it('tiny budgets are floored to MIN_TAU_S', async () => {
    const scope = await buildScope(
      'unused',
      { origin: HAMILTON, shape: 'loop', durationS: 120 },
      fakeIso,
    );
    expect(scope.tauOutS).toBe(MIN_TAU_S);
  });

  it('ringToGeoJsonPolygon closes the ring for the PostGIS RPCs', () => {
    const gj = ringToGeoJsonPolygon([
      { lat: 43.2, lng: -79.9 },
      { lat: 43.3, lng: -79.9 },
      { lat: 43.3, lng: -79.8 },
    ]);
    const ring = gj.coordinates[0]!;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
    expect(ring[0]).toEqual([-79.9, 43.2]); // [lng, lat] order
  });
});
