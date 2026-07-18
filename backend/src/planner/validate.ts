/**
 * Deterministic feasibility gates (M3-T11; Protocol §3.6, Spec §33).
 *
 * A routed candidate passes/fails per-constraint with reasons:
 *   Tier 1 (inviolable): routable geometry sanity; loop closure within ε.
 *   Tier 2 (hard-relaxable): the avoid set — verified by RESULT-SCAN of the routed
 *     flags (BD-16 caveat: never trust request flags), each violation reported;
 *     required stops present or their absence reported.
 *   Tier 3 (soft): duration within ±DURATION_TOLERANCE; self-overlap sanity.
 * Feasibility is BINARY (Tier-1 pass AND every Tier-2 either satisfied or
 * explicitly disclosed-relaxed); soft misses annotate but do not fail (§3.6).
 */

import type {
  ConstraintResult,
  ConstraintStatus,
  ParsedConstraints,
  RouteThroughOutput,
} from '@shared/types';

import { EPSILON_CLOSURE_M, SELF_OVERLAP_CAP } from './loop';
import { AVOID_DISC_RADIUS_M, type ResolvedLocation } from './resolve_locations';
import type { ResolvedStop, StopCoverage } from './stops';

// re-exported so the row detail and the generation filter agree by construction
export { AVOID_DISC_RADIUS_M };

// frozen M4-T12 (was 0.1): p80 of the frozen config's |dur err| across DEV+VAL —
// §21 "the band where most feasible routes land"; misses beyond it disclose.
// The 0.1 bar failed routes the planner measurably cannot hit (BD-29: 8/9
// seeded failures were pure duration misses, unrepairable by any move).
export const DURATION_TOLERANCE_DEFAULT = 0.2;

// R16-3: a fraction-timed stop ("coffee midway") is satisfied when its measured
// arrival lands within ±20 % of total duration of the asked fraction — the chip
// vocabulary (0.25/0.5/0.75) makes neighbouring chips just-distinguishable at
// this width. Soft (Tier 3): misses disclose the actual %, never fail the route.
export const STOP_TIMING_TOLERANCE = 0.2;

// R18-4 location-intent verdict bars (measured on routed geometry)
export const VIA_MATCH_RADIUS_M = 30;
export const VIA_COVERAGE_MIN = 0.6;
export const NEAR_MAX_DIST_M = 2_000;

// Single source of truth moved to shared at M7-T05 (the client constraints
// panel renders these rows); re-exported so existing backend imports hold.
export type { ConstraintResult, ConstraintStatus } from '@shared/types';

export interface ValidationInput {
  route: RouteThroughOutput;
  constraints: ParsedConstraints;
  /** Loop closure distance (m) from assembly; null for A→B. */
  closureM: number | null;
  selfOverlap: number;
  /** Per-type request-vs-included tally (R16-3; replaces the scalar counts —
   *  a missing required fuel stop must not hide behind a covered coffee). */
  stopCoverage: StopCoverage[];
  /** The candidate's stops with measured arrivals (timing verdicts). */
  stops: ResolvedStop[];
  /** Tier-2 constraints the relaxation ladder has already relaxed (disclosed). */
  relaxedConstraints?: string[];
  /** R18-4: resolved location intents — measured verdicts replace the blanket
   *  relaxed rows when provided (run.ts passes them; older callers fall back
   *  to the honest blanket). */
  resolvedLocations?: readonly ResolvedLocation[];
}

export interface ValidationVerdict {
  feasible: boolean;
  results: ConstraintResult[];
}

/** Run every gate; feasible = all Tier-1 satisfied AND no un-relaxed Tier-2 violation. */
export function validateCandidate(
  input: ValidationInput,
  {
    durationTolerance = DURATION_TOLERANCE_DEFAULT,
    epsilonM = EPSILON_CLOSURE_M,
    selfOverlapCap = SELF_OVERLAP_CAP,
  }: {
    durationTolerance?: number;
    epsilonM?: number;
    selfOverlapCap?: number;
  } = {},
): ValidationVerdict {
  const { route, constraints, closureM, selfOverlap } = input;
  const relaxed = new Set(input.relaxedConstraints ?? []);
  const results: ConstraintResult[] = [];

  // --- Tier 1: routable + sane geometry ---
  const routable = route.geometry.coordinates.length >= 2 && route.distance_m > 0;
  results.push({
    constraint: 'routable',
    tier: 1,
    status: routable ? 'satisfied' : 'violated',
    detail: routable ? `${Math.round(route.distance_m)} m routed` : 'empty or zero-length geometry',
  });

  // --- Tier 1: loop closure ---
  if (constraints.shape === 'loop') {
    const closes = closureM !== null && closureM <= epsilonM;
    results.push({
      constraint: 'loop_closure',
      tier: 1,
      status: closes ? 'satisfied' : 'violated',
      detail:
        closureM === null
          ? 'no closure measurement'
          : `closure ${Math.round(closureM)} m (ε ${epsilonM} m)`,
    });
  }

  // --- Tier 2: avoid set (RESULT-SCAN of routed flags — BD-16) ---
  const scans: Array<[keyof ParsedConstraints['avoid'], boolean, string]> = [
    ['highways', route.has_highway, 'highway'],
    ['tolls', route.has_toll, 'toll'],
    ['ferries', route.has_ferry, 'ferry'],
    ['unpaved', route.has_unpaved, 'unpaved'],
  ];
  for (const [key, present, label] of scans) {
    if (!constraints.avoid[key]) {
      results.push({
        constraint: `avoid_${label}`,
        tier: 2,
        status: 'not_applicable',
        detail: 'not requested',
      });
      continue;
    }
    const status: ConstraintStatus = present
      ? relaxed.has(`avoid_${label}`)
        ? 'relaxed'
        : 'violated'
      : 'satisfied';
    results.push({
      constraint: `avoid_${label}`,
      tier: 2,
      status,
      detail: present
        ? status === 'relaxed'
          ? `${label} present — relaxed with disclosure`
          : `route contains ${label} despite avoid request (result-scan)`
        : `no ${label} in routed result`,
    });
  }

  // --- Tier 2: required stops present or absence reported — PER TYPE (R16-3;
  // the old scalar gate let a covered coffee hide a missing required fuel) ---
  for (const c of input.stopCoverage) {
    if (c.requested <= 0) continue;
    const key = `stop_${c.type}`;
    const covered = c.included >= c.requested;
    const status: ConstraintStatus = covered
      ? 'satisfied'
      : c.importance === 'required' && !relaxed.has(key) && !relaxed.has('stops')
        ? 'violated'
        : 'relaxed';
    results.push({
      constraint: key,
      tier: 2,
      status,
      detail: `${c.included}/${c.requested} requested ${c.type} stops included`,
    });
  }

  // --- Tier 2: location intents (R18-4) — NEVER silently ignored. With
  // resolutions provided, verdicts are MEASURED on the routed geometry:
  //   via_<slug>        ≥ 60 % of the named road's vertices within 30 m of
  //                     the route = the drive really drives it;
  //   near_<slug>       route passes within 2 km of the place;
  //   avoid_area_<slug> route stays outside the keep-away disc (v1 renders a
  //                     miss as RELAXED with the measured distance — the
  //                     dedicated ladder rung upgrades this to violated later).
  // Unresolved/out-of-reach intents disclose honestly as relaxed. Callers
  // without resolutions get the blanket honest rows.
  const routeCoords = route.geometry.coordinates as Array<[number, number]>;
  const mPerDegLat = 111_320;
  const mPerDegLng = (lat: number): number => 111_320 * Math.cos((lat * Math.PI) / 180);
  const minDistToRouteM = (lng: number, lat: number): number => {
    const kx = mPerDegLng(lat);
    let best = Infinity;
    for (const [cLng, cLat] of routeCoords) {
      const d = Math.hypot((cLng - lng) * kx, (cLat - lat) * mPerDegLat);
      if (d < best) best = d;
    }
    return best;
  };
  if (input.resolvedLocations !== undefined) {
    for (const r of input.resolvedLocations) {
      if (!r.applied || r.resolution.kind === 'unresolved') {
        results.push({
          constraint: r.slug,
          tier: 2,
          status: 'relaxed',
          detail: r.disclosure ?? `"${r.constraint.kind} ${r.constraint.text}" — not applied`,
        });
        continue;
      }
      if (r.constraint.kind === 'avoid') {
        const p =
          r.resolution.kind === 'town'
            ? r.resolution.point
            : (() => {
                const c =
                  r.resolution.kind === 'road'
                    ? r.resolution.segment.geometry.coordinates[
                        Math.floor(r.resolution.segment.geometry.coordinates.length / 2)
                      ]!
                    : [0, 0];
                return { lat: c[1]!, lng: c[0]! };
              })();
        const dM = minDistToRouteM(p.lng, p.lat);
        const clear = dM > AVOID_DISC_RADIUS_M;
        results.push({
          constraint: r.slug,
          tier: 2,
          status: clear ? 'satisfied' : 'relaxed',
          detail: clear
            ? `route stays ${(dM / 1000).toFixed(1)} km clear of ${r.constraint.text}`
            : `route passes ${(dM / 1000).toFixed(1)} km from ${r.constraint.text} (asked to avoid; disc ${AVOID_DISC_RADIUS_M / 1000} km)`,
        });
        continue;
      }
      if (r.resolution.kind === 'road' && r.constraint.kind === 'near') {
        // proximity intent about a road: measure distance, not traversal
        const c =
          r.resolution.segment.geometry.coordinates[
            Math.floor(r.resolution.segment.geometry.coordinates.length / 2)
          ]!;
        const dM = minDistToRouteM(c[0]!, c[1]!);
        const ok = dM <= NEAR_MAX_DIST_M;
        results.push({
          constraint: r.slug,
          tier: 2,
          status: ok ? 'satisfied' : 'relaxed',
          detail: ok
            ? `route passes ${(dM / 1000).toFixed(1)} km from ${r.resolution.segment.name}`
            : `route stays ${(dM / 1000).toFixed(1)} km from ${r.resolution.segment.name} (bar ${NEAR_MAX_DIST_M / 1000} km)`,
        });
        continue;
      }
      if (r.resolution.kind === 'road') {
        const verts = r.resolution.segment.geometry.coordinates as Array<[number, number]>;
        let within = 0;
        for (const [vLng, vLat] of verts) {
          if (minDistToRouteM(vLng, vLat) <= VIA_MATCH_RADIUS_M) within += 1;
        }
        const coverage = verts.length > 0 ? within / verts.length : 0;
        const ok = coverage >= VIA_COVERAGE_MIN;
        results.push({
          constraint: r.slug,
          tier: 2,
          status: ok ? 'satisfied' : 'relaxed',
          detail: ok
            ? `drives ${(coverage * 100).toFixed(0)} % of ${r.resolution.segment.name}`
            : `only ${(coverage * 100).toFixed(0)} % of ${r.resolution.segment.name} is on the route (bar ${VIA_COVERAGE_MIN * 100} %)`,
        });
        continue;
      }
      // town near/through: proximity is the honest measure
      const dM = minDistToRouteM(r.resolution.point.lng, r.resolution.point.lat);
      const ok = dM <= NEAR_MAX_DIST_M;
      results.push({
        constraint: r.slug,
        tier: 2,
        status: ok ? 'satisfied' : 'relaxed',
        detail: ok
          ? `route passes ${(dM / 1000).toFixed(1)} km from ${r.constraint.text}`
          : `route stays ${(dM / 1000).toFixed(1)} km from ${r.constraint.text} (bar ${NEAR_MAX_DIST_M / 1000} km)`,
      });
    }
  } else {
    for (const lc of constraints.location_constraints) {
      const slug = lc.text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const prefix = lc.kind === 'through' ? 'via' : lc.kind === 'avoid' ? 'avoid_area' : 'near';
      results.push({
        constraint: `${prefix}_${slug}`,
        tier: 2,
        status: 'relaxed',
        detail: `"${lc.kind} ${lc.text}" — location intent not yet wired to routing; it did not shape this drive`,
      });
    }
  }

  // --- Tier 3 (soft): distance target (R18-4 — consumed, measured, honest) ---
  if (constraints.distance_target_m !== null) {
    const err =
      Math.abs(route.distance_m - constraints.distance_target_m) / constraints.distance_target_m;
    results.push({
      constraint: 'distance',
      tier: 3,
      status: err <= durationTolerance ? 'satisfied' : 'relaxed',
      detail: `distance ${(route.distance_m / 1000).toFixed(1)} km vs target ${(
        constraints.distance_target_m / 1000
      ).toFixed(0)} km (${(err * 100).toFixed(0)} % err)`,
    });
  }

  // --- Tier 3 (soft): duration band ---
  if (constraints.duration_target_s !== null) {
    const err =
      Math.abs(route.duration_s - constraints.duration_target_s) / constraints.duration_target_s;
    results.push({
      constraint: 'duration',
      tier: 3,
      status: err <= durationTolerance ? 'satisfied' : 'relaxed',
      detail: `duration ${Math.round(route.duration_s)} s vs target ${constraints.duration_target_s} s (${(err * 100).toFixed(0)} % err, tol ${durationTolerance * 100} %)`,
    });
  }

  // --- Tier 3 (soft): fraction-timed stop arrivals (R16-3) ---
  // Verified against MEASURED per-leg arrivals (break_through legs) — never a
  // geometric estimate. Unmeasured arrivals disclose honestly as relaxed.
  const nthOfType = new Map<string, number>();
  for (const s of input.stops) {
    if (s.atFraction === null) continue;
    const nth = (nthOfType.get(s.requestedType) ?? 0) + 1;
    nthOfType.set(s.requestedType, nth);
    const key =
      nth === 1 ? `stop_timing_${s.requestedType}` : `stop_timing_${s.requestedType}_${nth}`;
    if (s.arrivalS === null || route.duration_s <= 0) {
      results.push({
        constraint: key,
        tier: 3,
        status: 'relaxed',
        detail: `${s.name}: arrival unmeasured — timing not verifiable`,
      });
      continue;
    }
    const actual = s.arrivalS / route.duration_s;
    const off = Math.abs(actual - s.atFraction);
    results.push({
      constraint: key,
      tier: 3,
      status: off <= STOP_TIMING_TOLERANCE ? 'satisfied' : 'relaxed',
      detail: `${s.name} at ${(actual * 100).toFixed(0)} % of the drive (asked ${(
        s.atFraction * 100
      ).toFixed(0)} %, tol ±${STOP_TIMING_TOLERANCE * 100} %)`,
    });
  }

  // --- Tier 3 (soft-ish sanity): self-overlap ---
  results.push({
    constraint: 'self_overlap',
    tier: 3,
    status: selfOverlap <= selfOverlapCap ? 'satisfied' : 'relaxed',
    detail: `self_overlap ${selfOverlap.toFixed(2)} (cap ${selfOverlapCap})`,
  });

  const feasible =
    results.filter((r) => r.tier === 1).every((r) => r.status === 'satisfied') &&
    results.filter((r) => r.tier === 2).every((r) => r.status !== 'violated');

  return { feasible, results };
}
