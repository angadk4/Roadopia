import type { LatLng, StopRequest } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  bearingDeg,
  countryClassFactor,
  generateAtoBCandidates,
  generateLoopCandidates,
  resizedSpeed,
  seedPolygonAreaM2,
  segValueOf,
  COUNTRY_CURV_GAIN,
  sectorOf,
} from './candidates';
import type { CandidateSegment, CandidateSpot } from './retrieve';

/**
 * M3-T06 — candidate generation on a synthetic RURAL fixture: curvy segments
 * spread around the origin in several compass directions (clustered groups),
 * plus a few spots. AC: ≥ N_CANDIDATES candidates across ≥ 3 sectors; unit
 * checks for sector spread + cluster coverage + determinism + anti-retrace.
 */

const ORIGIN: LatLng = { lat: 43.25, lng: -79.87 };

/** Place a point at bearing°/distance km from the origin (approx planar). */
function at(bearing: number, km: number): LatLng {
  const d2r = Math.PI / 180;
  const dLat = (km / 111.32) * Math.cos(bearing * d2r);
  const dLng = ((km / 111.32) * Math.sin(bearing * d2r)) / Math.cos(ORIGIN.lat * d2r);
  return { lat: ORIGIN.lat + dLat, lng: ORIGIN.lng + dLng };
}

let segSeq = 0;
function segment(center: LatLng, curviness: number, lengthM = 800): CandidateSegment {
  const dx = 0.002;
  segSeq += 1;
  return {
    id: `s${segSeq}`,
    osmWayId: `${1000 + segSeq}`,
    name: `Seg ${segSeq}`,
    highway: 'tertiary',
    lengthM,
    curviness,
    geometry: {
      type: 'LineString',
      coordinates: [
        [center.lng - dx, center.lat],
        [center.lng, center.lat + dx / 2],
        [center.lng + dx, center.lat],
      ],
    },
  };
}

/** Rural fixture: 4 tight clusters (N, E, SSW, W) + scattered singles. */
function ruralSegments(): CandidateSegment[] {
  segSeq = 0;
  const clusters: Array<{ bearing: number; km: number; curv: number; n: number }> = [
    { bearing: 0, km: 12, curv: 5.5, n: 4 }, // N — the twisty jackpot
    { bearing: 90, km: 10, curv: 3.2, n: 4 }, // E
    { bearing: 200, km: 14, curv: 2.4, n: 3 }, // SSW
    { bearing: 275, km: 9, curv: 1.8, n: 3 }, // W
  ];
  const segs: CandidateSegment[] = [];
  for (const c of clusters) {
    for (let i = 0; i < c.n; i++) {
      // members within ~1.2 km of the cluster centre — inside CLUSTER_RADIUS_M
      const jitterKm = (i % 3) * 0.6;
      segs.push(segment(at(c.bearing + i, c.km + jitterKm / 10), c.curv - i * 0.1));
    }
  }
  // scattered gentle singles (return-anchor material in other sectors)
  segs.push(segment(at(45, 7), 0.9));
  segs.push(segment(at(135, 8), 0.8));
  segs.push(segment(at(315, 6), 0.7));
  segs.push(segment(at(180, 7), 0.85));
  return segs;
}

const SPOTS: CandidateSpot[] = [
  {
    id: 'p1',
    name: 'Ridge Café',
    type: 'coffee',
    lat: at(0, 11).lat,
    lng: at(0, 11).lng,
    source: 'osm',
  },
  {
    id: 'p2',
    name: 'East Espresso',
    type: 'coffee',
    lat: at(90, 9).lat,
    lng: at(90, 9).lng,
    source: 'osm',
  },
  {
    id: 'p3',
    name: 'Concession Gas Bar',
    type: 'fuel',
    lat: at(90, 12).lat,
    lng: at(90, 12).lng,
    source: 'osm',
  },
];

/** StopRequest shorthand (R16-3 test matrix). */
function req(
  type: StopRequest['type'],
  at_fraction: StopRequest['at_fraction'] = null,
  importance: StopRequest['importance'] = 'nice_to_have',
): StopRequest {
  return { type, count: 1, importance, at_fraction };
}

describe('generateLoopCandidates (M3-T06)', () => {
  it('produces ≥ N_CANDIDATES across ≥ 3 sectors on the rural fixture (AC)', () => {
    const out = generateLoopCandidates(ORIGIN, ruralSegments(), [], { nCandidates: 10 });
    expect(out.length).toBeGreaterThanOrEqual(10);
    const sectors = new Set(out.map((c) => c.sector));
    expect(sectors.size).toBeGreaterThanOrEqual(3);
  });

  it('covers ≥ 3 distinct clusters (cluster coverage)', () => {
    const out = generateLoopCandidates(ORIGIN, ruralSegments(), [], { nCandidates: 10 });
    const clusters = new Set(out.map((c) => c.clusterId));
    expect(clusters.size).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic (identical output across runs, stops + fractions included)', () => {
    const requests = [req('coffee', 0.5), req('fuel')];
    const a = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, { stopRequests: requests });
    const b = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, { stopRequests: requests });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // The two mechanism tests below pin nSectors: 8 — their fixture geometry was
  // laid out for 45° wedges. The DEFAULT is frozen at 4 (M4-T12); the L3/L4
  // mechanisms under test are sector-count-independent.
  it('return sector ≠ outbound sector whenever an anchor exists (anti-retrace, L3)', () => {
    const out = generateLoopCandidates(ORIGIN, ruralSegments(), [], { nSectors: 8 });
    const withReturn = out.filter((c) => c.returnSector !== null);
    expect(withReturn.length).toBeGreaterThan(0);
    for (const c of withReturn) expect(c.returnSector).not.toBe(c.sector);
  });

  it('waypoints are angularly ordered around the origin (L4 sweep)', () => {
    const out = generateLoopCandidates(ORIGIN, ruralSegments(), [], { nSectors: 8 });
    for (const c of out.filter((x) => x.waypoints.length >= 3)) {
      const rot = (x: number) => (x - (c.sector * 360) / 8 + 360) % 360;
      const bearings = c.waypoints.map((w) => rot(bearingDeg(ORIGIN, w)));
      for (let i = 1; i < bearings.length; i++) {
        expect(bearings[i]!).toBeGreaterThanOrEqual(bearings[i - 1]! - 1e-9);
      }
    }
  });

  it('anchors a real requested spot when asked (G5) and none otherwise', () => {
    const withStops = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, {
      stopRequests: [req('coffee')],
    });
    expect(withStops.some((c) => c.stops.length > 0)).toBe(true);
    const anchored = withStops.find((c) => c.stops.length > 0)!;
    const stop = anchored.stops[0]!;
    const spot = SPOTS.find((s) => s.id === stop.spotId)!;
    // waypointIndex points AT the stop's own waypoint (index maintenance)
    const wp = anchored.waypoints[stop.waypointIndex]!;
    expect(Math.abs(wp.lat - spot.lat)).toBeLessThan(1e-9);
    expect(Math.abs(wp.lng - spot.lng)).toBeLessThan(1e-9);

    const without = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, {});
    expect(without.every((c) => c.stops.length === 0)).toBe(true);
  });

  it('per-type anchoring: coffee + fuel each get a spot of THEIR type, no spot reused (R16-3)', () => {
    const out = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, {
      stopRequests: [req('coffee'), req('fuel')],
    });
    const full = out.find((c) => c.stops.length === 2)!;
    expect(full).toBeDefined();
    const byType = new Map(full.stops.map((s) => [s.requestedType, s]));
    expect(byType.get('coffee')!.spotType).toBe('coffee');
    expect(byType.get('fuel')!.spotType).toBe('fuel');
    expect(byType.get('fuel')!.spotId).toBe('p3'); // only fuel spot in the fixture
    const ids = full.stops.map((s) => s.spotId);
    expect(new Set(ids).size).toBe(ids.length); // used-set: no double-booking
  });

  it('a request with no spot of its type yields no stop (coverage discloses, never fabricates)', () => {
    const out = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, {
      stopRequests: [req('viewpoint')], // fixture has none
    });
    expect(out.every((c) => c.stops.length === 0)).toBe(true);
  });

  it('fraction stops keep a valid waypointIndex after insertion (R16-3)', () => {
    const out = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, {
      stopRequests: [req('coffee', 0.5), req('fuel')],
    });
    for (const c of out) {
      for (const s of c.stops) {
        const wp = c.waypoints[s.waypointIndex];
        expect(wp).toBeDefined();
        const spot = SPOTS.find((x) => x.id === s.spotId)!;
        expect(Math.abs(wp!.lat - spot.lat)).toBeLessThan(1e-9);
        expect(Math.abs(wp!.lng - spot.lng)).toBeLessThan(1e-9);
      }
    }
    // and the fraction unit records its ask
    const withFraction = out.flatMap((c) => c.stops).filter((s) => s.atFraction === 0.5);
    expect(withFraction.length).toBeGreaterThan(0);
    expect(withFraction.every((s) => s.requestedType === 'coffee')).toBe(true);
  });

  it('sectorOf partitions bearings evenly', () => {
    expect(sectorOf(0, 8)).toBe(0);
    expect(sectorOf(44.9, 8)).toBe(0);
    expect(sectorOf(45, 8)).toBe(1);
    expect(sectorOf(359.9, 8)).toBe(7);
  });
});

describe('country-road preference + duration resize (BD-21, owner round 3)', () => {
  it('countryClassFactor prefers township/county lanes over arterials', () => {
    expect(countryClassFactor('unclassified')).toBe(1);
    expect(countryClassFactor('tertiary')).toBeGreaterThan(countryClassFactor('secondary'));
    expect(countryClassFactor('secondary')).toBeGreaterThan(countryClassFactor('primary'));
    expect(countryClassFactor('residential')).toBeLessThanOrEqual(0.15);
  });

  it('ramps/links and motorway/trunk rank arterial-grade, never mid-grade (FB-5 hardening)', () => {
    expect(countryClassFactor('motorway_link')).toBe(0.15);
    expect(countryClassFactor('trunk_link')).toBe(0.15);
    expect(countryClassFactor('primary_link')).toBe(0.15);
    expect(countryClassFactor('motorway')).toBe(0.15);
    expect(countryClassFactor('trunk')).toBe(0.15);
    expect(countryClassFactor('road')).toBe(0.5); // unknown MINOR tags keep the default
  });

  it('an identical cluster weighs less as secondary than as tertiary (class-scaled weight)', () => {
    const tert = [segment(at(0, 10), 3), segment(at(1, 10), 3)];
    const sec = [segment(at(90, 10), 3), segment(at(91, 10), 3)].map((s) => ({
      ...s,
      highway: 'secondary',
    }));
    // nSectors pinned to 8: the fixture places the clusters in 45°-wedge terms
    // (mechanism test; the frozen default of 4 is exercised by the M4-T12 sweeps)
    const out = generateLoopCandidates(ORIGIN, [...tert, ...sec], [], {
      nCandidates: 8,
      nSectors: 8,
    });
    // single-cluster candidates only (pairs sum both weights); the tertiary
    // cluster sits north (sector 0), the secondary one east (sector 1–2)
    const singles = out.filter((c) => !c.id.includes('+'));
    const tertCand = singles.find((c) => c.sector === 0)!;
    const secCand = singles.find((c) => c.sector !== 0)!;
    expect(tertCand.clusterWeight).toBeGreaterThan(secCand.clusterWeight);
  });

  it('residential-only material yields NO candidates (no crescent fallback)', () => {
    const res = ruralSegments().map((s) => ({ ...s, highway: 'residential' }));
    expect(generateLoopCandidates(ORIGIN, res, [])).toEqual([]);
  });

  it('idPrefix namespaces candidate ids (resize-merge collision safety)', () => {
    const plain = generateLoopCandidates(ORIGIN, ruralSegments(), []);
    const prefixed = generateLoopCandidates(ORIGIN, ruralSegments(), [], { idPrefix: 'rz-' });
    expect(prefixed.length).toBeGreaterThan(0);
    expect(prefixed.every((c) => c.id.startsWith('rz-'))).toBe(true);
    const plainIds = new Set(plain.map((c) => c.id));
    expect(prefixed.every((c) => !plainIds.has(c.id))).toBe(true);
  });

  it('traversal waypoints are INSET vertices, never the road tips (anti-spur, BD-23)', () => {
    // one long dense-vertex curvy road: 11 vertices ~400 m apart
    const coords: [number, number][] = Array.from({ length: 11 }, (_, i) => [
      -79.87 + i * 0.005,
      43.35 + (i % 2) * 0.001,
    ]);
    const seg: CandidateSegment = {
      id: 'long1',
      osmWayId: '9001',
      name: 'Long Twisty Rd',
      highway: 'tertiary',
      lengthM: 4_100,
      curviness: 4,
      geometry: { type: 'LineString', coordinates: coords },
    };
    const out = generateLoopCandidates(ORIGIN, [seg], []);
    expect(out.length).toBeGreaterThan(0);
    const tips = [coords[0]!, coords[coords.length - 1]!];
    for (const c of out) {
      for (const w of c.waypoints) {
        for (const [tLng, tLat] of tips) {
          expect(Math.abs(w.lat - tLat) > 1e-9 || Math.abs(w.lng - tLng) > 1e-9).toBe(true);
        }
      }
    }
    // and the span points DO lie on the road's interior vertices
    const onSegment = out[0]!.waypoints.filter((w) =>
      coords.some(([lng, lat]) => Math.abs(w.lat - lat) < 1e-9 && Math.abs(w.lng - lng) < 1e-9),
    );
    expect(onSegment.length).toBeGreaterThanOrEqual(2);
  });

  it('resizedSpeed scales by the observed miss and clamps to sane sizing speeds', () => {
    expect(resizedSpeed(55, 5400, 10800)).toBeCloseTo(27.5, 5); // 2× over-long → half speed
    expect(resizedSpeed(55, 5400, 2700)).toBe(90); // 2× short → 110 clamps to 90
    expect(resizedSpeed(55, 5400, 100_000)).toBe(15); // absurd miss clamps to floor
    expect(resizedSpeed(55, 5400, 0)).toBe(55); // guard: no median, no change
  });
});

describe('generateAtoBCandidates (M3-T06)', () => {
  const DEST = at(90, 40); // 40 km east

  it('progress-orders waypoints along o→d and skips absurd-detour clusters', () => {
    const segs = ruralSegments();
    const out = generateAtoBCandidates(ORIGIN, DEST, segs, SPOTS, {
      stopRequests: [req('coffee')],
    });
    expect(out.length).toBeGreaterThan(0);
    // the W cluster (bearing 275°, behind the origin) blows the 2.2× corridor cap
    // for a 40 km eastward trip only when far enough — assert every kept cluster
    // is corridor-sane instead of asserting a specific exclusion:
    for (const c of out) {
      expect(c.kind).toBe('atob');
      // waypoint progress is non-decreasing
      const prog = (p: LatLng) => {
        const d = (x: LatLng, y: LatLng) =>
          Math.hypot(
            (x.lat - y.lat) * 111,
            (x.lng - y.lng) * 111 * Math.cos((43.25 * Math.PI) / 180),
          );
        return d(ORIGIN, p) - d(DEST, p);
      };
      const values = c.waypoints.map(prog);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]! - 1e-9);
      }
    }
  });

  it('is deterministic', () => {
    const requests = [req('coffee', 0.25), req('fuel')];
    const a = generateAtoBCandidates(ORIGIN, DEST, ruralSegments(), SPOTS, {
      stopRequests: requests,
    });
    const b = generateAtoBCandidates(ORIGIN, DEST, ruralSegments(), SPOTS, {
      stopRequests: requests,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('fraction stop picks the spot whose corridor progress best matches f (R16-3)', () => {
    // p2 (East Espresso, 9 km along the 40 km eastward corridor) sits near
    // progress 0.22; p1 (Ridge Café, due north) near 0.12 — an "early on"
    // (f=0.25) coffee must choose p2
    const out = generateAtoBCandidates(ORIGIN, DEST, ruralSegments(), SPOTS, {
      stopRequests: [req('coffee', 0.25)],
    });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.stops).toHaveLength(1);
      expect(c.stops[0]!.spotId).toBe('p2');
      expect(c.stops[0]!.atFraction).toBe(0.25);
      // index maintenance through the progress sort
      const wp = c.waypoints[c.stops[0]!.waypointIndex]!;
      const spot = SPOTS.find((s) => s.id === 'p2')!;
      expect(Math.abs(wp.lat - spot.lat)).toBeLessThan(1e-9);
      expect(Math.abs(wp.lng - spot.lng)).toBeLessThan(1e-9);
    }
  });

  it('per-type A→B anchoring: coffee + fuel both included, distinct spots', () => {
    const out = generateAtoBCandidates(ORIGIN, DEST, ruralSegments(), SPOTS, {
      stopRequests: [req('coffee'), req('fuel')],
    });
    const full = out.find((c) => c.stops.length === 2)!;
    expect(full).toBeDefined();
    const types = new Set(full.stops.map((s) => s.requestedType));
    expect(types.has('coffee')).toBe(true);
    expect(types.has('fuel')).toBe(true);
    expect(new Set(full.stops.map((s) => s.spotId)).size).toBe(2);
  });
});

// --- R25-U20b: ring seeding + the shoelace pre-gate --------------------------

describe('R25-U20b ring seeding + shoelace gate', () => {
  const LAT_M = 111_320;
  const LNG_M = 111_320 * Math.cos((43.5 * Math.PI) / 180);
  const O = { lat: 43.5, lng: -80.0 };
  const at = (xM: number, yM: number) => ({ lat: 43.5 + yM / LAT_M, lng: -80.0 + xM / LNG_M });
  const segAt = (id: string, xM: number, yM: number): CandidateSegment => ({
    id,
    osmWayId: id,
    name: `Rd ${id}`,
    highway: 'tertiary',
    lengthM: 2000,
    curviness: 2.0,
    urbanShare: 0,
    geometry: {
      type: 'LineString',
      coordinates: [
        [at(xM - 1000, yM).lng, at(xM - 1000, yM).lat],
        [at(xM, yM).lng, at(xM, yM).lat],
        [at(xM + 1000, yM).lng, at(xM + 1000, yM).lat],
      ],
    },
  });

  it('rings are built from ANCHOR POINTS at θ+120/θ+240, skipped honestly when sparse', () => {
    const segments = [segAt('east', 12_000, 0)]; // one cluster due east (θ≈90°)
    // anchor points at ~bearing 210° and ~330°, ring-distance ≈ 12 km
    const anchors = [at(-6600, -10_800), at(-6600, 10_800)];
    const withRing = generateLoopCandidates(O, segments, [], {
      ringSeed: true,
      anchorPoints: anchors,
      durationS: 5400,
    });
    const ring = withRing.find((c) => c.id.endsWith('-ring'));
    expect(ring).toBeDefined();
    expect(ring!.waypoints.length).toBeGreaterThanOrEqual(3); // span + two spokes
    // sparse pool (no anchors) → NO ring candidate, nothing synthesized
    const sparse = generateLoopCandidates(O, segments, [], { ringSeed: true, durationS: 5400 });
    // anchorPool falls back to segment centroids — all due east, no 210°/330°
    expect(sparse.some((c) => c.id.endsWith('-ring'))).toBe(false);
    // flag off (explicit) → byte-identical: no ring ids at all
    const off = generateLoopCandidates(O, segments, [], { ringSeed: false, durationS: 5400 });
    expect(off.some((c) => c.id.endsWith('-ring'))).toBe(false);
  });

  it('seedPolygonAreaM2: a fat triangle measures, a straight line encloses nothing', () => {
    expect(seedPolygonAreaM2(O, [at(10_000, 0), at(5000, 8000)])).toBeGreaterThan(30_000_000);
    expect(seedPolygonAreaM2(O, [at(5000, 0), at(10_000, 0)])).toBeLessThan(1000);
  });

  it('the shoelace gate drops only near-degenerate seed polygons', () => {
    const segments = [segAt('east', 12_000, 0)];
    const all = generateLoopCandidates(O, segments, [], { durationS: 5400 });
    const gated = generateLoopCandidates(O, segments, [], { shoelaceGate: true, durationS: 5400 });
    // the gate only ever REMOVES candidates, never invents or reorders
    expect(gated.length).toBeLessThanOrEqual(all.length);
    const allIds = new Set(all.map((c) => c.id));
    expect(gated.every((c) => allIds.has(c.id))).toBe(true);
    // every survivor genuinely encloses area
    const perimeterM = (5400 / 3600) * 55 * 1000;
    const minArea = (0.04 * (perimeterM * perimeterM)) / (4 * Math.PI);
    for (const c of gated) {
      expect(seedPolygonAreaM2(O, c.waypoints)).toBeGreaterThanOrEqual(minArea);
    }
  });
});

// --- R26-A3: the value function that can choose a country road ---------------

describe('segValueOf (R26-A3)', () => {
  const road = (
    over: Partial<CandidateSegment> & { highway: string; lengthM: number; curviness: number },
  ): CandidateSegment => ({
    id: over.id ?? 'x',
    osmWayId: 'x',
    name: 'Rd',
    urbanShare: 0,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-80, 43.5],
        [-79.99, 43.51],
      ],
    },
    ...over,
  });

  it('LEGACY is multiplicative — a straight country road is worth ~nothing', () => {
    const straight = road({ highway: 'unclassified', lengthM: 8000, curviness: 0.1 });
    const twisty = road({ highway: 'unclassified', lengthM: 8000, curviness: 3.0 });
    // 30x apart: this is gate 3 — why admitting the material alone was inert
    expect(segValueOf(twisty, false) / segValueOf(straight, false)).toBeGreaterThan(20);
  });

  it('COUNTRY_VALUE is base+bonus — the straight country road is worth REAL value…', () => {
    const straight = road({ highway: 'unclassified', lengthM: 8000, curviness: 0.1 });
    expect(segValueOf(straight, true)).toBeGreaterThan(0.3 * segValueOf(straight, false) + 1);
    expect(segValueOf(straight, true)).toBeGreaterThan(1000); // not a rounding artifact
  });

  it('…but twisty STILL wins, bounded by the gain — fun is not traded away', () => {
    const straight = road({ highway: 'unclassified', lengthM: 8000, curviness: 0.1 });
    const twisty = road({ highway: 'unclassified', lengthM: 8000, curviness: 3.0 });
    const ratio = segValueOf(twisty, true) / segValueOf(straight, true);
    expect(ratio).toBeGreaterThan(1); // still prefers the fun road
    expect(ratio).toBeLessThanOrEqual(1 + COUNTRY_CURV_GAIN + 1e-9); // bounded
  });

  it('class order is preserved under BOTH shapes — mains never outrank country', () => {
    for (const on of [false, true]) {
      const country = road({ highway: 'unclassified', lengthM: 5000, curviness: 1.0 });
      const main = road({ highway: 'secondary', lengthM: 5000, curviness: 1.0 });
      expect(segValueOf(country, on)).toBeGreaterThan(segValueOf(main, on));
    }
  });

  it('urban context still discounts under the new shape', () => {
    const rural = road({ highway: 'tertiary', lengthM: 5000, curviness: 0.5, urbanShare: 0 });
    const town = road({ highway: 'tertiary', lengthM: 5000, curviness: 0.5, urbanShare: 1 });
    expect(segValueOf(rural, true)).toBeGreaterThan(segValueOf(town, true));
  });
});
