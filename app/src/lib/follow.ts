/**
 * Follow-mode core (M9-T06; FR-110..112) — PURE geometry, no React, no I/O.
 *
 * A FollowTrack precomputes cumulative distance along the served polyline and
 * anchors each Valhalla maneuver at its start-distance (a maneuver's
 * `distance_m` is the length it covers, so starts are the running sum).
 * Locating a fix projects it onto the nearest segment — with a monotonic bias
 * so the overlapping stem of a loop (the unavoidable-origin law means loops
 * legitimately retrace their first minutes) resolves to the outbound leg
 * early and the homebound leg late, instead of teleporting progress.
 *
 * Honesty rule for derived guidance: saved routes carry no maneuvers, so the
 * screen re-derives them by map-matching the saved line through /match. Those
 * hints are only trusted when the match reconstructs essentially the same
 * route (length within MATCH_AGREE_FRAC); otherwise follow-mode runs with
 * position + remaining distance and SAYS guidance is unavailable — wrong
 * turn instructions are worse than none.
 */

import type { LatLng, LineString, Maneuver } from '@shared/types';

/** A fix farther than this from the line is off-route (FR-110 honesty). */
export const OFF_ROUTE_M = 75;
/** Derived maneuvers are trusted only if match length agrees within this. */
export const MATCH_AGREE_FRAC = 0.1;
/** Trace points sent to /match when deriving guidance (server cap is 5000). */
export const DERIVE_TRACE_MAX = 1500;
/** Within this of the end (having driven most of it) the drive is done. */
const DONE_WITHIN_M = 60;
const DONE_MIN_PROGRESS = 0.8;
/** Stem bias: candidates this close to the best projection compete on along. */
const AMBIGUITY_SLACK_M = 25;
/** Progress may not jump backwards more than this when resolving ambiguity. */
const BACKTRACK_TOLERANCE_M = 150;

const LAT_M = 111_320;

function metresBetween(a: LatLng, b: LatLng): number {
  const lngM = LAT_M * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lat - a.lat) * LAT_M, (b.lng - a.lng) * lngM);
}

export interface ManeuverAnchor {
  /** Distance along the track (m) where this maneuver begins. */
  atM: number;
  instruction: string;
}

export interface FollowTrack {
  points: LatLng[];
  /** Cumulative distance (m) at each vertex; last entry = total length. */
  cumM: number[];
  totalM: number;
  /** Anchored turn hints, in track order; [] = guidance unavailable. */
  anchors: ManeuverAnchor[];
}

export function buildFollowTrack(geometry: LineString, maneuvers: Maneuver[]): FollowTrack {
  const points: LatLng[] = geometry.coordinates.map((c) => ({ lat: c[1]!, lng: c[0]! }));
  const cumM: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumM.push(cumM[i - 1]! + metresBetween(points[i - 1]!, points[i]!));
  }
  const totalM = cumM[cumM.length - 1] ?? 0;

  // Maneuver starts = running sum of covered distances, scaled onto OUR line
  // (engine lengths and polyline lengths drift a few %; hints are "in ~800 m",
  // so proportional placement is the honest anchor).
  const anchors: ManeuverAnchor[] = [];
  const engineTotal = maneuvers.reduce((s, m) => s + (m.distance_m ?? 0), 0);
  if (engineTotal > 0 && totalM > 0) {
    let runM = 0;
    for (const m of maneuvers) {
      // 'start'-type instructions at 0 are not turns; skip anchors at the origin
      if (runM > 0 && m.instruction.trim() !== '') {
        anchors.push({ atM: (runM / engineTotal) * totalM, instruction: m.instruction });
      }
      runM += m.distance_m ?? 0;
    }
  }
  return { points, cumM, totalM, anchors };
}

export interface TrackLocation {
  /** Progress along the track (m). */
  alongM: number;
  /** Perpendicular distance from the track (m). */
  offTrackM: number;
}

function projectOnSegment(p: LatLng, a: LatLng, b: LatLng): { distM: number; frac: number } {
  const lngM = LAT_M * Math.cos((a.lat * Math.PI) / 180);
  const ax = a.lng * lngM;
  const ay = a.lat * LAT_M;
  const bx = b.lng * lngM;
  const by = b.lat * LAT_M;
  const px = p.lng * lngM;
  const py = p.lat * LAT_M;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const frac = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { distM: Math.hypot(px - (ax + frac * dx), py - (ay + frac * dy)), frac };
}

/**
 * Project a fix onto the track. `lastAlongM` biases ambiguous projections
 * (overlapping stem legs) toward continuing forward from known progress.
 */
export function locateOnTrack(
  track: FollowTrack,
  fix: LatLng,
  lastAlongM: number | null,
): TrackLocation {
  let bestDist = Infinity;
  const candidates: TrackLocation[] = [];
  for (let i = 1; i < track.points.length; i++) {
    const a = track.points[i - 1]!;
    const b = track.points[i]!;
    const { distM, frac } = projectOnSegment(fix, a, b);
    if (distM < bestDist) bestDist = distM;
    candidates.push({
      alongM: track.cumM[i - 1]! + frac * (track.cumM[i]! - track.cumM[i - 1]!),
      offTrackM: distM,
    });
  }
  const near = candidates.filter((c) => c.offTrackM <= bestDist + AMBIGUITY_SLACK_M);
  if (lastAlongM !== null) {
    const forward = near.filter((c) => c.alongM >= lastAlongM - BACKTRACK_TOLERANCE_M);
    if (forward.length > 0) {
      return forward.reduce((m, c) => (c.alongM < m.alongM ? c : m));
    }
  }
  return near.reduce((m, c) => (c.offTrackM < m.offTrackM ? c : m), near[0]!);
}

export interface FollowStatus {
  alongM: number;
  remainingM: number;
  offRoute: boolean;
  /** Next turn ahead; null = none known (end of drive, or no guidance). */
  hint: { instruction: string; inM: number } | null;
  done: boolean;
}

export function followStatus(
  track: FollowTrack,
  fix: LatLng,
  lastAlongM: number | null,
): FollowStatus {
  const loc = locateOnTrack(track, fix, lastAlongM);
  const offRoute = loc.offTrackM > OFF_ROUTE_M;
  // Off-route fixes keep the last known progress — remaining distance must
  // not swing while the driver is in a parking lot beside the line.
  const alongM = offRoute && lastAlongM !== null ? lastAlongM : loc.alongM;
  const remainingM = Math.max(0, track.totalM - alongM);
  const next = track.anchors.find((a) => a.atM > alongM + 10);
  const done =
    remainingM <= DONE_WITHIN_M &&
    lastAlongM !== null &&
    lastAlongM >= track.totalM * DONE_MIN_PROGRESS;
  return {
    alongM,
    remainingM,
    offRoute,
    hint: next && !offRoute ? { instruction: next.instruction, inM: next.atM - alongM } : null,
    done,
  };
}

/** Uniform decimation of the served line into a /match trace (≤ max points). */
export function decimateForMatch(geometry: LineString, max = DERIVE_TRACE_MAX): LatLng[] {
  const coords = geometry.coordinates;
  if (coords.length <= max) return coords.map((c) => ({ lat: c[1]!, lng: c[0]! }));
  const out: LatLng[] = [];
  const step = (coords.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const c = coords[Math.round(i * step)]!;
    out.push({ lat: c[1]!, lng: c[0]! });
  }
  return out;
}

/**
 * Are derived maneuvers trustworthy for THIS line? True only when the matched
 * length agrees with the followed line's length within MATCH_AGREE_FRAC.
 */
export function matchAgrees(trackTotalM: number, matchedDistanceM: number): boolean {
  if (trackTotalM <= 0 || matchedDistanceM <= 0) return false;
  return Math.abs(matchedDistanceM - trackTotalM) / trackTotalM <= MATCH_AGREE_FRAC;
}

const KM_UNDER = 1000;

/** "780 m" / "12.4 km" — hint + remaining formatting. */
export function fmtDistance(m: number): string {
  if (m < KM_UNDER) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
