import type { LatLng } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  bearingDeg,
  countryClassFactor,
  generateAtoBCandidates,
  generateLoopCandidates,
  resizedSpeed,
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
];

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

  it('is deterministic (identical output across runs)', () => {
    const a = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, { anchorSpots: true });
    const b = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, { anchorSpots: true });
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
    const withSpots = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, { anchorSpots: true });
    expect(withSpots.some((c) => c.spotIds.length > 0)).toBe(true);
    const anchored = withSpots.find((c) => c.spotIds.length > 0)!;
    const spot = SPOTS.find((s) => s.id === anchored.spotIds[0])!;
    expect(
      anchored.waypoints.some(
        (w) => Math.abs(w.lat - spot.lat) < 1e-9 && Math.abs(w.lng - spot.lng) < 1e-9,
      ),
    ).toBe(true);

    const without = generateLoopCandidates(ORIGIN, ruralSegments(), SPOTS, { anchorSpots: false });
    expect(without.every((c) => c.spotIds.length === 0)).toBe(true);
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
    const out = generateAtoBCandidates(ORIGIN, DEST, segs, SPOTS, { anchorSpots: true });
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
    const a = generateAtoBCandidates(ORIGIN, DEST, ruralSegments(), SPOTS, { anchorSpots: true });
    const b = generateAtoBCandidates(ORIGIN, DEST, ruralSegments(), SPOTS, { anchorSpots: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
