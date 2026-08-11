/**
 * R34-fix (BD-161) — SELF-INTERSECTION detector: the owner's "it randomly
 * produces a square within the loop" (device, 2026-08-09).
 *
 * The blind spot this closes: a route that CROSSES itself encloses a sub-loop
 * the driver cannot read ("how would this portion be driven in order?").
 * Every existing detector misses it by construction — `microloopPositions`
 * caps at 3 km perimeter, `outAndBack` needs retraced road, overlap needs
 * shared cells. A clean-roads figure-eight or a spoke crossing the ring
 * passes all of them. Recovery §6.3 lists "self-crossing" as a geometry
 * question; this is that detector.
 *
 * Method: segment-segment intersection over a 60 m-resampled polyline with a
 * spatial hash (O(n) expected). Adjacent segments and the loop's closing
 * touch (end == start) are not crossings. Crossings within `graceM` of the
 * origin are excused (driveway/estate topology can force one legitimate
 * cross-over at the trip's mouth).
 */
import type { LineString } from '@shared/types';

export interface Crossing {
  /** The intersection point [lng, lat]. */
  point: [number, number];
  /** Along-route metres of the two crossing passes. */
  atM: [number, number];
}

/** The owner's "square within the loop" vs a legitimate lasso pierce: a KNOT
 *  encloses a SHORT sub-loop (unreadable on the map); a PIERCE's two passes
 *  are far apart along-route (a spoke crossing the ring to reach its entry —
 *  topologically normal). Measured before this split: a blunt zero-crossing
 *  gate rejected 164/185 candidates at funnel origins, mostly pierces. */
export const KNOT_MAX_ENCLOSED_M = Number(process.env['KNOT_MAX_ENCLOSED_M'] ?? 10_000);

export interface CrossingSummary {
  /** Short-enclosure crossings — the squares. Zero tolerance. */
  knots: number;
  /** Far crossings (spoke-through-ring). ≤2 tolerated (out + home). */
  pierces: number;
}

/** Two crossings whose POINTS sit near each other form the owner's X-square
 *  regardless of enclosed length (screenshot, 2026-08-11: out+home piercing
 *  the ring side by side enclosed a big readable quad that the enclosed-
 *  length rule alone tolerated as "2 pierces"). Clustered pierces are knots. */
export const PIERCE_CLUSTER_M = Number(process.env['PIERCE_CLUSTER_M'] ?? 3_000);

export function summarizeCrossings(hits: Crossing[]): CrossingSummary {
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const isKnot = hits.map((h) => Math.abs(h.atM[1] - h.atM[0]) <= KNOT_MAX_ENCLOSED_M);
  for (let a = 0; a < hits.length; a++) {
    for (let b = a + 1; b < hits.length; b++) {
      const dM = Math.hypot(
        (hits[a]!.point[1] - hits[b]!.point[1]) * latM,
        (hits[a]!.point[0] - hits[b]!.point[0]) * lngM,
      );
      if (dM <= PIERCE_CLUSTER_M) {
        isKnot[a] = true;
        isKnot[b] = true;
      }
    }
  }
  let knots = 0;
  let pierces = 0;
  for (const k of isKnot) {
    if (k) knots++;
    else pierces++;
  }
  return { knots, pierces };
}

const RESAMPLE_M = 60;
const CELL_M = 240;

function resample(coords: Array<[number, number]>): {
  pts: Array<[number, number]>;
  cum: number[];
} {
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const pts: Array<[number, number]> = [];
  const cum: number[] = [];
  let acc = 0;
  let carried = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i === 0) {
      pts.push(coords[0]!);
      cum.push(0);
      continue;
    }
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const segLen = Math.hypot((b[1] - a[1]) * latM, (b[0] - a[0]) * lngM);
    let d = RESAMPLE_M - carried;
    while (d <= segLen) {
      const t = d / segLen;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      acc += RESAMPLE_M;
      cum.push(acc);
      d += RESAMPLE_M;
    }
    carried = segLen - (d - RESAMPLE_M);
    acc = cum[cum.length - 1] ?? 0;
  }
  return { pts, cum };
}

function segIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): [number, number] | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null; // parallel
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null; // strict interior
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

/**
 * All strict self-crossings of the route, excluding near-origin grace.
 * `minSeparationM` skips near-adjacent passes (a tight hairpin is not a
 * crossing of two different parts of the trip).
 */
export function selfIntersections(
  geometry: LineString,
  origin?: { lat: number; lng: number },
  graceM = 500,
  minSeparationM = 500,
): Crossing[] {
  const coords = geometry.coordinates as Array<[number, number]>;
  if (coords.length < 4) return [];
  const { pts, cum } = resample(coords);
  const n = pts.length;
  if (n < 4) return [];

  const latM = 111_320;
  const lngM = 111_320 * Math.cos((43.2 * Math.PI) / 180);
  const cell = (p: [number, number]): string =>
    `${Math.floor((p[0] * lngM) / CELL_M)}:${Math.floor((p[1] * latM) / CELL_M)}`;

  // hash segment i by both endpoint cells
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n - 1; i++) {
    for (const key of new Set([cell(pts[i]!), cell(pts[i + 1]!)])) {
      const arr = buckets.get(key);
      if (arr) arr.push(i);
      else buckets.set(key, [i]);
    }
  }

  const out: Crossing[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n - 1; i++) {
    // candidate partners from own + 8 neighbour cells
    const [cx, cy] = [
      Math.floor((pts[i]![0] * lngM) / CELL_M),
      Math.floor((pts[i]![1] * latM) / CELL_M),
    ];
    const partners = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of buckets.get(`${cx + dx}:${cy + dy}`) ?? []) partners.add(j);
      }
    }
    for (const j of partners) {
      if (j <= i + 1) continue; // adjacency + double-count guard
      // closing touch of a loop: last segment meeting the first is not a cross
      if (i === 0 && j === n - 2) continue;
      if (Math.abs(cum[j]! - cum[i]!) < minSeparationM) continue;
      const hit = segIntersect(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!);
      if (!hit) continue;
      // TRANSVERSAL crossings only: two passes down the SAME road (a legal
      // retrace) sit ~1 m apart after coordinate rounding and WEAVE — near-
      // parallel micro-intersections by the dozen (measured: 79 phantom
      // "crossings" on one Belfountain route). A readable "square in the
      // loop" pierces at a real angle. Doubling is measured elsewhere.
      const a1 = Math.atan2(pts[i + 1]![1] - pts[i]![1], (pts[i + 1]![0] - pts[i]![0]) * 0.72);
      const a2 = Math.atan2(pts[j + 1]![1] - pts[j]![1], (pts[j + 1]![0] - pts[j]![0]) * 0.72);
      let dAng = Math.abs(a1 - a2) % Math.PI;
      if (dAng > Math.PI / 2) dAng = Math.PI - dAng;
      if (dAng < (25 * Math.PI) / 180) continue; // < 25° = same-road weave
      if (origin) {
        const dM = Math.hypot((hit[1] - origin.lat) * latM, (hit[0] - origin.lng) * lngM);
        if (dM <= graceM) continue;
      }
      const key = `${Math.round(hit[0] * 5000)}:${Math.round(hit[1] * 5000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ point: hit, atM: [cum[i]!, cum[j]!] });
    }
  }
  return out;
}
