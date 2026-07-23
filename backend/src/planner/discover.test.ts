import type { GetIsochroneOutput, LatLng, RouteThroughOutput } from '@shared/types';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { haversineMeters } from '../../../data/curvature/geometry';
import type { SeedDriveRow } from '../db/planner_reads';
import type { MatrixCell } from '../valhalla/matrix';

import {
  DISCOVER_MENU_MAX,
  DISCOVER_MENU_MIN,
  DISCOVER_MIN_ROAD_M,
  DISCOVER_REACH_S,
  discoverDrives,
  TAP_DURATION_MAX_S,
  TAP_DURATION_MIN_S,
  type DiscoverDeps,
} from './discover';
import type { CandidateSegment } from './retrieve';

/**
 * R23-U4 / R24-U5-U6 golden fixture — the discoverDrives pipeline against a
 * MOCKED engine (isochrone + retrieve + haversine matrix + seed reads + a
 * straight-line route pre-builder). Deterministic by construction: the committed
 * byte-stable proof lives here, not on the live menu (BD-69 env-sensitivity).
 */

const ORIGIN: LatLng = { lat: 43.5, lng: -80.0 };
const MATRIX_SPEED_MS = 50 / 3.6;

/** A short 3-point curvy line centred on (lat,lng). */
function seg(
  id: string,
  name: string,
  highway: string,
  lengthM: number,
  curviness: number,
  lat: number,
  lng: number,
  urbanShare = 0,
): CandidateSegment {
  return {
    id,
    osmWayId: id,
    name,
    highway,
    lengthM,
    curviness,
    urbanShare,
    geometry: {
      type: 'LineString',
      coordinates: [
        [lng - 0.01, lat - 0.005],
        [lng, lat],
        [lng + 0.01, lat + 0.005],
      ],
    },
  };
}

const FIXTURE: CandidateSegment[] = [
  // spread of reachable country roads (all out-and-backs — R24)
  seg('close', 'Close Bend', 'tertiary', 3000, 2.0, 43.56, -80.06),
  seg('escarp', 'Escarpment Bend', 'tertiary', 5000, 2.4, 43.7, -80.0),
  seg('sydenham', 'Sydenham Climb', 'unclassified', 3500, 2.1, 43.5, -79.72),
  seg('beaver', 'Beaver Run', 'tertiary', 4200, 1.9, 43.3, -79.92),
  seg('hockley', 'Hockley Road', 'unclassified', 3000, 1.6, 43.62, -80.3),
  seg('pretty', 'Pretty River Rd', 'unclassified', 3200, 1.7, 43.34, -80.24),
  seg('mono', 'Mono Hills Rd', 'tertiary', 2600, 1.3, 43.78, -79.86),
  seg('credit', 'Credit Valley Rd', 'tertiary', 2500, 1.5, 43.44, -79.76),
  seg('grey5', 'Grey Line 5', 'tertiary', 2800, 1.4, 43.68, -80.28),
  seg('blue', 'Blue Mountain Rd', 'unclassified', 3400, 2.0, 43.58, -79.68),
  // a same-name adjacent pair → merges into one whole road (id joined with '+');
  // curvy enough (2.8) to survive the R24 curated top-6 trim
  {
    ...seg('twinA', 'Twin Line', 'tertiary', 1400, 2.8, 43.55, -80.15),
    geometry: {
      type: 'LineString',
      coordinates: [
        [-80.16, 43.545],
        [-80.15, 43.55],
        [-80.14, 43.555],
      ],
    },
  },
  {
    ...seg('twinB', 'Twin Line', 'tertiary', 1400, 2.8, 43.56, -80.13),
    geometry: {
      type: 'LineString',
      coordinates: [
        [-80.14, 43.555],
        [-80.13, 43.56],
        [-80.12, 43.565],
      ],
    },
  },
  // dropped: under the full-span floor
  seg('short', 'Short Spur', 'tertiary', 800, 2.0, 43.55, -79.95),
  // dropped: unnamed → no tappable label
  seg('nameless', '', 'tertiary', 3000, 2.2, 43.52, -80.05),
  // dropped: passes the pool cull but exceeds the 60-min matrix reach
  seg('edge', 'Edge Ridge Rd', 'tertiary', 3000, 1.8, 43.95, -79.85),
];

const isochroneFn = async (): Promise<GetIsochroneOutput> => ({
  polygon: [
    { lat: 44.5, lng: -81 },
    { lat: 44.5, lng: -79 },
    { lat: 42.5, lng: -79 },
    { lat: 42.5, lng: -81 },
    { lat: 44.5, lng: -81 },
  ],
});

/** Deterministic mock matrix: straight-line time/distance between all locations. */
const matrixFn = async (
  _url: string,
  { locations }: { locations: ReadonlyArray<readonly [number, number]> },
): Promise<MatrixCell[][]> =>
  locations.map((src) =>
    locations.map((tgt) => {
      const d = haversineMeters([src[0], src[1]], [tgt[0], tgt[1]]);
      return { timeS: d / MATRIX_SPEED_MS, distanceM: d };
    }),
  );

/** Deterministic straight-line out-and-back pre-builder (stands in for Valhalla). */
const routeFn = async (
  _url: string,
  { waypoints }: { waypoints: ReadonlyArray<readonly [number, number]> },
): Promise<RouteThroughOutput> => {
  const coords = waypoints.map(([lng, lat]) => [lng, lat] as [number, number]);
  let dist = 0;
  for (let i = 1; i < coords.length; i++) dist += haversineMeters(coords[i - 1]!, coords[i]!);
  return {
    geometry: { type: 'LineString', coordinates: coords },
    distance_m: dist,
    duration_s: dist / MATRIX_SPEED_MS,
    legs: [],
    maneuvers: [],
    has_highway: false,
    has_toll: false,
    has_ferry: false,
    has_unpaved: false,
  };
};

function depsWith(segments: CandidateSegment[], seeds: SeedDriveRow[] = []): DiscoverDeps {
  return {
    db: {} as unknown as Client,
    valhallaUrl: 'http://127.0.0.1:8002',
    isochroneFn,
    matrixFn,
    retrieveFn: async () => ({ segments, spots: [], unavailableStopTypes: [] }),
    seedDrivesFn: async () => seeds,
    routeFn,
  };
}

describe('discoverDrives (R23-U4 golden fixture)', () => {
  it('returns a labelled, reachable, well-formed menu', async () => {
    const res = await discoverDrives(ORIGIN, depsWith(FIXTURE));
    expect(res.reachMinutes).toBe(Math.round(DISCOVER_REACH_S / 60));
    expect(res.drives.length).toBeGreaterThanOrEqual(DISCOVER_MENU_MIN);
    expect(res.drives.length).toBeLessThanOrEqual(DISCOVER_MENU_MAX);
    for (const d of res.drives) {
      expect(d.name).not.toBe('');
      expect(d.length_m).toBeGreaterThanOrEqual(DISCOVER_MIN_ROAD_M);
      expect(d.driveTimeToStartS).toBeGreaterThan(0);
      expect(d.driveTimeToStartS).toBeLessThanOrEqual(DISCOVER_REACH_S);
      expect(d.driveTimeToStartM).toBeGreaterThan(0);
      expect(d.roadTraverseS).toBeGreaterThan(0);
      expect(d.suggestedDurationS).toBeGreaterThanOrEqual(TAP_DURATION_MIN_S);
      expect(d.suggestedDurationS).toBeLessThanOrEqual(TAP_DURATION_MAX_S);
      expect(d.entry).not.toEqual(d.exit);
    }
  });

  it('every drive is a PRE-BUILT out-and-back with a REAL measured total (R24)', async () => {
    const res = await discoverDrives(ORIGIN, depsWith(FIXTURE));
    expect(res.drives.length).toBeGreaterThan(0);
    for (const d of res.drives) {
      expect(d.source).toBe('auto');
      expect(d.durationSource).toBe('measured'); // pre-built by routeFn
      expect(d.route).toBeDefined();
      expect(d.measuredDurationS).toBeGreaterThan(0);
      // the shown total tracks the measured route (clamped to the min)
      expect(d.suggestedDurationS).toBe(Math.max(TAP_DURATION_MIN_S, d.measuredDurationS!));
      // the pre-built route starts + ends at the origin (out-and-back)
      const c = d.route!.geometry.coordinates;
      expect(c[0]).toEqual(c[c.length - 1]);
    }
  });

  it('blends the hand-picked classics (source=classic, provenance id)', async () => {
    const classic: SeedDriveRow = {
      id: 'seed-hockley',
      name: 'Hockley Valley Road',
      // a real zigzag (like the actual seeds) → measures genuinely curvy
      geometry: {
        type: 'LineString',
        coordinates: [
          [-80.02, 43.61],
          [-80.008, 43.6135],
          [-80.016, 43.617],
          [-80.004, 43.6205],
          [-80.012, 43.624],
          [-79.998, 43.6275],
          [-79.98, 43.63],
        ],
      },
      waypoints: [
        { lat: 43.61, lng: -80.02 },
        { lat: 43.63, lng: -79.98 },
      ],
      is_loop: false,
      distance_m: 6000,
      duration_s: 600,
      curviness: 0, // seeds store 0 → Discover measures from geometry
    };
    const res = await discoverDrives(ORIGIN, depsWith(FIXTURE, [classic]));
    const c = res.drives.find((d) => d.source === 'classic');
    expect(c).toBeDefined();
    expect(c!.name).toBe('Hockley Valley Road');
    expect(c!.classicRouteId).toBe('seed-hockley');
    expect(c!.curviness).toBeGreaterThan(0); // measured, not the stored 0
  });

  it('drops sub-floor, unnamed, and beyond-reach roads', async () => {
    const res = await discoverDrives(ORIGIN, depsWith(FIXTURE));
    const ids = res.drives.map((d) => d.segmentId);
    expect(ids).not.toContain('short'); // under the full-span floor
    expect(ids).not.toContain('nameless'); // no label
    expect(ids).not.toContain('edge'); // beyond the 60-min reach
    expect(res.drives.every((d) => d.name !== 'Edge Ridge Rd')).toBe(true);
  });

  it('merges a same-name adjacent pair into one whole road', async () => {
    const res = await discoverDrives(ORIGIN, depsWith(FIXTURE));
    const twin = res.drives.find((d) => d.name === 'Twin Line');
    expect(twin).toBeDefined();
    expect(twin!.segmentId).toContain('+'); // merged id
    expect(twin!.length_m).toBeGreaterThanOrEqual(DISCOVER_MIN_ROAD_M); // 1400+1400
  });

  it('entry is the nearer endpoint (min matrix drive-time)', async () => {
    const res = await discoverDrives(ORIGIN, depsWith(FIXTURE));
    for (const d of res.drives) {
      const toEntry = haversineMeters([ORIGIN.lng, ORIGIN.lat], [d.entry.lng, d.entry.lat]);
      const toExit = haversineMeters([ORIGIN.lng, ORIGIN.lat], [d.exit.lng, d.exit.lat]);
      expect(toEntry).toBeLessThanOrEqual(toExit + 1); // entry is the closer end
    }
  });

  it('is ranked by menuScore descending', async () => {
    const res = await discoverDrives(ORIGIN, depsWith(FIXTURE));
    for (let i = 1; i < res.drives.length; i++) {
      expect(res.drives[i - 1]!.score).toBeGreaterThanOrEqual(res.drives[i]!.score);
    }
  });

  it('is byte-stable across identical runs (committed determinism proof)', async () => {
    const a = await discoverDrives(ORIGIN, depsWith(FIXTURE));
    const b = await discoverDrives(ORIGIN, depsWith(FIXTURE));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('returns an honest empty menu when nothing qualifies (never fabricates)', async () => {
    const res = await discoverDrives(
      ORIGIN,
      depsWith([seg('short', 'Short Spur', 'tertiary', 800, 2, 43.5, -80)]),
    );
    expect(res.drives).toEqual([]);
    expect(res.disclosures.length).toBeGreaterThan(0);
    expect(res.disclosures[0]).toMatch(/no standout drives/i);
  });
});
