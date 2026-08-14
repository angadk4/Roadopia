import type { Route } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  appleDirectionsUrl,
  buildGoogleLoopUrl,
  buildHandoffOptions,
  googleDirectionsUrl,
  GOOGLE_WAYPOINT_CAP,
  sampleInterior,
  URL_MAX_CHARS,
} from '../handoff';

/** M9-T07 — best-effort hand-off URLs (FR-115..117; verification §17). */

function routeOf(overrides: Partial<Route>): Route {
  return {
    geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: 200 }, (_, i) => [-79.9 + i * 0.001, 43.2]),
    },
    is_loop: false,
    waypoints: [],
    distance_m: 20_000,
    duration_s: 1500,
    curviness: 0,
    elevation_profile: null,
    climb_m: null,
    highway_flag: false,
    toll_flag: false,
    ferry_flag: false,
    unpaved_flag: false,
    character_tags: [],
    intensity: 'chill',
    free_tags: [],
    visibility: 'private',
    owner_id: null,
    origin_type: 'ai',
    forked_from: null,
    generation_request_id: null,
    satisfied_constraints: null,
    stops: [],
    ...overrides,
  } as Route;
}

describe('URL builders', () => {
  it('Apple uses the CURRENT unified schema, never the regressed daddr form', () => {
    const url = appleDirectionsUrl({ lat: 43.2, lng: -79.9 }, { lat: 43.1, lng: -79.8 });
    expect(url.startsWith('https://maps.apple.com/directions?')).toBe(true);
    expect(url).toContain('destination=43.20000%2C-79.90000');
    expect(url).toContain('source=43.10000%2C-79.80000');
    expect(url).toContain('mode=driving');
    expect(url).not.toContain('daddr');
  });

  it('Google uses dir/?api=1 with piped, encoded waypoints', () => {
    const url = googleDirectionsUrl(
      { lat: 43.2, lng: -79.9 },
      { origin: { lat: 43.1, lng: -79.8 }, waypoints: [{ lat: 43.15, lng: -79.85 }] },
    );
    expect(url.startsWith('https://www.google.com/maps/dir/?api=1')).toBe(true);
    expect(url).toContain('waypoints=43.15000%2C-79.85000');
    expect(url).toContain('travelmode=driving');
  });
});

describe('A→B routes', () => {
  it('hands off origin→destination on both platforms, no loop offer', () => {
    const o = buildHandoffOptions(routeOf({ is_loop: false }));
    expect(o.atob).not.toBeNull();
    expect(o.atob!.apple).toContain('source=');
    expect(o.atob!.google).toContain('origin=');
    expect(o.googleLoop).toBeNull();
  });
});

describe('loops', () => {
  const loop = routeOf({ is_loop: true });

  it('NEVER offers an Apple loop — Google decimated + legs only (FR-116)', () => {
    const o = buildHandoffOptions(loop);
    expect(o.atob).toBeNull(); // no "faithful loop" pretense on either platform
    expect(o.googleLoop).not.toBeNull();
    expect(o.googleLoop!).toContain('google.com/maps/dir');
  });

  it('decimates within the documented waypoint cap and URL limit (FR-117)', () => {
    const url = buildGoogleLoopUrl(loop)!;
    const waypoints = /waypoints=([^&]*)/.exec(url)![1]!;
    const parts = decodeURIComponent(waypoints).split('|');
    expect(parts.length).toBeLessThanOrEqual(GOOGLE_WAYPOINT_CAP);
    expect(url.length).toBeLessThanOrEqual(URL_MAX_CHARS);
    // the length assertion above cannot fail on its own (9 coordinate pairs is
    // ~330 chars against a 2,048 limit), so pin what the guard is really FOR:
    // every waypoint distinct, and none of them the route's own origin
    expect(new Set(parts).size).toBe(parts.length);
    expect(parts).not.toContain('43.20000,-79.90000');
  });

  it('a loop too short to sample offers NOTHING rather than a point-to-itself link', () => {
    // 2 coordinates: no interior to sample. The old code still returned a URL
    // with origin === destination and no waypoints, labelled "Rough loop".
    const stub = routeOf({
      is_loop: true,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-79.9, 43.2],
          [-79.89, 43.21],
        ],
      },
    });
    expect(buildGoogleLoopUrl(stub)).toBeNull();
    expect(buildHandoffOptions(stub).googleLoop).toBeNull();
  });

  it('short geometries yield distinct interior samples, never the endpoints', () => {
    const short = {
      type: 'LineString',
      coordinates: [
        [-79.9, 43.2],
        [-79.89, 43.21],
        [-79.88, 43.22],
        [-79.87, 43.23],
      ],
    } as Route['geometry'];
    const pts = sampleInterior(short, 9);
    expect(new Set(pts.map((p) => `${p.lat},${p.lng}`)).size).toBe(pts.length);
    expect(pts.some((p) => p.lng === -79.9)).toBe(false); // not the origin
    expect(pts.some((p) => p.lng === -79.87)).toBe(false); // not the end
  });

  it('interior samples span the shape and exclude the endpoints', () => {
    const pts = sampleInterior(loop.geometry, 9);
    expect(pts).toHaveLength(9);
    expect(pts[0]!.lng).toBeGreaterThan(-79.9); // not the start
    expect(pts[8]!.lng).toBeLessThan(-79.9 + 199 * 0.001); // not the end
  });

  it('offers leg-by-leg hand-off to each stop, in order', () => {
    const withStops = routeOf({
      is_loop: true,
      stops: [
        {
          name: 'Ridge Café',
          type: 'coffee',
          requested_type: 'coffee',
          arrival_s: 1200,
          at_fraction: 0.25,
          location: { lat: 43.25, lng: -79.82 },
          waypoint_index: 1,
        },
      ],
    });
    const o = buildHandoffOptions(withStops);
    expect(o.legs).toHaveLength(1);
    expect(o.legs[0]!.name).toBe('Ridge Café');
    expect(o.legs[0]!.apple).toContain('maps.apple.com/directions');
    expect(o.legs[0]!.google).toContain('api=1');
  });
});
