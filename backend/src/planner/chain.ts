/**
 * Chain generator (R18-3) — "string the great roads together".
 *
 * THE R18 audit: legacy candidates force 2-7 km of curvy road and let a
 * fastest-path router fill the other ~90 % — boring-by-construction, and the
 * project knew ("multi-cluster chains are the promising lever, not far
 * anchors"). This generator builds loop candidates that TRAVERSE 3-7 full
 * curvy spans, budgeted by a real travel matrix, so the majority of route
 * meters become roads we chose.
 *
 * Why this succeeds where round-12 triples failed (pre-registered in the R18
 * plan): triples moved countryScore ~0.003 on identical arterial connectors
 * with no metric rewarding them; now (a) shortest-profile connectors differ
 * per corridor, (b) chains self-size via the matrix instead of overshooting
 * into the −tier, (c) arterial/curvy-share are measured and tiered.
 * ADOPTION RULE (falsifiable): pool countryScore variance must rise from
 * ~0.007 to > 0.05 on the corpus, or chains are refused (BD-40 discipline).
 * `tripleClusters` stays false forever — this is a different generator behind
 * a different flag.
 *
 * Pure module: NO engine calls. The caller retrieves the matrix (one
 * sources_to_targets over origin + 2·pool endpoints ≤ 49 locations — fits the
 * engine's 2 500-pair cap in a single call) and hands it in. Deterministic:
 * ties by segment id, no RNG.
 *
 * v1 scope: stop-free briefs only (stop-unit insertion into chains lands with
 * R18-4's bundles); chains ADD to the legacy pool behind `chainCandidates` —
 * diversify/scoring pick the winners.
 */

import type { LatLng } from '@shared/types';

import { haversineMeters } from '../../../data/curvature/geometry';
import type { MatrixCell } from '../valhalla/matrix';

import {
  bearingDeg,
  countryClassFactor,
  effectiveCurviness,
  sectorOf,
  tipOf,
  traversalSpanOf,
  type CandidateSpanRef,
  type WaypointCandidate,
} from './candidates';
import type { CandidateSegment } from './retrieve';

/** Span pool cap: origin + 24×2 endpoints = 49 locations < the 50×50 matrix cap. */
export const M_SPAN_POOL = 24;
/** ≤ 20 route locations (engine cap): origin×2 + 7 spans×2 + anchor ≤ 17. */
export const CHAIN_MAX_SPANS = 7;
export const CHAIN_MIN_SPANS = 3;
/** Pairwise span separation floor — two spans of the same road are one span. */
export const SPAN_MIN_SEPARATION_M = 1_500;
/** Fill targets: fraction of the duration budget a chain aims to consume. */
export const CHAIN_FILL_TARGETS = [1.0, 0.85] as const;
/** Angular gap (deg) beyond which a return anchor is inserted to keep the
 *  sweep from cutting straight home across the middle. */
export const CHAIN_ANCHOR_GAP_DEG = 120;
/** Full two-point traversal spans need this much road (mirrors TRAVERSE_MIN_M). */
export const CHAIN_FULL_SPAN_MIN_M = 1_200;
/** Shorter curvy pieces join as single-waypoint TOUCHES (data reality: the
 *  retrieved corpus median piece is ~200 m across ~226 roads — the forced fun
 *  of a chain comes from MANY curvy-area visits with shortest connectors
 *  between them, not only from long traversals). */
export const CHAIN_TOUCH_MIN_M = 400;

export interface ChainSpan {
  segment: CandidateSegment;
  /** Entry/exit chosen so traversal runs in sweep direction (set per rotation).
   *  For a TOUCH span a === b (single on-road point). */
  a: LatLng; // traversal endpoint at inset (or the tip for touches)
  b: LatLng; // traversal endpoint at 1-inset (== a for touches)
  touch: boolean;
  centroid: LatLng;
  bearing: number; // origin → centroid
  distanceM: number; // origin → centroid
  value: number; // curviness · length · class factor
}

/**
 * Merge same-NAME adjacent pieces into whole-road spans (R18-3 pool fix).
 * OSM chops a curvy road into many short ways — live probe: 300 retrieved
 * segments yielded a pool of FOUR ≥1.2 km spans because the pieces were
 * 200-800 m each. The road the driver experiences is the whole named run;
 * merging by name + endpoint adjacency turns "Forks of the Credit Road ×9
 * pieces" into ONE chainable span. Deterministic: pieces walk by endpoint
 * proximity, ties by id; unnamed pieces stay singletons.
 */
const MERGE_JOIN_M = 150;

export function mergeRoadPieces(segments: readonly CandidateSegment[]): CandidateSegment[] {
  const byName = new Map<string, CandidateSegment[]>();
  for (const s of segments) {
    const key = s.name !== '' ? s.name : `__id:${s.id}`;
    let list = byName.get(key);
    if (!list) {
      list = [];
      byName.set(key, list);
    }
    list.push(s);
  }
  const endOf = (s: CandidateSegment, last: boolean): [number, number] => {
    const c = s.geometry.coordinates;
    return (last ? c[c.length - 1] : c[0]) as [number, number];
  };
  const out: CandidateSegment[] = [];
  for (const [, pieces] of byName) {
    if (pieces.length === 1) {
      out.push(pieces[0]!);
      continue;
    }
    const remaining = [...pieces].sort((a, b) => a.id.localeCompare(b.id));
    while (remaining.length > 0) {
      // seed a run and greedily extend at both ends by endpoint adjacency
      const run: CandidateSegment[] = [remaining.shift()!];
      const runCoords: Array<[number, number]> = [
        ...(run[0]!.geometry.coordinates as Array<[number, number]>),
      ];
      let extended = true;
      while (extended && remaining.length > 0) {
        extended = false;
        const head = runCoords[0]!;
        const tail = runCoords[runCoords.length - 1]!;
        for (let i = 0; i < remaining.length; i++) {
          const cand = remaining[i]!;
          const cs = cand.geometry.coordinates as Array<[number, number]>;
          const joins: Array<[string, number]> = [
            ['tail-first', haversineMeters(tail, endOf(cand, false))],
            ['tail-last', haversineMeters(tail, endOf(cand, true))],
            ['head-first', haversineMeters(head, endOf(cand, false))],
            ['head-last', haversineMeters(head, endOf(cand, true))],
          ];
          joins.sort((a, b) => a[1] - b[1]);
          const [mode, d] = joins[0]!;
          if (d > MERGE_JOIN_M) continue;
          if (mode === 'tail-first') runCoords.push(...cs.slice(1));
          else if (mode === 'tail-last') runCoords.push(...[...cs].reverse().slice(1));
          else if (mode === 'head-last') runCoords.unshift(...cs.slice(0, -1));
          else runCoords.unshift(...[...cs].reverse().slice(0, -1));
          run.push(cand);
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
      if (run.length === 1) {
        out.push(run[0]!);
      } else {
        const lengthM = run.reduce((a, r) => a + r.lengthM, 0);
        const curviness =
          run.reduce((a, r) => a + r.curviness * r.lengthM, 0) / Math.max(1, lengthM);
        // R24: length-weight the turn density across the merged run (like curviness);
        // omit the field entirely if no piece carried the signal (fail-open).
        const anyTurns = run.some((r) => r.significantTurnsPerKm !== undefined);
        out.push({
          ...run[0]!,
          id: run
            .map((r) => r.id)
            .sort()
            .join('+'),
          lengthM,
          curviness,
          ...(anyTurns
            ? {
                significantTurnsPerKm:
                  run.reduce((a, r) => a + (r.significantTurnsPerKm ?? 0) * r.lengthM, 0) /
                  Math.max(1, lengthM),
              }
            : {}),
          geometry: { type: 'LineString', coordinates: runCoords },
        });
      }
    }
  }
  return out;
}

/** Deterministic span pool: whole-road merged, high-value, long-enough,
 *  mutually separated, duration-plausible spans. */
export function buildSpanPool(
  origin: LatLng,
  segments: readonly CandidateSegment[],
  durationS: number,
  sizingSpeedKmh: number,
): ChainSpan[] {
  const vMs = (sizingSpeedKmh / 3.6) * 1;
  const maxRoundTripS = 1.5 * durationS;
  const ranked = mergeRoadPieces(segments)
    .filter((s) => s.lengthM >= CHAIN_TOUCH_MIN_M)
    .map((segment) => {
      const touch = segment.lengthM < CHAIN_FULL_SPAN_MIN_M;
      const [a, b] = touch
        ? ([tipOf(segment), tipOf(segment)] as [LatLng, LatLng])
        : traversalSpanOf(segment);
      const centroid: LatLng = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
      const distanceM = haversineMeters([origin.lng, origin.lat], [centroid.lng, centroid.lat]);
      return {
        segment,
        a,
        b,
        touch,
        centroid,
        bearing: bearingDeg(origin, centroid),
        distanceM,
        value:
          effectiveCurviness(segment) *
          segment.lengthM *
          countryClassFactor(segment.highway) *
          (1 - 0.7 * (segment.urbanShare ?? 0)), // R19: town material ranks last; R24: de-switchback
      };
    })
    // plausibility: reaching the span and coming home must fit the budget
    .filter((s) => (2 * s.distanceM + s.segment.lengthM) / vMs <= maxRoundTripS)
    .sort((x, y) => y.value - x.value || x.segment.id.localeCompare(y.segment.id));

  const pool: ChainSpan[] = [];
  for (const s of ranked) {
    if (pool.length >= M_SPAN_POOL) break;
    const tooClose = pool.some(
      (p) =>
        haversineMeters([p.centroid.lng, p.centroid.lat], [s.centroid.lng, s.centroid.lat]) <
        SPAN_MIN_SEPARATION_M,
    );
    if (!tooClose) pool.push(s);
  }
  return pool;
}

/** Matrix locations for the pool: [origin, span0.a, span0.b, span1.a, …]. */
export function chainMatrixLocations(
  origin: LatLng,
  pool: readonly ChainSpan[],
): Array<[number, number]> {
  const locs: Array<[number, number]> = [[origin.lng, origin.lat]];
  for (const s of pool) {
    locs.push([s.a.lng, s.a.lat]);
    locs.push([s.b.lng, s.b.lat]);
  }
  return locs;
}

interface OrientedSpan {
  span: ChainSpan;
  poolIndex: number;
  entry: LatLng;
  exit: LatLng;
  entryLoc: number; // matrix index
  exitLoc: number;
  rotBearing: number; // bearing rotated into the sweep frame
}

const timeOf = (m: MatrixCell[][], i: number, j: number): number | null => m[i]?.[j]?.timeS ?? null;

export interface ChainOptions {
  durationS: number;
  nSectors?: number;
  /** Return-anchor pool (on-road points; reuse of retrieveAnchorPoints). */
  anchorPoints?: readonly LatLng[];
  idPrefix?: string;
}

/**
 * Build up to nSectors × |CHAIN_FILL_TARGETS| chain candidates: for each sweep
 * rotation, greedily add spans in descending value with sweep-order insertion,
 * keeping the matrix-predicted duration inside the fill target.
 */
export function buildChainCandidates(
  origin: LatLng,
  pool: readonly ChainSpan[],
  matrix: MatrixCell[][],
  opts: ChainOptions,
): WaypointCandidate[] {
  if (pool.length < CHAIN_MIN_SPANS) return [];
  const nSectors = opts.nSectors ?? 4;
  const pfx = opts.idPrefix ?? '';
  const out: WaypointCandidate[] = [];

  for (let sector = 0; sector < nSectors; sector++) {
    const rot = (x: number): number => (x - (sector * 360) / nSectors + 360) % 360;

    // orient every span for this sweep: entry = angularly earlier endpoint
    const oriented: OrientedSpan[] = pool.map((span, poolIndex) => {
      const bearA = rot(bearingDeg(origin, span.a));
      const bearB = rot(bearingDeg(origin, span.b));
      const aFirst = bearA <= bearB;
      return {
        span,
        poolIndex,
        entry: aFirst ? span.a : span.b,
        exit: aFirst ? span.b : span.a,
        entryLoc: 1 + poolIndex * 2 + (aFirst ? 0 : 1),
        exitLoc: 1 + poolIndex * 2 + (aFirst ? 1 : 0),
        rotBearing: rot(span.bearing),
      };
    });
    const byValue = [...oriented].sort(
      (x, y) => y.span.value - x.span.value || x.span.segment.id.localeCompare(y.span.segment.id),
    );

    for (const fill of CHAIN_FILL_TARGETS) {
      const budgetS = opts.durationS * fill;
      const chain: OrientedSpan[] = []; // kept in sweep order

      const predict = (seq: OrientedSpan[]): number | null => {
        if (seq.length === 0) return 0;
        let total = 0;
        const legs: Array<[number, number]> = [];
        legs.push([0, seq[0]!.entryLoc]);
        for (let k = 0; k < seq.length; k++) {
          legs.push([seq[k]!.entryLoc, seq[k]!.exitLoc]); // the span itself
          if (k + 1 < seq.length) legs.push([seq[k]!.exitLoc, seq[k + 1]!.entryLoc]);
        }
        legs.push([seq[seq.length - 1]!.exitLoc, 0]);
        for (const [i, j] of legs) {
          const t = timeOf(matrix, i, j);
          if (t === null) return null; // unroutable hop — reject this shape
          total += t;
        }
        return total;
      };

      for (const cand of byValue) {
        if (chain.length >= CHAIN_MAX_SPANS) break;
        if (chain.some((c) => c.poolIndex === cand.poolIndex)) continue;
        // sweep-order insertion position
        const at = chain.findIndex((c) => c.rotBearing > cand.rotBearing);
        const next = [...chain];
        next.splice(at === -1 ? chain.length : at, 0, cand);
        const t = predict(next);
        if (t !== null && t <= budgetS) {
          chain.length = 0;
          chain.push(...next);
        }
      }

      if (chain.length < CHAIN_MIN_SPANS) continue;
      const predicted = predict(chain);
      if (predicted === null || predicted < 0.6 * opts.durationS) continue;

      // waypoints: entry+exit per full span, ONE point per touch; sweep order
      const waypoints: LatLng[] = [];
      const spans: CandidateSpanRef[] = [];
      for (const c of chain) {
        if (c.span.touch) {
          spans.push({
            segmentId: c.span.segment.id,
            startIndex: waypoints.length,
            endIndex: waypoints.length,
          });
          waypoints.push(c.entry);
        } else {
          spans.push({
            segmentId: c.span.segment.id,
            startIndex: waypoints.length,
            endIndex: waypoints.length + 1,
          });
          waypoints.push(c.entry, c.exit);
        }
      }

      // return-anchor: if the largest angular gap (incl. the wrap through the
      // origin bearing) exceeds the cap, add the anchor point nearest the gap
      // centre bearing at ~the chain's mean distance — keeps the way home from
      // cutting straight across the middle of the sweep.
      if (opts.anchorPoints && opts.anchorPoints.length > 0 && chain.length >= 2) {
        const bearings = chain.map((c) => c.rotBearing).sort((a, b) => a - b);
        let worstGap = 360 - bearings[bearings.length - 1]!; // wrap back to 0
        let gapCentre = (bearings[bearings.length - 1]! + worstGap / 2) % 360;
        for (let k = 1; k < bearings.length; k++) {
          const gap = bearings[k]! - bearings[k - 1]!;
          if (gap > worstGap) {
            worstGap = gap;
            gapCentre = bearings[k - 1]! + gap / 2;
          }
        }
        if (worstGap > CHAIN_ANCHOR_GAP_DEG) {
          const meanDist = chain.reduce((sum, c) => sum + c.span.distanceM, 0) / chain.length;
          const targetBearing = (gapCentre + (sector * 360) / nSectors) % 360;
          const anchor = [...opts.anchorPoints].sort((p, q) => {
            const dp =
              Math.abs(((bearingDeg(origin, p) - targetBearing + 540) % 360) - 180) * 100 +
              Math.abs(haversineMeters([origin.lng, origin.lat], [p.lng, p.lat]) - meanDist) / 1000;
            const dq =
              Math.abs(((bearingDeg(origin, q) - targetBearing + 540) % 360) - 180) * 100 +
              Math.abs(haversineMeters([origin.lng, origin.lat], [q.lng, q.lat]) - meanDist) / 1000;
            return dp - dq || p.lat - q.lat || p.lng - q.lng;
          })[0]!;
          // insert at the sweep position of its bearing
          const anchorRot = (bearingDeg(origin, anchor) - (sector * 360) / nSectors + 360) % 360;
          let insertAt = waypoints.length;
          for (let k = 0; k < chain.length; k++) {
            if (chain[k]!.rotBearing > anchorRot) {
              insertAt = spans[k]!.startIndex;
              break;
            }
          }
          waypoints.splice(insertAt, 0, anchor);
          for (const sp of spans) {
            if (sp.startIndex >= insertAt) {
              sp.startIndex += 1;
              sp.endIndex += 1;
            }
          }
        }
      }

      out.push({
        id: `${pfx}chain-s${sector}-f${Math.round(fill * 100)}`,
        kind: 'loop',
        waypoints,
        sector,
        returnSector: null,
        clusterId: null,
        stops: [], // v1: chains generate for stop-free briefs only (see header)
        spans,
        clusterWeight: chain.reduce((sum, c) => sum + c.span.value, 0),
      });
    }
  }

  // dedupe identical span-sets across rotations (same chain found twice)
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = (c.spans ?? []).map((s) => s.segmentId).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// A→B corridor chains (R18-3 parity) — the audit's "A→B forces ONE off-road
// centroid" fix. Spans string along the o→d corridor by PROGRESS (monotone —
// no backtracking); the binding constraint is the assembly detour cap, which
// assembleAtoB re-checks exactly on real roads, so selection here budgets by
// straight-line predicted path length (no matrix call needed) with slack
// under the 1.8× cap. Deterministic: ties by segment id.
// ---------------------------------------------------------------------------

/** ≤ 20 route locations (engine cap): o + d + 4 spans×2 + stops ≤ 14. */
export const CORRIDOR_MAX_SPANS = 4;
export const CORRIDOR_MIN_SPANS = 2;
/** Straight-line predicted path caps (× direct distance) — two variants, both
 *  under the 1.8× assembly detour cap so real-road routing keeps slack. */
export const CORRIDOR_FILL_TARGETS = [1.55, 1.3] as const;
/** A span whose lone marginal detour exceeds this × direct can never fit. */
export const CORRIDOR_SPAN_DETOUR_MAX = 0.5;
/** Minimum corridor-progress gap between spans — monotone separation. */
export const CORRIDOR_PROGRESS_MIN_GAP = 0.06;
/** Pool cap — no matrix constraint here; keeps the greedy cheap. */
export const M_CORRIDOR_POOL = 16;

/**
 * Chain 2-4 curvy spans along the o→d corridor, progress-ordered. Emits ≤ 2
 * candidates (one per fill target, deduped by span-set). v1 = stop-free briefs
 * only (legacy per-cluster candidates carry the stops).
 */
export function buildCorridorChains(
  origin: LatLng,
  destination: LatLng,
  segments: readonly CandidateSegment[],
  opts: { idPrefix?: string } = {},
): WaypointCandidate[] {
  const pfx = opts.idPrefix ?? '';
  const directM = haversineMeters([origin.lng, origin.lat], [destination.lng, destination.lat]);
  if (directM < 1_000) return [];

  /** Progress of p along o→d (0 at origin, 1 at destination). */
  const progress = (p: LatLng): number => {
    const dO = haversineMeters([origin.lng, origin.lat], [p.lng, p.lat]);
    const dD = haversineMeters([destination.lng, destination.lat], [p.lng, p.lat]);
    return (dO - dD) / (2 * directM) + 0.5;
  };

  interface CorridorSpan {
    segment: CandidateSegment;
    entry: LatLng; // endpoint with the SMALLER progress (monotone within span)
    exit: LatLng;
    touch: boolean;
    prog: number; // mid progress — the ordering key
    detourM: number; // marginal straight-line detour of visiting the span
    value: number;
  }

  const pool: CorridorSpan[] = [];
  const ranked = mergeRoadPieces(segments)
    .filter((s) => s.lengthM >= CHAIN_TOUCH_MIN_M)
    .map((segment) => {
      const touch = segment.lengthM < CHAIN_FULL_SPAN_MIN_M;
      const [pA, pB] = touch
        ? ([tipOf(segment), tipOf(segment)] as [LatLng, LatLng])
        : traversalSpanOf(segment);
      const aFirst = progress(pA) <= progress(pB);
      const entry = aFirst ? pA : pB;
      const exit = aFirst ? pB : pA;
      const centroid: LatLng = {
        lat: (entry.lat + exit.lat) / 2,
        lng: (entry.lng + exit.lng) / 2,
      };
      const detourM =
        haversineMeters([origin.lng, origin.lat], [centroid.lng, centroid.lat]) +
        haversineMeters([centroid.lng, centroid.lat], [destination.lng, destination.lat]) -
        directM;
      return {
        segment,
        entry,
        exit,
        touch,
        prog: progress(centroid),
        detourM,
        value:
          effectiveCurviness(segment) *
          segment.lengthM *
          countryClassFactor(segment.highway) *
          (1 - 0.7 * (segment.urbanShare ?? 0)), // R19: town material ranks last; R24: de-switchback
        centroid,
      };
    })
    .filter((s) => s.detourM <= CORRIDOR_SPAN_DETOUR_MAX * directM)
    .sort((x, y) => y.value - x.value || x.segment.id.localeCompare(y.segment.id));
  for (const s of ranked) {
    if (pool.length >= M_CORRIDOR_POOL) break;
    const tooClose = pool.some(
      (p) =>
        haversineMeters(
          [(p.entry.lng + p.exit.lng) / 2, (p.entry.lat + p.exit.lat) / 2],
          [(s.entry.lng + s.exit.lng) / 2, (s.entry.lat + s.exit.lat) / 2],
        ) < SPAN_MIN_SEPARATION_M,
    );
    if (!tooClose) pool.push(s);
  }
  if (pool.length < CORRIDOR_MIN_SPANS) return [];

  /** Straight-line path length o → spans (progress order) → d. */
  const dLL = (p: LatLng, q: LatLng): number => haversineMeters([p.lng, p.lat], [q.lng, q.lat]);
  const predict = (seq: readonly CorridorSpan[]): number => {
    let total = 0;
    let at = origin;
    for (const s of seq) {
      total += dLL(at, s.entry) + s.segment.lengthM;
      at = s.exit;
    }
    return total + dLL(at, destination);
  };

  const out: WaypointCandidate[] = [];
  for (const fill of CORRIDOR_FILL_TARGETS) {
    const budgetM = fill * directM;
    const chain: CorridorSpan[] = []; // kept in progress order
    for (const cand of pool) {
      if (chain.length >= CORRIDOR_MAX_SPANS) break;
      if (chain.some((c) => c.segment.id === cand.segment.id)) continue;
      // monotone separation along the corridor
      if (chain.some((c) => Math.abs(c.prog - cand.prog) < CORRIDOR_PROGRESS_MIN_GAP)) continue;
      const at = chain.findIndex((c) => c.prog > cand.prog);
      const next = [...chain];
      next.splice(at === -1 ? chain.length : at, 0, cand);
      if (predict(next) <= budgetM) {
        chain.length = 0;
        chain.push(...next);
      }
    }
    if (chain.length < CORRIDOR_MIN_SPANS) continue;

    const waypoints: LatLng[] = [];
    const spans: CandidateSpanRef[] = [];
    for (const c of chain) {
      if (c.touch) {
        spans.push({
          segmentId: c.segment.id,
          startIndex: waypoints.length,
          endIndex: waypoints.length,
        });
        waypoints.push(c.entry);
      } else {
        spans.push({
          segmentId: c.segment.id,
          startIndex: waypoints.length,
          endIndex: waypoints.length + 1,
        });
        waypoints.push(c.entry, c.exit);
      }
    }
    out.push({
      id: `${pfx}atob-chain-f${Math.round(fill * 100)}`,
      kind: 'atob',
      waypoints,
      sector: sectorOf(bearingDeg(origin, chain[0]!.entry), 4),
      returnSector: null,
      clusterId: null,
      stops: [], // v1: corridor chains generate for stop-free briefs only
      spans,
      clusterWeight: chain.reduce((sum, c) => sum + c.value, 0),
    });
  }

  // dedupe identical span-sets across fill targets
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = (c.spans ?? []).map((s) => s.segmentId).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
