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
  if (s.points.length >= MAX_POINTS) return s; // full — keep recording time, stop growing
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
  return s.points.length >= 8 && rawDistanceM(s) >= 500;
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
