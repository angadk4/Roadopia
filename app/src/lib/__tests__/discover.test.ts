import type {
  DiscoverResult,
  LatLng,
  LineString,
  NearbyDrive,
  RouteThroughOutput,
  CoreDrive,
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
  buildRemixRequest,
  coreDrivesToFeatureCollection,
  coreTripDurationS,
  coreTripLabel,
} from '../discover';

// --- R25-U15: three-leg helpers ------------------------------------------------

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

const CORE: CoreDrive = {
  id: 'c-80.0_43.5:loop:x',
  kind: 'loop',
  name: 'River Road',
  barProfile: 'strict',
  core: {
    geometry: {
      type: 'LineString',
      coordinates: [
        [-80, 43.5],
        [-80.01, 43.51],
        [-80, 43.5],
      ],
    },
    distance_m: 42_000,
    duration_s: 2520,
    entry: { lat: 43.5, lng: -80 },
    exit: { lat: 43.5, lng: -80 },
    curviness: 2.1,
    backroadShare: 0.62,
    mainShare: 0.22,
    hoodShare: 0.03,
    turnsPer10min: 3.2,
    loopiness: 0.41,
  },
  connectorOut: {
    geometry: {
      type: 'LineString',
      coordinates: [
        [-79.9, 43.4],
        [-80, 43.5],
      ],
    },
    distance_m: 12_000,
    duration_s: 1080,
  },
  connectorHome: {
    geometry: {
      type: 'LineString',
      coordinates: [
        [-80, 43.5],
        [-79.9, 43.4],
      ],
    },
    distance_m: 13_000,
    duration_s: 1260,
  },
  sameWayHome: false,
};

describe('R25-U15 three-leg helpers', () => {
  it('renders three separately-styled features per drive (amber core, grey legs)', () => {
    const fc = coreDrivesToFeatureCollection([CORE]);
    expect(fc.features.map((f) => f.properties.leg)).toEqual(['core', 'out', 'home']);
    expect(fc.features[0]!.geometry).toBe(CORE.core.geometry);
  });

  it('the card label is the honest three-part time, never one blob', () => {
    expect(coreTripLabel(CORE)).toBe('the drive 42 min · getting there 18 · home 21');
    expect(coreTripDurationS(CORE)).toBe(4860);
  });

  it('Remix seeds the REAL planner via the tap contract (through-pin + clamped budget)', () => {
    const req = buildRemixRequest(CORE, { lat: 43.4, lng: -79.9 });
    expect(req.location_constraints).toEqual([
      { kind: 'through', text: 'River Road', near_point: CORE.core.entry },
    ]);
    expect(req.duration_target_s).toBe(4860); // inside the tap window
    expect(req.out_and_back).toBeUndefined(); // a REAL planner run, not a rebuild
  });
});
