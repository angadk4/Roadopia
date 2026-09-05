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
 * Guidance source (device pass 2026-09-04): a route now CARRIES the engine's
 * maneuvers for its exact geometry (planner / /route / /match at serve time,
 * persisted by 0031), so the screen anchors them directly. Rows saved before
 * that column exist: for those the screen re-derives turns by map-matching
 * the saved line and anchors each matched turn onto our line BY POSITION
 * (anchorsFromMatched) — a matcher shortcut drops the turns inside it, not
 * the whole set. `matchAgrees` remains as the older whole-set check. Either
 * way, when guidance cannot be trusted follow-mode runs with position +
 * remaining distance and SAYS so — wrong turn instructions are worse than none.
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

/** Segments beyond this far ahead of known progress are searched only when
 *  nothing nearer fits — bounds the per-fix work on a 10k-vertex line. */
const WINDOW_AHEAD_M = 2000;

/** Index of the last vertex whose cumulative distance is ≤ d (binary search). */
function vertexAt(cumM: number[], d: number): number {
  let lo = 0;
  let hi = cumM.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumM[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Two passes over segments [from, to): the nearest distance first, then the
 * few candidates within AMBIGUITY_SLACK_M of it. No per-segment allocation
 * (the old single pass built one object per segment per GPS fix — GC churn
 * at 1 Hz on a long line).
 */
function scan(
  track: FollowTrack,
  fix: LatLng,
  from: number,
  to: number,
  lastAlongM: number | null,
): TrackLocation | null {
  const { points, cumM } = track;
  let bestDist = Infinity;
  for (let i = from; i < to; i++) {
    const { distM } = projectOnSegment(fix, points[i]!, points[i + 1]!);
    if (distM < bestDist) bestDist = distM;
  }
  if (bestDist === Infinity) return null;
  // A LOOP's first and last vertex are the same point, so a driver sitting at
  // the origin projects equally well onto metre 0 and metre 34,890 — and GPS
  // noise decides which. Treating "no progress yet" as progress 0 (rather than
  // as no constraint at all) makes the earliest candidate win, so a loop starts
  // at its start instead of announcing itself finished before departure.
  const floor = (lastAlongM ?? 0) - BACKTRACK_TOLERANCE_M;
  let forward: TrackLocation | null = null;
  let nearest: TrackLocation | null = null;
  for (let i = from; i < to; i++) {
    const { distM, frac } = projectOnSegment(fix, points[i]!, points[i + 1]!);
    if (distM > bestDist + AMBIGUITY_SLACK_M) continue;
    const alongM = cumM[i]! + frac * (cumM[i + 1]! - cumM[i]!);
    if (nearest === null || distM < nearest.offTrackM) nearest = { alongM, offTrackM: distM };
    if (alongM >= floor && (forward === null || alongM < forward.alongM)) {
      forward = { alongM, offTrackM: distM };
    }
  }
  return forward ?? nearest;
}

/**
 * Project a fix onto the track. `lastAlongM` biases ambiguous projections
 * (overlapping stem legs) toward continuing forward from known progress, and
 * bounds the search to a window around it — the full line is scanned only
 * when nothing within the window is on-route (a big jump, or a rejoin).
 */
export function locateOnTrack(
  track: FollowTrack,
  fix: LatLng,
  lastAlongM: number | null,
): TrackLocation {
  const segments = track.points.length - 1;
  if (segments < 1) return { alongM: 0, offTrackM: Infinity }; // <2 points: no track to be on
  if (lastAlongM !== null) {
    const from = vertexAt(track.cumM, lastAlongM - BACKTRACK_TOLERANCE_M);
    const to = Math.min(segments, vertexAt(track.cumM, lastAlongM + WINDOW_AHEAD_M) + 1);
    const near = scan(track, fix, from, to, lastAlongM);
    if (near !== null && near.offTrackM <= OFF_ROUTE_M) return near;
  }
  return scan(track, fix, 0, segments, lastAlongM) ?? { alongM: 0, offTrackM: Infinity };
}

export interface FollowHint {
  instruction: string;
  inM: number;
}

export interface FollowStatus {
  alongM: number;
  remainingM: number;
  offRoute: boolean;
  /** Next turn ahead; null = none known (end of drive, or no guidance). */
  hint: FollowHint | null;
  /** The turn after that ("then …"), so a quick double turn is not a surprise. */
  then: FollowHint | null;
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
  const nextIdx = track.anchors.findIndex((a) => a.atM > alongM + 10);
  const next = nextIdx >= 0 ? track.anchors[nextIdx] : undefined;
  const after = nextIdx >= 0 ? track.anchors[nextIdx + 1] : undefined;
  const done =
    remainingM <= DONE_WITHIN_M &&
    lastAlongM !== null &&
    lastAlongM >= track.totalM * DONE_MIN_PROGRESS;
  const toHint = (a: ManeuverAnchor | undefined): FollowHint | null =>
    a && !offRoute ? { instruction: a.instruction, inM: a.atM - alongM } : null;
  return {
    alongM,
    remainingM,
    offRoute,
    hint: toHint(next),
    then: toHint(after),
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

// ---- device pass 2026-09-04: guidance travels with the route; these serve
// ---- the legacy fallback, the map split and the arrival estimate.

/** The point `d` metres along the track (clamped to the ends). */
export function pointAtDistance(track: Pick<FollowTrack, 'points' | 'cumM'>, d: number): LatLng {
  const { points, cumM } = track;
  const first = points[0];
  if (!first) return { lat: 0, lng: 0 };
  if (d <= 0) return first;
  const last = points[points.length - 1]!;
  if (d >= cumM[cumM.length - 1]!) return last;
  const i = vertexAt(cumM, d);
  const a = points[i]!;
  const b = points[i + 1] ?? a;
  const seg = cumM[i + 1]! - cumM[i]!;
  const f = seg > 0 ? (d - cumM[i]!) / seg : 0;
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

export interface DerivedGuidance {
  anchors: ManeuverAnchor[];
  /** Turns that landed on the followed line, in order. */
  kept: number;
  /** Turns the matcher reported (excluding the origin 'start'). */
  total: number;
}

/**
 * LEGACY rows only (saved before maneuvers travelled with the route): anchor
 * the matcher's turns onto OUR line by POSITION, not by cumulative distance.
 * Each maneuver's start is walked along the MATCHED line, that point is
 * projected onto the followed line (monotonically), and it is kept when it
 * lands on the line, in order. A shortcut the matcher took drops only the
 * turns inside it — where the old length-agreement gate refused the whole
 * set, so a loop (whose retraced stem the matcher always shortcuts) had no
 * guidance at all.
 */
/**
 * Every projection of `p` within AMBIGUITY_SLACK_M of the nearest one — the
 * candidates a retraced stem produces — resolved by closeness to where the
 * MATCHED line says the turn should be. (Choosing the earliest-forward one,
 * as live tracking does, pinned a homebound turn onto the outbound copy of
 * the stem whenever the turns between them had been dropped — review finding.)
 */
function nearestToExpected(track: FollowTrack, p: LatLng, expectedM: number): TrackLocation | null {
  const { points, cumM } = track;
  const segments = points.length - 1;
  if (segments < 1) return null;
  let bestDist = Infinity;
  for (let i = 0; i < segments; i++) {
    const { distM } = projectOnSegment(p, points[i]!, points[i + 1]!);
    if (distM < bestDist) bestDist = distM;
  }
  if (bestDist === Infinity) return null;
  let pick: TrackLocation | null = null;
  for (let i = 0; i < segments; i++) {
    const { distM, frac } = projectOnSegment(p, points[i]!, points[i + 1]!);
    if (distM > bestDist + AMBIGUITY_SLACK_M) continue;
    const alongM = cumM[i]! + frac * (cumM[i + 1]! - cumM[i]!);
    if (pick === null || Math.abs(alongM - expectedM) < Math.abs(pick.alongM - expectedM)) {
      pick = { alongM, offTrackM: distM };
    }
  }
  return pick;
}

export function anchorsFromMatched(
  track: FollowTrack,
  matched: LineString,
  maneuvers: Maneuver[],
): DerivedGuidance {
  const along = buildFollowTrack(matched, []);
  // matched metres → our metres (a matcher that shortcut the loop measures
  // it shorter; the scale spreads the difference over the whole line)
  const scale = along.totalM > 0 && track.totalM > 0 ? track.totalM / along.totalM : 1;
  const anchors: ManeuverAnchor[] = [];
  let runM = 0;
  let last: number | null = null;
  let lastStartM = 0;
  let total = 0;
  for (const m of maneuvers) {
    const startM = runM;
    runM += m.distance_m ?? 0;
    if (startM <= 0 || m.instruction.trim() === '') continue; // the origin 'start' is not a turn
    total += 1;
    // where this turn should fall on OUR line: the last kept anchor advanced
    // by the matched distance since it
    const expected = last === null ? startM * scale : last + (startM - lastStartM) * scale;
    const loc = nearestToExpected(track, pointAtDistance(along, startM), expected);
    if (loc === null || loc.offTrackM > OFF_ROUTE_M) continue;
    if (last !== null && loc.alongM <= last) continue; // never two turns at one spot
    anchors.push({ atM: loc.alongM, instruction: m.instruction });
    last = loc.alongM;
    lastStartM = startM;
  }
  return { anchors, kept: anchors.length, total };
}

/** Below this share of the matcher's turns, derived guidance is refused. */
export const DERIVED_MIN_KEPT_FRAC = 0.5;

export function derivedGuidanceUsable(d: DerivedGuidance): boolean {
  return d.total > 0 && d.kept / d.total >= DERIVED_MIN_KEPT_FRAC;
}

/**
 * The line split at progress: the part driven and the part ahead. Either is
 * null when it would have fewer than two vertices (a LineString needs two).
 */
export function splitAtAlong(
  track: FollowTrack,
  alongM: number,
): { behind: LineString | null; ahead: LineString | null } {
  const { points, cumM } = track;
  if (points.length < 2) return { behind: null, ahead: null };
  const cut = pointAtDistance(track, alongM);
  const cutC: [number, number] = [cut.lng, cut.lat];
  let i = 0;
  while (i < cumM.length && cumM[i]! < alongM) i++; // first vertex at/after the cut
  const toC = (p: LatLng): [number, number] => [p.lng, p.lat];
  const behind = [...points.slice(0, i).map(toC), cutC];
  const ahead = [cutC, ...points.slice(i).map(toC)];
  // a LineString needs two DISTINCT vertices — at either end one side
  // collapses to the cut point twice over
  const lineOrNull = (c: Array<[number, number]>): LineString | null => {
    if (c.length < 2) return null;
    if (c.length === 2 && c[0]![0] === c[1]![0] && c[0]![1] === c[1]![1]) return null;
    return { type: 'LineString', coordinates: c };
  };
  return { behind: lineOrNull(behind), ahead: lineOrNull(ahead) };
}

/**
 * Time left, in seconds: the route's own measured pace, refined by the last
 * few observed ground rates once the car is actually moving. Shown only as a
 * duration ("about 1 h 20 min left") — never as a rate (Hard rule D).
 */
export function etaSeconds(
  remainingM: number,
  recentMps: number[],
  routeDistanceM: number,
  routeDurationS: number,
): number | null {
  const moving = recentMps.filter((v) => v > 1);
  const observed = moving.length >= 3 ? moving.reduce((a, b) => a + b, 0) / moving.length : null;
  const planned = routeDistanceM > 0 && routeDurationS > 0 ? routeDistanceM / routeDurationS : null;
  const v = observed ?? planned;
  if (v === null || !(v > 0)) return null;
  return remainingM / v;
}

/** "12 min" / "1 h 20 min" / "2 h". */
export function fmtDuration(s: number): string {
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
