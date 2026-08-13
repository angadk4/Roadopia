/**
 * Manual route builder (M9-T01/T02; FR-050..053) — PURE state + conversions.
 *
 * The interaction is the crosshair pattern (PickPointScreen precedent): pan,
 * add the centre as a waypoint; ≥2 waypoints route through POST /route (the
 * SNAP is the product — hand-built routes still follow real roads, §21).
 * This module owns everything node-testable: waypoint list ops, the request,
 * and shaping the snapped result into a saveable Route (origin_type='manual').
 */

import type { LatLng, Route, RouteThroughOutput } from '@shared/types';

export interface BuilderState {
  waypoints: LatLng[];
}

export const EMPTY_BUILDER: BuilderState = { waypoints: [] };

/** Spec cap (FR-050): enough for any hand-built drive, bounded for the wire. */
export const MAX_WAYPOINTS = 25;

export function addWaypoint(s: BuilderState, p: LatLng): BuilderState {
  if (s.waypoints.length >= MAX_WAYPOINTS) return s;
  const last = s.waypoints[s.waypoints.length - 1];
  // a double-tap on the same spot is a no-op, not a zero-length leg
  if (last && Math.abs(last.lat - p.lat) < 1e-6 && Math.abs(last.lng - p.lng) < 1e-6) return s;
  return { waypoints: [...s.waypoints, p] };
}

export function undoWaypoint(s: BuilderState): BuilderState {
  return { waypoints: s.waypoints.slice(0, -1) };
}

export function clearWaypoints(): BuilderState {
  return EMPTY_BUILDER;
}

/** Routing needs two ends; the UI disables the call below this. */
export function canRoute(s: BuilderState): boolean {
  return s.waypoints.length >= 2;
}

/** Close the loop: append the first point as the final waypoint (FR-051). */
export function closeLoop(s: BuilderState): BuilderState {
  const first = s.waypoints[0];
  if (!first || s.waypoints.length < 2) return s;
  return addWaypoint(s, first);
}

const LOOP_CLOSE_M = 300;

function metresBetween(a: LatLng, b: LatLng): number {
  const latM = 111_320;
  const lngM = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lat - a.lat) * latM, (b.lng - a.lng) * lngM);
}

/**
 * Shape a snapped /route result into a saveable Route. Honest fields only:
 * curviness 0 (unmeasured here — never a claimed number), no AI provenance,
 * origin_type 'manual', private by default (the server enforces both anyway).
 */
export function toManualRoute(snapped: RouteThroughOutput, waypoints: LatLng[]): Route {
  const isLoop =
    waypoints.length >= 3 &&
    metresBetween(waypoints[0]!, waypoints[waypoints.length - 1]!) < LOOP_CLOSE_M;
  return {
    geometry: snapped.geometry,
    is_loop: isLoop,
    waypoints,
    distance_m: snapped.distance_m,
    duration_s: snapped.duration_s,
    curviness: 0,
    elevation_profile: null,
    climb_m: null,
    highway_flag: snapped.has_highway,
    toll_flag: snapped.has_toll,
    ferry_flag: snapped.has_ferry,
    unpaved_flag: snapped.has_unpaved,
    character_tags: [],
    intensity: 'chill',
    free_tags: [],
    visibility: 'private',
    owner_id: null,
    origin_type: 'manual',
    forked_from: null,
    generation_request_id: null,
    satisfied_constraints: null,
    stops: [],
  } as Route;
}

/** "42 km · 51 min" — the live stats line under the map (FR-051). */
export function statsLine(snapped: RouteThroughOutput | null): string {
  if (!snapped) return 'Add at least two points to route';
  const km = (snapped.distance_m / 1000).toFixed(snapped.distance_m >= 10_000 ? 0 : 1);
  const min = Math.round(snapped.duration_s / 60);
  return `${km} km · ${min} min`;
}
