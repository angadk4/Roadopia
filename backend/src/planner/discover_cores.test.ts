import type { LatLng, LineString, Maneuver, RouteThroughOutput } from '@shared/types';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { haversineMeters } from '../../../data/curvature/geometry';
import type { RouteThroughRequest } from '../valhalla/route';

import {
  CORE_CONNECTOR_SHARE_MAX,
  CORE_ROUTE_FIDELITY_MIN,
  CORES_BUILD_MAX,
  CORES_MENU_MAX,
  CORES_SAME_NAME_MAX,
  CORES_SHORT_CARD_MAX_S,
  CORES_TRIP_TOTAL_MAX_S,
  discoverCores,
  ringFidelity,
  ringSamples,
  rotateRingToNearest,
  type CoreRowRead,
  type DiscoverCoresDeps,
} from './discover_cores';
import { pairOverlap } from './overlap';

/**
 * R25-U14 — the v2 browse against stubbed deps: definer rows in, three honest
 * legs out; mostly-commute cores dropped BEFORE any build; the stored core is
 * served as stored; same-way-home is a label.
 *
 * BD-203 (planner audit): the menu is the definer's QUALITY order (never
 * longest-first), a 3 h door-to-door ceiling and a reserved <= 75-min card
 * are product bars, dedup is the index's symmetric same-ask rule, a per-card
 * drop is refilled, connectors carry flags + maneuvers, and the ring is
 * served ROUTED (with maneuvers) only when the engine reproduces it.
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

/** A CLOSED axis-aligned square ring (side `sideM`, `perSide` vertices per
 *  side, first vertex repeated at the end) — >= 8 points, so the browse treats
 *  it as a ring (BD-162 join = origin-nearest vertex). [lng, lat] order. */
function squareRing(center: LatLng, sideM: number, perSide = 4): Array<[number, number]> {
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const h = sideM / 2;
  const corners: Array<[number, number]> = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 4; k++) {
    const a = corners[k]!;
    const b = corners[(k + 1) % 4]!;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  pts.push(pts[0]!);
  return pts.map(([x, y]) => [center.lng + x / lngM, center.lat + y / latM]);
}

function ringLengthM(coords: ReadonlyArray<readonly [number, number]>): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) m += haversineMeters(coords[i - 1]!, coords[i]!);
  return m;
}

function ringRow(
  id: string,
  coords: Array<[number, number]>,
  durationS: number,
  over: Partial<CoreRowRead> = {},
): CoreRowRead {
  const line: LineString = { type: 'LineString', coordinates: coords };
  const first = coords[0]!;
  return {
    id,
    kind: 'loop',
    name: `Core ${id}`,
    bar_profile: 'strict',
    geom_simplified: line,
    geometry: line,
    entry: { lat: first[1], lng: first[0] },
    exit: { lat: first[1], lng: first[0] },
    distance_m: Math.round(ringLengthM(coords)),
    duration_s: durationS,
    curviness: 2.0,
    backroad_share: 0.6,
    main_share: 0.25,
    highway_share: 0,
    hood_share: 0.03,
    turns_per_10min: 3.0,
    loopiness: 0.7,
    ...over,
  };
}

/** A 2 km square ring centred `eastM`/`northM` metres from the origin. */
const ringAt = (id: string, eastM: number, northM: number, durationS: number): CoreRowRead =>
  ringRow(
    id,
    squareRing(
      {
        lat: ORIGIN.lat + northM / 111_320,
        lng: ORIGIN.lng + eastM / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
      },
      2_000,
    ),
    durationS,
  );

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

const isRingPass = (req: RouteThroughRequest): boolean => req.middleType === 'through';

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

const RING_MANEUVERS: Maneuver[] = [
  { type: 'start', instruction: 'Drive east on Ring Road.', distance_m: 1200 },
  { type: 'left', instruction: 'Turn left onto Ring Road.', distance_m: 2000 },
  { type: 'destination', instruction: 'You have arrived.', distance_m: 0 },
];

describe('discoverCores (R25-U14)', () => {
  const near = coreRow(
    'near',
    { lat: 43.55, lng: -80.05 },
    { lat: 43.6, lng: -80.1 },
    3600, // a real 60-min drive core
  );

  it('serves three legs; a NON-ring core is served as stored, guidance honestly absent', async () => {
    // (open 3-point fixture: no ring, so no ring pass is even attempted)
    const res = await discoverCores(ORIGIN, depsWith([near]));
    expect(res.v).toBe(2);
    expect(res.drives).toHaveLength(1);
    const d = res.drives[0]!;
    expect(d.core.geometry).toEqual(near.geom_simplified); // as stored
    expect(d.core.duration_s).toBe(3600); // measured offline, not recomputed
    expect(d.core.maneuvers).toBeNull();
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
    // BD-203 keeps the words honest too: nothing measured a second road.
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
    expect(res.disclosures.join(' ')).toMatch(/same fastest road there and back/);
    expect(res.disclosures.join(' ')).not.toMatch(/second road/);
  });

  it('an empty index returns an honest empty menu (never fabricates)', async () => {
    const res = await discoverCores(ORIGIN, depsWith([]));
    expect(res.drives).toEqual([]);
    expect(res.disclosures[0]).toMatch(/No measured drives/);
  });
});

describe('discoverCores selection (BD-203)', () => {
  it('keeps the definer QUALITY order — never longest-first', async () => {
    const rows = [
      ringAt('q1', 10_000, 0, 40 * 60),
      ringAt('q2', 10_000, 6_000, 90 * 60),
      ringAt('q3', 10_000, -6_000, 60 * 60),
    ];
    const res = await discoverCores(ORIGIN, depsWith(rows));
    expect(res.drives.map((d) => d.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('drops a trip over the 3 h door-to-door ceiling and says so', async () => {
    const ok = ringAt('ok', 10_000, 0, 60 * 60);
    // ~10 min each way + 170 min core = ~190 min door to door (> 180)
    const long = ringAt('long', 10_000, 6_000, 170 * 60);
    expect(CORES_TRIP_TOTAL_MAX_S).toBe(3 * 3600);
    const res = await discoverCores(ORIGIN, depsWith([ok, long]));
    expect(res.drives.map((d) => d.id)).toEqual(['ok']);
    expect(res.disclosures).toContain(
      '1 more would be more than 3 hours door to door — not shown.',
    );
  });

  it('the empty-state line comes FIRST when nothing fits; the counts follow', async () => {
    const long = ringAt('long', 10_000, 0, 170 * 60);
    const res = await discoverCores(ORIGIN, depsWith([long]));
    expect(res.drives).toEqual([]);
    expect(res.disclosures[0]).toMatch(/^No measured drives fit from here/);
    expect(res.disclosures[1]).toMatch(/would be more than 3 hours door to door/);
    expect(res.disclosures[1]).not.toMatch(/more would/); // nothing is shown, so not "more"
  });

  it('a shorter sub-ring of a kept ring SURVIVES dedup (different ask)', async () => {
    // The index's frozen rule (eval/dedup_index.ts): same ring = mutual
    // overlap > 0.5 AND durations within 15 %. A 45-min lap on two sides of
    // a 120-min square shares most of ITS edges with the big ring — the old
    // asymmetric longest-first test deleted it; it is a different drive.
    const center = {
      lat: ORIGIN.lat,
      lng: ORIGIN.lng + 12_000 / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
    };
    const big = squareRing(center, 4_000, 6);
    const perSide = 6;
    // corner0 -> corner1 -> corner2 (two shared sides), then the diagonal home
    const tri = big.slice(0, 2 * perSide + 1);
    const c0 = tri[0]!;
    const c2 = tri[tri.length - 1]!;
    for (let i = 1; i < perSide; i++) {
      const t = i / perSide;
      tri.push([c2[0] + (c0[0] - c2[0]) * t, c2[1] + (c0[1] - c2[1]) * t]);
    }
    tri.push(c0);
    const bigRow = ringRow('big', big, 120 * 60);
    const subRow = ringRow('sub', tri, 45 * 60);
    const overlap = pairOverlap(subRow.geom_simplified, bigRow.geom_simplified);
    expect(overlap).toBeGreaterThan(0.5); // the fixture really is a sub-ring
    const res = await discoverCores(ORIGIN, depsWith([bigRow, subRow]));
    expect(res.drives.map((d) => d.id)).toEqual(['big', 'sub']);
  });

  it('a near-duplicate (mutual overlap > 0.5, durations within 15 %) is ONE card', async () => {
    const a = ringAt('a', 10_000, 0, 60 * 60);
    const b = { ...ringAt('b', 10_000, 0, 65 * 60), name: 'Core b (other cell)' };
    const res = await discoverCores(ORIGIN, depsWith([a, b]));
    expect(res.drives.map((d) => d.id)).toEqual(['a']);
  });

  it('same-name rings dedup only within the 15 % band — different sizes both stay', async () => {
    const small = { ...ringAt('n1', 10_000, 0, 50 * 60), name: '8th Line' };
    const bigger = { ...ringAt('n2', 10_000, 6_000, 110 * 60), name: '8th Line' };
    const alike = { ...ringAt('n3', 10_000, -6_000, 54 * 60), name: '8th Line' };
    const res = await discoverCores(ORIGIN, depsWith([small, bigger, alike]));
    // n3 is a same-name, same-ask row (54 vs 50 min) — dropped; n2 is a
    // legitimately different ask under the same headline — kept.
    expect(res.drives.map((d) => d.id)).toEqual(['n1', 'n2']);
  });

  it('at most CORES_SAME_NAME_MAX cards carry one headline name, across asks (BD-203)', async () => {
    expect(CORES_SAME_NAME_MAX).toBe(2);
    // four different-size rings all named after the same cell road
    const rows: CoreRowRead[] = [
      { ...ringAt('f1', 10_000, 0, 40 * 60), name: 'Fallbrook Trail' },
      { ...ringAt('f2', 10_000, 6_000, 70 * 60), name: 'Fallbrook Trail' },
      { ...ringAt('f3', 10_000, -6_000, 100 * 60), name: 'Fallbrook Trail' },
      { ...ringAt('f4', 16_000, 0, 130 * 60), name: 'Fallbrook Trail' },
      ringAt('other', 16_000, 6_000, 60 * 60),
    ];
    const res = await discoverCores(ORIGIN, depsWith(rows));
    const named = res.drives.filter((d) => d.name === 'Fallbrook Trail');
    expect(named).toHaveLength(2);
    expect(res.drives.map((d) => d.id)).toContain('other');
  });

  it('reserves a <= 75-min card when one is reachable, trimming in quality order', async () => {
    expect(CORES_SHORT_CARD_MAX_S).toBe(75 * 60);
    // ten 100-min rings rank above the one 50-min ring
    const rows: CoreRowRead[] = [];
    for (let i = 0; i < 10; i++) rows.push(ringAt(`r${i}`, 10_000, (i - 5) * 5_500, 100 * 60));
    rows.push(ringAt('short', 16_000, 0, 50 * 60));
    const res = await discoverCores(ORIGIN, depsWith(rows));
    expect(res.drives).toHaveLength(CORES_MENU_MAX);
    expect(res.drives.map((d) => d.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'short']);
  });

  it('a per-card drop is REFILLED from the built candidates (select 9 -> 6)', async () => {
    expect(CORES_BUILD_MAX).toBeGreaterThan(CORES_MENU_MAX);
    const rows: CoreRowRead[] = [];
    for (let i = 0; i < 9; i++) rows.push(ringAt(`r${i}`, 10_000, (i - 4) * 5_500, 90 * 60));
    const doomed = rotateRingToNearest(rows[1]!.geometry!, ORIGIN)!.join;
    let built = 0;
    const res = await discoverCores(
      ORIGIN,
      depsWith(rows, {
        routeFn: async (_url, req) => {
          if (!isRingPass(req)) {
            built++;
            const [lng, lat] = req.waypoints[1]!;
            if (Math.abs(lng - doomed.lng) < 1e-9 && Math.abs(lat - doomed.lat) < 1e-9) {
              throw new Error('no route'); // r1's out connector fails
            }
          }
          return straightRoute(req.waypoints);
        },
      }),
    );
    expect(built).toBe(2 * CORES_BUILD_MAX); // out + home for each of the 9
    expect(res.drives.map((d) => d.id)).toEqual(['r0', 'r2', 'r3', 'r4', 'r5', 'r6']);
  });

  it('connector legs carry the engine flags and maneuvers (legOf)', async () => {
    const row = ringAt('flags', 10_000, 0, 60 * 60);
    const cue: Maneuver = { type: 'right', instruction: 'Turn right.', distance_m: 800 };
    const res = await discoverCores(
      ORIGIN,
      depsWith([row], {
        routeFn: async (_url, req) => {
          if (isRingPass(req)) throw new Error('ring pass off in this test');
          const r = straightRoute(req.waypoints);
          const isOut = req.waypoints[0]![0] === ORIGIN.lng && req.waypoints[0]![1] === ORIGIN.lat;
          return { ...r, has_highway: isOut, has_toll: !isOut, maneuvers: [cue] };
        },
      }),
    );
    const d = res.drives[0]!;
    expect(d.connectorOut.has_highway).toBe(true);
    expect(d.connectorOut.has_toll).toBe(false);
    expect(d.connectorHome.has_highway).toBe(false);
    expect(d.connectorHome.has_toll).toBe(true);
    expect(d.connectorOut.maneuvers).toEqual([cue]);
    expect(d.connectorHome.maneuvers).toEqual([cue]);
    expect(d.core.maneuvers).toBeNull(); // the ring pass failed: honestly absent
  });
});

describe('the ring pass (BD-203)', () => {
  const row = ringRow(
    'ring',
    squareRing(
      {
        lat: ORIGIN.lat,
        lng: ORIGIN.lng + 10_000 / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
      },
      6_000,
      10,
    ),
    75 * 60,
  );
  const rotated = rotateRingToNearest(row.geometry!, ORIGIN)!;

  it('routes join -> <= 15 through-points round the ring -> join, on the drive-first costing', async () => {
    const seen: RouteThroughRequest[] = [];
    await discoverCores(
      ORIGIN,
      depsWith([row], {
        routeFn: async (_url, req) => {
          seen.push(req);
          return straightRoute(req.waypoints);
        },
      }),
    );
    const ring = seen.filter(isRingPass);
    const commutes = seen.filter((r) => !isRingPass(r));
    expect(ring).toHaveLength(1);
    expect(commutes).toHaveLength(2);
    for (const c of commutes) expect(c.waypoints).toHaveLength(2);
    const pass = ring[0]!;
    expect(pass.waypoints[0]).toEqual([rotated.join.lng, rotated.join.lat]);
    expect(pass.waypoints[pass.waypoints.length - 1]).toEqual([rotated.join.lng, rotated.join.lat]);
    expect(pass.waypoints.length).toBeLessThanOrEqual(16); // <= 15 samples + the closing join
    expect(pass.costingOptions).toEqual({ use_highways: 0.2, use_living_streets: 0 });
    // samples are >= 1.5 km apart ALONG the ring (a chord across a corner is shorter)
    const samples = ringSamples(rotated.rotated);
    const ringCoords = rotated.rotated.coordinates as Array<[number, number]>;
    const idxOf = (p: [number, number]): number =>
      ringCoords.findIndex((c) => c[0] === p[0] && c[1] === p[1]);
    expect(samples.length).toBeLessThanOrEqual(15);
    for (let i = 1; i < samples.length; i++) {
      const a = idxOf(samples[i - 1]!);
      const b = idxOf(samples[i]!);
      expect(b).toBeGreaterThan(a); // walks the ring forward
      expect(ringLengthM(ringCoords.slice(a, b + 1))).toBeGreaterThanOrEqual(1_500);
    }
  });

  it('at fidelity >= 0.95 the card serves the ROUTED ring + maneuvers, stored numbers untouched', async () => {
    expect(CORE_ROUTE_FIDELITY_MIN).toBe(0.95);
    const res = await discoverCores(
      ORIGIN,
      depsWith([row], {
        routeFn: async (_url, req) =>
          isRingPass(req)
            ? {
                ...straightRoute(req.waypoints),
                geometry: rotated.rotated, // the engine reproduced the ring
                distance_m: 999, // a re-price that must NOT be served
                duration_s: 999,
                maneuvers: RING_MANEUVERS,
              }
            : straightRoute(req.waypoints),
      }),
    );
    const d = res.drives[0]!;
    expect(ringFidelity(rotated.rotated, d.core.geometry)).toBe(1);
    expect(d.core.geometry).toEqual(rotated.rotated);
    expect(d.core.maneuvers).toEqual(RING_MANEUVERS);
    expect(d.core.distance_m).toBe(row.distance_m); // provenance: the measurement
    expect(d.core.duration_s).toBe(75 * 60);
  });

  it('below 0.95 (the engine shortcut the ring) the STORED ring ships, maneuvers null', async () => {
    // Re-stating the R25-U14 rule honestly: the stored ring is what a card
    // shows unless the engine reproduces it — a shortcut is never dressed up
    // as the measured drive, and the stored numbers never describe a line
    // the user is not shown.
    const c = rotated.rotated.coordinates as Array<[number, number]>;
    const half = c.slice(0, Math.floor(c.length / 2) + 1);
    const shortcut: LineString = { type: 'LineString', coordinates: [...half, c[0]!] };
    expect(ringFidelity(rotated.rotated, shortcut)).toBeLessThan(CORE_ROUTE_FIDELITY_MIN);
    const res = await discoverCores(
      ORIGIN,
      depsWith([row], {
        routeFn: async (_url, req) =>
          isRingPass(req)
            ? { ...straightRoute(req.waypoints), geometry: shortcut, maneuvers: RING_MANEUVERS }
            : straightRoute(req.waypoints),
      }),
    );
    const d = res.drives[0]!;
    expect(d.core.geometry).toEqual(rotateRingToNearest(row.geom_simplified, ORIGIN)!.rotated);
    expect(d.core.maneuvers).toBeNull();
    expect(d.core.duration_s).toBe(75 * 60);
  });

  it('a failed ring pass never drops the card (best effort)', async () => {
    const res = await discoverCores(
      ORIGIN,
      depsWith([row], {
        routeFn: async (_url, req) => {
          if (isRingPass(req)) throw new Error('engine hiccup');
          return straightRoute(req.waypoints);
        },
      }),
    );
    expect(res.drives).toHaveLength(1);
    expect(res.drives[0]!.core.maneuvers).toBeNull();
    expect(res.drives[0]!.core.geometry).toEqual(
      rotateRingToNearest(row.geom_simplified, ORIGIN)!.rotated,
    );
  });
});
