import type { LatLng, LineString, RouteThroughOutput } from '@shared/types';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { haversineMeters } from '../../../data/curvature/geometry';

import {
  CORE_CONNECTOR_SHARE_MAX,
  discoverCores,
  type CoreRowRead,
  type DiscoverCoresDeps,
} from './discover_cores';

/**
 * R25-U14 — the v2 browse against stubbed deps: definer rows in, three honest
 * legs out; mostly-commute cores dropped BEFORE any build; the stored core is
 * served as stored (never re-routed); same-way-home is disclosed, retried
 * exactly once.
 */

const ORIGIN: LatLng = { lat: 43.5, lng: -80.0 };
const SPEED_MS = 50 / 3.6;

function coreRow(id: string, entry: LatLng, exit: LatLng, durationS: number): CoreRowRead {
  return {
    id,
    kind: 'loop',
    name: `Core ${id}`,
    bar_profile: 'strict',
    geom_simplified: {
      type: 'LineString',
      coordinates: [
        [entry.lng, entry.lat],
        [(entry.lng + exit.lng) / 2 + 0.02, (entry.lat + exit.lat) / 2],
        [exit.lng, exit.lat],
      ],
    },
    entry,
    exit,
    distance_m: durationS * SPEED_MS,
    duration_s: durationS,
    curviness: 2.0,
    backroad_share: 0.6,
    main_share: 0.25,
    highway_share: 0,
    hood_share: 0.03,
    turns_per_10min: 3.0,
    loopiness: 0.4,
  };
}

const matrixFn: NonNullable<DiscoverCoresDeps['matrixFn']> = async (_url, { locations }) =>
  locations.map((src) =>
    locations.map((tgt) => {
      const d = haversineMeters([src[0], src[1]], [tgt[0], tgt[1]]);
      return { timeS: d / SPEED_MS, distanceM: d };
    }),
  );

const straightRoute = (waypoints: ReadonlyArray<readonly [number, number]>): RouteThroughOutput => {
  const coords = waypoints.map(([lng, lat]) => [lng, lat] as [number, number]);
  let dist = 0;
  for (let i = 1; i < coords.length; i++) dist += haversineMeters(coords[i - 1]!, coords[i]!);
  return {
    geometry: { type: 'LineString', coordinates: coords } as LineString,
    distance_m: dist,
    duration_s: dist / SPEED_MS,
    legs: [],
    maneuvers: [],
    has_highway: false,
    has_toll: false,
    has_ferry: false,
    has_unpaved: false,
  };
};

function depsWith(
  rows: CoreRowRead[],
  overrides: Partial<DiscoverCoresDeps> = {},
): DiscoverCoresDeps {
  return {
    db: {} as unknown as Client,
    valhallaUrl: 'http://x',
    coresFn: async () => rows,
    matrixFn,
    routeFn: async (_url, req) => straightRoute(req.waypoints),
    ...overrides,
  };
}

describe('discoverCores (R25-U14)', () => {
  const near = coreRow(
    'near',
    { lat: 43.55, lng: -80.05 },
    { lat: 43.6, lng: -80.1 },
    3600, // a real 60-min drive core
  );

  it('serves three legs; the core geometry is the STORED one, never re-routed', async () => {
    const res = await discoverCores(ORIGIN, depsWith([near]));
    expect(res.v).toBe(2);
    expect(res.drives).toHaveLength(1);
    const d = res.drives[0]!;
    expect(d.core.geometry).toEqual(near.geom_simplified); // as stored
    expect(d.core.duration_s).toBe(3600); // measured offline, not recomputed
    expect(d.connectorOut.duration_s).toBeGreaterThan(0);
    expect(d.connectorHome.duration_s).toBeGreaterThan(0);
    expect(d.core.loopiness).toBe(0.4); // loop core keeps its measured shape
  });

  it('drops mostly-commute cores BEFORE building anything (no wasted builds)', async () => {
    let builds = 0;
    // a 12-min core very far away → connector share ≫ cap
    const far = coreRow('far', { lat: 43.85, lng: -80.35 }, { lat: 43.86, lng: -80.36 }, 720);
    const res = await discoverCores(
      ORIGIN,
      depsWith([far], {
        routeFn: async (_url, req) => {
          builds++;
          return straightRoute(req.waypoints);
        },
      }),
    );
    expect(res.drives).toEqual([]);
    expect(builds).toBe(0); // dropped on the matrix estimate alone
    expect(res.disclosures.join(' ')).toMatch(/getting-there/);
    expect(CORE_CONNECTOR_SHARE_MAX).toBeLessThan(1);
  });

  it('BD-150: the menu never shows the same physical ring twice', async () => {
    // Overlapping sweep cells store one ring many times (measured: 270 loop
    // cores / 82 distinct names; a live menu showed "8th Line" twice). Two
    // rows with identical geometry must yield ONE card — and a genuinely
    // different ring still gets its slot.
    const twinA = coreRow('twinA', { lat: 43.55, lng: -80.05 }, { lat: 43.6, lng: -80.1 }, 3600);
    const twinB = { ...twinA, id: 'twinB', name: 'Core twinB (other cell)' };
    const other = coreRow('other', { lat: 43.62, lng: -79.95 }, { lat: 43.66, lng: -79.9 }, 3000);
    const res = await discoverCores(ORIGIN, depsWith([twinA, twinB, other]));
    expect(res.drives).toHaveLength(2);
    expect(res.drives.map((d) => d.id)).toEqual(['twinA', 'other']);
  });

  it('BD-149: the commute is NEVER engineered — no retries, sameWayHome is a label only', async () => {
    // The owner, from the device: getting there/back "should genuinely just
    // take the easiest and fastest way". The R29/R30 offset-via ladders WERE
    // his "getting there is absolutely terrible". Contract now: exactly one
    // out call + one home call (2 waypoints each, no vias), and total overlap
    // simply LABELS the card sameWayHome — an honest fact, not a defect.
    const outLine = straightRoute([
      [ORIGIN.lng, ORIGIN.lat],
      [near.entry.lng, near.entry.lat],
    ]);
    let calls = 0;
    let viaCalls = 0;
    const res = await discoverCores(
      ORIGIN,
      depsWith([near], {
        routeFn: async (_url, req) => {
          calls++;
          if (req.waypoints.length > 2) viaCalls++;
          return outLine; // out and home ride the same line
        },
      }),
    );
    expect(res.drives[0]!.sameWayHome).toBe(true);
    expect(viaCalls).toBe(0); // no via retries, ever
    expect(calls).toBe(2); // one out + one home — nothing else
    expect(res.disclosures.join(' ')).toMatch(/way you went out/);
  });

  it('an empty index returns an honest empty menu (never fabricates)', async () => {
    const res = await discoverCores(ORIGIN, depsWith([]));
    expect(res.drives).toEqual([]);
    expect(res.disclosures[0]).toMatch(/No measured drives/);
  });
});
