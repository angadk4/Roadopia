/**
 * R30 (BD-146) — the owner's words as HARD GATES on the whole trip AS DRIVEN.
 *
 * History this encodes: R29 shipped trips judged on the DRIVE leg only
 * (BD-135 "the ask means the drive"). Measured from the owner's own two areas
 * (rq30, 36 production routes): 36/36 exceeded the ask beyond the audit's own
 * 25 % tolerance ("1 hour" → 106 min mean), commute was 44 % of distance,
 * whole-trip loopiness averaged 0.14 against the 0.25 bar every CORE must
 * pass, mean 3 spur stubs per trip at the leg joins, mean longest doubled run
 * 7.3 km. The owner drove it and said exactly that, in order. BD-146: the ask
 * means the TRIP; these bars REJECT a candidate — nothing here is a
 * disclosure.
 *
 * Bars reuse the planner's own standards wherever one exists, so "the trip
 * must be as clean as the things we already reject for being dirty" is
 * literal: loopiness ≥ CORE_LOOPINESS_MIN (what every stored core passes),
 * doubling ≤ OUT_AND_BACK_REJECT_M (what every legacy blob loop is rejected
 * at), spur/microloop = 0 (what judgeCore hard-rejects cores for).
 */
import type { LineString } from '@shared/types';

import { CORE_LOOPINESS_MIN } from './core_bars';
import { OUT_AND_BACK_REJECT_M } from './loop';
import { outAndBack } from './outandback';
import { loopiness, microloopPositions, spurPositions, SPUR_WINDOW_WIDE_STEPS } from './overlap';

/** Trip duration may miss the ask by this fraction — the same 25 % the audit
 *  has always called `wrong_length` (it was just aimed at the wrong number). */
export const TRIP_DURATION_TOL = Number(process.env['TRIP_DURATION_TOL'] ?? 0.25);
/** R34-U8 (Recovery §11): the EXACT band — inside ±15 % is the requested
 *  product; a clean trip outside it serves as an honest ALTERNATE duration,
 *  never as a silent miss. */
export const TRIP_EXACT_BAND = Number(process.env['TRIP_EXACT_BAND'] ?? 0.15);
/** "Loops should look like loops" = THE DRIVE looks like a loop (the ring on
 *  the map), judged at the core bar. The whole trip CANNOT hit a pure-loop
 *  isoperimetric score from a distant origin — two clean 11 km spokes on a
 *  perfect ring score 0.21 by geometry alone — and the owner explicitly asked
 *  for get-there/get-home spokes. The spokes have their own gates instead
 *  (different roads, no doubling, no stubs, bounded commute share). */
export const TRIP_LOOPINESS_MIN = CORE_LOOPINESS_MIN;
/** Longest same-road doubled run across the WHOLE trip ("no same roads twice
 *  unless absolutely necessary") — the legacy loop reject bar. */
export const TRIP_OAB_MAX_M = OUT_AND_BACK_REJECT_M;
/** Spur/microloop grace only within sight of the driver's own driveway. The
 *  shipped 2 500 m ORIGIN_GRACE hid the owner's whole subdivision. */
export const TRIP_SPUR_GRACE_M = Number(process.env['TRIP_SPUR_GRACE_M'] ?? 500);
/** Doubling within this of the origin is the driver's own subdivision
 *  entrance — often the ONLY road in/out, i.e. the owner's "unless absolutely
 *  necessary" case (measured: 863 m shared entrance at Southfields). Doubling
 *  beyond it is never necessary and still rejects. */
export const TRIP_OAB_ORIGIN_GRACE_M = Number(process.env['TRIP_OAB_ORIGIN_GRACE_M'] ?? 1000);
/** The commute must not out-weigh the drive (by TIME). */
export const TRIP_COMMUTE_SHARE_MAX = Number(process.env['TRIP_COMMUTE_SHARE_MAX'] ?? 0.5);
/** Out and home connectors must be substantially DIFFERENT roads. */
export const TRIP_CONNECTOR_OVERLAP_MAX = Number(process.env['TRIP_CONNECTOR_OVERLAP_MAX'] ?? 0.2);
/** A connector must not ride the core's own road (the join u-turn stubs). */
export const TRIP_CORE_OVERLAP_MAX = Number(process.env['TRIP_CORE_OVERLAP_MAX'] ?? 0.1);

export interface TripMetrics {
  durationS: number;
  targetS: number;
  /** THE DRIVE's loopiness: the routed arc closed by its J2→J1 chord (null =
   *  degenerate geometry). See TRIP_LOOPINESS_MIN. */
  loopiness: number | null;
  oabLongestM: number;
  spurs: number;
  microloops: number;
  /** BD-161/164: self-crossings. knots = short-enclosure or clustered;
   *  pierces = far/spaced. BOTH are zero-tolerance on served loops (BD-164:
   *  a figure-eight with big lobes is one "pierce" — and it is not a loop);
   *  the split survives for diagnostics/audit only. */
  knots: number;
  pierces: number;
  /** U-turn maneuvers in the routed trip (cores are u-turn-free offline; a
   *  connector adding one is a defect — v21 caught 1 on a served exact). */
  uturns: number;
  /** (out + home) / total, by time. */
  commuteShare: number;
  outHomeOverlap: number;
  outCoreOverlap: number;
  homeCoreOverlap: number;
}

export interface TripVerdict {
  pass: boolean;
  failures: string[];
}

/** Measure the as-driven metrics the gates need (geometry-side only — the
 *  duration/overlap fields come from the builder, which has the real legs). */
/** Close an open drive arc with its end→start chord and measure loopiness —
 *  "does the DRIVE look like a loop on the map". */
export function driveClosedLoopiness(drive: LineString): number | null {
  const c = drive.coordinates as Array<[number, number]>;
  if (c.length < 4) return null;
  return loopiness({ type: 'LineString', coordinates: [...c, c[0]!] });
}

export function tripShapeMetrics(
  geometry: LineString,
  origin: { lat: number; lng: number },
  opts: { oabGraceM?: number } = {},
): Pick<TripMetrics, 'oabLongestM' | 'spurs' | 'microloops'> {
  // Doubling: longest run OUTSIDE the origin grace — the shared subdivision
  // entrance is necessity, not defect (TRIP_OAB_ORIGIN_GRACE_M).
  const rad = Math.PI / 180;
  const farM = (p: [number, number]): number => {
    const dLat = (p[1] - origin.lat) * 111_320;
    const dLng = (p[0] - origin.lng) * 111_320 * Math.cos(origin.lat * rad);
    return Math.hypot(dLat, dLng);
  };
  const oab = outAndBack(geometry);
  const longestAway = oab.runs
    // R35-U11: the grace is the MEASURED unavoidable stem when provided —
    // necessity proven by the network, not assumed by a radius.
    .filter((r) => farM(r.point) > (opts.oabGraceM ?? TRIP_OAB_ORIGIN_GRACE_M))
    .reduce((m, r) => Math.max(m, r.lengthM), 0);
  return {
    oabLongestM: longestAway,
    spurs: spurPositions(geometry, origin, TRIP_SPUR_GRACE_M, SPUR_WINDOW_WIDE_STEPS).length,
    microloops: microloopPositions(geometry, origin, TRIP_SPUR_GRACE_M).length,
  };
}

/** The owner's standard, applied. Every failure is named so the trace and the
 *  audit can say WHY a candidate was rejected. */
/** R34-U8: duration becomes a SERVING TIER, not only a reject — the builder
 *  judges cleanliness with `durationTol: Infinity` and classifies the band
 *  itself (exact vs alternate). Default keeps the historical reject
 *  behaviour for every other caller and test. */
export function judgeTrip(m: TripMetrics, opts: { durationTol?: number } = {}): TripVerdict {
  const durationTol = opts.durationTol ?? TRIP_DURATION_TOL;
  const failures: string[] = [];
  // R32-U3 invariant: NaN compares false against EVERY threshold, so a
  // non-finite duration would silently pass this gate. Non-finite = fail.
  if (
    !Number.isFinite(m.durationS) ||
    Math.abs(m.durationS - m.targetS) / m.targetS > durationTol
  ) {
    failures.push('trip_duration');
  }
  if (m.loopiness === null || m.loopiness < TRIP_LOOPINESS_MIN) failures.push('not_a_loop');
  if (m.oabLongestM > TRIP_OAB_MAX_M) failures.push('doubling');
  if (m.spurs > 0) failures.push('spurs');
  if (m.microloops > 0) failures.push('microloops');
  // BD-164 (owner, device ×2): a loop is a SIMPLE CLOSED CURVE. The "pierce
  // tolerance" (BD-161/162) allowed single-crossing figure-eights with big
  // lobes — the bowtie he photographed. Zero self-crossings of ANY kind on a
  // served loop. (Origin grace ≤500 m remains: a driveway crossover is
  // invisible at map zoom; everything else is not a loop.)
  if (m.knots + m.pierces > 0) failures.push('self_crossing');
  if (m.uturns > 0) failures.push('uturn');
  if (m.commuteShare > TRIP_COMMUTE_SHARE_MAX) failures.push('commute_majority');
  if (m.outHomeOverlap > TRIP_CONNECTOR_OVERLAP_MAX) failures.push('same_way_home');
  if (m.outCoreOverlap > TRIP_CORE_OVERLAP_MAX || m.homeCoreOverlap > TRIP_CORE_OVERLAP_MAX) {
    failures.push('connector_rides_core');
  }
  return { pass: failures.length === 0, failures };
}
