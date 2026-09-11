/**
 * BD-203 — THE SWEEP: a loop BUILT from measured pieces, by construction.
 *
 * What was wrong from the start (planner audit, 2026-09-07): every loop the
 * product has ever served — live legacy blobs AND the offline index — came
 * from ONE /route request through a few 'through' waypoints, with a generic
 * router filling 90-97 % of the metres and free to come home the way it went
 * out. Doubling, lollipops, crossings and seam stubs were then DETECTED and
 * repaired after the fact, and ~35 refused levers sat downstream of that
 * generator. The ring path (drive_first_trip.ts) only escapes it when a stored
 * ring happens to fit the ask from the door — at the owner's own home every
 * 90-minute ask ended as "temporarily unavailable".
 *
 * The sweep is the other way round:
 *   1. MATERIAL — index ribbons (100 % backroad, curvy, 4-11 min each) and
 *      the two halves of every stored ring within reach, deduped by geometry;
 *   2. PRICE — one matrix prices origin ↔ every piece end;
 *   3. PLAN — tours = ordered subsets (≤ SWEEP_TOUR_PIECES_MAX) in angular
 *      order around the origin, both rotations, every direction per piece,
 *      predicted door-to-door against the ask; chords that cross, pieces that
 *      cross, and turn-backs at a piece end are screened out before routing;
 *   4. BUILD — legs routed one after another (corridor.ts): a connector may
 *      not ride or cross anything driven before it and may not ride the piece
 *      it is heading for; the piece is driven end to end through dense
 *      samples with a departure heading; the way home may not reuse the way
 *      out beyond the measured stem;
 *   5. JUDGE — the glued trip meets the SAME `judgeTrip` gates as the ring
 *      path (drive-closed loopiness, doubling, stubs, crescents, crossings,
 *      u-turns, commute share, out/home overlap) plus per-piece fidelity.
 *
 * Measured with the prototype (eval/experiments/sweep_proto.ts) at the owner's
 * two areas: judge-clean 99-min (home, 90 asked), 103/98/99-min (Southfields,
 * 90 asked), 73-min (Southfields, 60 asked) and 125-min (Southfields, 120
 * asked) loops in 100-600 ms of engine time per tour. The judge stays the
 * firewall: construction removes the reasons for rejection, nothing here
 * relaxes a bar.
 */
import type { LatLng, LineString, RouteThroughOutput } from '@shared/types';
import type { Client } from 'pg';

import { travelMatrix, type MatrixCell, type MatrixRequest } from '../valhalla/matrix';
import type { AutoCostingOptions } from '../valhalla/route';

import {
  arrivalBearing,
  bearingDeg,
  bearingDiffDeg,
  corridorRings,
  defaultCorridorRouteFn,
  departureBearing,
  glueLegs,
  haversineM,
  isEngineTimeout,
  lineLengthM,
  routeCorridorLeg,
  sampleAlongWithBearing,
  simplifyLine,
  type BuiltLeg,
  type CorridorRouteFn,
  type Ring,
  type XY,
} from './corridor';
import { segIntersect, selfIntersections, summarizeCrossings } from './crossings';
import { DRIVE_CORES_VERSION, readDriveCores, type CoreRowRead } from './discover_cores';
import { ARC_FIDELITY_MIN, type DriveFirstOutcome, type DriveFirstTrip } from './drive_first_trip';
import { edgeOverlapRatio, loopiness as loopinessOf } from './overlap';
import { uturnCount } from './score';
import {
  driveClosedLoopiness,
  judgeTrip,
  TRIP_COMMUTE_SHARE_MAX,
  TRIP_DURATION_TOL,
  TRIP_EXACT_BAND,
  tripShapeMetrics,
  type TripMetrics,
} from './trip_gates';

export const SWEEP_ON = (process.env['LOOP_SWEEP'] ?? 'on') !== 'off';
/** Pieces after dedup (matrix: origin + 2 ends each ≤ 49 locations). */
export const SWEEP_PIECES_MAX = Number(process.env['SWEEP_PIECES_MAX'] ?? 24);
/** Ring pieces (halves + quarters) must not crowd out the short ribbons
 *  (measured at Southfields: 20 slots filled by six rings' halves left no
 *  ribbon tours). Ribbons and ring pieces get their own quota. */
export const SWEEP_RING_PIECES_MAX = Number(process.env['SWEEP_RING_PIECES_MAX'] ?? 14);
export const SWEEP_RIBBONS_MAX = Number(process.env['SWEEP_RIBBONS_MAX'] ?? 14);
/** Pieces per tour. */
export const SWEEP_TOUR_PIECES_MAX = Number(process.env['SWEEP_TOUR_PIECES_MAX'] ?? 4);
/** Tours routed per request (deterministic order; the deadline cuts earlier). */
export const SWEEP_BUILD_MAX = Number(process.env['SWEEP_BUILD_MAX'] ?? 6);
/** Stop building once this many clean EXACT-band trips exist. */
export const SWEEP_CLEAN_EXACT_ENOUGH = 2;
/** Predicted tour duration must sit within this of the ask to be routed. */
export const SWEEP_PRED_TOL = TRIP_DURATION_TOL;
/** A routed leg this much slower than its prediction is a forced detour —
 *  the tour is abandoned early instead of finishing a 219-minute "90". */
export const SWEEP_LEG_DETOUR_FACTOR = 2.2;
export const SWEEP_LEG_DETOUR_SLACK_S = 180;
/** Running total: abandon once what is driven plus what is still predicted
 *  cannot land inside the alternate band any more. */
export const SWEEP_RUNNING_OVER_FACTOR = 1 + SWEEP_PRED_TOL;
/** A turn-back sharper than this at a piece end means a u-turn or a block
 *  circle to continue — screened out before routing (chord heuristic). */
export const SWEEP_TURNBACK_MAX_DEG = 150;
/** Two pieces are the same road when either shares this much of its edges. */
export const SWEEP_PIECE_DUP_OVERLAP = 0.2;
/** A ring half must be at least this long to count as a piece. */
export const SWEEP_RING_HALF_MIN_M = 3_000;
/** Piece ends must be this far apart (a near-closed piece is not chainable). */
export const SWEEP_PIECE_ENDS_MIN_M = 800;
/** Samples along a piece: spacing clamped to [300, 1000] m (16 per piece
 *  target); a chunk carries ≤ 17 samples + the departure point (engine cap 20). */
export const SWEEP_SAMPLE_MIN_M = 300;
export const SWEEP_SAMPLE_MAX_M = 1_000;
export const SWEEP_SAMPLES_PER_PIECE = 16;
export const SWEEP_CHUNK_SAMPLES = 17;
/** The connector to a piece may not ride the piece beyond this many metres
 *  from its entry (widened, then dropped, when the network forces it). */
export const SWEEP_RIBBON_HOLE_LADDER: ReadonlyArray<number> = [1000, 1500, 0];

export interface SweepPiece {
  id: string;
  /** Halves cut from one stored ring share a family — never two in a tour. */
  family: string;
  name: string;
  kind: 'ribbon' | 'ring_half';
  coords: XY[];
  lengthM: number;
  /** Measured seconds for the piece (stored pace × its length). */
  durationS: number;
  curviness: number;
  backroadShare: number;
  hoodShare: number;
  turnsPer10min: number;
  /** Origin → piece midpoint. */
  bearingDeg: number;
  /** May the piece be driven exit → entry? A ribbon is raw two-way road
   *  geometry; a ring piece is a ROUTED line that passes through roundabouts
   *  and turn channels (one-way), so driven backwards its samples force the
   *  engine into u-turns (measured: 7-11 per reversed ring piece, 0 forward). */
  reversible: boolean;
  /** The stored row it came from (ring halves: the ring). */
  row: CoreRowRead;
}

function ll(c: XY): LatLng {
  return { lat: c[1], lng: c[0] };
}

/** A stored ring built from a pseudo-origin can carry that origin's own
 *  STEM — the first and last metres retrace each other (the index allows
 *  doubling ≤ 0.1). Cutting through it would seed a piece with a built-in
 *  u-turn, so the doubled prefix/suffix is trimmed (pairs within 40 m). */
export function trimDoubledStem(ring: XY[]): XY[] {
  const n = ring.length;
  let k = 0;
  while (k < Math.floor(n / 2) - 2 && haversineM(ring[k]!, ring[n - 1 - k]!) < 40) k++;
  return k === 0 ? ring : ring.slice(k, n - k);
}

/** Cut a stored ring into its two halves at the origin-nearest vertex and the
 *  vertex half the ring away from it (by ring distance). Null = not a ring. */
export function ringHalves(
  row: CoreRowRead,
  origin: LatLng,
): Array<{ label: string; coords: XY[] }> {
  const raw = (row.geometry ?? row.geom_simplified).coordinates as XY[];
  if (raw.length < 8) return [];
  const gapM = haversineM(raw[0]!, raw[raw.length - 1]!);
  if (gapM > 2_000) return [];
  const ring = trimDoubledStem(gapM < 1 ? raw.slice(0, -1) : raw.slice());
  if (ring.length < 8) return [];
  const cum: number[] = [0];
  for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1]! + haversineM(ring[i - 1]!, ring[i]!));
  const total = cum[cum.length - 1]! + haversineM(ring[ring.length - 1]!, ring[0]!);
  if (total < 2 * SWEEP_RING_HALF_MIN_M) return [];
  const o: XY = [origin.lng, origin.lat];
  let j1 = 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = haversineM(o, ring[i]!);
    if (d < best) {
      best = d;
      j1 = i;
    }
  }
  let j2 = j1;
  let bestGap = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const along = (cum[i]! - cum[j1]! + total) % total;
    const gap = Math.abs(along - total / 2);
    if (gap < bestGap) {
      bestGap = gap;
      j2 = i;
    }
  }
  if (j2 === j1) return [];
  const cut = (from: number, to: number): XY[] => {
    const out: XY[] = [ring[from]!];
    let i = from;
    while (i !== to) {
      i = (i + 1) % ring.length;
      out.push(ring[i]!);
    }
    return out;
  };
  // quarters: the vertices a quarter-ring before/after the antipode, so a
  // ring also offers 10-25-minute pieces (a 60-minute ask from a door two
  // rings away needs a piece, not a half)
  const atAlong = (fromIdx: number, wantM: number): number => {
    let bi = fromIdx;
    let bg = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const along = (cum[i]! - cum[fromIdx]! + total) % total;
      const gap = Math.abs(along - wantM);
      if (gap < bg) {
        bg = gap;
        bi = i;
      }
    }
    return bi;
  };
  const q1 = atAlong(j1, total / 4);
  const q3 = atAlong(j1, (3 * total) / 4);
  return [
    { label: 'h1', coords: cut(j1, j2) },
    { label: 'h2', coords: cut(j2, j1) },
    { label: 'q1', coords: cut(j1, q1) },
    { label: 'q2', coords: cut(q1, j2) },
    { label: 'q3', coords: cut(j2, q3) },
    { label: 'q4', coords: cut(q3, j1) },
  ];
}

/**
 * Material within reach → distinct pieces, best first. Ribbons are pieces as
 * stored (entry → exit); rings contribute their two halves. Dedup by
 * geometry (the index stores one road under several sweep cells); halves of
 * one ring are exempt from dedup against each other (they are disjoint).
 */
export function piecesFromRows(
  ribbons: ReadonlyArray<CoreRowRead>,
  loops: ReadonlyArray<CoreRowRead>,
  origin: LatLng,
  max: number = SWEEP_PIECES_MAX,
): SweepPiece[] {
  const o: XY = [origin.lng, origin.lat];
  const all: SweepPiece[] = [];
  for (const row of ribbons) {
    const coords = ((row.geometry ?? row.geom_simplified).coordinates as XY[]).map(
      (p) => [p[0], p[1]] as XY,
    );
    if (coords.length < 4) continue;
    const lengthM = lineLengthM(coords);
    all.push({
      id: row.id,
      family: row.id,
      name: row.name,
      kind: 'ribbon',
      coords,
      lengthM,
      durationS: row.duration_s,
      curviness: row.curviness,
      backroadShare: row.backroad_share,
      hoodShare: row.hood_share,
      turnsPer10min: row.turns_per_10min,
      bearingDeg: bearingDeg(o, coords[Math.floor(coords.length / 2)]!),
      reversible: true,
      row,
    });
  }
  for (const row of loops) {
    const ringLen = Math.max(1, row.distance_m);
    for (const half of ringHalves(row, origin)) {
      const lengthM = lineLengthM(half.coords);
      if (half.coords.length < 4 || lengthM < SWEEP_RING_HALF_MIN_M) continue;
      all.push({
        id: `${row.id}#${half.label}`,
        family: row.id,
        name: row.name,
        kind: 'ring_half',
        coords: half.coords.map((p) => [p[0], p[1]] as XY),
        lengthM,
        durationS: Math.round(row.duration_s * (lengthM / ringLen)),
        curviness: row.curviness,
        backroadShare: row.backroad_share,
        hoodShare: row.hood_share,
        turnsPer10min: row.turns_per_10min,
        bearingDeg: bearingDeg(o, half.coords[Math.floor(half.coords.length / 2)]!),
        reversible: false,
        row,
      });
    }
  }
  const value = (p: SweepPiece): number => p.curviness * p.lengthM;
  const sorted = all
    .filter(
      (p) => haversineM(p.coords[0]!, p.coords[p.coords.length - 1]!) >= SWEEP_PIECE_ENDS_MIN_M,
    )
    .sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id));
  const kept: SweepPiece[] = [];
  for (const p of sorted) {
    const quota = p.kind === 'ring_half' ? SWEEP_RING_PIECES_MAX : SWEEP_RIBBONS_MAX;
    if (kept.filter((k) => k.kind === p.kind).length >= quota) continue;
    // copies of one road under several cells are deduped WITHIN a kind; a
    // ribbon that is part of a ring stays (different scale) and the tour
    // planner keeps overlapping pieces out of one tour (piecesConflict).
    const dup = kept.some((k) => k.kind === p.kind && k.family !== p.family && piecesOverlap(p, k));
    if (!dup) kept.push(p);
    if (kept.length >= max) break;
  }
  return kept;
}

const geomOf = (p: SweepPiece): LineString => ({ type: 'LineString', coordinates: p.coords });

/** Either piece shares more than SWEEP_PIECE_DUP_OVERLAP of its edges. */
export function piecesOverlap(a: SweepPiece, b: SweepPiece): boolean {
  return (
    edgeOverlapRatio(geomOf(a), geomOf(b)) > SWEEP_PIECE_DUP_OVERLAP ||
    edgeOverlapRatio(geomOf(b), geomOf(a)) > SWEEP_PIECE_DUP_OVERLAP
  );
}

export interface TourStep {
  piece: SweepPiece;
  reversed: boolean;
}

export interface TourPlan {
  steps: TourStep[];
  /** Predicted door-to-door seconds (matrix hops + measured piece seconds). */
  predS: number;
  /** Predicted first + last hop over the total (by time). */
  commutePred: number;
  /** Predicted seconds on pieces (the material the tour is made of). */
  pieceS: number;
  /** Length-weighted measured curviness of the pieces (twisty asks rank on it). */
  pieceCurv: number;
  /** Predicted seconds for the hop BEFORE each step and the hop home. */
  hopS: number[];
  /** Isoperimetric shape of the chord polygon origin → piece ends → origin
   *  (0..1): rounder tours are planned first — they are the ones the judge
   *  passes, and a thin one costs the same engine calls to fail. */
  shapePred: number;
}

/** 4πA / P² of a closed polygon in local metres (0 = a line, 1 = a circle). */
export function chordShape(points: ReadonlyArray<XY>): number {
  if (points.length < 3) return 0;
  const lat0 = points[0]![1];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 111_320;
  let area = 0;
  let perim = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const ax = a[0] * kx;
    const ay = a[1] * ky;
    const bx = b[0] * kx;
    const by = b[1] * ky;
    area += ax * by - bx * ay;
    perim += Math.hypot(bx - ax, by - ay);
  }
  if (perim <= 0) return 0;
  return Math.min(1, (4 * Math.PI * Math.abs(area / 2)) / (perim * perim));
}

/** matrix index of a piece end: 0 = origin, then entry/exit per piece */
export function matrixIndex(pieceIdx: number, end: 'entry' | 'exit'): number {
  return 1 + pieceIdx * 2 + (end === 'entry' ? 0 : 1);
}

export function matrixLocations(origin: LatLng, pieces: ReadonlyArray<SweepPiece>): XY[] {
  const locs: XY[] = [[origin.lng, origin.lat]];
  for (const p of pieces) locs.push(p.coords[0]!, p.coords[p.coords.length - 1]!);
  return locs;
}

/** Strict-interior crossing between a segment and a (simplified) polyline. */
function segCrossesLine(a: XY, b: XY, line: ReadonlyArray<XY>): boolean {
  for (let i = 1; i < line.length; i++) {
    if (segIntersect(a, b, line[i - 1]!, line[i]!) !== null) return true;
  }
  return false;
}

function linesCross(p: ReadonlyArray<XY>, q: ReadonlyArray<XY>): boolean {
  for (let i = 1; i < p.length; i++) {
    if (segCrossesLine(p[i - 1]!, p[i]!, q)) return true;
  }
  return false;
}

/**
 * Enumerate tours: every subset of ≤ SWEEP_TOUR_PIECES_MAX pieces (one per
 * family), visited in angular order around the origin, both rotations, every
 * direction per piece. Screens (all pure geometry, no engine):
 *   - unroutable hops (null matrix cells);
 *   - turn-backs at a piece end (the driver would reverse);
 *   - crossing chords or crossing pieces (the tour would cross itself);
 *   - commute share by time > TRIP_COMMUTE_SHARE_MAX;
 *   - predicted duration outside ± SWEEP_PRED_TOL of the ask.
 * Returned best-first: exact band, then most piece time, then |error|,
 * then ids — deterministic. One plan per piece SET (the best variant).
 */
export function enumerateTours(
  pieces: ReadonlyArray<SweepPiece>,
  origin: LatLng,
  hop: (i: number, j: number) => number | null,
  targetS: number,
  opts: { piecesMax?: number; twisty?: boolean; stats?: Record<string, number> } = {},
): TourPlan[] {
  const o: XY = [origin.lng, origin.lat];
  const n = pieces.length;
  const piecesMax = opts.piecesMax ?? SWEEP_TOUR_PIECES_MAX;
  const order = pieces
    .map((_, i) => i)
    .sort((x, y) => pieces[x]!.bearingDeg - pieces[y]!.bearingDeg);
  const simp = pieces.map((p) => simplifyLine(p.coords, 100));
  // piece-vs-piece conflicts (crossing, or the same road at another scale),
  // computed once
  const pieceCross: boolean[][] = pieces.map(() => new Array<boolean>(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const x = linesCross(simp[i]!, simp[j]!) || piecesOverlap(pieces[i]!, pieces[j]!);
      pieceCross[i]![j] = x;
      pieceCross[j]![i] = x;
    }
  }
  const chordCache = new Map<string, boolean>();
  const chordCrossesPiece = (a: XY, b: XY, pi: number): boolean => {
    const key = `${a[0]},${a[1]}|${b[0]},${b[1]}|${pi}`;
    let v = chordCache.get(key);
    if (v === undefined) {
      v = segCrossesLine(a, b, simp[pi]!);
      chordCache.set(key, v);
    }
    return v;
  };
  const entryOf = (pi: number, rev: boolean): XY =>
    rev ? pieces[pi]!.coords[pieces[pi]!.coords.length - 1]! : pieces[pi]!.coords[0]!;
  const exitOf = (pi: number, rev: boolean): XY =>
    rev ? pieces[pi]!.coords[0]! : pieces[pi]!.coords[pieces[pi]!.coords.length - 1]!;
  const dirCoords = (pi: number, rev: boolean): XY[] =>
    rev ? pieces[pi]!.coords.slice().reverse() : pieces[pi]!.coords;

  const tally = (why: string): void => {
    if (opts.stats) opts.stats[why] = (opts.stats[why] ?? 0) + 1;
  };
  const bestBySet = new Map<string, TourPlan>();
  const better = (a: TourPlan, b: TourPlan): boolean => {
    const ea = Math.abs(a.predS - targetS) / targetS;
    const eb = Math.abs(b.predS - targetS) / targetS;
    const xa = ea <= TRIP_EXACT_BAND ? 0 : 1;
    const xb = eb <= TRIP_EXACT_BAND ? 0 : 1;
    if (xa !== xb) return xa < xb;
    // a TWISTY ask ranks the material's measured curvature first (0.5-wide
    // bands — BD-183's rule for rings, applied to the sweep's pieces; the
    // three refused twisty levers were tiebreaks behind a distance rule)
    if (opts.twisty === true) {
      const ca = Math.floor(a.pieceCurv / 0.5);
      const cb = Math.floor(b.pieceCurv / 0.5);
      if (ca !== cb) return ca > cb;
    }
    // rounder predicted shape first (0.1-wide bands), then more piece time
    const sa = Math.floor(a.shapePred * 10);
    const sb = Math.floor(b.shapePred * 10);
    if (sa !== sb) return sa > sb;
    if (a.pieceS !== b.pieceS) return a.pieceS > b.pieceS;
    return ea < eb;
  };

  const consider = (subset: number[]): void => {
    const k = subset.length;
    // piece-piece crossings are independent of direction/order
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        if (pieceCross[subset[i]!]![subset[j]!]) {
          tally('pieces_conflict');
          return;
        }
      }
    }
    for (let mask = 0; mask < 1 << k; mask++) {
      let prevIdx = 0;
      let prevPt: XY = o;
      let total = 0;
      let pieceS = 0;
      let lenSum = 0;
      let curvSum = 0;
      const hopS: number[] = [];
      const steps: TourStep[] = [];
      let ok = true;
      for (let s = 0; s < k && ok; s++) {
        const pi = subset[s]!;
        const rev = ((mask >> s) & 1) === 1;
        if (rev && !pieces[pi]!.reversible) {
          tally('not_reversible');
          ok = false;
          break;
        }
        const entry = entryOf(pi, rev);
        const h = hop(prevIdx, matrixIndex(pi, rev ? 'exit' : 'entry'));
        if (h === null) {
          tally('hop_unroutable');
          ok = false;
          break;
        }
        // turn-back screens: approach vs the piece's departure; the piece's
        // arrival vs the departure toward the next target
        const dc = dirCoords(pi, rev);
        if (
          bearingDiffDeg(bearingDeg(prevPt, entry), departureBearing(dc)) > SWEEP_TURNBACK_MAX_DEG
        ) {
          ok = false;
          break;
        }
        const exit = exitOf(pi, rev);
        const nextPt: XY = s === k - 1 ? o : entryOf(subset[s + 1]!, ((mask >> (s + 1)) & 1) === 1);
        if (bearingDiffDeg(arrivalBearing(dc), bearingDeg(exit, nextPt)) > SWEEP_TURNBACK_MAX_DEG) {
          tally('turnback_exit');
          ok = false;
          break;
        }
        // the chord into this piece must not cross any piece of the tour
        for (let t = 0; t < k; t++) {
          if (chordCrossesPiece(prevPt, entry, subset[t]!)) {
            tally('chord_crosses_piece');
            ok = false;
            break;
          }
        }
        if (!ok) break;
        hopS.push(h);
        total += h + pieces[pi]!.durationS;
        pieceS += pieces[pi]!.durationS;
        lenSum += pieces[pi]!.lengthM;
        curvSum += pieces[pi]!.curviness * pieces[pi]!.lengthM;
        steps.push({ piece: pieces[pi]!, reversed: rev });
        prevIdx = matrixIndex(pi, rev ? 'entry' : 'exit');
        prevPt = exit;
      }
      if (!ok) continue;
      const home = hop(prevIdx, 0);
      if (home === null) {
        tally('home_unroutable');
        continue;
      }
      for (let t = 0; t < k; t++) {
        if (chordCrossesPiece(prevPt, o, subset[t]!)) {
          tally('home_chord_crosses_piece');
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      hopS.push(home);
      total += home;
      // chord-vs-chord (connectors between each other)
      const chords: Array<[XY, XY]> = [];
      let from: XY = o;
      for (const st of steps) {
        const e = st.reversed ? st.piece.coords[st.piece.coords.length - 1]! : st.piece.coords[0]!;
        chords.push([from, e]);
        from = st.reversed ? st.piece.coords[0]! : st.piece.coords[st.piece.coords.length - 1]!;
      }
      chords.push([from, o]);
      for (let i = 0; i < chords.length && ok; i++) {
        for (let j = i + 1; j < chords.length; j++) {
          if (i === 0 && j === chords.length - 1) continue; // share the origin
          if (segIntersect(chords[i]![0], chords[i]![1], chords[j]![0], chords[j]![1]) !== null) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      const commutePred = (hopS[0]! + home) / Math.max(1, total);
      if (commutePred > TRIP_COMMUTE_SHARE_MAX) {
        tally('commute_share');
        continue;
      }
      if (Math.abs(total - targetS) / targetS > SWEEP_PRED_TOL) {
        tally('duration_band');
        continue;
      }
      const polygon: XY[] = [o];
      for (const c of chords) polygon.push(c[1]);
      polygon.pop(); // the last chord ends at the origin, already the first point
      const plan: TourPlan = {
        steps,
        predS: total,
        commutePred,
        pieceS,
        pieceCurv: lenSum > 0 ? curvSum / lenSum : 0,
        hopS,
        shapePred: chordShape(polygon),
      };
      const key = steps
        .map((st) => st.piece.id)
        .sort()
        .join('|');
      const cur = bestBySet.get(key);
      if (cur === undefined || better(plan, cur)) bestBySet.set(key, plan);
    }
  };

  const rec = (startIdx: number, cur: number[]): void => {
    if (cur.length > 0) {
      consider(cur);
      if (cur.length >= 2) consider(cur.slice().reverse());
    }
    if (cur.length === piecesMax) return;
    for (let i = startIdx; i < n; i++) {
      const pi = order[i]!;
      if (cur.some((c) => pieces[c]!.family === pieces[pi]!.family)) continue;
      cur.push(pi);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);

  return [...bestBySet.values()].sort((a, b) => {
    if (better(a, b)) return -1;
    if (better(b, a)) return 1;
    return a.steps
      .map((s) => s.piece.id)
      .join('|')
      .localeCompare(b.steps.map((s) => s.piece.id).join('|'));
  });
}

export interface SweepBuildCtx {
  baseUrl: string;
  routeFn: CorridorRouteFn;
  origin: LatLng;
  targetS: number;
  /** The measured unavoidable stem (m) — the one repeat a loop may carry. */
  stemM: number;
  /** Spokes and connectors: direct costing plus the user's own avoids. */
  costingOptions: AutoCostingOptions;
  outOfTime: () => boolean;
  /** Epoch ms — no hole rung and no new leg starts past it. */
  deadlineMs?: number;
}

export interface SweepBuilt {
  trip: DriveFirstTrip | null;
  failures: string[];
  /** Engine calls spent on this tour. */
  calls: number;
  /** Per-leg truth for the trace (which leg carried a u-turn, how long each
   *  was) — present whenever at least one leg was routed. */
  legsDebug?: Array<{
    kind: 'connector' | 'piece' | 'home';
    durationS: number;
    distanceM: number;
    uturns: number;
  }>;
}

/** Samples along a piece, chunked so each engine call stays under the cap. */
export function pieceChunks(
  coords: ReadonlyArray<XY>,
): Array<Array<{ pt: XY; bearingDeg: number }>> {
  const len = lineLengthM(coords);
  const spacing = Math.min(
    SWEEP_SAMPLE_MAX_M,
    Math.max(SWEEP_SAMPLE_MIN_M, len / SWEEP_SAMPLES_PER_PIECE),
  );
  // each sample carries the line's local bearing: on a divided road the
  // through-point then snaps to the carriageway running THIS way (measured
  // without it: 7-11 u-turns on a reversed ring piece)
  const samples = sampleAlongWithBearing(coords, spacing).slice(1); // the entry is the leg's start
  const chunks: Array<Array<{ pt: XY; bearingDeg: number }>> = [];
  for (let i = 0; i < samples.length; i += SWEEP_CHUNK_SAMPLES) {
    chunks.push(samples.slice(i, i + SWEEP_CHUNK_SAMPLES));
  }
  return chunks.filter((c) => c.length > 0);
}

/** The synthetic "core" a sweep trip serves under (name, measured stats of
 *  the pieces, geometry of the drive) — so the serving code treats it like a
 *  ring trip. Stats are length-weighted over the PIECES (the measured
 *  material); the served route's own trace is the truth for the whole line. */
export function sweepCoreOf(plan: TourPlan, drive: LineString): CoreRowRead {
  const pcs = plan.steps.map((s) => s.piece);
  const total = pcs.reduce((s, p) => s + p.lengthM, 0) || 1;
  const w = (f: (p: SweepPiece) => number): number =>
    pcs.reduce((s, p) => s + f(p) * p.lengthM, 0) / total;
  const names: string[] = [];
  for (const p of pcs) if (!names.includes(p.name)) names.push(p.name);
  const c = drive.coordinates as XY[];
  return {
    id: `sweep:${pcs.map((p) => p.id).join('+')}`,
    kind: 'ribbon',
    name: names.length <= 2 ? names.join(' and ') : `${names[0]}, ${names[1]} and more`,
    bar_profile: 'strict',
    geom_simplified: drive,
    geometry: drive,
    entry: ll(c[0]!),
    exit: ll(c[c.length - 1]!),
    distance_m: pcs.reduce((s, p) => s + p.lengthM, 0),
    duration_s: plan.pieceS,
    curviness: w((p) => p.curviness),
    backroad_share: w((p) => p.backroadShare),
    main_share: 0,
    highway_share: 0,
    hood_share: w((p) => p.hoodShare),
    turns_per_10min: w((p) => p.turnsPer10min),
    loopiness: null,
  };
}

/**
 * Route one planned tour leg by leg and judge it as driven. Never throws:
 * a failed leg or a refused trip comes back as `failures`.
 */
export async function buildSweepTour(plan: TourPlan, ctx: SweepBuildCtx): Promise<SweepBuilt> {
  const o: XY = [ctx.origin.lng, ctx.origin.lat];
  const legs: BuiltLeg[] = [];
  const legKinds: Array<'connector' | 'piece' | 'home'> = [];
  const debugOf = (): NonNullable<SweepBuilt['legsDebug']> =>
    legs.map((l, i) => ({
      kind: legKinds[i] ?? 'piece',
      durationS: l.route.duration_s,
      distanceM: l.route.distance_m,
      uturns: uturnCount(l.route),
    }));
  const fail = (failures: string[]): SweepBuilt => ({
    trip: null,
    failures,
    calls,
    ...(legs.length > 0 ? { legsDebug: debugOf() } : {}),
  });
  /** index into `legs` where each piece's drive starts/ends */
  const pieceLegSpans: Array<{ from: number; to: number }> = [];
  let cur: XY = o;
  let heading: number | null = null;
  let calls = 0;
  /** `previous` = the legs whose corridors this leg may not reuse or cross:
   *  everything driven so far. The connector into a piece keeps its own tail
   *  open (`openTailM`) so the piece drive it delivers is never fenced by it
   *  (measured live: fencing the piece made a third of the drives unroutable;
   *  NOT excluding the connector let the drive cross it — spurs + crossings). */
  const route = async (
    waypoints: XY[],
    extraRings: Ring[] | undefined,
    middleType: 'through' | 'break',
    previous: ReadonlyArray<BuiltLeg>,
    waypointHeadings?: ReadonlyArray<number | null>,
  ): Promise<BuiltLeg> => {
    const leg = await routeCorridorLeg(ctx.routeFn, ctx.baseUrl, {
      waypoints,
      costingOptions: ctx.costingOptions,
      middleType,
      heading,
      previous,
      stemM: ctx.stemM,
      ...(extraRings ? { extraRings } : {}),
      ...(waypointHeadings ? { waypointHeadings } : {}),
      ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
    });
    calls++;
    return leg;
  };
  const tooSlow = (leg: BuiltLeg, predictedS: number): boolean =>
    leg.route.duration_s > predictedS * SWEEP_LEG_DETOUR_FACTOR + SWEEP_LEG_DETOUR_SLACK_S;

  try {
    for (let s = 0; s < plan.steps.length; s++) {
      if (ctx.outOfTime()) return fail(['time_budget']);
      const { piece, reversed } = plan.steps[s]!;
      const pc = reversed ? piece.coords.slice().reverse() : piece.coords;
      // (i) the connector — may not ride the piece it is heading for
      let conn: BuiltLeg | null = null;
      let lastErr: unknown = null;
      for (const ribbonHoleM of SWEEP_RIBBON_HOLE_LADDER) {
        try {
          conn = await route(
            [cur, pc[0]!],
            ribbonHoleM > 0 ? corridorRings(pc, { skipStartM: ribbonHoleM }) : undefined,
            'break',
            legs,
          );
          // the connector may have ridden the piece's first metres (its hole):
          // keep that much of its own tail open so the piece drive is not fenced
          conn.openTailM = (ribbonHoleM > 0 ? ribbonHoleM : 2_500) + 800;
          break;
        } catch (e) {
          lastErr = e;
          calls++;
          if (isEngineTimeout(e)) break; // fenced off — a wider hole will not help cheaply
        }
      }
      if (conn === null) {
        void lastErr;
        return fail([`connector_${s + 1}_unroutable`]);
      }
      if (tooSlow(conn, plan.hopS[s]!)) {
        return fail([`connector_${s + 1}_detour`]);
      }
      legs.push(conn);
      legKinds.push('connector');
      cur = conn.coords[conn.coords.length - 1]!;
      // (ii) the piece, driven end to end
      heading = departureBearing(pc);
      const from = legs.length;
      for (const chunk of pieceChunks(pc)) {
        if (ctx.outOfTime()) return fail(['time_budget']);
        let leg: BuiltLeg;
        try {
          // no per-sample headings: measured live, a heading on every through
          // sample made a third of the piece drives unroutable and removed no
          // u-turn (the u-turns were one-way bits driven backwards — see
          // `reversible`); the departure heading on the first point stays
          leg = await route([cur, ...chunk.map((c) => c.pt)], undefined, 'through', legs);
        } catch {
          return fail([`piece_${s + 1}_unroutable`]);
        }
        legs.push(leg);
        legKinds.push('piece');
        cur = leg.coords[leg.coords.length - 1]!;
        heading = arrivalBearing(leg.coords);
      }
      pieceLegSpans.push({ from, to: legs.length - 1 });
      const drivenS = legs.slice(from).reduce((acc, l) => acc + l.route.duration_s, 0);
      if (drivenS > piece.durationS * SWEEP_LEG_DETOUR_FACTOR + SWEEP_LEG_DETOUR_SLACK_S) {
        return fail([`piece_${s + 1}_detour`]);
      }
      // running total: what is driven plus what is still predicted must be
      // able to land inside the alternate band, else stop spending calls
      const soFarS = legs.reduce((acc, l) => acc + l.route.duration_s, 0);
      const remainingS =
        plan.hopS.slice(s + 1).reduce((acc, h) => acc + h, 0) +
        plan.steps.slice(s + 1).reduce((acc, st) => acc + st.piece.durationS, 0);
      if (
        soFarS + remainingS >
        ctx.targetS * SWEEP_RUNNING_OVER_FACTOR + SWEEP_LEG_DETOUR_SLACK_S
      ) {
        return fail(['running_over']);
      }
    }
    if (ctx.outOfTime()) return fail(['time_budget']);
    // (iii) home — may not reuse the way out beyond the stem
    let home: BuiltLeg;
    try {
      home = await route([cur, o], undefined, 'break', legs);
    } catch {
      return fail(['home_unroutable']);
    }
    if (tooSlow(home, plan.hopS[plan.hopS.length - 1]!)) {
      return fail(['home_detour']);
    }
    legs.push(home);
    legKinds.push('home');
  } catch {
    return fail(['build_error']);
  }

  // ---- judge as driven
  const glued: RouteThroughOutput = glueLegs(legs.map((l) => l.route));
  const coords = glued.geometry.coordinates as XY[];
  const outLeg = legs[0]!;
  const homeLeg = legs[legs.length - 1]!;
  const thereM = lineLengthM(outLeg.coords);
  const homeM = lineLengthM(homeLeg.coords);
  const totalM = lineLengthM(coords);
  const driveM = Math.max(0, totalM - thereM - homeM);
  const thereS = outLeg.route.duration_s;
  const homeS = homeLeg.route.duration_s;
  const driveS = Math.max(0, glued.duration_s - thereS - homeS);
  // drive geometry: everything between the first connector and the way home
  const driveCoords: XY[] = [];
  for (let i = 1; i < legs.length - 1; i++) {
    for (const p of legs[i]!.coords) {
      const prev = driveCoords[driveCoords.length - 1];
      if (prev === undefined || prev[0] !== p[0] || prev[1] !== p[1]) driveCoords.push(p);
    }
  }
  const driveGeo: LineString = { type: 'LineString', coordinates: driveCoords };
  const outGeo: LineString = { type: 'LineString', coordinates: outLeg.coords };
  const homeGeo: LineString = { type: 'LineString', coordinates: homeLeg.coords };
  const metrics: TripMetrics = {
    durationS: glued.duration_s,
    targetS: ctx.targetS,
    // a swept loop has no ring: the whole trip IS the constructed loop, so
    // the better of "the drive closed by its chord" (the ring path's ruler)
    // and the whole shape is what the map shows; the structural gates —
    // doubling, stubs, crescents, crossings — keep a lollipop out regardless
    loopiness: Math.max(
      driveCoords.length >= 4 ? (driveClosedLoopiness(driveGeo) ?? 0) : 0,
      loopinessOf(glued.geometry) ?? 0,
    ),
    ...tripShapeMetrics(glued.geometry, ctx.origin, { oabGraceM: ctx.stemM }),
    ...summarizeCrossings(selfIntersections(glued.geometry, ctx.origin)),
    uturns: uturnCount(glued),
    commuteShare: (thereS + homeS) / Math.max(1, glued.duration_s),
    outHomeOverlap: edgeOverlapRatio(homeGeo, outGeo),
    outCoreOverlap: 0,
    homeCoreOverlap: 0,
  };
  const verdict = judgeTrip(metrics, { durationTol: Number.POSITIVE_INFINITY });
  const failures = [...verdict.failures];
  // per-piece fidelity: the routed drive must follow the measured piece
  const fidelities: number[] = plan.steps.map((st, i) => {
    const span = pieceLegSpans[i]!;
    const drivenCoords: XY[] = [];
    for (let li = span.from; li <= span.to; li++) drivenCoords.push(...legs[li]!.coords);
    const pc = st.reversed ? st.piece.coords.slice().reverse() : st.piece.coords;
    return edgeOverlapRatio(
      { type: 'LineString', coordinates: pc },
      { type: 'LineString', coordinates: drivenCoords },
    );
  });
  const fidelity = fidelities.length > 0 ? Math.min(...fidelities) : 0;
  if (fidelity < ARC_FIDELITY_MIN) failures.push('arc_deviation');
  if (failures.length > 0) return fail(failures);

  const err = Math.abs(glued.duration_s - ctx.targetS) / ctx.targetS;
  const core = sweepCoreOf(plan, driveGeo);
  const midC = driveCoords[Math.floor(driveCoords.length / 2)] ?? o;
  const trip: DriveFirstTrip = {
    core,
    route: glued,
    drive: {
      entry: ll(driveCoords[0] ?? o),
      mid: ll(midC),
      exit: ll(driveCoords[driveCoords.length - 1] ?? o),
      frac: 1,
    },
    legs: {
      thereM: Math.round(thereM),
      driveM: Math.round(driveM),
      homeM: Math.round(homeM),
      thereS: Math.round(thereS),
      driveS: Math.round(driveS),
      homeS: Math.round(homeS),
    },
    geometry: glued.geometry,
    distanceM: glued.distance_m,
    durationS: glued.duration_s,
    metrics,
    tier: err <= TRIP_EXACT_BAND ? 'exact' : 'alternate',
    fidelity,
    source: 'sweep',
    pieceNames: plan.steps.map((s) => s.piece.name),
    holes: legs.map((l) => l.holes),
  };
  return { trip, failures: [], calls, legsDebug: debugOf() };
}

export type SweepMatrixFn = (baseUrl: string, req: MatrixRequest) => Promise<MatrixCell[][]>;
export type SweepCoresFn = (
  db: Client,
  bbox: [number, number, number, number],
  version: string,
  limit: number,
  kind: 'loop' | 'ribbon',
) => Promise<CoreRowRead[]>;

export interface SweepOpts {
  /** Reach half-width (m) for the material read — the ring path's reach. */
  reachM: number;
  stemM: number;
  costingOptions: AutoCostingOptions;
  deadlineMs?: number;
  /** The ask's character tags ('twisty' ranks curvature first). */
  character?: readonly string[];
  routeFn?: CorridorRouteFn;
  matrixFn?: SweepMatrixFn;
  coresFn?: SweepCoresFn;
  now?: () => number;
}

/**
 * The sweep for one ask. Same outcome shape as the ring path so the serving
 * code treats a swept trip like a ring trip (exact / held alternate / none),
 * with every tried tour and its failures in `rejected` for the trace.
 */
export async function sweepTrip(
  db: Client,
  valhallaUrl: string,
  origin: LatLng,
  targetS: number,
  opts: SweepOpts,
): Promise<
  DriveFirstOutcome & {
    pieces: number;
    plans: number;
    calls: number;
    screened?: Record<string, number>;
  }
> {
  const now = opts.now ?? (() => Date.now());
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;
  const outOfTime = (): boolean => now() > deadline;
  const none = { trip: null, alternates: [], rejected: [], pieces: 0, plans: 0, calls: 0 };
  if (targetS <= 0) return none;
  const cores = opts.coresFn ?? readDriveCores;
  const matrixFn = opts.matrixFn ?? travelMatrix;
  const routeFn = opts.routeFn ?? defaultCorridorRouteFn;
  const half = opts.reachM / 111_320;
  const bbox: [number, number, number, number] = [
    origin.lng - half,
    origin.lat - half,
    origin.lng + half,
    origin.lat + half,
  ];
  let ribbons: CoreRowRead[];
  let loops: CoreRowRead[];
  try {
    [ribbons, loops] = await Promise.all([
      cores(db, bbox, DRIVE_CORES_VERSION, 50, 'ribbon'),
      cores(db, bbox, DRIVE_CORES_VERSION, 50, 'loop'),
    ]);
  } catch {
    return none; // the legacy planner is never hostage to the index
  }
  const pieces = piecesFromRows(ribbons, loops, origin);
  if (pieces.length === 0) return { ...none, pieces: 0 };
  let cells: MatrixCell[][];
  try {
    cells = await matrixFn(valhallaUrl, {
      locations: matrixLocations(origin, pieces),
      costingOptions: opts.costingOptions,
    });
  } catch {
    return {
      ...none,
      pieces: pieces.length,
      rejected: [{ id: 'sweep', failures: ['matrix_unavailable'] }],
    };
  }
  const hop = (i: number, j: number): number | null => cells[i]?.[j]?.timeS ?? null;
  const screened: Record<string, number> = {};
  const plans = enumerateTours(pieces, origin, hop, targetS, {
    twisty: opts.character?.includes('twisty') ?? false,
    stats: screened,
  });
  const ctx: SweepBuildCtx = {
    baseUrl: valhallaUrl,
    routeFn,
    origin,
    targetS,
    stemM: opts.stemM,
    costingOptions: opts.costingOptions,
    outOfTime,
    ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
  };
  const clean: DriveFirstTrip[] = [];
  const rejected: Array<{
    id: string;
    failures: string[];
    legs?: NonNullable<SweepBuilt['legsDebug']>;
  }> = [];
  let calls = 0;
  let built = 0;
  for (const plan of plans) {
    if (built >= SWEEP_BUILD_MAX) break;
    if (clean.filter((t) => t.tier === 'exact').length >= SWEEP_CLEAN_EXACT_ENOUGH) break;
    if (outOfTime()) {
      rejected.push({ id: planId(plan), failures: ['time_budget'] });
      break;
    }
    built++;
    const res = await buildSweepTour(plan, ctx);
    calls += res.calls;
    if (res.trip !== null) clean.push(res.trip);
    else
      rejected.push({
        id: planId(plan),
        failures: res.failures,
        ...(res.legsDebug ? { legs: res.legsDebug } : {}),
      });
  }
  if (clean.length === 0)
    return {
      trip: null,
      alternates: [],
      rejected,
      pieces: pieces.length,
      plans: plans.length,
      calls,
    };
  const err = (t: DriveFirstTrip): number => Math.abs(t.durationS - targetS) / targetS;
  clean.sort(
    (a, b) =>
      (a.tier === 'exact' ? 0 : 1) - (b.tier === 'exact' ? 0 : 1) ||
      err(a) - err(b) ||
      b.legs.driveS - a.legs.driveS ||
      a.core.id.localeCompare(b.core.id),
  );
  const best = clean[0]!;
  const alternates: DriveFirstTrip[] = [];
  for (const t of clean.slice(1)) {
    if (alternates.length >= 2) break;
    const dup =
      edgeOverlapRatio(t.core.geom_simplified, best.core.geom_simplified) > 0.5 ||
      alternates.some(
        (a) => edgeOverlapRatio(t.core.geom_simplified, a.core.geom_simplified) > 0.5,
      );
    if (!dup) alternates.push(t);
  }
  return {
    trip: best,
    alternates,
    rejected,
    pieces: pieces.length,
    plans: plans.length,
    calls,
    screened,
  };
}

export function planId(plan: TourPlan): string {
  return `sweep:${plan.steps.map((s) => `${s.piece.name}${s.reversed ? '↓' : '↑'}`).join('→')}`;
}
