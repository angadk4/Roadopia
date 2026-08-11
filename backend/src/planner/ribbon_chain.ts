/**
 * R29 Unit B — chain measured RIBBONS into one drive that fills the ask.
 *
 * WHY (BD-136): drive-first with SINGLE ribbons was vacuous — the index's
 * 1,114 ribbons average 9 minutes (max 52), so nothing fit a 60-120 min ask
 * and every brief fell through to the legacy planner. The drive the owner
 * wants — "out via X, along Y, home via Z" — is literally a CHAIN of short
 * measured ribbons with routed links between them.
 *
 * WHY NOT `buildSpanPool`/`buildChainCandidates` (explorer-verified, R29 plan):
 *   - `mergeRoadPieces` groups by road NAME and would fuse two same-named
 *     ribbons within 150 m into one bogus span;
 *   - `traversalSpanOf` recomputes endpoints at a 12 % inset, discarding the
 *     MEASURED entry/exit the ribbon's stored metrics describe;
 *   - `predict()` prices a span's own leg via the travel matrix — the fastest
 *     path between its ends, which under-prices a winding ribbon ~3× and would
 *     over-fill the chain (discover.ts:377 works around the same trap).
 * So this module hand-builds the pool and reuses only the CONTRACTS: the
 * matrix-location layout `[origin, e0,x0, e1,x1, …]`, `WaypointCandidate`,
 * and the sweep-order greedy shape.
 *
 * DESIGN POINTS THAT CARRY MEASURED HISTORY:
 *   - Orientation is chosen PER INSERTION by matrix cost (both endpoints are
 *     already matrix locations). The first cut froze entry→exit for metric
 *     honesty and it MEASURED wrong: a ribbon whose exit points away from the
 *     next entry forces a backtrack past itself — one Southfields probe chain
 *     carried 34 revisits and 6.7 km of doubling from exactly this. A rural
 *     road's duration is ~symmetric, so reversal is accepted and noted;
 *     backroad share is direction-agnostic.
 *   - 3 waypoints per ribbon (entry, geometric mid, exit): two far-apart
 *     points let Valhalla pick its own path — the recorded 3.8× failure —
 *     while dense vias burst the 20-location /route cap. 4 ribbons × 3 + the
 *     origin twice = 14 locations.
 *   - Span refs are `pinned: true`, which excludes them from repair targeting
 *     (loop.ts:760-770) — deliberate, because repair's DROP arithmetic assumes
 *     2-point spans and would orphan a 3-point span's middle via. A chain that
 *     fails assembly simply dies; others live.
 *   - The chain is judged on THE DRIVE (run.ts extends `judgedDurationS` to
 *     `rchain-` ids via splitLoopLegs): first entry → last exit, inter-ribbon
 *     links included — that IS the drive being promised.
 */
import type { LatLng } from '@shared/types';

import type { MatrixCell } from '../valhalla/matrix';

import type { WaypointCandidate } from './candidates';
import type { CoreRowRead } from './discover_cores';
import type { CandidateSegment } from './retrieve';

/** R29 Unit B master flag. OFF = byte-identical (path never consulted). */
export const RIBBON_CHAINS_ON = (process.env['RIBBON_CHAINS'] ?? 'off') !== 'off';
/**
 * Ribbons per chain. Each ribbon emits exactly 2 waypoints (entry, exit), so 6
 * ribbons stay under the 20-location /route cap in practice; the emitter
 * enforces the hard cap regardless. Raised from 4 after the probe: 4 ×
 * ~9-minute ribbons top out near 36 min of ribbon and cannot reach the 0.6×
 * floor of a 90-minute ask — Guelph and Belfountain built ZERO chains.
 *
 * (Mid vias were tried and removed: a mid vertex taken from SIMPLIFIED geometry
 * can snap onto a leg boundary, and Valhalla then 499s with "leg_shape_index
 * not set for intermediate location" — that killed every Southfields chain. A
 * short ribbon's fastest entry→exit path is the road itself anyway.)
 */
export const RIBBON_CHAIN_MAX = Number(process.env['RIBBON_CHAIN_MAX'] ?? 6);
/** Hard /route location budget: origin × 2 + waypoints must stay ≤ 20. */
const ROUTE_LOCATION_CAP = 20;
export const RIBBON_CHAIN_MIN = 2;
/** Pool cap: 1 + 2×24 = 49 locations ≤ the 50×50 matrix cap. */
export const RIBBON_POOL_MAX = 24;
/** Fractions of the ask a chain aims to fill (mirrors CHAIN_FILL_TARGETS). */
export const RIBBON_FILL_TARGETS: readonly number[] = [1.0, 0.85];
/** A chain under this fraction of the ask is not the ask (mirrors chain.ts). */
export const RIBBON_FILL_FLOOR = 0.6;
/** Sector counts tried — a K-sector tour selects ONE ribbon per sector. */
const SECTOR_COUNTS = [4, 3, 5];
/** Waypoints closer than this are the same junction — merged at emission
 *  (two `through` locations on one network point = zero-length leg = 499). */
export const JUNCTION_MERGE_M = 50;

function hav(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDeg(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lng - from.lng) * rad) * Math.cos(to.lat * rad);
  const x =
    Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
    Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lng - from.lng) * rad);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

interface PoolEntry {
  row: CoreRowRead;
  centroid: LatLng;
  bearing: number;
  /** Measured quality, not the corpus formula: what the drive IS. */
  value: number;
  /** Matrix location indices (the `[origin, e0,x0, e1,x1…]` contract). */
  entryLoc: number;
  exitLoc: number;
}

/**
 * Physical-road key for a ribbon row: the way-id suffix after the LAST colon.
 * Id formats in the wild: `cell:ribbon:ways` (r33), `cell:r34ribbon:ways`
 * (r34 carry — its rename broke the old `':ribbon:'` marker match and killed
 * road dedup in production), `version:cell:ribbon:ways` (loader v2). The way
 * suffix itself never contains ':' so last-colon is format-proof.
 */
export function ribbonRoadKey(id: string): string {
  const cut = id.lastIndexOf(':');
  return cut >= 0 ? id.slice(cut + 1) : id;
}

/**
 * Deterministic pool: top ribbons by measured value, capped for the matrix.
 *
 * DEDUPED BY PHYSICAL ROAD first: sweep cells overlap (12 km scope on an 8 km
 * grid), so the SAME road is stored as a ribbon under several cells — measured
 * at Guelph: a 24-entry pool that was only 4 distinct roads. Without this the
 * pool's diversity is an illusion and every sector fills with copies of one
 * road.
 */
export function ribbonPool(origin: LatLng, ribbons: readonly CoreRowRead[]): PoolEntry[] {
  const byRoad = new Map<string, CoreRowRead>();
  for (const r of ribbons) {
    if (r.kind !== 'ribbon') continue;
    const road = ribbonRoadKey(r.id);
    const cur = byRoad.get(road);
    if (cur === undefined || r.id.localeCompare(cur.id) < 0) byRoad.set(road, r);
  }
  return [...byRoad.values()]
    .sort(
      (a, b) =>
        b.backroad_share * b.curviness * b.duration_s -
          a.backroad_share * a.curviness * a.duration_s || a.id.localeCompare(b.id),
    )
    .slice(0, RIBBON_POOL_MAX)
    .map((row, i) => {
      const centroid: LatLng = {
        lat: (row.entry.lat + row.exit.lat) / 2,
        lng: (row.entry.lng + row.exit.lng) / 2,
      };
      return {
        row,
        centroid,
        bearing: bearingDeg(origin, centroid),
        value: row.backroad_share * row.curviness * row.duration_s,
        entryLoc: 1 + 2 * i,
        exitLoc: 2 + 2 * i,
      };
    });
}

/** A pool entry with a chosen driving direction (reversed = exit→entry). */
interface Oriented {
  entry_: PoolEntry;
  reversed: boolean;
}
const inLoc = (o: Oriented): number => (o.reversed ? o.entry_.exitLoc : o.entry_.entryLoc);
const outLoc = (o: Oriented): number => (o.reversed ? o.entry_.entryLoc : o.entry_.exitLoc);

/**
 * R29 Unit C — ribbons as CandidateSegments for the A→B corridor chainer.
 *
 * The property that KILLED loop chaining is exactly right here: ribbons lie
 * ALONG roads, and a corridor wants spans along its direction. The corridor
 * predictor prices a span's own leg by `lengthM` (not the matrix), so mapping
 * `distance_m → lengthM` keeps its budget honest for a winding ribbon.
 * `mergeRoadPieces` runs inside `buildCorridorChains`, so each synthesized
 * segment gets a UNIQUE name — two same-named ribbons within 150 m would
 * otherwise be silently fused into one bogus span (measured hazard, BD-138).
 * Corridor progress may drive a ribbon opposite its measured direction; road
 * class is direction-agnostic and a rural road's duration is ~symmetric, so
 * this is accepted and noted rather than filtered.
 */
export function ribbonsAsSegments(ribbons: readonly CoreRowRead[]): CandidateSegment[] {
  const byRoad = new Map<string, CoreRowRead>();
  for (const r of ribbons) {
    if (r.kind !== 'ribbon') continue;
    const road = ribbonRoadKey(r.id);
    const cur = byRoad.get(road);
    if (cur === undefined || r.id.localeCompare(cur.id) < 0) byRoad.set(road, r);
  }
  return [...byRoad.values()].map((r) => ({
    id: `ribbon:${r.id}`,
    osmWayId: '',
    name: `${r.name} [${r.id}]`, // unique — see the merge hazard above
    highway: 'tertiary',
    lengthM: r.distance_m,
    curviness: r.curviness,
    urbanShare: r.hood_share,
    geometry: r.geom_simplified,
  }));
}

/** The matrix layout the chain pricing expects: `[origin, e0,x0, e1,x1, …]`. */
export function ribbonMatrixLocations(
  origin: LatLng,
  pool: readonly PoolEntry[],
): Array<[number, number]> {
  const out: Array<[number, number]> = [[origin.lng, origin.lat]];
  for (const p of pool) {
    out.push([p.row.entry.lng, p.row.entry.lat], [p.row.exit.lng, p.row.exit.lat]);
  }
  return out;
}

/**
 * Predicted trip seconds for an ordered chain: routed link origin→entry₀, each
 * ribbon at its MEASURED duration, routed links exit→next entry, exit_last→origin.
 * Any unroutable cell rejects the shape outright.
 */
function predictS(m: MatrixCell[][], seq: readonly Oriented[]): number | null {
  if (seq.length === 0) return null;
  let total = 0;
  const cell = (a: number, b: number): number | null => m[a]?.[b]?.timeS ?? null;
  const first = cell(0, inLoc(seq[0]!));
  if (first === null) return null;
  total += first;
  for (let i = 0; i < seq.length; i++) {
    total += seq[i]!.entry_.row.duration_s; // MEASURED, never the matrix (3× trap)
    if (i + 1 < seq.length) {
      const next = cell(outLoc(seq[i]!), inLoc(seq[i + 1]!));
      if (next === null) return null;
      total += next;
    }
  }
  const home = cell(outLoc(seq[seq.length - 1]!), 0);
  if (home === null) return null;
  return total + home;
}

/**
 * Build ribbon-chain candidates: per sweep rotation, greedily add ribbons in
 * value order, inserting each at its bearing position (monotone sweep — the
 * chain progresses around the compass rather than zig-zagging), keeping the
 * best fill that stays inside the target.
 */
export function chainRibbons(
  origin: LatLng,
  ribbons: readonly CoreRowRead[],
  matrix: MatrixCell[][],
  durationS: number | null,
): WaypointCandidate[] {
  if (durationS === null || durationS <= 0) return [];
  const pool = ribbonPool(origin, ribbons);
  if (pool.length < RIBBON_CHAIN_MIN) return [];

  const out: WaypointCandidate[] = [];
  const seen = new Set<string>();

  // DESIGN #4 (BD-138) — derived from three MEASURED failures, not guessed:
  //   #1 frozen orientation → backtracking (34 revisits)   → orient by matrix cost
  //   #2 bearing-sweep over the whole pool → radius petals   → select within a RADIUS BAND
  //   #3 nearest-neighbour → collapses onto COLLINEAR ribbons (the index holds
  //      adjacent pieces of the same long roads; a chain of them is a LINE,
  //      and a line from a fixed origin is an out-and-back)
  //      → select ONE ribbon per bearing SECTOR, so the tour ENCLOSES area
  // Plus the Valhalla 499: adjacent ribbons meet at junctions, so consecutive
  // waypoints can snap to the SAME network point → zero-length `through` leg.
  // The emitter merges waypoints closer than JUNCTION_MERGE_M.
  //
  // The tour's radius is DERIVED from the budget rather than swept blindly: a
  // K-sector tour at radius r costs ~2r out/home plus K chords of 2·r·sin(π/K);
  // solving link budget = ask − ribbon time for r gives the band centre.
  const LINK_KMH = 55;
  for (const K of SECTOR_COUNTS) {
    for (const fill of RIBBON_FILL_TARGETS) {
      const budget = durationS * fill;
      const cell = (a: number, b: number): number | null => matrix[a]?.[b]?.timeS ?? null;

      // Ribbon time we can afford at K sectors: assume the K best-by-value
      // ribbons' mean duration as the estimate.
      const byValue = pool
        .slice()
        .sort((a, b) => b.value - a.value || a.row.id.localeCompare(b.row.id));
      const estRibbonS = byValue.slice(0, K).reduce((t2, e) => t2 + e.row.duration_s, 0) || 1;
      const linkBudgetS = Math.max(0, budget - estRibbonS);
      const chordFactor = 2 + K * 2 * Math.sin(Math.PI / K); // out+home + K chords
      const targetRadiusM = Math.max(3_000, ((linkBudgetS / 3600) * LINK_KMH * 1000) / chordFactor);

      // ONE ribbon per sector: nearest to the target radius, best value on ties.
      const bySector = new Map<number, PoolEntry>();
      for (const e of pool) {
        const sector = Math.floor((e.bearing / 360) * K) % K;
        const dist = hav([origin.lng, origin.lat], [e.centroid.lng, e.centroid.lat]);
        const fitR = Math.abs(dist - targetRadiusM) / targetRadiusM;
        if (fitR > 0.75) continue; // outside the band — petals live here
        const cur = bySector.get(sector);
        if (cur === undefined) {
          bySector.set(sector, e);
          continue;
        }
        const curDist = hav([origin.lng, origin.lat], [cur.centroid.lng, cur.centroid.lat]);
        const curFit = Math.abs(curDist - targetRadiusM) / targetRadiusM;
        if (fitR < curFit - 0.1 || (Math.abs(fitR - curFit) <= 0.1 && e.value > cur.value)) {
          bySector.set(sector, e);
        }
      }
      const picked = [...bySector.values()].sort((a, b) => a.bearing - b.bearing);
      if (picked.length < RIBBON_CHAIN_MIN) continue;

      // Orient each ribbon by matrix cost along the bearing-ordered tour.
      const chain: Oriented[] = [];
      let ok = true;
      for (let i = 0; i < picked.length && chain.length < RIBBON_CHAIN_MAX; i++) {
        const cand = picked[i]!;
        const from = chain.length === 0 ? 0 : outLoc(chain[chain.length - 1]!);
        const fwd = cell(from, cand.entryLoc);
        const rev = cell(from, cand.exitLoc);
        if (fwd === null && rev === null) {
          ok = false;
          break;
        }
        chain.push({
          entry_: cand,
          reversed: rev !== null && (fwd === null || rev < fwd),
        });
      }
      if (!ok) continue;

      // Trim from the END until the tour fits the budget (keeps the spread).
      let t = predictS(matrix, chain);
      while (chain.length > RIBBON_CHAIN_MIN && (t === null || t > budget)) {
        chain.pop();
        t = predictS(matrix, chain);
      }
      if (chain.length < RIBBON_CHAIN_MIN || t === null || t > budget) continue;
      if (t < durationS * RIBBON_FILL_FLOOR) continue;

      const key = chain
        .map((c) => (c.reversed ? c.entry_.row.id + 'r' : c.entry_.row.id))
        .join('+');
      if (seen.has(key)) continue;
      seen.add(key);

      // Emit with the junction merge: a waypoint within JUNCTION_MERGE_M of the
      // previous one is the SAME network point — pushing it again makes a
      // zero-length `through` leg and a Valhalla 499.
      const waypoints: LatLng[] = [];
      const spans: NonNullable<WaypointCandidate['spans']> = [];
      let overCap = false;
      for (const c of chain) {
        const row = c.entry_.row;
        const a = c.reversed ? row.exit : row.entry;
        const b = c.reversed ? row.entry : row.exit;
        const prev = waypoints[waypoints.length - 1];
        const mergeA =
          prev !== undefined && hav([prev.lng, prev.lat], [a.lng, a.lat]) < JUNCTION_MERGE_M;
        const startIndex = mergeA ? waypoints.length - 1 : waypoints.length;
        if (!mergeA) waypoints.push(a);
        waypoints.push(b);
        if (waypoints.length + 2 > ROUTE_LOCATION_CAP) {
          overCap = true;
          break;
        }
        spans.push({
          segmentId: `rchain:${row.id}`,
          startIndex,
          endIndex: waypoints.length - 1,
          // Pinned: repair must not SHIFT/DROP these — its index arithmetic
          // assumes 2-point spans and a merged junction shares an index.
          pinned: true,
          value: c.entry_.value,
        });
      }
      if (overCap) continue;
      out.push({
        id: `rchain-k${K}-f${Math.round(fill * 100)}`,
        kind: 'loop',
        waypoints,
        sector: K,
        returnSector: null,
        clusterId: null,
        stops: [],
        spans,
        clusterWeight: chain.reduce((t2, c) => t2 + c.entry_.value, 0),
      } as WaypointCandidate);
    }
  }
  return out;
}
