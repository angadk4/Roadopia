/**
 * Baselines B0–B5 (M4-T04; Protocol §8) — the floors every clever variant must
 * beat. Deliberately NAIVE constructions run through the SAME harness and
 * metrics as the real planner:
 *   B0 fastest        — default costing, out-and-back sized to the ask
 *   B1 avoid-highways — B0 shape + highway exclusion
 *   B2 random         — seeded random bearings → keep if it routes (any-feasible floor)
 *   B3 POI            — via the nearest requested-type spot (stop-coverage floor)
 *   B4 curvature      — greedily through the top-curvature segments, no
 *                       sectors/dedup (exposes out-and-back retracing by design)
 *   B5 router-native  — probed once: Valhalla /route has no round-trip mode → N/A
 *
 * Baselines bypass parsing: `parsed` = the GOLD constraints (their parse
 * metrics are trivially perfect and excluded from comparison claims). Origins
 * that are not coordinates (place-name / 'current' / null) cannot be routed
 * before M6 geocoding — recorded honestly as errors; the SAME limitation holds
 * for every variant, so denominators stay comparable.
 */

import type { LatLng } from '@shared/types';
import { resolveDisposition } from '@shared/types';
import type { Client } from 'pg';

import { measureCurvature } from '../../../backend/src/planner/curvature';
import { selfOverlapRatio } from '../../../backend/src/planner/overlap';
import { retrieveCandidates } from '../../../backend/src/planner/retrieve';
import { validateCandidate } from '../../../backend/src/planner/validate';
import { routeThrough, type AutoCostingOptions } from '../../../backend/src/valhalla/route';
import type { RequestExample } from '../datasets/schema';
import type { AttemptRecord, AttemptOutcome } from '../harness/types';

export type BaselineId = 'B0' | 'B1' | 'B2' | 'B3' | 'B4';
export const BASELINE_IDS: BaselineId[] = ['B0', 'B1', 'B2', 'B3', 'B4'];

/** Deterministic PRNG (§22: fixed seeds) — B2's randomness must reproduce. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AVG_SPEED_KMH = 55;

export function pointAtBearing(origin: LatLng, bearingDeg: number, distM: number): LatLng {
  const d2r = Math.PI / 180;
  const dKm = distM / 1000;
  return {
    lat: origin.lat + (dKm / 111.32) * Math.cos(bearingDeg * d2r),
    lng: origin.lng + ((dKm / 111.32) * Math.sin(bearingDeg * d2r)) / Math.cos(origin.lat * d2r),
  };
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const d2r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * d2r;
  const dLng = (b[0] - a[0]) * d2r;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * d2r) * Math.cos(b[1] * d2r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface BaselineDeps {
  valhallaUrl: string;
  db: Client;
  rng: () => number;
}

/** Coordinates-or-null: only latlng gold origins are routable before M6 geocoding. */
function coordOrigin(example: RequestExample): LatLng | null {
  const o = example.gold!.constraints.origin;
  return o !== null && typeof o === 'object' ? o : null;
}

export async function runBaseline(
  id: BaselineId,
  example: RequestExample,
  deps: BaselineDeps,
): Promise<AttemptRecord> {
  const gold = example.gold!;
  const t0 = performance.now();
  const base: Omit<AttemptRecord, 'outcome' | 'route' | 'feasible' | 'violations'> = {
    exampleId: example.id,
    configId: id,
    parsed: gold.constraints,
    disposition: resolveDisposition(gold.constraints),
    presented: 1,
    diversityPairwise: null,
    relaxations: [],
    firstPassFeasible: false,
    correctionsApplied: 0,
    correctionIntroducedViolation: false,
    repairedToFeasible: false,
    generationTimeMs: 0,
    routeEngineCalls: 0,
    llmCalls: 0,
    llmInvalidOutputs: 0,
    costUsd: 0,
  };
  const finish = (
    outcome: AttemptOutcome,
    route: AttemptRecord['route'],
    feasible: boolean,
    violations: AttemptRecord['violations'],
    engineCalls: number,
  ): AttemptRecord => ({
    ...base,
    outcome,
    route,
    feasible,
    firstPassFeasible: feasible,
    violations,
    generationTimeMs: performance.now() - t0,
    routeEngineCalls: engineCalls,
  });

  // non-proceed gold (clarify in DEV) — no baseline routes these
  const disposition = resolveDisposition(gold.constraints);
  if (disposition !== 'proceed') {
    return finish(disposition === 'clarify' ? 'clarify' : 'refused', null, false, [], 0);
  }
  const origin = coordOrigin(example);
  if (origin === null) {
    return finish('error', null, false, [], 0); // pre-M6 geocoding gap (all variants)
  }

  const c = gold.constraints;
  const isLoop = c.shape === 'loop';
  const durationS = c.duration_target_s ?? 5400;
  const totalM = (durationS / 3600) * AVG_SPEED_KMH * 1000;
  let engineCalls = 0;

  const buildWaypoints = async (): Promise<Array<[number, number]> | null> => {
    const o: [number, number] = [origin.lng, origin.lat];
    if (!isLoop) return null; // gold destinations are place-name strings pre-M6
    switch (id) {
      case 'B0':
      case 'B1': {
        const p = pointAtBearing(origin, 90, totalM / 2);
        return [o, [p.lng, p.lat], o];
      }
      case 'B2': {
        const b1 = deps.rng() * 360;
        const b2 = (b1 + 120 + deps.rng() * 60) % 360;
        const f = 0.5 + deps.rng() * 0.5;
        const p1 = pointAtBearing(origin, b1, (totalM / 3) * f);
        const p2 = pointAtBearing(origin, b2, (totalM / 3) * f);
        return [o, [p1.lng, p1.lat], [p2.lng, p2.lat], o];
      }
      case 'B3': {
        const type = c.stops[0]?.type;
        if (!type) {
          const p = pointAtBearing(origin, 90, totalM / 2);
          return [o, [p.lng, p.lat], o]; // no stops requested → fastest shape
        }
        const dbType = type === 'food' ? null : type; // 'food' has no spot type yet
        if (dbType === null) {
          const p = pointAtBearing(origin, 90, totalM / 2);
          return [o, [p.lng, p.lat], o];
        }
        const res = await deps.db.query<{ lat: number; lng: number }>(
          `select lat, lng from find_spots(p_lat := $1, p_lng := $2, p_radius_m := 25000,
                                           p_types := array[$3], p_limit := 1)`,
          [origin.lat, origin.lng, dbType],
        );
        const spot = res.rows[0];
        if (!spot) {
          const p = pointAtBearing(origin, 90, totalM / 2);
          return [o, [p.lng, p.lat], o];
        }
        return [o, [Number(spot.lng), Number(spot.lat)], o];
      }
      case 'B4': {
        // crude square Ω at the ask's radius — greedy top-3 curvature, no sectors
        const r = totalM / 2;
        const ring = [45, 135, 225, 315].map((b) => pointAtBearing(origin, b, r * 1.4));
        const retrieved = await retrieveCandidates(deps.db, {
          rings: [ring],
          tauOutS: durationS,
          shape: 'loop',
        });
        const top = [...retrieved.segments]
          .sort((a, b2) => b2.curviness - a.curviness || a.id.localeCompare(b2.id))
          .slice(0, 3);
        if (top.length === 0) return null;
        const wps = top.map((s) => s.geometry.coordinates[0]! as [number, number]);
        return [o, ...wps, o];
      }
    }
  };

  try {
    const waypoints = await buildWaypoints();
    if (waypoints === null) return finish('error', null, false, [], engineCalls);
    // R25-U2 CORRECTION (BD-84): `exclude_highways` was a Valhalla NO-OP —
    // every published B0-vs-B1 comparison before 2026-07-26 compared
    // byte-identical arms and is void. With AVOID_REAL_LEVERS (default ON)
    // routeThrough now realizes it as use_highways:0 + shortest dropped, so
    // B1 is a REAL no-highway baseline from here forward.
    const costing: AutoCostingOptions | undefined =
      id === 'B1' ? { exclude_highways: true } : undefined;
    engineCalls++;
    const routed = await routeThrough(deps.valhallaUrl, {
      waypoints,
      ...(costing ? { costingOptions: costing } : {}),
    });

    const coords = routed.geometry.coordinates;
    const oPt: [number, number] = [origin.lng, origin.lat];
    const closureM = isLoop
      ? Math.max(haversine(oPt, coords[0]!), haversine(oPt, coords[coords.length - 1]!))
      : null;
    const selfOverlap = selfOverlapRatio(routed.geometry, undefined, origin);
    // baselines carry no typed CandidateStop bookkeeping — synthesize the
    // per-type coverage the R16-3 gate expects (B3 anchors the first stop only)
    const requiredStops = c.stops.filter((s) => s.importance === 'required');
    const stopCoverage = requiredStops.map((s, i) => ({
      type: s.type,
      importance: s.importance,
      requested: s.count,
      included: id === 'B3' && i === 0 ? 1 : 0,
    }));

    const verdict = validateCandidate({
      route: routed,
      constraints: c,
      closureM,
      selfOverlap,
      stopCoverage,
      stops: [],
    });
    const violations = verdict.results
      .filter((res) => res.status === 'violated')
      .map((res) => ({
        tier: res.tier === 1 ? (1 as const) : (2 as const),
        name: res.constraint,
        disclosed: false,
      }));

    return finish(
      verdict.feasible ? 'feasible' : 'relaxed',
      {
        duration_s: routed.duration_s,
        distance_m: routed.distance_m,
        closureM,
        isLoop,
        selfOverlap,
        curvature: measureCurvature(routed.geometry).curviness,
        connected: true,
        requiredStopsRequested: stopCoverage.reduce((a, sc) => a + sc.requested, 0),
        requiredStopsPresent: stopCoverage.reduce((a, sc) => a + sc.included, 0),
      },
      verdict.feasible,
      violations,
      engineCalls,
    );
  } catch {
    return finish('error', null, false, [], engineCalls);
  }
}

/** B5 probe: Valhalla /route with origin==destination — confirms no native loops. */
export async function probeB5(valhallaUrl: string, origin: LatLng): Promise<string> {
  try {
    const r = await routeThrough(valhallaUrl, {
      waypoints: [
        [origin.lng, origin.lat],
        [origin.lng, origin.lat],
      ],
    });
    return `origin==destination returns a ${Math.round(r.distance_m)} m trip — no usable native round-trip (trivial)`;
  } catch (err) {
    return `origin==destination rejected (${err instanceof Error ? err.message.slice(0, 80) : 'error'}) — no native round-trip mode`;
  }
}
