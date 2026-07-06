/**
 * Search-region module — builds Ω, the isochrone-bounded scope (M3-T03; §3.3).
 *
 * Loops:  Ω = isochrone(origin, τ_out) with τ_out = ALPHA_LOOP · T* — the outbound
 *         share of the time budget (α ≈ 0.55, calibrated at M4).
 * A→B:    Ω bounds the o→d corridor: the union of two endpoint isochrones at
 *         ALPHA_ATOB · T* each — reachable sets from both ends cover the corridor
 *         plus detour room (§3.3 leaves the corridor construction to calibration;
 *         this is the deterministic first form, tuned in M4).
 *
 * Isochrone-bounding beats a guessed radius because reachability already scales
 * with the requested duration (§3.3). The isochrone caller is injected so the
 * geometry logic is unit-testable without a live engine.
 */

import type { GetIsochroneInput, GetIsochroneOutput, LatLng } from '@shared/types';

import { getIsochrone } from '../valhalla/isochrone';

/** Outbound share of the budget for loops (§3.3, α ≈ 0.55; M4 calibrates). */
export const ALPHA_LOOP = 0.55;
/** Per-endpoint share for the A→B corridor union (first form; M4 calibrates). */
export const ALPHA_ATOB = 0.55;
/** Floor so tiny budgets still produce a usable region (minutes granularity). */
export const MIN_TAU_S = 5 * 60;
/**
 * Ceiling: Valhalla rejects isochrone contours beyond 120 min (HTTP 400 — found
 * live when a 3 h brief's ladder-widened τ hit 129 min and killed the run).
 * Beyond ~2 h outbound the reachable set is effectively the whole region anyway.
 */
export const MAX_TAU_S = 115 * 60;

export type IsochroneFn = (input: GetIsochroneInput) => Promise<GetIsochroneOutput>;

export interface ScopeRequest {
  origin: LatLng;
  shape: 'loop' | 'a_to_b';
  /** Total requested duration T* in seconds. */
  durationS: number;
  /** Required when shape = a_to_b. */
  destination?: LatLng;
  costing?: string;
}

export interface Scope {
  /** One or two rings (loop: single isochrone; a_to_b: origin + destination). */
  rings: LatLng[][];
  /** The outbound budget(s) used, seconds. */
  tauOutS: number;
  shape: 'loop' | 'a_to_b';
}

/** Convert a Scope ring to a GeoJSON Polygon (closed ring) for the PostGIS RPCs. */
export function ringToGeoJsonPolygon(ring: LatLng[]): {
  type: 'Polygon';
  coordinates: number[][][];
} {
  const coords = ring.map((p) => [p.lng, p.lat]);
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
  return { type: 'Polygon', coordinates: [coords] };
}

/**
 * Build Ω for a request. Throws if a_to_b lacks a destination (schema-level rule,
 * revalidated here because this module is callable directly).
 */
export async function buildScope(
  baseUrl: string,
  request: ScopeRequest,
  isochroneFn: IsochroneFn = (input) => getIsochrone(baseUrl, input),
): Promise<Scope> {
  const costing = request.costing ?? 'auto';

  if (request.shape === 'loop') {
    const tau = Math.min(
      MAX_TAU_S,
      Math.max(MIN_TAU_S, Math.round(request.durationS * ALPHA_LOOP)),
    );
    const iso = await isochroneFn({ origin: request.origin, time_s: tau, costing });
    return { rings: [iso.polygon], tauOutS: tau, shape: 'loop' };
  }

  if (!request.destination) {
    throw new Error('a_to_b scope requires a destination');
  }
  const tau = Math.min(MAX_TAU_S, Math.max(MIN_TAU_S, Math.round(request.durationS * ALPHA_ATOB)));
  const [fromOrigin, fromDest] = await Promise.all([
    isochroneFn({ origin: request.origin, time_s: tau, costing }),
    isochroneFn({ origin: request.destination, time_s: tau, costing }),
  ]);
  return { rings: [fromOrigin.polygon, fromDest.polygon], tauOutS: tau, shape: 'a_to_b' };
}
