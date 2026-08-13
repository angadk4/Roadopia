import type { RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  addWaypoint,
  canRoute,
  closeLoop,
  EMPTY_BUILDER,
  MAX_WAYPOINTS,
  statsLine,
  toManualRoute,
  undoWaypoint,
} from '../builder';

/** M9-T01/T02 — the pure builder core (FR-050..053). */

const SNAPPED = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.9, 43.2],
      [-79.89, 43.21],
    ],
  },
  distance_m: 42_000,
  duration_s: 51 * 60,
  legs: [],
  maneuvers: [],
  has_highway: false,
  has_toll: false,
  has_ferry: true,
  has_unpaved: false,
} as unknown as RouteThroughOutput;

describe('builder state', () => {
  it('adds, undoes, refuses duplicates and enforces the cap', () => {
    let s = addWaypoint(EMPTY_BUILDER, { lat: 43.2, lng: -79.9 });
    s = addWaypoint(s, { lat: 43.2, lng: -79.9 }); // duplicate tap — no-op
    expect(s.waypoints).toHaveLength(1);
    s = addWaypoint(s, { lat: 43.21, lng: -79.89 });
    expect(canRoute(s)).toBe(true);
    s = undoWaypoint(s);
    expect(canRoute(s)).toBe(false);
    for (let i = 0; i < MAX_WAYPOINTS + 5; i++) {
      s = addWaypoint(s, { lat: 43.2 + i * 0.01, lng: -79.9 });
    }
    expect(s.waypoints.length).toBe(MAX_WAYPOINTS);
  });

  it('closeLoop appends the first point (and needs ≥2 points)', () => {
    let s = addWaypoint(EMPTY_BUILDER, { lat: 43.2, lng: -79.9 });
    expect(closeLoop(s).waypoints).toHaveLength(1); // too few — unchanged
    s = addWaypoint(s, { lat: 43.3, lng: -79.8 });
    const closed = closeLoop(s);
    expect(closed.waypoints).toHaveLength(3);
    expect(closed.waypoints[2]).toEqual(closed.waypoints[0]);
  });
});

describe('toManualRoute', () => {
  const A = { lat: 43.2, lng: -79.9 };
  const B = { lat: 43.3, lng: -79.8 };

  it('marks a closed ring as a loop, an open path not', () => {
    expect(toManualRoute(SNAPPED, [A, B, A]).is_loop).toBe(true);
    expect(toManualRoute(SNAPPED, [A, B]).is_loop).toBe(false);
  });

  it('is honest: manual origin, no AI provenance, unmeasured curviness, private', () => {
    const r = toManualRoute(SNAPPED, [A, B]);
    expect(r.origin_type).toBe('manual');
    expect(r.generation_request_id).toBeNull();
    expect(r.curviness).toBe(0);
    expect(r.visibility).toBe('private');
    expect(r.ferry_flag).toBe(true); // flags come from the SNAP, not defaults
  });
});

describe('statsLine', () => {
  it('reads like a human line and handles the empty state', () => {
    expect(statsLine(SNAPPED)).toBe('42 km · 51 min');
    expect(statsLine(null)).toContain('two points');
  });
});
