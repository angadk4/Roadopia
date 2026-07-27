import type { LatLng, LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { WaypointCandidate } from './candidates';
import {
  candidateWithConnectorVias,
  CONNECTOR_MAX_LOCATIONS,
  planConnectorVias,
  waypointVertexIndices,
} from './connectors';
import type { CandidateSegment } from './retrieve';

/**
 * R25-U19 — the pure half of the connector rebuild: dense-monotone-corpus via
 * planning + candidate enrichment with full stop/span index maintenance. The
 * engine half is judged by the rq25_u19_probe experiment + the pre-registered
 * A/B; THESE tests pin the bookkeeping the four prior refusals never needed.
 */

const LAT = 43.5;
const LNG0 = -80.0;
const LNG_M = 111_320 * Math.cos((LAT * Math.PI) / 180);
const LAT_M = 111_320;

const at = (xM: number, yM: number): [number, number] => [LNG0 + xM / LNG_M, LAT + yM / LAT_M];
const ll = (xM: number, yM: number): LatLng => ({ lng: LNG0 + xM / LNG_M, lat: LAT + yM / LAT_M });

/** Straight east–west polyline of `lenM` metres sampled every `stepM`. */
function line(lenM: number, yM = 0, stepM = 100): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = 0; x <= lenM; x += stepM) out.push(at(x, yM));
  return out;
}

function seg(
  id: string,
  xM: number,
  yM: number,
  opts: { highway?: string; curviness?: number; urbanShare?: number; lenM?: number } = {},
): CandidateSegment {
  const lenM = opts.lenM ?? 800;
  return {
    id,
    osmWayId: id,
    name: `Road ${id}`,
    highway: opts.highway ?? 'tertiary',
    lengthM: lenM,
    curviness: opts.curviness ?? 2.0,
    urbanShare: opts.urbanShare ?? 0,
    geometry: {
      type: 'LineString',
      coordinates: [at(xM - lenM / 2, yM), at(xM, yM), at(xM + lenM / 2, yM)],
    },
  };
}

describe('planConnectorVias (R25-U19, pure)', () => {
  it('snaps dense samples to nearby curvy BACKROAD corpus points, in monotone order', () => {
    const leg = line(12_000);
    const segments = [
      seg('a', 3000, 800), // 800 m north of the 3 km mark — in radius
      seg('b', 8000, -900), // 900 m south of the 8 km mark — in radius
    ];
    const vias = planConnectorVias(leg, segments, { spacingM: 2500, radiusM: 1200 });
    expect(vias.length).toBe(2);
    expect(vias.map((v) => v.segmentId)).toEqual(['a', 'b']);
    // monotone along the leg — the property whose absence cost 3.8× distance
    expect(vias[0]!.alongM).toBeLessThan(vias[1]!.alongM);
  });

  it('never steers into mains, hoods, or straight roads — backroad-class curvy only', () => {
    const leg = line(12_000);
    const segments = [
      seg('main', 4000, 500, { highway: 'secondary' }), // main road — excluded
      seg('hood', 6000, 500, { highway: 'residential' }), // hood — excluded
      seg('flat', 8000, 500, { curviness: 0.3 }), // not curvy — excluded
    ];
    expect(planConnectorVias(leg, segments)).toEqual([]);
  });

  it('short legs and out-of-radius material are left to Valhalla (no via spam)', () => {
    expect(planConnectorVias(line(3000), [seg('a', 1500, 200)])).toEqual([]); // under MIN_LEG
    expect(planConnectorVias(line(12_000), [seg('far', 6000, 5000)])).toEqual([]); // 5 km off
  });

  it('TRACES a paralleling backroad with repeated same-road vias (design-review fix: the old same-segment exclusion under-steered exactly this case)', () => {
    // DENSE parallel geometry (a real corpus road, not a 3-vertex sketch)
    const long: CandidateSegment = {
      ...seg('one-road', 6000, 700, { lenM: 9000 }),
      geometry: {
        type: 'LineString',
        coordinates: Array.from({ length: 31 }, (_, i) => at(1500 + i * 300, 700)),
      },
    };
    const vias = planConnectorVias(line(12_000), [long]); // probe-frozen defaults
    // corridor-following working = MULTIPLE vias walking the same road…
    expect(vias.length).toBeGreaterThanOrEqual(2);
    expect(vias.every((v) => v.segmentId === 'one-road')).toBe(true);
    // …with spacing kept and never the identical vertex twice
    for (let i = 1; i < vias.length; i++) {
      expect(vias[i]!.alongM - vias[i - 1]!.alongM).toBeGreaterThanOrEqual(2000);
      expect(vias[i]!.point).not.toEqual(vias[i - 1]!.point);
    }
  });

  it('snapped-point MONOTONICITY holds even when a snap displaces backward', () => {
    // a road angled so its nearest vertex to a later sample sits BEHIND the
    // previous via's projection — the snapped-projection guard must drop it
    const road = seg('angled', 4000, 700, { lenM: 700 });
    const decoy = seg('behind', 5200, 750, { lenM: 400 });
    // decoy's vertices all project ~5.0-5.4 km; road's ~3.6-4.4 km — with
    // spacing 2500 both samples would snap inside each other's shadow; the
    // guard keeps projections strictly increasing
    const vias = planConnectorVias(line(12_000), [road, decoy], { spacingM: 2500, radiusM: 1600 });
    for (let i = 1; i < vias.length; i++) {
      expect(vias[i]!.alongM).toBeGreaterThan(vias[i - 1]!.alongM);
    }
  });

  it('is deterministic: identical inputs → identical vias (EXACT value ties break by id)', () => {
    const leg = line(12_000);
    // byte-identical geometry under two ids — a true float-exact tie
    const twinA = seg('twin-a', 5000, 600);
    const twinB = { ...twinA, id: 'twin-b', osmWayId: 'twin-b' };
    const a = planConnectorVias(leg, [twinB, twinA]);
    const b = planConnectorVias(leg, [twinA, twinB]);
    expect(a).toEqual(b); // input-order independent
    expect(a[0]!.segmentId).toBe('twin-a'); // id tiebreak
  });
});

describe('waypointVertexIndices', () => {
  it('projects monotonically — a loop passing near an earlier waypoint cannot fold the legs', () => {
    // out 10 km and back on a parallel road 600 m north
    const coords = [...line(10_000, 0, 500), ...line(10_000, 600, 500).reverse()];
    const geom: LineString = { type: 'LineString', coordinates: coords };
    // w0 at 8 km outbound; w1 at 2 km on the RETURN leg (near the start!)
    const idx = waypointVertexIndices(geom, [ll(8000, 0), ll(2000, 600)]);
    expect(idx[0]!).toBeLessThan(idx[1]!); // strictly forward despite proximity to origin
    expect(coords[idx[1]!]![1]).toBeCloseTo(LAT + 600 / LAT_M, 6); // snapped to the RETURN side
  });
});

describe('candidateWithConnectorVias (index maintenance)', () => {
  const mkCandidate = (over: Partial<WaypointCandidate> = {}): WaypointCandidate => ({
    id: 'cand',
    kind: 'loop',
    waypoints: [ll(10_000, 0), ll(10_000, 8000), ll(0, 8000)],
    sector: 0,
    returnSector: null,
    clusterId: null,
    stops: [],
    clusterWeight: 1,
    ...over,
  });
  // rectangle loop: origin(0,0) → w0(10k,0) → w1(10k,8k) → w2(0,8k) → origin
  const rect: LineString = {
    type: 'LineString',
    coordinates: [
      ...line(10_000, 0, 500), // east along y=0
      ...line(8000, 0, 500).map(([, ,], i): [number, number] => at(10_000, i * 500)), // north
      ...line(10_000, 8000, 500).reverse(), // west along y=8000
      ...line(8000, 0, 500).map(([, ,], i): [number, number] => at(0, 8000 - i * 500)), // south
    ],
  };

  it('inserts vias only on connector legs and maintains stop indices', () => {
    const candidate = mkCandidate({
      stops: [
        {
          spotId: 's1',
          name: 'Cafe',
          type: 'coffee',
          requestedType: 'coffee',
          atFraction: null,
          waypointIndex: 1,
          location: ll(10_000, 8000),
        } as never,
      ],
    });
    const segments = [seg('east', 5000, 700), seg('west', 5000, 8000 - 700)];
    const out = candidateWithConnectorVias(ll(0, 0), candidate, rect, segments);
    expect(out).not.toBeNull();
    expect(out!.id).toBe('cand-cr');
    expect(out!.waypoints.length).toBeGreaterThan(3);
    // the stop still points at ITS waypoint after every insertion
    const stopIdx = (out!.stops[0] as { waypointIndex: number }).waypointIndex;
    expect(out!.waypoints[stopIdx]).toEqual(ll(10_000, 8000));
    // original candidate untouched (pure)
    expect(candidate.waypoints.length).toBe(3);
    expect(candidate.id).toBe('cand');
  });

  it('NEVER refines a span-traversal leg — those metres are the drive', () => {
    const candidate = mkCandidate({
      spans: [{ segmentId: 'drive', startIndex: 0, endIndex: 1 }],
    });
    // corpus material sits alongside the SPAN leg only (w0→w1, the north leg)
    const segments = [seg('bait', 10_000 - 700, 4000)];
    const out = candidateWithConnectorVias(ll(0, 0), candidate, rect, segments);
    expect(out).toBeNull(); // nothing insertable outside the span
  });

  it('span indices shift with insertions and stay on the same waypoints', () => {
    const candidate = mkCandidate({
      spans: [{ segmentId: 'drive', startIndex: 1, endIndex: 2 }], // w1→w2 (west leg)...
    });
    // insert on the FIRST leg (origin→w0) only
    const segments = [seg('east', 5000, 700)];
    const before0 = candidate.waypoints[1];
    const out = candidateWithConnectorVias(ll(0, 0), candidate, rect, segments);
    expect(out).not.toBeNull();
    const sp = out!.spans![0]!;
    expect(out!.waypoints[sp.startIndex]).toEqual(before0); // still anchored to w1
    expect(sp.endIndex - sp.startIndex).toBe(1); // traversal pair intact
  });

  it('respects the engine location ceiling and returns null when nothing fits', () => {
    const many = Array.from({ length: CONNECTOR_MAX_LOCATIONS }, (_, i) => ll(100 * i, 0));
    const candidate = mkCandidate({ waypoints: many });
    const out = candidateWithConnectorVias(ll(0, 0), candidate, rect, [seg('east', 5000, 700)]);
    expect(out).toBeNull(); // no via budget left
  });
});
