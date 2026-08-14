/**
 * Drive recorder (M9-T03..T05; FR-060..062) — PURE capture state machine.
 *
 * Foreground-only by design (spec §20.3: NO background location permission —
 * recording runs with the screen on + wake-lock). The machine filters fixes
 * so a parked car or a GPS wander doesn't fatten the trace:
 *   - accuracy gate: fixes worse than ACCURACY_MAX_M are noise, dropped;
 *   - spacing gate: a new point must move ≥ MIN_SPACING_M from the last;
 *   - hard cap: MAX_POINTS bounds memory and the /match payload (rule K).
 * The Expo watcher wiring lives in location.ts; screens consume this.
 */

import type { LatLng, Route, RouteThroughOutput } from '@shared/types';

export const ACCURACY_MAX_M = 50;
export const MIN_SPACING_M = 10;
export const MAX_POINTS = 10_000;
/** POST /match's schema cap (backend/src/routes/match.ts MAX_TRACE_POINTS).
 *  Capture may exceed it on a long drive — the trace is decimated to fit
 *  rather than rejected, so a two-hour drive still snaps. */
export const MATCH_TRACE_MAX = 5_000;

export interface RecorderState {
  status: 'idle' | 'recording' | 'stopped';
  points: LatLng[];
  /** Epoch ms at start/stop (screen-supplied — the machine stays clock-free). */
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  /** Fixes dropped by the gates — honesty counter for the review screen. */
  droppedFixes: number;
}

export const IDLE_RECORDER: RecorderState = {
  status: 'idle',
  points: [],
  startedAtMs: null,
  stoppedAtMs: null,
  droppedFixes: 0,
};

function metresBetween(a: LatLng, b: LatLng): number {
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lat - a.lat) * latM, (b.lng - a.lng) * lngM);
}

export function startRecording(nowMs: number): RecorderState {
  return { ...IDLE_RECORDER, status: 'recording', startedAtMs: nowMs };
}

export function addFix(
  s: RecorderState,
  fix: { lat: number; lng: number; accuracyM: number | null },
): RecorderState {
  if (s.status !== 'recording') return s;
  if (fix.accuracyM !== null && fix.accuracyM > ACCURACY_MAX_M) {
    return { ...s, droppedFixes: s.droppedFixes + 1 };
  }
  const last = s.points[s.points.length - 1];
  if (last && metresBetween(last, fix) < MIN_SPACING_M) {
    return { ...s, droppedFixes: s.droppedFixes + 1 };
  }
  // full — keep recording time, stop growing, but COUNT the drop (the review
  // screen's counter is called honest; silently truncating would make it lie)
  if (s.points.length >= MAX_POINTS) return { ...s, droppedFixes: s.droppedFixes + 1 };
  return { ...s, points: [...s.points, { lat: fix.lat, lng: fix.lng }] };
}

export function stopRecording(s: RecorderState, nowMs: number): RecorderState {
  if (s.status !== 'recording') return s;
  return { ...s, status: 'stopped', stoppedAtMs: nowMs };
}

/** Raw capture length (m) — pre-snap, for the live HUD only. */
export function rawDistanceM(s: RecorderState): number {
  let d = 0;
  for (let i = 1; i < s.points.length; i++) d += metresBetween(s.points[i - 1]!, s.points[i]!);
  return d;
}

export function elapsedS(s: RecorderState, nowMs: number): number {
  if (s.startedAtMs === null) return 0;
  return Math.max(0, Math.round(((s.stoppedAtMs ?? nowMs) - s.startedAtMs) / 1000));
}

/** Enough material to be worth map-matching (a parking-lot shuffle is not). */
export function canMatch(s: RecorderState): boolean {
  return whyCannotMatch(s) === null;
}

/** WHICH gate failed — so the screen can say the true reason, not a guess.
 *  (A 3 km drive under heavy tree cover can pass the distance gate and fail
 *  the point-count one; telling that driver "under 500 m" is a lie.) */
export function whyCannotMatch(s: RecorderState): 'too_few_points' | 'too_short' | null {
  if (s.points.length < 8) return 'too_few_points';
  if (rawDistanceM(s) < 500) return 'too_short';
  return null;
}

/**
 * The captured trace, decimated to what POST /match accepts. Uniform sampling
 * keeps the drive's whole shape (endpoints included) instead of truncating it
 * to the first 5,000 points, which would silently amputate the drive home.
 */
export function traceForMatch(s: RecorderState, max = MATCH_TRACE_MAX): LatLng[] {
  const pts = s.points;
  if (pts.length <= max || max < 2) return [...pts];
  const out: LatLng[] = [];
  const step = (pts.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]!);
  return out;
}

const LOOP_CLOSE_M = 300;

/**
 * Shape the MATCHED result into a saveable Route (FR-062): origin_type
 * 'recorded', private by default, duration = the REAL recorded wall time
 * (the drive as driven — not the engine's estimate), distance from the snap.
 */
export function toRecordedRoute(matched: RouteThroughOutput, s: RecorderState): Route {
  const first = s.points[0];
  const last = s.points[s.points.length - 1];
  const isLoop = !!first && !!last && metresBetween(first, last) < LOOP_CLOSE_M;
  return {
    geometry: matched.geometry,
    is_loop: isLoop,
    waypoints: first && last ? [first, last] : [],
    distance_m: matched.distance_m,
    duration_s: elapsedS(s, s.stoppedAtMs ?? 0),
    curviness: 0,
    elevation_profile: null,
    climb_m: null,
    highway_flag: matched.has_highway,
    toll_flag: matched.has_toll,
    ferry_flag: matched.has_ferry,
    unpaved_flag: matched.has_unpaved,
    character_tags: [],
    intensity: 'chill',
    free_tags: [],
    visibility: 'private',
    owner_id: null,
    origin_type: 'recorded',
    forked_from: null,
    generation_request_id: null,
    satisfied_constraints: null,
    stops: [],
  } as Route;
}
