/**
 * BD-203 prototype — LOOPS BY CONSTRUCTION ("corridor-excluded sweep").
 *
 * Question: can a loop be BUILT so the structural judge has nothing to reject,
 * instead of generated blind and judged afterwards? Mechanism under test:
 *   1. measured material (index ribbons) within reach of the origin;
 *   2. one matrix prices origin ↔ every ribbon end;
 *   3. tours = ordered subsets of ribbons in ANGULAR order around the origin,
 *      predicted door-to-door against the ask;
 *   4. each leg is ROUTED SEQUENTIALLY with `exclude_polygons` = thin corridors
 *      around every previous leg (holes: the origin stem, and the start of the
 *      current leg), and a `heading` hint so the next leg continues forward —
 *      so re-driving or crossing an earlier leg is impossible by construction;
 *   5. the glued trip meets the SAME judge (trip_gates) as everything served.
 *
 * Also settles two engine facts first: does `exclude_polygons` work on the
 * running 3.7.0 with the raised `max_exclude_polygons_length`, and what does a
 * 300-ring corridor cost in wall time.
 *
 * Run: TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx eval/experiments/sweep_proto.ts [lat lng minutes]
 */
import { Client } from 'pg';

import {
  selfIntersections,
  summarizeCrossings,
  segIntersect,
} from '../../backend/src/planner/crossings';
import { readDriveCores, type CoreRowRead } from '../../backend/src/planner/discover_cores';
import { computeOriginStem } from '../../backend/src/planner/origin_stem';
import { edgeOverlapRatio, loopiness } from '../../backend/src/planner/overlap';
import {
  judgeTrip,
  tripShapeMetrics,
  type TripMetrics,
} from '../../backend/src/planner/trip_gates';
import { travelMatrix } from '../../backend/src/valhalla/matrix';
import { decodePolyline } from '../../backend/src/valhalla/polyline';
import type { LatLng, LineString } from '../../shared/src/types';

const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type XY = [number, number]; // [lng, lat]
const LAT_M = 111_320;

function hav(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const ll = (c: XY): LatLng => ({ lat: c[1], lng: c[0] });
const bearingDeg = (a: XY, b: XY): number => {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
};

// ---------------------------------------------------------------- corridors
/** Douglas–Peucker on lon/lat with a metric tolerance. */
function simplify(coords: XY[], tolM: number): XY[] {
  if (coords.length < 3) return coords.slice();
  const lat0 = coords[0]![1];
  const kx = LAT_M * Math.cos((lat0 * Math.PI) / 180);
  const pts = coords.map((c) => [c[0] * kx, c[1] * LAT_M] as [number, number]);
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    const a = pts[s]!;
    const b = pts[e]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    let worst = -1;
    let worstD = tolM;
    for (let i = s + 1; i < e; i++) {
      const p = pts[i]!;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([s, worst], [worst, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Thin rectangles (half-width `wM`) around each simplified segment of a
 *  leg, skipping `skipStartM` metres at the start and `skipEndM` at the end. */
function corridorRings(coords: XY[], wM: number, skipStartM: number, skipEndM: number): XY[][] {
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++)
    cum.push(cum[i - 1]! + hav(ll(coords[i - 1]!), ll(coords[i]!)));
  const total = cum[cum.length - 1]!;
  const kept = coords.filter((_, i) => cum[i]! >= skipStartM && cum[i]! <= total - skipEndM);
  if (kept.length < 2) return [];
  const simp = simplify(kept, 20);
  const rings: XY[][] = [];
  for (let i = 1; i < simp.length; i++) {
    const a = simp[i - 1]!;
    const b = simp[i]!;
    const kx = LAT_M * Math.cos((a[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * LAT_M;
    const len = Math.hypot(dx, dy) || 1;
    // unit normal (metres) → degrees
    const nx = (-dy / len) * wM;
    const ny = (dx / len) * wM;
    // extend the rectangle by wM along the segment so consecutive boxes overlap at bends
    const ex = (dx / len) * wM;
    const ey = (dy / len) * wM;
    const P = (x: number, y: number): XY => [x / kx, y / LAT_M];
    const ax = a[0] * kx;
    const ay = a[1] * LAT_M;
    const bx = b[0] * kx;
    const by = b[1] * LAT_M;
    rings.push([
      P(ax - ex + nx, ay - ey + ny),
      P(bx + ex + nx, by + ey + ny),
      P(bx + ex - nx, by + ey - ny),
      P(ax - ex - nx, ay - ey - ny),
      P(ax - ex + nx, ay - ey + ny),
    ]);
  }
  return rings;
}

// ---------------------------------------------------------------- engine
interface Leg {
  coords: XY[];
  distanceM: number;
  durationS: number;
  uturns: number;
  ms: number;
}

async function routeLeg(
  points: XY[],
  opts: { exclude: XY[][]; heading: number | null; costing: Record<string, unknown> },
): Promise<Leg> {
  const last = points.length - 1;
  const payload = {
    locations: points.map((p, i) => ({
      lat: p[1],
      lon: p[0],
      type: i === 0 || i === last ? 'break' : 'through',
      ...(i === 0 || i === last ? {} : { search_filter: { min_road_class: 'unclassified' } }),
      ...(i === 0 && opts.heading !== null
        ? { heading: Math.round(opts.heading), heading_tolerance: 70 }
        : {}),
    })),
    costing: 'auto',
    costing_options: { auto: opts.costing },
    ...(opts.exclude.length > 0 ? { exclude_polygons: opts.exclude } : {}),
  };
  const t = performance.now();
  const res = await fetch(`${VALHALLA}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as {
    trip?: {
      summary?: { length?: number; time?: number };
      legs?: Array<{ shape?: string; maneuvers?: Array<{ type?: number }> }>;
    };
    error?: string;
    error_code?: number;
  };
  if (!res.ok || !body.trip)
    throw new Error(`route ${res.status} ${body.error_code ?? ''} ${body.error ?? ''}`);
  const coords: XY[] = [];
  let uturns = 0;
  for (const leg of body.trip.legs ?? []) {
    const pts = decodePolyline(leg.shape ?? '') as XY[];
    for (const p of pts) {
      const prev = coords[coords.length - 1];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) coords.push(p);
    }
    for (const m of leg.maneuvers ?? []) if (m.type === 12 || m.type === 13) uturns++;
  }
  return {
    coords,
    distanceM: (body.trip.summary?.length ?? 0) * 1000,
    durationS: body.trip.summary?.time ?? 0,
    uturns,
    ms: Math.round(performance.now() - t),
  };
}

// ---------------------------------------------------------------- fact check
async function factCheckExclusions(origin: LatLng): Promise<void> {
  const a: XY = [origin.lng, origin.lat];
  const b: XY = [-80.02, 43.47]; // ~14 km west-south-west (Campbellville side)
  const costing = { use_highways: 0.2, use_living_streets: 0 };
  const first = await routeLeg([a, b], { exclude: [], heading: null, costing });
  const rings = corridorRings(first.coords, 50, 800, 800);
  const perim = rings.reduce((s, r) => s + hav(ll(r[0]!), ll(r[1]!)) * 2 + 200, 0);
  console.log(
    `fact-check: first route ${(first.distanceM / 1000).toFixed(1)} km / ${Math.round(first.durationS / 60)} min in ${first.ms} ms; corridor rings ${rings.length}, ~${Math.round(perim / 1000)} km perimeter`,
  );
  try {
    const second = await routeLeg([a, b], { exclude: rings, heading: null, costing });
    const overlap = edgeOverlapRatio(
      { type: 'LineString', coordinates: second.coords },
      { type: 'LineString', coordinates: first.coords },
    );
    const x = selfIntersections(
      { type: 'LineString', coordinates: [...first.coords, ...second.coords.slice().reverse()] },
      origin,
    );
    console.log(
      `fact-check: excluded route ${(second.distanceM / 1000).toFixed(1)} km / ${Math.round(second.durationS / 60)} min in ${second.ms} ms; overlap with first ${overlap.toFixed(3)}; crossings of the pair ${x.length}`,
    );
  } catch (e) {
    console.log(`fact-check: excluded route FAILED: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------- sweep
interface Rib {
  row: CoreRowRead;
  /** Pieces cut from the same stored ring share a family — never two in one tour. */
  family: string;
  coords: XY[]; // full geometry, entry → exit
  a: XY; // entry
  b: XY; // exit
  valueS: number; // seconds of measured drive (what the tour is made of)
  bearing: number; // from origin to the ribbon midpoint
}

interface Tour {
  ribs: Array<{ rib: Rib; reversed: boolean }>;
  predS: number;
  drivePredS: number;
  commutePred: number;
  span: number; // angular spread (degrees)
  crossings: number;
}

function ribbonSamples(coords: XY[], minSepM: number, maxPts: number): XY[] {
  const spacing = Math.max(minSepM, lengthOf(coords) / maxPts);
  const out: XY[] = [coords[0]!];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += hav(ll(coords[i - 1]!), ll(coords[i]!));
    if (acc >= spacing) {
      out.push(coords[i]!);
      acc = 0;
    }
  }
  if (out[out.length - 1] !== coords[coords.length - 1]) out.push(coords[coords.length - 1]!);
  return out;
}
function lengthOf(coords: XY[]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += hav(ll(coords[i - 1]!), ll(coords[i]!));
  return s;
}

async function sweep(origin: LatLng, targetS: number): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const reachM = Math.max(12_000, targetS * 0.3 * (55_000 / 3600));
  const half = reachM / LAT_M;
  const bbox: [number, number, number, number] = [
    origin.lng - half,
    origin.lat - half,
    origin.lng + half,
    origin.lat + half,
  ];
  const rows = await readDriveCores(db, bbox, 'r35-rib', 50, 'ribbon');
  const loops = await readDriveCores(db, bbox, 'r35-rib', 50, 'loop');
  await db.end();
  const costing = { use_highways: 0.2, use_living_streets: 0 };
  const stemM = await computeOriginStem(VALHALLA, origin, {});
  console.log(
    `\n=== sweep from ${origin.lat},${origin.lng} for ${Math.round(targetS / 60)} min — ${rows.length} ribbons + ${loops.length} loops in reach, stem ${stemM} m`,
  );

  const pieces: Rib[] = rows.map((row) => {
    const coords = (row.geometry ?? row.geom_simplified).coordinates as XY[];
    const mid = coords[Math.floor(coords.length / 2)]!;
    return {
      row,
      family: row.id,
      coords,
      a: coords[0]!,
      b: coords[coords.length - 1]!,
      valueS: row.duration_s,
      bearing: bearingDeg([origin.lng, origin.lat], mid),
    };
  });
  // loop cores → two HALF-RING ribbons each, cut at the origin-nearest vertex
  // and its antipode by ring distance (a ring is also chaining material)
  for (const row of loops) {
    const raw = (row.geometry ?? row.geom_simplified).coordinates as XY[];
    if (raw.length < 8) continue;
    const gap = hav(ll(raw[0]!), ll(raw[raw.length - 1]!));
    if (gap > 2000) continue;
    const ring = gap < 1 ? raw.slice(0, -1) : raw.slice();
    const cum = [0];
    for (let i = 1; i < ring.length; i++)
      cum.push(cum[i - 1]! + hav(ll(ring[i - 1]!), ll(ring[i]!)));
    const total = cum[cum.length - 1]! + hav(ll(ring[ring.length - 1]!), ll(ring[0]!));
    let j1 = 0;
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const d = hav(origin, ll(ring[i]!));
      if (d < best) {
        best = d;
        j1 = i;
      }
    }
    // antipode: the vertex half the ring away from j1
    let j2 = j1;
    for (let i = 0; i < ring.length; i++) {
      const along = (cum[i]! - cum[j1]! + total) % total;
      if (along >= total / 2) {
        j2 = i;
        break;
      }
    }
    if (j2 === j1) continue;
    const cut = (from: number, to: number): XY[] => {
      const out: XY[] = [ring[from]!];
      let i = from;
      while (i !== to) {
        i = (i + 1) % ring.length;
        out.push(ring[i]!);
      }
      return out;
    };
    for (const [label, coords] of [
      ['h1', cut(j1, j2)],
      ['h2', cut(j2, j1)],
    ] as Array<[string, XY[]]>) {
      const len = lengthOf(coords);
      if (coords.length < 4 || len < 3000) continue;
      const mid = coords[Math.floor(coords.length / 2)]!;
      pieces.push({
        row: { ...row, name: `${row.name} (${label})`, distance_m: len },
        family: row.id,
        coords,
        a: coords[0]!,
        b: coords[coords.length - 1]!,
        valueS: Math.round(row.duration_s * (len / total)),
        bearing: bearingDeg([origin.lng, origin.lat], mid),
      });
    }
  }
  const ribs: Rib[] = pieces
    .filter((r) => r.coords.length >= 4 && hav(ll(r.a), ll(r.b)) > 800)
    .sort((x, y) => y.row.curviness * y.row.distance_m - x.row.curviness * x.row.distance_m)
    .filter((r, i, all) => {
      // dedup by geometry: the index stores the same road under several cells
      for (let j = 0; j < i; j++) {
        const o = all[j]!;
        if (o.family === r.family) continue;
        const g1: LineString = { type: 'LineString', coordinates: r.coords };
        const g2: LineString = { type: 'LineString', coordinates: o.coords };
        if (edgeOverlapRatio(g1, g2) > 0.2 || edgeOverlapRatio(g2, g1) > 0.2) return false;
      }
      return true;
    })
    .slice(0, 20);
  console.log(
    `distinct pieces ${ribs.length}: ${ribs.map((r) => `${r.row.name.slice(0, 20)}(${Math.round(r.valueS / 60)}m)`).join(', ')}`,
  );
  if (ribs.length === 0) {
    console.log('no ribbons');
    return;
  }
  // matrix: origin + ribbon ends
  const locs: XY[] = [[origin.lng, origin.lat]];
  for (const r of ribs) locs.push(r.a, r.b);
  const t0 = performance.now();
  const cells = await travelMatrix(VALHALLA, { locations: locs, costingOptions: costing });
  console.log(`matrix ${locs.length}×${locs.length} in ${Math.round(performance.now() - t0)} ms`);
  const tm = (i: number, j: number): number | null => cells[i]?.[j]?.timeS ?? null;
  const idx = (ri: number, end: 'a' | 'b'): number => 1 + ri * 2 + (end === 'a' ? 0 : 1);

  // enumerate tours: subsets of size 1..4 in angular order (both rotations)
  const order = ribs.map((_, i) => i).sort((x, y) => ribs[x]!.bearing - ribs[y]!.bearing);
  const tours: Tour[] = [];
  const n = order.length;
  const consider = (subset: number[]): void => {
    // directions exhaustive (2^k)
    const k = subset.length;
    for (let mask = 0; mask < 1 << k; mask++) {
      let prev = 0; // origin index in matrix
      let ok = true;
      let total = 0;
      let drive = 0;
      let commute = 0;
      const pts: XY[] = [[origin.lng, origin.lat]];
      const chosen: Tour['ribs'] = [];
      for (let s = 0; s < k; s++) {
        const ri = subset[s]!;
        const rev = (mask >> s) & 1 ? true : false;
        const startEnd = rev ? 'b' : 'a';
        const endEnd = rev ? 'a' : 'b';
        const hop = tm(prev, idx(ri, startEnd));
        if (hop === null) {
          ok = false;
          break;
        }
        total += hop;
        if (s === 0) commute += hop;
        else drive += hop;
        total += ribs[ri]!.valueS;
        drive += ribs[ri]!.valueS;
        pts.push(rev ? ribs[ri]!.b : ribs[ri]!.a, rev ? ribs[ri]!.a : ribs[ri]!.b);
        prev = idx(ri, endEnd);
        chosen.push({ rib: ribs[ri]!, reversed: rev });
      }
      if (!ok) continue;
      const home = tm(prev, 0);
      if (home === null) continue;
      total += home;
      commute += home;
      pts.push([origin.lng, origin.lat]);
      // forward-continuation screen: at each ribbon exit the next target must
      // lie roughly AHEAD (else the driver reverses = block-circle or u-turn);
      // at each entry the approach must not oppose the ribbon's own direction.
      let reversal = false;
      for (let s = 0; s < k; s++) {
        const { rib, reversed } = chosen[s]!;
        const rc = reversed ? rib.coords.slice().reverse() : rib.coords;
        const entryDir = bearingDeg(rc[0]!, rc[Math.min(3, rc.length - 1)]!);
        const exitDir = bearingDeg(rc[Math.max(0, rc.length - 4)]!, rc[rc.length - 1]!);
        const prevPt =
          s === 0
            ? ([origin.lng, origin.lat] as XY)
            : chosen[s - 1]!.reversed
              ? chosen[s - 1]!.rib.a
              : chosen[s - 1]!.rib.b;
        const nextPt =
          s === k - 1
            ? ([origin.lng, origin.lat] as XY)
            : chosen[s + 1]!.reversed
              ? chosen[s + 1]!.rib.b
              : chosen[s + 1]!.rib.a;
        const approach = bearingDeg(prevPt, rc[0]!);
        const depart = bearingDeg(rc[rc.length - 1]!, nextPt);
        const diff = (x: number, y: number): number =>
          Math.abs(((((x - y) % 360) + 540) % 360) - 180);
        if (diff(approach, entryDir) > 150 || diff(exitDir, depart) > 150) {
          reversal = true;
          break;
        }
      }
      if (reversal) continue;
      // chord pre-screen: the polygon origin→ends→origin must be simple
      let crossings = 0;
      for (let i = 1; i < pts.length; i++) {
        for (let j = i + 2; j < pts.length; j++) {
          if (i === 1 && j === pts.length - 1) continue; // share the origin
          if (segIntersect(pts[i - 1]!, pts[i]!, pts[j - 1]!, pts[j]!) !== null) crossings++;
        }
      }
      const bearings = subset.map((ri) => ribs[ri]!.bearing);
      let span = 0;
      if (bearings.length > 1) {
        const bs = bearings.slice().sort((x, y) => x - y);
        let maxGap = 0;
        for (let i = 0; i < bs.length; i++) {
          const gap = i === bs.length - 1 ? bs[0]! + 360 - bs[i]! : bs[i + 1]! - bs[i]!;
          maxGap = Math.max(maxGap, gap);
        }
        span = 360 - maxGap;
      }
      tours.push({
        ribs: chosen,
        predS: total,
        drivePredS: drive,
        commutePred: commute / Math.max(1, total),
        span,
        crossings,
      });
    }
  };
  // every subset of ≤4 pieces (no two of one family), visited in angular
  // order around the origin, both rotations
  const subsets: number[][] = [];
  const rec = (startIdx: number, cur: number[]): void => {
    if (cur.length > 0) subsets.push(cur.slice());
    if (cur.length === 4) return;
    for (let i = startIdx; i < n; i++) {
      const ri = order[i]!;
      if (cur.some((c) => ribs[c]!.family === ribs[ri]!.family)) continue;
      cur.push(ri);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  for (const subset of subsets) {
    consider(subset);
    if (subset.length >= 2) consider(subset.slice().reverse());
  }
  const err = (t: Tour): number => Math.abs(t.predS - targetS) / targetS;
  const feasible = tours.filter((t) => t.crossings === 0 && t.commutePred <= 0.5 && err(t) <= 0.25);
  feasible.sort(
    (x, y) =>
      (err(x) <= 0.15 ? 0 : 1) - (err(y) <= 0.15 ? 0 : 1) ||
      y.drivePredS - x.drivePredS ||
      err(x) - err(y),
  );
  console.log(`tours enumerated ${tours.length}, feasible ${feasible.length}`);

  // dedup by ribbon set, build top 4
  const seen = new Set<string>();
  let built = 0;
  for (const tour of feasible) {
    const key = tour.ribs
      .map((r) => r.rib.row.id)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    if (built >= 4) break;
    built++;
    const label = tour.ribs
      .map((r) => `${r.rib.row.name.slice(0, 18)}${r.reversed ? '↓' : '↑'}`)
      .join(' → ');
    const tb = performance.now();
    const legs: Leg[] = [];
    let cur: XY = [origin.lng, origin.lat];
    let heading: number | null = null;
    let failed = '';
    const fidelities: number[] = [];
    const holesUsed: string[] = [];
    /** Exclusion = corridors of every previous leg; hole around the current
     *  start (end of the previous leg) and around the origin (the stem). */
    const exclusionFor = (startHoleM: number, stemHoleM: number): XY[][] => {
      const out: XY[][] = [];
      for (let i = 0; i < legs.length; i++) {
        const isLast = i === legs.length - 1;
        out.push(
          ...corridorRings(legs[i]!.coords, 50, i === 0 ? stemHoleM : 0, isLast ? startHoleM : 0),
        );
      }
      return out;
    };
    /** Route with adaptive holes: a "no path" at a hole size means the
     *  network forces a shared stretch there — widen and retry. */
    const routeAdaptive = async (points: XY[]): Promise<Leg> => {
      let lastErr: Error | null = null;
      for (const [startHole, stemHole] of [
        [800, stemM + 400],
        [1600, stemM + 400],
        [1600, stemM + 1200],
        [3000, stemM + 2500],
      ] as Array<[number, number]>) {
        try {
          const leg = await routeLeg(points, {
            exclude: exclusionFor(startHole, stemHole),
            heading,
            costing,
          });
          holesUsed.push(`${startHole}/${stemHole}`);
          return leg;
        } catch (e) {
          lastErr = e as Error;
        }
      }
      throw lastErr ?? new Error('unroutable');
    };
    /** Same as exclusionFor plus the ribbon's own corridor beyond its first
     *  300 m — a connector must ARRIVE at the ribbon, never ride it. */
    const exclusionForConnector = (
      startHoleM: number,
      stemHoleM: number,
      ribbon: XY[],
      ribbonHoleM: number,
    ): XY[][] => [
      ...exclusionFor(startHoleM, stemHoleM),
      ...(ribbonHoleM > 0 ? corridorRings(ribbon, 50, ribbonHoleM, 0) : []),
    ];
    for (let s = 0; s < tour.ribs.length; s++) {
      const { rib, reversed } = tour.ribs[s]!;
      const rc = reversed ? rib.coords.slice().reverse() : rib.coords;
      // (i) the CONNECTOR: cur → ribbon entry, forbidden from riding the ribbon
      try {
        let conn: Leg | null = null;
        let lastErr: Error | null = null;
        for (const [startHole, stemHole, ribHole] of [
          [800, stemM + 400, 1000],
          [800, stemM + 400, 1500],
          [1600, stemM + 400, 1500],
          [1600, stemM + 1200, 1500],
          [1600, stemM + 1200, 0],
          [3000, stemM + 2500, 0],
        ] as Array<[number, number, number]>) {
          try {
            conn = await routeLeg([cur, rc[0]!], {
              exclude: exclusionForConnector(startHole, stemHole, rc, ribHole),
              heading,
              costing,
            });
            holesUsed.push(`c${startHole}/${stemHole}/r${ribHole}`);
            break;
          } catch (e) {
            lastErr = e as Error;
          }
        }
        if (conn === null) {
          // diagnose which exclusion blocks the connector
          const variants: Array<[string, XY[][]]> = [
            ['no ribbon corridor', exclusionFor(1600, stemM + 1200)],
            [
              'ribbon hole 1000',
              [...exclusionFor(1600, stemM + 1200), ...corridorRings(rc, 50, 1000, 0)],
            ],
            ['ribbon hole 300 only (no prev legs)', corridorRings(rc, 50, 300, 0)],
            ['no exclusions', []],
          ];
          for (const [vl, ex] of variants) {
            try {
              const r = await routeLeg([cur, rc[0]!], { exclude: ex, heading, costing });
              console.log(
                `    diag connector ${s + 1}: works with "${vl}" (${(r.distanceM / 1000).toFixed(1)} km)`,
              );
              break;
            } catch {
              console.log(`    diag connector ${s + 1}: still fails with "${vl}"`);
            }
          }
          throw lastErr ?? new Error('unroutable');
        }
        legs.push(conn);
        cur = conn.coords[conn.coords.length - 1]!;
      } catch (e) {
        failed = `connector ${s + 1}: ${(e as Error).message}`;
        break;
      }
      // (ii) the RIBBON DRIVE: entry → dense samples → exit, heading along the ribbon
      const samples = ribbonSamples(rc, 300, 17).slice(1); // entry is `cur`
      heading = bearingDeg(rc[0]!, rc[Math.min(3, rc.length - 1)]!);
      try {
        const leg = await routeAdaptive([cur, ...samples]);
        legs.push(leg);
        const fid = edgeOverlapRatio(
          { type: 'LineString', coordinates: rc },
          { type: 'LineString', coordinates: leg.coords },
        );
        fidelities.push(fid);
        const c = leg.coords;
        cur = c[c.length - 1]!;
        heading = bearingDeg(c[Math.max(0, c.length - 3)]!, c[c.length - 1]!);
      } catch (e) {
        failed = `ribbon ${s + 1}: ${(e as Error).message}`;
        break;
      }
    }
    if (!failed) {
      try {
        const home = await routeAdaptive([cur, [origin.lng, origin.lat]]);
        legs.push(home);
      } catch (e) {
        failed = `home: ${(e as Error).message}`;
      }
    }
    if (failed) {
      console.log(
        `  [${label}] pred ${Math.round(tour.predS / 60)} min — BUILD FAILED ${failed} (${Math.round(performance.now() - tb)} ms)`,
      );
      continue;
    }
    const coords: XY[] = [];
    for (const leg of legs) {
      for (const p of leg.coords) {
        const prev = coords[coords.length - 1];
        if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) coords.push(p);
      }
    }
    const geometry: LineString = { type: 'LineString', coordinates: coords };
    const durationS = legs.reduce((s, l) => s + l.durationS, 0);
    const distanceM = legs.reduce((s, l) => s + l.distanceM, 0);
    const shape = tripShapeMetrics(geometry, origin, { oabGraceM: stemM });
    const x = summarizeCrossings(selfIntersections(geometry, origin));
    const thereS = legs[0]!.durationS; // the first connector IS the way there
    const homeS = legs[legs.length - 1]!.durationS;
    const metrics: TripMetrics = {
      durationS,
      targetS,
      loopiness: loopiness(geometry),
      ...shape,
      ...x,
      uturns: legs.reduce((s, l) => s + l.uturns, 0),
      commuteShare: (Math.max(0, thereS) + homeS) / Math.max(1, durationS),
      outHomeOverlap: edgeOverlapRatio(
        { type: 'LineString', coordinates: legs[legs.length - 1]!.coords },
        { type: 'LineString', coordinates: legs[0]!.coords },
      ),
      outCoreOverlap: 0,
      homeCoreOverlap: 0,
    };
    const verdict = judgeTrip(metrics, { durationTol: Number.POSITIVE_INFINITY });
    const fails = [...verdict.failures];
    if (fidelities.some((f) => f < 0.85)) fails.push('arc_deviation');
    const e = Math.abs(durationS - targetS) / targetS;
    console.log(
      `  [${label}] pred ${Math.round(tour.predS / 60)} → built ${Math.round(durationS / 60)} min / ${(distanceM / 1000).toFixed(1)} km (err ${(e * 100).toFixed(0)}%), ` +
        `${legs.length} legs in ${Math.round(performance.now() - tb)} ms (per leg ${legs.map((l) => l.ms).join('/')}, holes ${holesUsed.join(' ')}); ` +
        `loopiness ${metrics.loopiness?.toFixed(2)}, oab ${Math.round(metrics.oabLongestM)} m, spurs ${metrics.spurs}, micro ${metrics.microloops}, ` +
        `x ${x.knots}/${x.pierces}, uturns ${metrics.uturns}, commute ${(metrics.commuteShare * 100).toFixed(0)}%, out/home ${metrics.outHomeOverlap.toFixed(2)}, ` +
        `fidelity ${fidelities.map((f) => f.toFixed(2)).join('/')} → ${fails.length === 0 ? 'CLEAN' : fails.join('+')}`,
    );
  }
}

async function main(): Promise<void> {
  const lat = Number(process.argv[2] ?? 43.5312);
  const lng = Number(process.argv[3] ?? -79.8827);
  const mins = Number(process.argv[4] ?? 90);
  const origin = { lat, lng };
  if (process.env['SKIP_FACT'] !== '1') await factCheckExclusions(origin);
  await sweep(origin, mins * 60);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
