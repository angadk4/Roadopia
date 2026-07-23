import type {
  DiscoverResult,
  LatLng,
  LineString,
  NearbyDrive,
  RouteThroughOutput,
} from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { ApiClientOptions, FetchLike } from '../api';
import {
  buildDiscoverPlanRequest,
  DiscoverUnavailableError,
  discoverDrivesToFeatureCollection,
  driveDurationS,
  drivesBounds,
  fetchDiscoverDrives,
  nearbyDriveToRoute,
} from '../discover';

const ORIGIN: LatLng = { lat: 43.5, lng: -80.0 };

const NEAR_DRIVE: NearbyDrive = {
  segmentId: 'a',
  name: 'Close Bend',
  entry: { lat: 43.5, lng: -80.0 },
  exit: { lat: 43.51, lng: -80.01 },
  curviness: 1.5,
  length_m: 3000,
  class: 'tertiary',
  urbanShare: 0,
  driveTimeToStartS: 600,
  driveTimeToStartM: 9000,
  roadTraverseS: 284,
  suggestedDurationS: 2700,
  score: 4000,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-80.0, 43.5],
      [-80.01, 43.51],
    ],
  },
};
const OAB_DRIVE: NearbyDrive = {
  ...NEAR_DRIVE,
  segmentId: 'b',
  name: 'Far Ridge',
  driveTimeToStartS: 2700,
  suggestedDurationS: 6000,
};
const RESULT: DiscoverResult = {
  drives: [NEAR_DRIVE, OAB_DRIVE],
  reachMinutes: 60,
  disclosures: [],
};

function fetchJson(status: number, body: unknown): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  });
}
const opts = (fetchImpl: FetchLike): ApiClientOptions => ({ baseUrl: 'http://x', fetchImpl });

describe('fetchDiscoverDrives', () => {
  it('validates and returns the menu on a well-formed response', async () => {
    const res = await fetchDiscoverDrives(opts(fetchJson(200, RESULT)), ORIGIN);
    expect(res.reachMinutes).toBe(60);
    expect(res.drives).toHaveLength(2);
    expect(res.drives[0]!.name).toBe('Close Bend');
  });

  it('rejects a malformed response (never surfaces bad rows — Hard rule K)', async () => {
    await expect(
      fetchDiscoverDrives(opts(fetchJson(200, { drives: 'nope', reachMinutes: 60 })), ORIGIN),
    ).rejects.toThrow(/unexpected response/i);
  });

  it('maps 404 (endpoint absent) to DiscoverUnavailableError', async () => {
    await expect(
      fetchDiscoverDrives(
        opts(fetchJson(404, { error: { code: 'not_found', message: 'x' } })),
        ORIGIN,
      ),
    ).rejects.toBeInstanceOf(DiscoverUnavailableError);
  });
});

describe('buildDiscoverPlanRequest (R24 fallback — out-and-back only)', () => {
  it('any drive → a direct out-and-back, no loop pin', () => {
    const req = buildDiscoverPlanRequest(OAB_DRIVE, ORIGIN);
    expect(req.shape).toBe('loop');
    expect(req.preset).toBe('backroads');
    expect(req.out_and_back).toEqual({
      entry: OAB_DRIVE.entry,
      exit: OAB_DRIVE.exit,
      name: 'Far Ridge',
    });
    expect('location_constraints' in req).toBe(false);
    expect('duration_target_s' in req).toBe(false);
  });
});

// --- R24 (U7): map-first data layer ------------------------------------------

const GEOM: LineString = {
  type: 'LineString',
  coordinates: [
    [-80.0, 43.5],
    [-80.04, 43.54],
  ],
};
const PREBUILT: RouteThroughOutput = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-80.0, 43.5],
      [-80.04, 43.54],
      [-80.0, 43.5],
    ],
  },
  distance_m: 12000,
  duration_s: 1800,
  legs: [],
  maneuvers: [],
  has_highway: false,
  has_toll: false,
  has_ferry: false,
  has_unpaved: false,
};
const CLASSIC_DRIVE: NearbyDrive = {
  ...OAB_DRIVE,
  segmentId: 'c',
  name: 'Classic Ridge',
  geometry: GEOM,
  source: 'classic',
  route: PREBUILT,
  measuredDurationS: 1800,
  durationSource: 'measured',
  classicRouteId: 'seed-1',
};

describe('driveDurationS', () => {
  it('prefers the measured total, falls back to the estimate', () => {
    expect(driveDurationS(CLASSIC_DRIVE)).toBe(1800);
    expect(driveDurationS(OAB_DRIVE)).toBe(6000); // no measured → suggested
  });
});

describe('discoverDrivesToFeatureCollection', () => {
  it('maps each drive to an amber-line feature keyed by segmentId', () => {
    const fc = discoverDrivesToFeatureCollection([NEAR_DRIVE, CLASSIC_DRIVE]);
    expect(fc.features).toHaveLength(2);
    const f = fc.features.find((x) => x.id === 'c')!;
    expect(f.properties).toMatchObject({
      id: 'c',
      name: 'Classic Ridge',
      distance_m: 3000,
      duration_s: 1800, // measured wins
      is_loop: false,
      source: 'classic',
    });
    expect(f.geometry).toEqual(GEOM);
  });
});

describe('drivesBounds', () => {
  it('unions the road-span coordinates; null when empty', () => {
    expect(drivesBounds([])).toBeNull();
    expect(drivesBounds([CLASSIC_DRIVE])).toEqual({ sw: [-80.04, 43.5], ne: [-80.0, 43.54] });
  });
});

describe('nearbyDriveToRoute', () => {
  it('maps a pre-built drive into a full out-and-back Route', () => {
    const route = nearbyDriveToRoute(CLASSIC_DRIVE)!;
    expect(route.is_loop).toBe(false);
    expect(route.geometry).toEqual(PREBUILT.geometry);
    expect(route.distance_m).toBe(12000);
    expect(route.duration_s).toBe(1800);
    expect(route.waypoints).toEqual([CLASSIC_DRIVE.entry, CLASSIC_DRIVE.exit]);
    expect(route.name).toBe('Classic Ridge');
    expect(route.free_tags).toEqual(['discover', 'classic']);
    expect(route.origin_type).toBe('ai');
    expect(route.owner_id).toBeNull();
  });

  it('returns null when the route was not pre-built (caller falls back to /plan)', () => {
    expect(nearbyDriveToRoute(OAB_DRIVE)).toBeNull();
  });
});
