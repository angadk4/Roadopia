/**
 * R25-U19 — corridor-following connectors: the rebuild aimed at the ~90-97 %
 * of route metres that are Valhalla-free glue (audit-v11's structural
 * finding: the corpus is clean, THE CONNECTORS are the product; four prior
 * ranking-side attempts refused — BD-39/40/81/82 — because none of them
 * touched these metres).
 *
 * Mechanism (the plan's pre-verified synthesis, all three properties at once):
 *   DENSE      — sample the ROUTED leg every ~2.5 km so Valhalla never gets a
 *                long free hand (probe: sampling held distance to +1.6 %
 *                where the raw corridor cost +18 %);
 *   MONOTONE   — vias keep leg-progress order, never doubling back (probe:
 *                without it, 3.8× distance);
 *   FROM THE CORPUS — each sample snaps to the best nearby BACKROAD-class
 *                corpus point (single gentle via, never an entry/exit span
 *                traversal — the span-forcing variant is the four-times-
 *                refused shape); no costing tweak reliably finds backroads
 *                (probe: use_highways:0 alone measured −48 pp on one pair).
 *
 * Honesty about the odds, from the plan itself: highway removal via this
 * family is SOLID; the backroad half measured +11 / 0 / −18 pp in the
 * planning prototype — NOT pre-validated. This module ships behind
 * CONNECTOR_REFINE (default OFF) with a pre-registered adopt-or-refuse A/B,
 * and the rq25_u19_probe experiment sweeps the parameters on live pairs
 * BEFORE the flag is ever judged (the probed code is THIS code).
 *
 * Integration shape: refine the DIVERSIFY-KEPT FINALISTS only (~4/brief), via
 * the shared helpers here, called identically by run.ts and eval mirrors —
 * one assembly re-run per finalist, kept only when the re-measured route
 * genuinely improves (backroad share up, duration within growth cap,
 * cleanliness not worse). Deterministic: no RNG, id tiebreaks, pure planning
 * separated from engine calls.
 */

import type { LatLng, LineString } from '@shared/types';

import { haversineMeters } from '../../../data/curvature/geometry';

import { effectiveCurviness, type WaypointCandidate } from './candidates';
import type { CandidateSegment } from './retrieve';
import { BACKROAD_CLASSES } from './roadclass';

/** Master flag — default OFF until the pre-registered A/B adopts. */
export const CONNECTOR_REFINE_ON = process.env['CONNECTOR_REFINE'] === 'on';

// --- tunables (frozen by the rq25_u19_probe sweep, 2026-07-26, 6 live pairs
// × 9 combos): s3500/r800 was the SAFE winner — worst raw duration growth
// ×1.15 (i.e. the accept-gate below almost never even fires), hwy within the
// 600 m floor, and the prototype's −18 pp failure case (Acton→Georgetown)
// measured +14 pp at ×1.01. Larger radii bought up to +45 pp but at ×1.5-2.7
// duration — the radius is the detour knob. Probe verdicts (raw REFUSED at
// the pre-registered median bar; gated median +2 pp, bimodal by corpus
// density) are recorded in the U19 decision entry. ------------------------
/** Sample the routed leg every this many metres (the DENSE property). */
export const CONNECTOR_SAMPLE_SPACING_M = Number(process.env['CONNECTOR_SPACING'] ?? 3500);
/** A sample snaps only to corpus points within this radius. */
export const CONNECTOR_SNAP_RADIUS_M = Number(process.env['CONNECTOR_RADIUS'] ?? 800);
/** Legs shorter than this stay untouched (nothing to steer). */
export const CONNECTOR_MIN_LEG_M = 5000;
/** Keep vias at least this far apart along the leg (anti-zigzag). */
export const CONNECTOR_VIA_MIN_SEP_M = 2000;
/** No vias within this distance of a leg's endpoints (don't fight anchors). */
export const CONNECTOR_END_INSET_M = 1500;
/** Valhalla route-location ceiling (chain.ts precedent: ≤ 20 locations). */
export const CONNECTOR_MAX_LOCATIONS = 20;
/** Only genuinely curvy corpus material may steer a connector. */
export const CONNECTOR_MIN_CURVINESS = 0.8;
/** Refined route may cost at most this × the original duration. */
export const CONNECTOR_MAX_DURATION_GROWTH = 1.15;
/**
 * Swap tolerance on presentationKey (review finding, confirmed): the key has
 * NO backroad-share channel (BD-88 cancelled the share grade as pool-inert),
 * so a strict key-improve guard would reject share-only wins and the lever
 * would degenerate toward OFF. A materially-better-measured refinement may
 * cost up to this many WITHIN-TIER points (≪ the 100-point tier gaps — tier
 * order can never cross); rows still re-rank normally afterwards.
 */
export const CONNECTOR_KEY_TOLERANCE = 1.0;
/** Inserted vias keep this planar distance from every other route location
 *  (review finding, confirmed): without it a corner waypoint can collect the
 *  SAME corpus vertex on both flanks — [P, w, P] — the documented round-8
 *  block-circle shape that 'through' typing hides from every detector. */
export const CONNECTOR_GLOBAL_SEP_M = 800;

const LAT_M = 111_320;
const lngM = (lat: number): number => LAT_M * Math.cos((lat * Math.PI) / 180);

/** Squared planar metres between two [lng,lat] points (local scaling). */
function d2(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = (a[0] - b[0]) * lngM((a[1] + b[1]) / 2);
  const dy = (a[1] - b[1]) * LAT_M;
  return dx * dx + dy * dy;
}

/**
 * Project each waypoint onto the route polyline (nearest vertex), MONOTONE —
 * each projection searches only forward of the previous one, so a loop that
 * passes near an earlier waypoint again cannot fold the leg map. Returns
 * vertex indices splitting the route into legs:
 *   [0..idx0] = origin→w0, [idx0..idx1] = w0→w1, …, [idxLast..end].
 */
export function waypointVertexIndices(
  geometry: LineString,
  waypoints: readonly LatLng[],
): number[] {
  const coords = geometry.coordinates as Array<[number, number]>;
  const NEAR2 = 300 * 300; // a route location's vertex is metres away, not km
  const out: number[] = [];
  let from = 0;
  for (const w of waypoints) {
    const p: [number, number] = [w.lng, w.lat];
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < coords.length; i++) {
      const d = d2(coords[i]!, p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      // review finding (confirmed): a global min can jump FORWARD onto a
      // closer LATER pass and collapse the legs between. Waypoints are route
      // locations, so a vertex within ~300 m exists on the correct pass —
      // anchor to the EARLIEST such vertex, then stop improving once we are
      // already close and the candidate is far past it.
      if (bestD <= NEAR2 && d > NEAR2 * 4 && i > best + 2) break;
    }
    out.push(best);
    from = best;
  }
  return out;
}

export interface ConnectorVia {
  point: LatLng;
  segmentId: string;
  /** Snap score (curviness-priced, distance-discounted) — for diagnostics. */
  value: number;
  /** Metres along the LEG at the originating sample (monotone order key). */
  alongM: number;
}

/**
 * Plan the via insertions for ONE leg (pure). `legCoords` is the routed leg's
 * polyline — the corridor whose shape we sample; snapping FROM the real
 * corridor is what kept the plan's probe at +1.6 % distance where snapping
 * from straight lines produced the 3.8× blowup.
 */
export function planConnectorVias(
  legCoords: ReadonlyArray<readonly [number, number]>,
  segments: readonly CandidateSegment[],
  opts: {
    spacingM?: number;
    radiusM?: number;
    minLegM?: number;
    viaMinSepM?: number;
    endInsetM?: number;
    maxVias?: number;
  } = {},
): ConnectorVia[] {
  const spacingM = opts.spacingM ?? CONNECTOR_SAMPLE_SPACING_M;
  const radiusM = opts.radiusM ?? CONNECTOR_SNAP_RADIUS_M;
  const minLegM = opts.minLegM ?? CONNECTOR_MIN_LEG_M;
  const viaMinSepM = opts.viaMinSepM ?? CONNECTOR_VIA_MIN_SEP_M;
  const endInsetM = opts.endInsetM ?? CONNECTOR_END_INSET_M;
  const maxVias = opts.maxVias ?? Infinity;
  if (legCoords.length < 2) return [];

  // cumulative distance along the leg
  const cum: number[] = [0];
  for (let i = 1; i < legCoords.length; i++) {
    cum.push(cum[i - 1]! + haversineMeters(legCoords[i - 1]!, legCoords[i]!));
  }
  const legLen = cum[cum.length - 1]!;
  if (legLen < minLegM) return [];

  // eligible corpus material: BACKROAD classes only, genuinely curvy under
  // the ADOPTED pricing (effectiveCurviness = saturation × de-switchback flow
  // factor, the R24 convention — raw curviness would steer connectors onto
  // the switchback stacks every other ranking path already discounts)
  const eligible = segments.filter(
    (s) => BACKROAD_CLASSES.has(s.highway) && effectiveCurviness(s) >= CONNECTOR_MIN_CURVINESS,
  );
  if (eligible.length === 0) return [];

  // centroid prefilter index (exact check runs on the survivors' vertices)
  const pre = eligible.map((s) => {
    const c = s.geometry.coordinates as Array<[number, number]>;
    let sx = 0;
    let sy = 0;
    for (const p of c) {
      sx += p[0];
      sy += p[1];
    }
    const centroid: [number, number] = [sx / c.length, sy / c.length];
    // rough radius: centroid → farthest vertex (coarse but safe)
    let r2 = 0;
    for (const p of c) r2 = Math.max(r2, d2(centroid, p));
    return { s, centroid, reach: Math.sqrt(r2) };
  });

  const radius2 = radiusM * radiusM;
  const vias: ConnectorVia[] = [];
  let lastKeptAlong = -Infinity;
  /** Along-leg projection of the last KEPT via's SNAPPED point — monotonicity
   *  must hold for the inserted points themselves, not just the sample grid
   *  (review finding, confirmed: a snap can displace backward by up to
   *  radiusM; spacing ≥ 2×radius makes defaults safe, this makes it safe for
   *  every swept combination). */
  let lastKeptProjM = -Infinity;

  for (let along = endInsetM; along <= legLen - endInsetM; along += spacingM) {
    if (vias.length >= maxVias) break;
    if (along - lastKeptAlong < viaMinSepM) continue;
    // sample point at `along` (linear interpolation between vertices)
    let vi = 1;
    while (vi < cum.length && cum[vi]! < along) vi++;
    if (vi >= cum.length) break;
    const t = (along - cum[vi - 1]!) / Math.max(1e-9, cum[vi]! - cum[vi - 1]!);
    const sample: [number, number] = [
      legCoords[vi - 1]![0] + (legCoords[vi]![0] - legCoords[vi - 1]![0]) * t,
      legCoords[vi - 1]![1] + (legCoords[vi]![1] - legCoords[vi - 1]![1]) * t,
    ];

    // best snap within radius: value = priced curviness × proximity, id ties.
    // Consecutive snaps to the SAME road are deliberately ALLOWED — that is
    // the route TRACING a paralleling backroad, i.e. corridor-following
    // working (review finding, confirmed: excluding them manufactured an
    // A-B-A-B weave and left a 9 km parallel road with a single via).
    let best: { seg: CandidateSegment; point: [number, number]; value: number } | null = null;
    for (const { s, centroid, reach } of pre) {
      const centreD = Math.sqrt(d2(sample, centroid));
      if (centreD - reach > radiusM) continue; // cannot possibly be in range
      const coords = s.geometry.coordinates as Array<[number, number]>;
      let nearest: [number, number] | null = null;
      let nearestD2 = radius2;
      for (const p of coords) {
        const d = d2(sample, p);
        if (d <= nearestD2) {
          nearestD2 = d;
          nearest = p;
        }
      }
      if (nearest === null) continue;
      const proximity = 1 - Math.sqrt(nearestD2) / radiusM; // 1 at the sample, 0 at radius
      const value =
        Math.min(effectiveCurviness(s), 3) *
        (1 - 0.7 * (s.urbanShare ?? 0)) *
        (0.4 + 0.6 * proximity);
      if (
        best === null ||
        value > best.value ||
        (value === best.value && s.id.localeCompare(best.seg.id) < 0)
      ) {
        best = { seg: s, point: nearest, value };
      }
    }
    if (best === null) continue; // nothing worth steering to — leave Valhalla free here

    // monotone for the SNAPPED point: project it onto the leg and require
    // real forward progress past the previous kept via (plus: never the
    // byte-identical vertex twice)
    let projM = 0;
    {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < legCoords.length; i++) {
        const d = d2(legCoords[i]!, best.point);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      projM = cum[bi]!;
    }
    if (projM <= lastKeptProjM + 500) continue;
    const prev = vias[vias.length - 1];
    if (prev && prev.point.lng === best.point[0] && prev.point.lat === best.point[1]) continue;

    vias.push({
      point: { lng: best.point[0], lat: best.point[1] },
      segmentId: best.seg.id,
      value: Math.round(best.value * 1000) / 1000,
      alongM: Math.round(along),
    });
    lastKeptAlong = along;
    lastKeptProjM = projM;
  }
  return vias;
}

/**
 * Enrich a candidate's CONNECTOR legs with corpus-snapped vias (pure).
 * Returns null when nothing qualifies (caller skips the engine re-run).
 *
 * Span-traversal legs (startIndex→endIndex) are NEVER refined — those metres
 * are the drive, not glue. Stops' waypointIndex and spans' indices are
 * maintained through every insertion (the DROP-repair bookkeeping precedent).
 * The via count is capped so total route locations stay ≤ the engine ceiling.
 */
export function candidateWithConnectorVias(
  origin: LatLng,
  candidate: WaypointCandidate,
  routeGeometry: LineString,
  segments: readonly CandidateSegment[],
  opts: { isLoop?: boolean; destination?: LatLng } = {},
): WaypointCandidate | null {
  const isLoop = opts.isLoop ?? true;
  const coords = routeGeometry.coordinates as Array<[number, number]>;
  if (coords.length < 2 || candidate.waypoints.length === 0) return null;

  const idx = waypointVertexIndices(routeGeometry, candidate.waypoints);
  // leg k runs between boundary[k] and boundary[k+1] in vertex space and
  // inserts BEFORE waypoint index k (== appends at the end for the last leg)
  const boundaries = [0, ...idx, coords.length - 1];

  // legs inside a span traversal are the drive itself — mark them off-limits
  const spanLegs = new Set<number>();
  for (const sp of candidate.spans ?? []) {
    for (let k = sp.startIndex; k < sp.endIndex; k++) spanLegs.add(k + 1); // leg between w[k], w[k+1]
  }

  // engine ceiling: origin(+dest/origin-again) + waypoints + vias ≤ MAX
  const fixedLocations = candidate.waypoints.length + (isLoop ? 2 : 2);
  let viaBudget = CONNECTOR_MAX_LOCATIONS - fixedLocations;
  if (viaBudget <= 0) return null;

  // global separation set (review finding, confirmed): a corner waypoint can
  // otherwise collect the same corpus vertex on BOTH flanks — [P, w[k], P] —
  // which 'through' typing turns into the round-8 block-circle no detector
  // sees. Every kept via must clear every existing route location.
  const placed: Array<[number, number]> = [
    [origin.lng, origin.lat],
    ...candidate.waypoints.map((w): [number, number] => [w.lng, w.lat]),
    ...(opts.destination ? [[opts.destination.lng, opts.destination.lat] as [number, number]] : []),
  ];
  const sep2 = CONNECTOR_GLOBAL_SEP_M * CONNECTOR_GLOBAL_SEP_M;
  const clearsAll = (pt: LatLng): boolean => placed.every((q) => d2([pt.lng, pt.lat], q) >= sep2);

  const insertions: Array<{ beforeIndex: number; points: LatLng[] }> = [];
  for (let leg = 0; leg < boundaries.length - 1; leg++) {
    if (viaBudget <= 0) break;
    if (spanLegs.has(leg)) continue;
    const a = boundaries[leg]!;
    const b = boundaries[leg + 1]!;
    if (b - a < 2) continue;
    const vias = planConnectorVias(coords.slice(a, b + 1), segments, { maxVias: viaBudget });
    const points: LatLng[] = [];
    for (const v of vias) {
      if (!clearsAll(v.point)) continue;
      points.push(v.point);
      placed.push([v.point.lng, v.point.lat]);
    }
    if (points.length === 0) continue;
    viaBudget -= points.length;
    insertions.push({ beforeIndex: leg, points });
  }
  if (insertions.length === 0) return null;

  // apply insertions back-to-front so indices stay valid while splicing
  const waypoints = [...candidate.waypoints];
  const shiftAt: Array<{ at: number; by: number }> = [];
  for (const ins of [...insertions].sort((x, y) => y.beforeIndex - x.beforeIndex)) {
    const at = Math.min(ins.beforeIndex, waypoints.length);
    waypoints.splice(at, 0, ...ins.points);
    shiftAt.push({ at: ins.beforeIndex, by: ins.points.length });
  }
  const shift = (i: number): number => {
    let out = i;
    for (const s of shiftAt) if (i >= s.at) out += s.by;
    return out;
  };

  return {
    ...candidate,
    id: `${candidate.id}-cr`,
    waypoints,
    stops: candidate.stops.map((st) => ({ ...st, waypointIndex: shift(st.waypointIndex) })),
    ...(candidate.spans
      ? {
          spans: candidate.spans.map((sp) => ({
            ...sp,
            startIndex: shift(sp.startIndex),
            endIndex: shift(sp.endIndex),
          })),
        }
      : {}),
  };
}

// --- the engine half: refine one diversify-kept LOOP finalist ----------------

/**
 * Attempt corridor-following refinement on ONE finalist (the shared function
 * run.ts and eval/loop_quality.ts call IDENTICALLY — the R25-U9a shared-
 * function precedent, so production and the adoption instrument cannot
 * drift). One assembleLoop re-run, no repair passes (the candidate is already
 * repaired; repair multiplies engine calls past the latency bar).
 *
 * Acceptance INSIDE this function (identical for every caller):
 *   - the enriched candidate assembled AND passed every assembly gate;
 *   - duration ≤ CONNECTOR_MAX_DURATION_GROWTH × the current route;
 *   - measured backroad materially up (share +2 pp or longest run +250 m).
 * The caller then re-scores through its own existing path and keeps the
 * refined row only if presentKey genuinely improves — refinement can never
 * present anything the normal ranking would not have chosen.
 *
 * Cheap pre-gates: skip finalists already ≥ 50 % backroad (nothing to win)
 * and candidates that yield no vias (no engine spend at all).
 */
export async function refineLoopFinalist(
  baseUrl: string,
  origin: LatLng,
  finalist: {
    candidate: WaypointCandidate;
    route: { geometry: LineString; duration_s: number };
    classMix: { backroadShare: number } | null;
    backroadLongestM: number | null;
  },
  segments: readonly CandidateSegment[],
  assemble: (candidate: WaypointCandidate) => Promise<import('./loop').AssembledLoop>,
): Promise<import('./loop').AssembledLoop | null> {
  if ((finalist.classMix?.backroadShare ?? 0) >= 0.5) return null; // already backroad
  const enriched = candidateWithConnectorVias(
    origin,
    finalist.candidate,
    finalist.route.geometry,
    segments,
    { isLoop: true },
  );
  if (enriched === null) return null; // nothing to steer to — zero engine spend
  try {
    const a = await assemble(enriched);
    if (!a.accepted) return null;
    if (a.route.duration_s > finalist.route.duration_s * CONNECTOR_MAX_DURATION_GROWTH) return null;
    const backShare = a.classMix?.backroadShare ?? null;
    const backRun = a.backroadLongestM ?? null;
    const shareGain =
      backShare !== null && backShare >= (finalist.classMix?.backroadShare ?? 0) + 0.02;
    const runGain = backRun !== null && backRun >= (finalist.backroadLongestM ?? 0) + 250;
    if (!shareGain && !runGain) return null; // no material win — keep the original
    return a;
  } catch {
    return null; // refinement must never cost a brief its route
  }
}
