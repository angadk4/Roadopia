import type { LatLng } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { MatrixCell } from '../valhalla/matrix';

import type { CoreRowRead } from './discover_cores';
import {
  chainRibbons,
  RIBBON_CHAIN_MAX,
  ribbonMatrixLocations,
  ribbonPool,
  ribbonRoadKey,
} from './ribbon_chain';

/**
 * R29 Unit B — the chain that fills the ask from measured ribbons. Pinned
 * hard because it is about to carry the BD-135 A/B: the predictor must price
 * ribbons at their MEASURED duration (the matrix under-prices them ~3×, which
 * is the exact trap that over-filled the generic chainer), orientation must
 * stay entry→exit, and the emitted spans must be repair-proof.
 */

const ORIGIN: LatLng = { lat: 43.75, lng: -79.83 };

function ribbon(id: string, entryLng: number, entryLat: number, durS: number): CoreRowRead {
  const entry = { lat: entryLat, lng: entryLng };
  const exit = { lat: entryLat + 0.005, lng: entryLng + 0.012 }; // ~1 km of road
  return {
    id,
    kind: 'ribbon',
    name: `Ribbon ${id}`,
    bar_profile: 'strict',
    geom_simplified: {
      type: 'LineString',
      coordinates: [
        [entry.lng, entry.lat],
        [(entry.lng + exit.lng) / 2, (entry.lat + exit.lat) / 2],
        [exit.lng, exit.lat],
      ],
    },
    entry,
    exit,
    distance_m: durS * 12,
    duration_s: durS,
    curviness: 1.5,
    backroad_share: 1.0,
    main_share: 0,
    highway_share: 0,
    hood_share: 0,
    turns_per_10min: 3,
    loopiness: null,
  };
}

/** Matrix where every routed link costs `linkS` seconds. */
function flatMatrix(n: number, linkS: number): MatrixCell[][] {
  return Array.from({ length: n }, (_, a) =>
    Array.from({ length: n }, (_, b) =>
      a === b ? { timeS: 0, distanceM: 0 } : { timeS: linkS, distanceM: linkS * 15 },
    ),
  );
}

/**
 * Design #4 selects ONE ribbon per bearing sector inside a radius band derived
 * from the budget, so the fixture is a genuine TOUR: four ~10-minute ribbons
 * N/E/S/W of the origin at ~3.5 km — the radius the model derives for a 70-min
 * ask (est. 40 min of ribbon → 30 min of links / chordFactor(K=4) ≈ 3.6 km).
 * The old fixture bunched all four in one corner; a tour cannot enclose a
 * corner, and the selection rightly returned nothing.
 */
const POOL4 = [
  ribbon('north', -79.83, 43.7815, 600), // 10 min each
  ribbon('east', -79.7864, 43.75, 600),
  ribbon('south', -79.83, 43.7185, 600),
  ribbon('west', -79.8736, 43.75, 600),
];

describe('ribbonPool / ribbonMatrixLocations', () => {
  it('keeps the [origin, e0,x0, e1,x1…] location contract', () => {
    const pool = ribbonPool(ORIGIN, POOL4);
    const locs = ribbonMatrixLocations(ORIGIN, pool);
    expect(locs).toHaveLength(1 + pool.length * 2);
    expect(locs[0]).toEqual([ORIGIN.lng, ORIGIN.lat]);
    expect(locs[pool[0]!.entryLoc]).toEqual([pool[0]!.row.entry.lng, pool[0]!.row.entry.lat]);
    expect(locs[pool[0]!.exitLoc]).toEqual([pool[0]!.row.exit.lng, pool[0]!.row.exit.lat]);
  });

  it('is deterministic and ranks by measured value', () => {
    const a = ribbonPool(ORIGIN, POOL4).map((p) => p.row.id);
    const b = ribbonPool(ORIGIN, [...POOL4].reverse()).map((p) => p.row.id);
    expect(a).toEqual(b);
  });

  it('road key survives every id format in the wild (the r34 rename broke the old marker)', () => {
    // Same physical road (way suffix 9007) under three format generations:
    expect(ribbonRoadKey('c-79.1_43.7:ribbon:9007')).toBe('9007');
    expect(ribbonRoadKey('c-79.1_43.7:r34ribbon:9007')).toBe('9007'); // the live-bug format
    expect(ribbonRoadKey('r35-rib:c-79.1_43.7:ribbon:9007')).toBe('9007'); // loader-v2 namespaced
    expect(ribbonRoadKey('c-77.5_44.9:ribbon:131525+8393+8420')).toBe('131525+8393+8420');
  });

  it('pool dedups the SAME road stored under different cells and formats', () => {
    // Two copies of one physical road from adjacent overlapping sweep cells,
    // one in the r34-carry format — exactly the production shape that
    // resurrected the Guelph 24-entries-4-roads pool.
    const copyA = { ...ribbon('c-79.83_43.75:ribbon:9007', -79.83, 43.7815, 600) };
    const copyB = { ...ribbon('c-79.90_43.75:r34ribbon:9007', -79.83, 43.7815, 600) };
    const pool = ribbonPool(ORIGIN, [copyA, copyB]);
    expect(pool).toHaveLength(1);
    expect(pool[0]!.row.id).toBe(copyA.id); // deterministic winner: lexicographic id
  });
});

describe('chainRibbons', () => {
  it('prices the chain with MEASURED ribbon durations, not matrix shortcuts', () => {
    // 4 ribbons × 10 min + 5 links × 5 min = 65 min. Ask 70 min → fits.
    // If the predictor used the matrix for ribbon self-legs (5 min each), it
    // would think the chain was 45 min and over-fill — the 3× trap.
    const pool = ribbonPool(ORIGIN, POOL4);
    const m = flatMatrix(1 + pool.length * 2, 300);
    const chains = chainRibbons(ORIGIN, POOL4, m, 70 * 60);
    expect(chains.length).toBeGreaterThan(0);
    const best = chains[0]!;
    // 2 points/ribbon since the mid-via measured as a Valhalla 499 source
    // ("leg_shape_index not set") — MID_VIA_MIN_M defaults Infinity.
    expect(best.waypoints.length).toBe((best.spans?.length ?? 0) * 2);
  });

  it('rejects a chain that cannot reach the fill floor of the ask', () => {
    // Two 10-min ribbons + links ≈ 35 min max; a 2-hour ask can't be 60% filled.
    const two = POOL4.slice(0, 2);
    const m = flatMatrix(1 + 2 * 2, 300);
    expect(chainRibbons(ORIGIN, two, m, 120 * 60)).toHaveLength(0);
  });

  it('keeps each ribbon INTACT entry↔exit (orientation may flip, road may not)', () => {
    const m = flatMatrix(1 + POOL4.length * 2, 300);
    const chains = chainRibbons(ORIGIN, POOL4, m, 70 * 60);
    const c = chains[0]!;
    for (const s of c.spans ?? []) {
      const id = s.segmentId.replace('rchain:', '');
      const row = POOL4.find((r) => r.id === id)!;
      const w0 = c.waypoints[s.startIndex]!;
      const w2 = c.waypoints[s.endIndex]!;
      // both ends present, in ONE of the two driving directions — the tour
      // picks the cheaper approach (nearest-neighbour by matrix cost), and a
      // rural road's duration is ~symmetric, so reversal is legitimate.
      const fwd = w0 === row.entry && w2 === row.exit;
      const rev = w0 === row.exit && w2 === row.entry;
      expect(fwd || rev).toBe(true);
    }
  });

  it('emits PINNED spans (repair must not touch them)', () => {
    const m = flatMatrix(1 + POOL4.length * 2, 300);
    const c = chainRibbons(ORIGIN, POOL4, m, 70 * 60)[0]!;
    for (const s of c.spans ?? []) {
      expect(s.endIndex - s.startIndex).toBe(1); // entry→exit, no mid via (v1)
      expect(s.pinned).toBe(true);
    }
    expect((c.spans ?? []).length).toBeLessThanOrEqual(RIBBON_CHAIN_MAX);
  });

  it('rejects a shape containing an unroutable link', () => {
    const pool = ribbonPool(ORIGIN, POOL4);
    const m = flatMatrix(1 + pool.length * 2, 300);
    for (const row of m)
      for (let j = 0; j < row.length; j++) row[j] = { timeS: null, distanceM: null };
    expect(chainRibbons(ORIGIN, POOL4, m, 70 * 60)).toHaveLength(0);
  });

  it('needs no ask → no chains (the ask defines the drive)', () => {
    const m = flatMatrix(1 + POOL4.length * 2, 300);
    expect(chainRibbons(ORIGIN, POOL4, m, null)).toHaveLength(0);
  });
});
