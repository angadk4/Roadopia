/**
 * Best-effort external hand-off (M9-T07; FR-115..117; verification §17).
 * PURE URL builders — no I/O, no platform calls.
 *
 * What the platforms can actually take (Dependency Verification §17, facts):
 *   - Apple Maps: ONE origin→destination, no waypoints — a loop cannot be
 *     faithfully represented, ever. Target the CURRENT unified Maps URL
 *     schema (post-iOS-18.4, `maps.apple.com/directions`) — the legacy
 *     `daddr=` form regressed.
 *   - Google Maps: `dir/?api=1` with a CAPPED `waypoints` list (docs cap
 *     GOOGLE_WAYPOINT_CAP; mobile may honor fewer) under a 2,048-char URL.
 * So every builder here is an approximation by construction, and the UI copy
 * must say so — follow-mode remains the primary way to drive the real shape.
 * FR-117: Google URLs are VERIFIED (waypoint count + length) before being
 * offered; the decimator steps down until the URL fits or offers nothing.
 */

import type { LatLng, Route } from '@shared/types';

/** Google Maps URLs documented waypoint cap (mobile may honor fewer). */
export const GOOGLE_WAYPOINT_CAP = 9;
/** Documented Google Maps URL length limit. */
export const URL_MAX_CHARS = 2048;

/** 5 decimals ≈ 1.1 m — plenty for nav, keeps URLs short. */
function coord(p: LatLng): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

/** Apple unified Maps URL (post-iOS-18.4): destination(+source), driving. */
export function appleDirectionsUrl(destination: LatLng, source?: LatLng): string {
  const params = [
    `destination=${encodeURIComponent(coord(destination))}`,
    ...(source ? [`source=${encodeURIComponent(coord(source))}`] : []),
    'mode=driving',
  ];
  return `https://maps.apple.com/directions?${params.join('&')}`;
}

/** Google universal directions URL; waypoints must already be within caps. */
export function googleDirectionsUrl(
  destination: LatLng,
  opts: { origin?: LatLng; waypoints?: LatLng[] } = {},
): string {
  const params = [
    'api=1',
    `destination=${encodeURIComponent(coord(destination))}`,
    ...(opts.origin ? [`origin=${encodeURIComponent(coord(opts.origin))}`] : []),
    ...(opts.waypoints && opts.waypoints.length > 0
      ? [`waypoints=${encodeURIComponent(opts.waypoints.map(coord).join('|'))}`]
      : []),
    'travelmode=driving',
  ];
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

/** Interior shape samples for the Google loop approximation (endpoints excluded). */
export function sampleInterior(geometry: Route['geometry'], k: number): LatLng[] {
  const coords = geometry.coordinates;
  if (coords.length < 3 || k <= 0) return [];
  const out: LatLng[] = [];
  for (let i = 1; i <= k; i++) {
    const idx = Math.round((i / (k + 1)) * (coords.length - 1));
    const c = coords[Math.min(idx, coords.length - 2)]!;
    out.push({ lat: c[1]!, lng: c[0]! });
  }
  return out;
}

export interface HandoffLeg {
  name: string;
  apple: string;
  google: string;
}

export interface HandoffOptions {
  /** A→B routes only: one origin→destination hand-off per platform. */
  atob: { apple: string; google: string } | null;
  /** Leg-by-leg to each stop, in drive order (works on both platforms). */
  legs: HandoffLeg[];
  /** Loops only, Google only: a decimated approximation — NEVER called faithful. */
  googleLoop: string | null;
}

/**
 * FR-117 verified construction: decimate at the cap and step DOWN until the
 * URL fits URL_MAX_CHARS; null when even one waypoint cannot fit.
 */
export function buildGoogleLoopUrl(route: Route): string | null {
  const start = {
    lat: route.geometry.coordinates[0]![1]!,
    lng: route.geometry.coordinates[0]![0]!,
  };
  for (let k = GOOGLE_WAYPOINT_CAP; k >= 1; k--) {
    const url = googleDirectionsUrl(start, {
      origin: start,
      waypoints: sampleInterior(route.geometry, k),
    });
    if (url.length <= URL_MAX_CHARS) return url;
  }
  return null;
}

export function buildHandoffOptions(route: Route): HandoffOptions {
  const coords = route.geometry.coordinates;
  const start = { lat: coords[0]![1]!, lng: coords[0]![0]! };
  const end = {
    lat: coords[coords.length - 1]![1]!,
    lng: coords[coords.length - 1]![0]!,
  };

  const legs: HandoffLeg[] = route.stops.map((s) => ({
    name: s.name,
    apple: appleDirectionsUrl(s.location),
    google: googleDirectionsUrl(s.location),
  }));

  if (!route.is_loop) {
    return {
      atob: {
        apple: appleDirectionsUrl(end, start),
        google: googleDirectionsUrl(end, { origin: start }),
      },
      legs,
      googleLoop: null,
    };
  }
  return { atob: null, legs, googleLoop: buildGoogleLoopUrl(route) };
}
