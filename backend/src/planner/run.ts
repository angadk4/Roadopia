/**
 * Planner orchestrator — deterministic end-to-end (M3-T13; Spec §27 state machine
 * minus the LLM steps; Protocol §3).
 *
 *   parse (M3-T02, done by the caller or via brief) → disposition (§3.5)
 *   → scope Ω (T03) → retrieve (T04) → generate candidates (T06)
 *   → route in PARALLEL (T07/T08) → measure curvature on final geometry (T05)
 *   → score (T10) → diversify (T09) → validate (T11)
 *   → relax ladder + best-so-far under the wall-clock budget (T12)
 *   → enrich (elevation, M2-T05) → ordered GenerationEvents throughout.
 *
 * Budget honesty: WALL_CLOCK_BUDGET_MS (25 s) + ITERATION_CAP (3) — on expiry the
 * best-so-far feasible route returns with `status: 'best_so_far'`; with none, the
 * redirect outcome ('unavailable'). No fabricated routes, no silent relaxation
 * (every rung's disclosure lands in the result). Trace = steps + tool calls +
 * validated results only (Hard rule I).
 */

import type {
  GenerationEvent,
  LatLng,
  ParsedConstraints,
  RouteThroughOutput,
  StopFraction,
  StopType,
} from '@shared/types';
import { resolveDisposition } from '@shared/types';
import type { Client } from 'pg';

import { getElevationProfile } from '../valhalla/elevation';
import { travelMatrix } from '../valhalla/matrix';

import { assembleAtoBWithRepair } from './atob';
import { bundleForRequest } from './bundles';
import {
  generateAtoBCandidates,
  generateLoopCandidates,
  resizedSpeed,
  type WaypointCandidate,
} from './candidates';
import {
  buildChainCandidates,
  buildCorridorChains,
  buildSpanPool,
  CHAIN_MIN_SPANS,
  chainMatrixLocations,
} from './chain';
import { profileForRequest, type CostingMode } from './costing';
import { measureCurvatureClassAware } from './curvature';
import { diversify, prefilterByDuration } from './diversify';
import {
  assembleLoopWithRepair,
  EPSILON_CLOSURE_M,
  RELAXED_ASSEMBLY_CAPS,
  RESIDENTIAL_RUN_SOFT_M,
  RESIDENTIAL_SOFT_SHARE,
  RETRACE_RUN_SOFT_M,
  SELF_OVERLAP_CAP,
} from './loop';
import { corridorDoublingRatio, loopiness } from './overlap';
import { weightsForPreset } from './presets';
import { initialParams, nextRelaxation, type SearchParams } from './relax';
import { AVOID_DISC_RADIUS_M, resolveLocations, type ResolvedLocation } from './resolve_locations';
import { retrieveAnchorPoints, retrieveCandidates } from './retrieve';
import { buildScope } from './scope';
import {
  ARTERIAL_PRESENT_PENALTY,
  ARTERIAL_SHARE_SOFT,
  CORRIDOR_DOUBLING_SOFT,
  dirtyPenaltyOf,
  durationGradeOf,
  fallbackOffenceUnits,
  LOOPINESS_SOFT_FLOOR,
  mergeWeights,
  PRESENT_TIER_DUROFF,
  scoreCandidate,
  uturnCount,
  type ScoreBreakdown,
} from './score';
import { resolveStopArrivals, stopCoverageOf, stopCoverScore, type ResolvedStop } from './stops';
import {
  URBAN_CONTEXT_ON,
  urbanIndexFor,
  urbanIntroM,
  urbanShareOf,
  type UrbanIndex,
} from './urban';
import { DURATION_TOLERANCE_DEFAULT, validateCandidate, type ValidationVerdict } from './validate';

export const WALL_CLOCK_BUDGET_MS = 25_000;
/** R18-2: 3 → 5 so the ladder's deeper rungs (soft-relax, avoid-relax,
 *  assembly-relax) actually EXECUTE — under 3, rungs 3-4 never ran. Budget
 *  seams unchanged; worst case ≈ 18 s < 25 s. */
export const ITERATION_CAP = 5;
/** R18-2: resize fires at a 15 % median miss (was 25 % — the 10-20 % zone sat
 *  in a dead band between this trigger and the 20 % presentation demotion). */
export const RESIZE_TRIGGER = 0.15;
/**
 * R21-4 honesty coverage: a presented best that misses the asked time by more
 * than this (aligned with RESIZE_TRIGGER — if resize couldn't close it, say so)
 * discloses it. And a loop whose isoperimetric loopiness is below the DISCLOSE
 * floor is called an out-and-back honestly — a CONSERVATIVE 0.10 (vs the refused
 * R21-1 0.20 demote-floor) so only clear slivers fire, and disclose-only (never
 * a ranking change — R21-1 proved loopiness is the wrong lever to ACT on).
 */
export const LOOPINESS_DISCLOSE_FLOOR = 0.1;
/**
 * R21-1 loop-shape quality kill switch. OFF → both shape metrics pass as null
 * everywhere (the dirty clauses read false, fallbackOffenceUnits adds 0) →
 * byte-identical to pre-R21-1. ON → degenerate loop shapes demote WITHIN the
 * existing dirty tier: thin out-and-back slivers (loopiness < floor), corridor
 * doubling (drive one road out, shadow it back), and the previously-INERT
 * 0.15-0.30 self-overlap units (fallbackOffenceUnits scored them but the dirty
 * boolean never flipped on selfOverlap, so they were dead). Never gates
 * assembly — a degenerate route stays feasible, still sets `best`, still breaks
 * the ladder — so it cannot loosen the relax ladder or starve the pool. BD-42
 * tier order is preserved by construction (dirtyPenaltyOf caps at 204.5).
 *
 * REFUSED (R21-1, 2026-07-20, BD-62) per the pre-registered A/B + a 3-skeptic
 * adversarial review. On the 48-brief fixed suite vs the byte-identical OFF
 * baseline (hash fa91008c3d59dc9a): loopiness p20 0.12→0.19 (bar ≥ +0.10 —
 * MISSED at +0.07, the 0.20 floor can only lift sub-floor slivers TOWARD 0.20,
 * so "clears 0.30" is unreachable by a presentation tool — it's a GENERATION
 * problem); AC 13→12 (bar: no regression — MISSED). Decisively, loopiness-as-
 * primary is COUNTERPRODUCTIVE for the twisty/backroads product: in sparse
 * areas the only real-shaped loops are round-and-boring, so demoting thin-but-
 * twisty loops trades away the CORE essence — Belfountain twisty curv 1.92→0.00,
 * Smithville rural country 0.52→0.26, Guelph twisty surfaced a 22 %-urban loop
 * over a curv-1.32/56 %-arterial one. The corridor-doubling + self-overlap sub-
 * signals target UNAMBIGUOUS degenerates and could seed a narrower future
 * experiment (loopiness excluded), but that is a NEW pre-registration, not this.
 * Machinery kept flag-off (byte-identical, the CHAIN_CANDIDATES_ON precedent).
 */
export const SHAPE_QUALITY_ON = false;
/**
 * R22-1b — the "Twisty" generation lever ("prefer the twistiest roads"). A
 * twisty ask ranks candidate clusters + the road it drives by CURVINESS instead
 * of weight (curviness × length), so it hunts the twistiest road that still fits
 * the budget rather than the most backroad-km. OFF → twisty generates exactly
 * like the default (byte-identical). Replaces the REFUTED retrieval-θ notch
 * (BD-69: retrieval is already curviest-first, so a θ floor was inert).
 */
export const TWISTY_CURVY_RANK = true;
/**
 * R18-3 LOOP chain generator flag — REFUSED per the pre-registered adoption
 * rule (2026-07-16, 48-brief fixed A/B vs R18-2, BD-40 discipline):
 *   - falsifiable diagnostic: pool countryScore variance had to rise
 *     0.007 → > 0.05; measured 0.0004-0.0098 across all briefs — the merged/
 *     touch span pools still price identically, chains lose at presentation
 *     or die at assembly (Grand Bend funnel: self_overlap 16→28, uturns
 *     4→10, spurs 13 — touch-heavy scattered pools make offence geometry);
 *   - curvyShare of bests +1 pp (bar: ≥ +10 pp); AC held 19/48; durErr held;
 *   - wall time 5 813 → 11 157 ms/brief (bar: ≤ 6 000) — matrix + extra
 *     assemblies + span repairs for no presented gain.
 * The generator + span-atomic repair machinery stay (A→B parity uses them);
 * any loop-chain revival is a NEW pre-registered experiment on richer span
 * material (post-R18-4 named-road merges are the plausible lever).
 */
export const CHAIN_CANDIDATES_ON = false;
/** R18-3 A→B corridor chains — separate regime, separately judged: no matrix
 *  call, no prior forced-curvy material at all on A→B (the audit's "ONE
 *  off-road centroid, ~100 % fastest-path"), own eval (eval/atob_quality.ts,
 *  first run = baseline). */
export const CORRIDOR_CHAINS_ON = true;
/** R18-4 location intents kill switch — off restores the blanket honest
 *  "not wired" rows (briefs WITHOUT location constraints are byte-identical
 *  either way: the resolver only runs when constraints carry intents). */
export const LOCATION_INTENTS_ON = true;
/** R18-4 character bundles kill switch — off restores weights-only presets
 *  (the audit-proven-inert behavior) byte-identically. */
export const CHARACTER_BUNDLES_ON = true;
// R19 urban-context kill switch — lives in urban.ts (single flag gates the
// retrieval filter + presentation tier + disclosure together); re-exported
// for the eval harness + tests.
export { URBAN_CONTEXT_ON };

export interface PlannerDeps {
  db: Client;
  valhallaUrl: string;
  /** Injectable clock for tests (defaults to performance.now). */
  now?: () => number;
  /** Live event sink (M6-T04 SSE): called for each event AS IT HAPPENS, in
   *  addition to the buffered `result.events` array. */
  onEvent?: (event: GenerationEvent) => void;
  /** Cancellation (M6-T04): when aborted, the loop stops at the next budget
   *  check — no further engine batches or iterations (client disconnect must
   *  halt the loop + spend). */
  signal?: AbortSignal;
  /** R18-1 rollback lever: 'legacy' restores the BD-21 costing byte-identically. */
  costingMode?: CostingMode;
}

export interface PlannerResult {
  status: 'ok' | 'relaxed' | 'best_so_far' | 'clarify' | 'refused' | 'redirect' | 'unavailable';
  route: RouteThroughOutput | null;
  curviness: number | null;
  score: ScoreBreakdown | null;
  validation: ValidationVerdict | null;
  disclosures: string[];
  clarificationQuestion: string | null;
  events: GenerationEvent[];
  elevation: { climb_m: number } | null;
  iterations: number;
  /** Feasible, distinct runner-up candidates (M7-T09/FB-4 "another option") —
   *  the diversify-kept pool the presenter used to discard. Deterministic
   *  order (presentKey desc); no enrich/LLM spend on these. */
  alternates: PlannerAlternate[];
  /** Chosen route's stops (R16-3): grounded spots + MEASURED arrivals. */
  stops: PlannerStop[];
  /** Chosen candidate's via points (stop markers index into these). */
  waypoints: LatLng[];
  /** Measured road-class honesty metrics (R18-1); null = trace unavailable. */
  countryScore: number | null;
  arterialShare: number | null;
  /** R19: measured urban-context share (0 = countryside; null = unavailable). */
  urbanShare: number | null;
}

/** Wire-shaped stop (matches shared RouteStopSchema field-for-field). */
export interface PlannerStop {
  name: string;
  /** DB spot type ('coffee' | 'food' | 'fuel' | …). */
  type: string;
  requested_type: StopType;
  arrival_s: number | null;
  at_fraction: StopFraction | null;
  location: LatLng;
  waypoint_index: number;
}

export interface PlannerAlternate {
  route: RouteThroughOutput;
  curviness: number;
  validation: ValidationVerdict;
  presentKey: number;
  stops: PlannerStop[];
  waypoints: LatLng[];
  countryScore: number | null;
  arterialShare: number | null;
  urbanShare: number | null;
}

function step(
  emit: (e: GenerationEvent) => void,
  stepName: GenerationEvent extends { step: infer S } ? S : never | string,
  status: 'started' | 'completed',
  detail?: string,
): void {
  emit({
    type: 'step',
    step: stepName as never,
    status,
    ...(detail !== undefined ? { detail } : {}),
  });
}

/** Resolve the §3.4 origin union to coordinates (gazetteer already ran at parse). */
function originLatLng(constraints: ParsedConstraints): LatLng | null {
  const o = constraints.origin;
  if (o === null || o === 'current' || typeof o === 'string') return null;
  return o;
}

function destinationLatLng(constraints: ParsedConstraints): LatLng | null {
  const d = constraints.destination;
  if (d === null || typeof d === 'string') return null;
  return d;
}

/**
 * Run the deterministic planner end-to-end for validated ParsedConstraints.
 * (Brief→ParsedConstraints is the caller's step — rules parser now, LLM at M5.)
 */
export async function runPlanner(
  constraints: ParsedConstraints,
  deps: PlannerDeps,
): Promise<PlannerResult> {
  const events: GenerationEvent[] = [];
  const emit = (e: GenerationEvent): void => {
    events.push(e);
    deps.onEvent?.(e);
  };
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  // abort counts as budget exhaustion: same stop-seams, no further batches
  const outOfBudget = () => deps.signal?.aborted === true || now() - t0 > WALL_CLOCK_BUDGET_MS;

  const result: PlannerResult = {
    status: 'unavailable',
    route: null,
    curviness: null,
    score: null,
    validation: null,
    disclosures: [],
    clarificationQuestion: null,
    events,
    elevation: null,
    iterations: 0,
    alternates: [],
    stops: [],
    waypoints: [],
    countryScore: null,
    arterialShare: null,
    urbanShare: null,
  };

  // --- disposition (§3.5) ---
  step(emit, 'validate_constraints', 'started');
  const disposition = resolveDisposition(constraints);
  step(emit, 'validate_constraints', 'completed', disposition);
  if (disposition === 'refuse_unsafe') {
    result.status = 'refused';
    emit({ type: 'done', status: 'unavailable' });
    return result;
  }
  if (disposition === 'redirect_out_of_region') {
    result.status = 'redirect';
    emit({ type: 'done', status: 'unavailable' });
    return result;
  }
  if (disposition === 'clarify') {
    result.status = 'clarify';
    result.clarificationQuestion = constraints.clarification.question;
    emit({ type: 'done', status: 'unavailable' });
    return result;
  }

  const origin = originLatLng(constraints);
  if (!origin) {
    // R18-4 honesty: name the unrecognized place instead of a generic shrug —
    // the wire layer turns this into "I don't recognize 'X'" (never the
    // dishonest "planner temporarily unavailable").
    const name = typeof constraints.origin === 'string' ? constraints.origin : null;
    emit({
      type: 'error',
      message: name
        ? `I don't recognize "${name}" as a place in the region — try a nearby town or drop a pin`
        : 'origin not resolvable to coordinates',
    });
    emit({ type: 'done', status: 'unavailable' });
    return result;
  }
  const destination = destinationLatLng(constraints);
  if (constraints.shape === 'a_to_b' && !destination) {
    // R18-4: mirror the origin guard — an unresolved place-name DESTINATION
    // previously THREW out of buildScope ('a_to_b scope requires a
    // destination'), surfacing as a raw error (measured by atob_quality:
    // Peterborough→Bancroft). Honest terminal result instead.
    const name = typeof constraints.destination === 'string' ? constraints.destination : null;
    emit({
      type: 'error',
      message: name
        ? `I don't recognize "${name}" as a place in the region — try a nearby town or drop a pin`
        : 'destination not resolvable to coordinates',
    });
    emit({ type: 'done', status: 'unavailable' });
    return result;
  }
  const isLoop = constraints.shape === 'loop';
  let durationS = constraints.duration_target_s ?? 5400; // distance-derived below (R18-4)

  // R18-4 character bundles: the levers a character ACTUALLY moves (costing
  // rides profileForRequest below; here: weights, arterial bar, duration
  // tolerance, scenic's optional viewpoint garnish)
  const bundle = CHARACTER_BUNDLES_ON ? bundleForRequest(constraints) : null;
  const baseWeights = mergeWeights(
    bundle?.weights ?? weightsForPreset(constraints.preset),
    constraints.weights,
  );
  const urbanShareBar = bundle?.urbanShareSoft ?? 0.2;
  // scenic: ONE nice-to-have viewpoint when none was asked (R17-A's detour cap
  // + stop-aware repair guard it; nice_to_have = rung 3 may drop it)
  const requestStops =
    bundle?.autoViewpointStop === true && !constraints.stops.some((x) => x.type === 'viewpoint')
      ? [
          ...constraints.stops,
          {
            type: 'viewpoint' as const,
            count: 1,
            importance: 'nice_to_have' as const,
            at_fraction: null,
          },
        ]
      : constraints.stops;
  // R18-1: the request's connector costing profile — the lever that decides
  // whether the ~90 % of meters BETWEEN waypoints are fun or fast
  const profile = profileForRequest(constraints, deps.costingMode ?? 'on');
  // R18-4: distance_target_m CONSUMED (the audit: parsed then dropped). With
  // no duration given, a "120 km loop" sizes the search by distance at the
  // profile's pace; with BOTH given and inconsistent, duration wins and the
  // tension is disclosed (validation adds the measured Tier-3 distance row).
  const distanceTargetM = constraints.distance_target_m;
  let distanceNote: string | null = null;
  if (distanceTargetM !== null) {
    const impliedS = Math.round((distanceTargetM / 1000 / profile.sizingSpeedKmh) * 3600);
    if (constraints.duration_target_s === null) {
      durationS = impliedS;
      distanceNote = `sized for ~${Math.round(distanceTargetM / 1000)} km (≈ ${Math.round(
        impliedS / 60,
      )} min at backroad pace)`;
    } else if (Math.abs(impliedS - durationS) / durationS > 0.3) {
      distanceNote = `${Math.round(distanceTargetM / 1000)} km and ${Math.round(
        durationS / 60,
      )} min don't quite agree — planning to the time`;
    }
  }

  /** ResolvedStop[] → wire-shaped stops (location = the stop's waypoint). */
  const toPlannerStops = (resolved: ResolvedStop[], candidate: WaypointCandidate): PlannerStop[] =>
    resolved.map((s) => ({
      name: s.name,
      type: s.spotType,
      requested_type: s.requestedType,
      arrival_s: s.arrivalS,
      at_fraction: s.atFraction,
      location: candidate.waypoints[s.waypointIndex]!,
      waypoint_index: s.waypointIndex,
    }));

  // --- R19 urban-context index: one cached read per area; fail-open null ---
  let urbanIndex: UrbanIndex | null = null;
  if (URBAN_CONTEXT_ON) {
    try {
      const reachDeg = 0.65; // ≥ any in-budget loop reach; quantized cache absorbs it
      const east = destination?.lng ?? origin.lng;
      const north = destination?.lat ?? origin.lat;
      urbanIndex = await urbanIndexFor(deps.db, {
        west: Math.min(origin.lng, east) - reachDeg,
        south: Math.min(origin.lat, north) - reachDeg,
        east: Math.max(origin.lng, east) + reachDeg,
        north: Math.max(origin.lat, north) + reachDeg,
      });
    } catch {
      urbanIndex = null; // measurement unavailable — nothing penalizes
    }
  }

  let params: SearchParams = initialParams(constraints);
  if (distanceNote !== null) params.disclosures.push(distanceNote);
  if (bundle !== null && bundle.durationTolerance !== DURATION_TOLERANCE_DEFAULT) {
    params = { ...params, durationTolerance: bundle.durationTolerance };
  }

  // --- R18-4 location intents: resolve ONCE (deterministic; constraints do
  // not change across ladder rungs). Roads → pinned traversal spans; towns →
  // pinned sweep points ('near'/'through') or keep-away discs ('avoid');
  // unresolved/out-of-reach → honest disclosure + relaxed validation row.
  let resolvedLocations: ResolvedLocation[] = [];
  let intentsActive = false;
  if (LOCATION_INTENTS_ON && constraints.location_constraints.length > 0) {
    intentsActive = true;
    emit({ type: 'tool_call', tool: 'resolve_locations' });
    try {
      const pad = 1.0; // ~111 km — beyond any in-budget reach
      const east = destination?.lng ?? origin.lng;
      const north = destination?.lat ?? origin.lat;
      resolvedLocations = await resolveLocations(deps.db, constraints, {
        origin,
        bbox: {
          west: Math.min(origin.lng, east) - pad,
          south: Math.min(origin.lat, north) - pad,
          east: Math.max(origin.lng, east) + pad,
          north: Math.max(origin.lat, north) + pad,
        },
        durationS: isLoop ? durationS : null,
        sizingSpeedKmh: profile.sizingSpeedKmh,
      });
      emit({
        type: 'tool_result',
        tool: 'resolve_locations',
        ok: true,
        count: resolvedLocations.length,
      });
    } catch {
      emit({ type: 'tool_result', tool: 'resolve_locations', ok: false });
    }
    for (const r of resolvedLocations) {
      if (r.disclosure !== null && !params.disclosures.includes(r.disclosure)) {
        params.disclosures.push(r.disclosure);
      }
    }
  }
  const locPointOf = (r: ResolvedLocation): LatLng | null => {
    if (r.resolution.kind === 'town') return r.resolution.point;
    if (r.resolution.kind === 'road') {
      const coords = r.resolution.segment.geometry.coordinates;
      const mid = coords[Math.floor(coords.length / 2)]!;
      return { lat: mid[1]!, lng: mid[0]! };
    }
    return null;
  };
  // 'through <road>' = traversal → pinned SPAN; 'near <road|town>' and
  // 'through <town>' = proximity → pinned POINT (anchor-snapped below)
  const pinnedSpans = resolvedLocations
    .filter((r) => r.applied && r.constraint.kind === 'through' && r.resolution.kind === 'road')
    .map(
      (r) => (r.resolution as Extract<ResolvedLocation['resolution'], { kind: 'road' }>).segment,
    );
  const pinnedTowns = resolvedLocations
    .filter(
      (r) =>
        r.applied &&
        r.constraint.kind !== 'avoid' &&
        (r.resolution.kind === 'town' ||
          (r.resolution.kind === 'road' && r.constraint.kind === 'near')),
    )
    .map((r) => locPointOf(r))
    .filter((v): v is LatLng => v !== null);
  const avoidDiscs = resolvedLocations
    .filter((r) => r.applied && r.constraint.kind === 'avoid')
    .map(locPointOf)
    .filter((v): v is LatLng => v !== null);
  const distLL = (a: LatLng, b: LatLng): number =>
    Math.hypot(
      (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)),
      (a.lat - b.lat) * 111_320,
    );
  const outsideDiscs = (pnt: LatLng): boolean =>
    avoidDiscs.every((d) => distLL(pnt, d) > AVOID_DISC_RADIUS_M);
  let best: {
    routed: {
      route: RouteThroughOutput;
      selfOverlap: number;
      closureM: number | null;
      snapOffsetM: number;
    };
    score: ScoreBreakdown;
    curviness: number;
    validation: ValidationVerdict;
    stops: PlannerStop[];
    waypoints: LatLng[];
    countryScore: number | null;
    arterialShare: number | null;
    urbanShare: number | null;
  } | null = null;
  let bestPresentKey = -Infinity;

  // --- R18-2 never-empty: least-dirty fallback material ---------------------
  // Assembly-rejected candidates that are CLOSED, ROUTABLE and violate no
  // un-relaxed hard avoid are quality-dirty, not broken — track the least-
  // offensive one so ladder exhaustion presents it with disclosure instead of
  // a dead end. Broken (open/unroutable/avoid-violating) candidates are NOT
  // fallback material.
  interface DirtyBest {
    row: {
      candidate: WaypointCandidate;
      route: RouteThroughOutput;
      selfOverlap: number;
      spursWide: number;
      retraceRunM: number;
      residentialShare: number | null;
      residentialRunM: number | null;
      countryScore: number | null;
      arterialShare: number | null;
      microloops: number;
      closureM: number | null;
      trace: import('../valhalla/trace').TraceResult | null;
    };
    units: number;
    curviness: number;
  }
  let dirtyBest: DirtyBest | null = null;
  const trackDirtyBest = (rejected: DirtyBest['row'][]): void => {
    for (const r of rejected) {
      const routable = r.route.geometry.coordinates.length >= 2 && r.route.distance_m > 0;
      const closed = r.closureM === null || r.closureM <= EPSILON_CLOSURE_M;
      const avoidClean =
        !(params.avoid.highways && r.route.has_highway) &&
        !(params.avoid.tolls && r.route.has_toll) &&
        !(params.avoid.ferries && r.route.has_ferry) &&
        !(params.avoid.unpaved && r.route.has_unpaved);
      if (!routable || !closed || !avoidClean) continue;
      const units = fallbackOffenceUnits({
        uturns: uturnCount(r.route),
        microloops: r.microloops,
        spursWide: r.spursWide,
        selfOverlap: r.selfOverlap,
        retraceRunM: r.retraceRunM,
        residentialShare: r.residentialShare,
        residentialRunM: r.residentialRunM,
        traceNull: r.trace === null,
        // R21-1: least-degenerate sliver wins the never-empty fallback too
        loopiness: SHAPE_QUALITY_ON && isLoop ? loopiness(r.route.geometry) : null,
        corridorDoubling:
          SHAPE_QUALITY_ON && isLoop ? corridorDoublingRatio(r.route.geometry, origin) : null,
      });
      const curviness = measureCurvatureClassAware(r.route.geometry, r.trace).curviness;
      const better =
        dirtyBest === null ||
        units < dirtyBest.units ||
        (units === dirtyBest.units &&
          (curviness > dirtyBest.curviness ||
            (curviness === dirtyBest.curviness && r.candidate.id < dirtyBest.row.candidate.id)));
      if (better) dirtyBest = { row: r, units, curviness };
    }
  };

  /** Present the least-dirty fallback with honest disclosure (returns false
   *  when no eligible material exists — the true redirect case). */
  const presentDirtyBest = (): boolean => {
    if (dirtyBest === null) return false;
    const { row, units, curviness } = dirtyBest;
    const effStops = params.dropNiceToHaveStops
      ? requestStops.filter((x) => x.importance === 'required')
      : requestStops;
    const resolved = resolveStopArrivals(row.candidate.stops, row.route);
    const verdict = validateCandidate(
      {
        route: row.route,
        constraints,
        closureM: row.closureM,
        selfOverlap: row.selfOverlap,
        stopCoverage: stopCoverageOf(effStops, row.candidate.stops),
        stops: resolved,
        relaxedConstraints: params.relaxedConstraints,
        ...(intentsActive ? { resolvedLocations } : {}), // R18-4 measured location-intent verdicts
      },
      { durationTolerance: params.durationTolerance },
    );
    const bits: string[] = [];
    const ut = uturnCount(row.route);
    if (ut > 0) bits.push(`includes ${ut} u-turn${ut > 1 ? 's' : ''}`);
    if (row.microloops > 0) bits.push('circles a block once');
    if (row.retraceRunM > RETRACE_RUN_SOFT_M) {
      bits.push(`repeats ${(row.retraceRunM / 1000).toFixed(1)} km of road`);
    } else if (row.selfOverlap > 0.15) {
      bits.push('repeats some pavement');
    }
    if ((row.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M) {
      bits.push('passes through a neighbourhood stretch');
    }
    if (SHAPE_QUALITY_ON && isLoop) {
      const lp = loopiness(row.route.geometry);
      const cd = corridorDoublingRatio(row.route.geometry, origin);
      if (lp !== null && lp < LOOPINESS_SOFT_FLOOR) {
        bits.push('is more of an out-and-back than a loop');
      } else if (cd !== null && cd > CORRIDOR_DOUBLING_SOFT) {
        bits.push('doubles back along the same corridor');
      }
    }
    if (bits.length === 0) bits.push(`carries ${units.toFixed(1)} quality flaws`);
    params.disclosures.push(
      `no clean loop exists around here — presenting the least-flawed option (${bits.join('; ')})`,
    );
    result.status = 'relaxed';
    result.route = row.route;
    result.curviness = curviness;
    result.score = null; // never scored against clean candidates — honest null
    result.validation = verdict;
    result.disclosures = params.disclosures;
    result.stops = toPlannerStops(resolved, row.candidate);
    result.waypoints = row.candidate.waypoints;
    result.countryScore = row.countryScore;
    result.arterialShare = row.arterialShare;
    result.urbanShare = URBAN_CONTEXT_ON
      ? urbanShareOf(urbanIndex, row.route.geometry, destination ? [origin, destination] : [origin])
      : null;
    emit({ type: 'done', status: 'relaxed' });
    return true;
  };

  // --- iteration loop (cap 3 / wall clock) ---
  for (let iteration = 1; iteration <= ITERATION_CAP && !outOfBudget(); iteration++) {
    result.iterations = iteration;

    // scope
    step(emit, 'scope', 'started');
    emit({ type: 'tool_call', tool: 'get_isochrone' });
    const scope = await buildScope(deps.valhallaUrl, {
      origin,
      shape: constraints.shape,
      durationS: Math.round(durationS * params.tauMultiplier),
      ...(destination ? { destination } : {}),
    });
    emit({
      type: 'tool_result',
      tool: 'get_isochrone',
      ok: true,
      count: scope.rings.length,
    });
    step(emit, 'scope', 'completed', `τ_out ${scope.tauOutS}s ×${params.tauMultiplier.toFixed(2)}`);

    // effective stop requests this iteration (rung 3 drops nice-to-haves) —
    // ONE definition feeds retrieve, generate, scoring, and validation so the
    // ladder's stop relaxation is consistent everywhere (R16-3)
    const effectiveStops = params.dropNiceToHaveStops
      ? requestStops.filter((s) => s.importance === 'required')
      : requestStops;

    // retrieve
    step(emit, 'retrieve', 'started');
    emit({ type: 'tool_call', tool: 'find_curvy_roads' });
    const stopTypes = effectiveStops.map((s) => s.type);
    const retrieved = await retrieveCandidates(deps.db, scope, {
      stopTypes,
      thetaCurvy: params.thetaCurvy,
    });
    emit({
      type: 'tool_result',
      tool: 'find_curvy_roads',
      ok: true,
      count: retrieved.segments.length,
    });
    if (stopTypes.length > 0) {
      emit({
        type: 'tool_result',
        tool: 'find_spots',
        ok: true,
        count: retrieved.spots.length,
      });
    }
    // R18-4 'avoid <place>': measurable keep-away discs filter the material
    // BEFORE generation — waypoints simply cannot land inside the disc
    if (avoidDiscs.length > 0) {
      const segMid = (g: (typeof retrieved.segments)[0]): LatLng => {
        const c = g.geometry.coordinates[Math.floor(g.geometry.coordinates.length / 2)]!;
        return { lat: c[1]!, lng: c[0]! };
      };
      retrieved.segments = retrieved.segments.filter((g) => outsideDiscs(segMid(g)));
      retrieved.spots = retrieved.spots.filter((sp) => outsideDiscs({ lat: sp.lat, lng: sp.lng }));
    }
    step(
      emit,
      'retrieve',
      'completed',
      `${retrieved.segments.length} segments, ${retrieved.spots.length} spots` +
        (retrieved.unavailableStopTypes.length
          ? `; unavailable stop types: ${retrieved.unavailableStopTypes.join(',')}`
          : ''),
    );
    for (const t of retrieved.unavailableStopTypes) {
      const note = `no ${t} spots exist in the region data yet — that stop type cannot be included`;
      if (!params.disclosures.includes(note)) params.disclosures.push(note);
    }

    // generate
    step(emit, 'generate_candidates', 'started');
    let anchorPoints = isLoop ? await retrieveAnchorPoints(deps.db, scope) : [];
    if (avoidDiscs.length > 0) anchorPoints = anchorPoints.filter((a) => outsideDiscs(a));
    // R18-4 'near <town>': snap the town point to the nearest ON-ROAD anchor
    // (never raw centroids — round-2 lesson) — but only a LOCAL snap: when the
    // anchor pool doesn't reach the place (measured live: a 26 km "snap"
    // silently gutted the intent), keep the raw point and let Valhalla snap
    // at routing time. A→B (no anchor pool) keeps the raw point too.
    const PIN_SNAP_MAX_M = 3_000;
    const pinnedPoints = pinnedTowns.map((t) => {
      if (anchorPoints.length === 0) return t;
      const nearest = anchorPoints.reduce((best, a) => (distLL(a, t) < distLL(best, t) ? a : best));
      return distLL(nearest, t) <= PIN_SNAP_MAX_M ? nearest : t;
    });
    // no-highway loops average backroad speeds — size clusters accordingly
    // (per-profile speeds: shortest connectors are ~10 % slower — rq18 probe)
    const sizingSpeed = params.avoid.highways
      ? profile.sizingSpeedNoHighwayKmh
      : profile.sizingSpeedKmh;
    let candidates = isLoop
      ? generateLoopCandidates(origin, retrieved.segments, retrieved.spots, {
          stopRequests: effectiveStops, // typed per-unit anchoring (R16-3)
          durationS, // duration-sized cluster choice (SPK-15)
          anchorPoints, // any-curviness return anchors (SPK-15 run 7)
          avgSpeedKmh: sizingSpeed,
          pinnedSpans, // R18-4 'through <road>' — forced, repair-immune
          pinnedPoints, // R18-4 'near <town>' — anchor-snapped sweep points
          curvyRank: TWISTY_CURVY_RANK && bundle?.id === 'twisty', // R22-1b
        })
      : generateAtoBCandidates(origin, destination!, retrieved.segments, retrieved.spots, {
          stopRequests: effectiveStops,
          pinnedSpans,
          pinnedPoints,
        });
    // R18-3 chained multi-span candidates: string 3-7 curvy spans per loop,
    // budgeted by ONE travel matrix. v1 = stop-free loop briefs; chains ADD to
    // the legacy pool (diversify/scoring pick winners). Fail-open on matrix
    // errors — the legacy pool must never be hostage to the matrix endpoint.
    let chainNote = '';
    if (isLoop && CHAIN_CANDIDATES_ON && effectiveStops.length === 0 && !outOfBudget()) {
      const pool = buildSpanPool(origin, retrieved.segments, durationS, sizingSpeed);
      if (pool.length >= CHAIN_MIN_SPANS) {
        emit({ type: 'tool_call', tool: 'travel_matrix' });
        try {
          const matrix = await travelMatrix(deps.valhallaUrl, {
            locations: chainMatrixLocations(origin, pool),
            costingOptions: profile.options,
          });
          emit({ type: 'tool_result', tool: 'travel_matrix', ok: true, count: matrix.length });
          const chains = buildChainCandidates(origin, pool, matrix, {
            durationS,
            anchorPoints,
          });
          candidates = [...chains, ...candidates];
          chainNote = `; ${chains.length} chained (pool ${pool.length} spans)`;
        } catch {
          emit({ type: 'tool_result', tool: 'travel_matrix', ok: false });
          chainNote = '; chains skipped (matrix unavailable)';
        }
      }
    }
    // R18-3 A→B corridor chains: 2-4 spans monotone by corridor progress. No
    // matrix — the binding constraint is the detour cap, re-checked exactly at
    // assembly; selection budgets by straight-line path with slack under it.
    if (!isLoop && CORRIDOR_CHAINS_ON && effectiveStops.length === 0 && !outOfBudget()) {
      const chains = buildCorridorChains(origin, destination!, retrieved.segments);
      if (chains.length > 0) {
        candidates = [...chains, ...candidates];
        chainNote = `; ${chains.length} corridor-chained`;
      }
    }
    step(
      emit,
      'generate_candidates',
      'completed',
      `${candidates.length} waypoint sets${chainNote}`,
    );

    // route all candidates in PARALLEL (§27; failures drop, never crash the run)
    step(emit, 'route_candidates', 'started');
    const routeAll = async (cands: typeof candidates) =>
      (
        await Promise.all(
          cands.map(async (candidate) => {
            try {
              if (isLoop) {
                // round 9: targeted waypoint-drop repair rides on every assembly
                const a = await assembleLoopWithRepair(
                  deps.valhallaUrl,
                  origin,
                  candidate,
                  {
                    ...profile.options, // R18-1: fun-vs-fast connector costing
                    exclude_highways: params.avoid.highways,
                    exclude_tolls: params.avoid.tolls,
                    exclude_ferries: params.avoid.ferries,
                    exclude_unpaved: params.avoid.unpaved, // best-effort; trace scan = truth (R16-2)
                  },
                  {
                    repairSegments: retrieved.segments, // round 11b INSERT material
                    shouldStop: outOfBudget, // R18-2 repair cost bound
                    ...(params.assemblyRelax ? RELAXED_ASSEMBLY_CAPS : {}), // rung 5
                  },
                );
                return {
                  // R16-fix: the REPAIRED candidate (maintained stops + waypoints)
                  // must flow downstream so arrivals/coverage/markers match a.route
                  candidate: a.candidate,
                  route: a.route,
                  selfOverlap: a.selfOverlap,
                  spursWide: a.spursWide,
                  retraceRunM: a.retraceRunM,
                  residentialShare: a.residentialShare,
                  residentialRunM: a.residentialRunM,
                  countryScore: a.countryScore,
                  arterialShare: a.arterialShare, // R18-1 honesty metric
                  microloops: a.microloops,
                  closureM: a.closureM as number | null,
                  snapOffsetM: a.snapOffsetM,
                  trace: a.trace,
                  assemblyAccepted: a.accepted,
                };
              }
              // R18-3 parity: span-atomic repair + always-trace measured truth
              const a = await assembleAtoBWithRepair(
                deps.valhallaUrl,
                origin,
                destination!,
                candidate,
                {
                  costingOptions: {
                    ...profile.options, // R18-1 (also costs the direct baseline identically)
                    exclude_highways: params.avoid.highways,
                    exclude_tolls: params.avoid.tolls,
                    exclude_ferries: params.avoid.ferries,
                    exclude_unpaved: params.avoid.unpaved, // best-effort; trace scan = truth (R16-2)
                  },
                  scanUnpaved: params.avoid.unpaved, // unpaved flag only when it matters
                  repairSegments: retrieved.segments,
                  shouldStop: outOfBudget,
                },
              );
              return {
                candidate: a.candidate, // TSP/repair may have reshaped waypoints + stops
                route: a.route,
                selfOverlap: a.selfOverlap,
                spursWide: 0,
                retraceRunM: 0,
                residentialShare: a.residentialShare, // R18-3: measured (was M6 IOU)
                residentialRunM: a.residentialRunM,
                countryScore: a.countryScore,
                arterialShare: a.arterialShare, // R18-3 A→B trace parity
                microloops: 0,
                closureM: null as number | null,
                snapOffsetM: 0, // A→B endpoints are user-chosen; no loop-pin snap story
                trace: a.trace, // R18-3: always attempted (fail-open null)
                assemblyAccepted: a.accepted,
              };
            } catch {
              return null; // no-route candidates drop; the ladder handles emptiness
            }
          }),
        )
      ).filter((r): r is NonNullable<typeof r> => r !== null);
    // R18-2: keep the assembly-REJECTED candidates too — they are the
    // least-dirty fallback material (never-empty guarantee)
    const splitBatch = (batch: Awaited<ReturnType<typeof routeAll>>) => ({
      accepted: batch.filter((r) => r.assemblyAccepted),
      rejected: batch.filter((r) => !r.assemblyAccepted),
    });
    const firstBatch = splitBatch(await routeAll(candidates));
    let routed = firstBatch.accepted;
    trackDirtyBest(firstBatch.rejected);

    // Duration-resize retry (owner rounds 3+6: "timings"): when a batch's
    // MEDIAN duration misses the target by > 25 %, the sizing speed was wrong
    // for this terrain/costing — regenerate with the speed scaled by the
    // observed miss and pool the rounds (prefixed ids never collide). Up to
    // TWO attempts (round 6); each attempt's trigger is judged on the LATEST
    // batch so early bad candidates don't mask a converged regeneration.
    let resizeNote = '';
    if (isLoop && constraints.duration_target_s !== null) {
      const target = constraints.duration_target_s;
      let sizingV = sizingSpeed;
      let batch = routed;
      for (let attempt = 1; attempt <= 2 && batch.length > 0 && !outOfBudget(); attempt++) {
        const durs = batch.map((r) => r.route.duration_s).sort((a, b) => a - b);
        const median = durs[Math.floor(durs.length / 2)]!;
        if (Math.abs(median - target) / target <= RESIZE_TRIGGER) break;
        sizingV = resizedSpeed(sizingV, target, median);
        const resized = generateLoopCandidates(origin, retrieved.segments, retrieved.spots, {
          stopRequests: effectiveStops,
          durationS,
          anchorPoints,
          avgSpeedKmh: sizingV,
          idPrefix: `rz${attempt}-`,
          pinnedSpans, // pins survive the resize regeneration too
          pinnedPoints,
          curvyRank: TWISTY_CURVY_RANK && bundle?.id === 'twisty', // R22-1b
        });
        const resizedBatch = splitBatch(await routeAll(resized));
        trackDirtyBest(resizedBatch.rejected);
        batch = resizedBatch.accepted;
        routed = [...routed, ...batch];
        resizeNote += `; resized (median ${Math.round(median / 60)} vs target ${Math.round(
          target / 60,
        )} min → v ${Math.round(sizingV)} km/h)`;
      }
    }
    step(
      emit,
      'route_candidates',
      'completed',
      `${routed.length} routable candidates${resizeNote}`,
    );

    // score (curvature measured on FINAL geometry) + diversify + validate
    step(emit, 'score_rank', 'started');
    const durationFiltered = prefilterByDuration(
      routed,
      constraints.duration_target_s,
      (r) => r.route.duration_s,
    );
    const scored = durationFiltered.map((r) => {
      const curv = measureCurvatureClassAware(r.route.geometry, r.trace); // round 15/FB-5
      // per-type coverage (R16-3): coffee-covered/fuel-missing scores 0.5, not 1
      const coverage = stopCoverageOf(effectiveStops, r.candidate.stops);
      const breakdown = scoreCandidate(
        {
          route: r.route,
          selfOverlap: r.selfOverlap,
          durationTargetS: constraints.duration_target_s,
          curviness: curv.curviness,
          twistinessPref: constraints.twistiness_pref,
          stopCover: stopCoverScore(coverage),
          scenicSignal: 0, // gated ([GATE-S]); no numeric scenic input yet
          countryScore: r.countryScore, // round 11
        },
        baseWeights,
      );
      // R21-1 loop-shape degeneracy (loops only; null when OFF / not a loop →
      // every downstream use is a no-op). Loopiness is the grid-free primary
      // signal; corridor doubling the secondary.
      const shapeLoopiness = SHAPE_QUALITY_ON && isLoop ? loopiness(r.route.geometry) : null;
      const shapeCorridor =
        SHAPE_QUALITY_ON && isLoop ? corridorDoublingRatio(r.route.geometry, origin) : null;
      // presentation key: any u-turn, wide-window spur (block spins), or
      // notable there-and-back ranks below every clean route (rounds 2–6) —
      // last-resort material, never preferred content
      const dirty =
        uturnCount(r.route) > 0 ||
        r.spursWide > 0 ||
        r.retraceRunM > RETRACE_RUN_SOFT_M ||
        (r.residentialShare ?? 0) > RESIDENTIAL_SOFT_SHARE || // round 7
        (r.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M || // round 8b
        r.microloops > 0 || // round 8
        // R21-1: degenerate loop shape + the previously-inert 0.15-0.30 self-
        // overlap units (all null/off → false → byte-identical no-op)
        (shapeLoopiness !== null && shapeLoopiness < LOOPINESS_SOFT_FLOOR) ||
        (shapeCorridor !== null && shapeCorridor > CORRIDOR_DOUBLING_SOFT) ||
        (SHAPE_QUALITY_ON && isLoop && r.selfOverlap > SELF_OVERLAP_CAP);
      // round 14: an on-target route outranks a shorter one of the same
      // quality tier (2nd lexicographic tier, below quality)
      const durOff =
        constraints.duration_target_s !== null &&
        Math.abs(r.route.duration_s - constraints.duration_target_s) /
          constraints.duration_target_s >
          DURATION_TOLERANCE_DEFAULT;
      // R19: third lexicographic tier — a clean on-target COUNTRY-context
      // route beats a clean on-target TOWN-context one (2 < 5 < 10 keeps
      // tiers strict). Supersedes R18-1/4's arterial bars per the owner's
      // correction ("main roads are fine when surrounded by fields") —
      // measured: a 90 %-arterial Caledon East loop is 0.04 urban and must
      // NOT demote. Null share (index unavailable) is never penalized;
      // URBAN_CONTEXT_ON=false restores the arterial-bar behavior.
      const urbanShare = URBAN_CONTEXT_ON
        ? urbanShareOf(
            urbanIndex,
            r.route.geometry,
            destination ? [origin, destination] : [origin], // grace: town-exit is not the route's fault
          )
        : null;
      const contextHeavy = URBAN_CONTEXT_ON
        ? urbanShare !== null && urbanShare > urbanShareBar
        : (profile.id === 'fun' || profile.id === 'backroads') &&
          r.arterialShare !== null &&
          r.arterialShare > ARTERIAL_SHARE_SOFT;
      // R18-2 graded dirtiness: within the dirty tier, least-offence wins
      // (fixes BD-56's single-offence pass-through); grade 0 when clean.
      const units = fallbackOffenceUnits({
        uturns: uturnCount(r.route),
        microloops: r.microloops,
        spursWide: r.spursWide,
        selfOverlap: r.selfOverlap,
        retraceRunM: r.retraceRunM,
        residentialShare: r.residentialShare,
        residentialRunM: r.residentialRunM,
        traceNull: r.trace === null,
        loopiness: shapeLoopiness, // R21-1 (null → 0)
        corridorDoubling: shapeCorridor,
      });
      // R18-2 within-tier duration grade: closes the 10-20 % dead band without
      // touching the BD-42 tier order (grade max 2 < 5 < 10).
      const durGrade = durationGradeOf(r.route.duration_s, constraints.duration_target_s);
      const presentKey =
        breakdown.score -
        dirtyPenaltyOf(dirty, units) -
        (durOff ? PRESENT_TIER_DUROFF : 0) -
        (contextHeavy ? ARTERIAL_PRESENT_PENALTY : 0) - // R19: urban context tier
        durGrade;
      return { r, curv, breakdown, presentKey, urbanShare };
    });
    step(emit, 'score_rank', 'completed', `${scored.length} scored`);

    step(emit, 'diversify', 'started');
    const diversified = diversify(
      scored.map((s) => ({
        id: s.r.candidate.id,
        score: s.presentKey,
        geometry: s.r.route.geometry,
        payload: s,
      })),
    );
    step(emit, 'diversify', 'completed', `${diversified.kept.length} distinct kept`);

    step(emit, 'validate_route', 'started');
    let feasibleThisRound = 0;
    const feasibles: PlannerAlternate[] = []; // this iteration's runner-up pool (FB-4)
    for (const kept of diversified.kept) {
      const s = (kept as { payload: (typeof scored)[number] }).payload;
      // measured arrivals from the break_through legs (R16-3) — feeds both the
      // Tier-3 timing verdicts and the result payload
      const resolved = resolveStopArrivals(s.r.candidate.stops, s.r.route);
      const verdict = validateCandidate(
        {
          route: s.r.route,
          constraints,
          closureM: s.r.closureM,
          selfOverlap: s.r.selfOverlap,
          stopCoverage: stopCoverageOf(effectiveStops, s.r.candidate.stops),
          stops: resolved,
          relaxedConstraints: params.relaxedConstraints,
          ...(intentsActive ? { resolvedLocations } : {}), // R18-4 measured location-intent verdicts
        },
        { durationTolerance: params.durationTolerance },
      );
      if (!verdict.feasible) continue;
      feasibleThisRound++;
      const plannerStops = toPlannerStops(resolved, s.r.candidate);
      feasibles.push({
        route: s.r.route,
        curviness: s.curv.curviness,
        validation: verdict,
        presentKey: s.presentKey,
        stops: plannerStops,
        waypoints: s.r.candidate.waypoints,
        countryScore: s.r.countryScore,
        arterialShare: s.r.arterialShare,
        urbanShare: s.urbanShare,
      });
      if (!best || s.presentKey > bestPresentKey) {
        bestPresentKey = s.presentKey;
        best = {
          routed: {
            route: s.r.route,
            selfOverlap: s.r.selfOverlap,
            closureM: s.r.closureM,
            snapOffsetM: s.r.snapOffsetM,
          },
          score: s.breakdown,
          curviness: s.curv.curviness,
          validation: verdict,
          stops: plannerStops,
          waypoints: s.r.candidate.waypoints,
          countryScore: s.r.countryScore,
          arterialShare: s.r.arterialShare,
          urbanShare: s.urbanShare,
        };
      }
    }
    step(emit, 'validate_route', 'completed', `${feasibleThisRound} feasible`);

    if (best) {
      // runner-up options: the same diversify-kept feasible pool, minus the
      // best (identity — same objects), deterministic presentKey order
      const chosen = best.routed.route;
      result.alternates = feasibles
        .filter((f) => f.route !== chosen)
        .sort((a, b) => b.presentKey - a.presentKey)
        .slice(0, 3);
      break; // stopping condition: a feasible candidate exists (§3.6)
    }

    // no feasible candidate — climb the ladder (R18-2: with pool telemetry so
    // a Wall-A-dead iteration fast-forwards to the assembly-relax rung)
    step(emit, 'self_correct', 'started');
    const outcome = nextRelaxation(params, { assembledCount: routed.length });
    if (outcome.kind === 'redirect') {
      // R18-2 never-empty: before any dead end, present the least-dirty
      // closed/routable candidate with honest disclosure
      if (presentDirtyBest()) {
        step(emit, 'self_correct', 'completed', 'ladder exhausted — least-flawed fallback');
        return result;
      }
      step(emit, 'self_correct', 'completed', 'ladder exhausted — redirect');
      result.status = 'redirect';
      result.disclosures = outcome.disclosures;
      emit({ type: 'done', status: 'unavailable' });
      return result;
    }
    params = outcome.params;
    step(emit, 'self_correct', 'completed', params.disclosures[params.disclosures.length - 1]);
  }

  if (!best) {
    // R18-2 never-empty: iteration/budget exhaustion also falls back before
    // giving up (redirect survives only for truly unroutable requests)
    if (presentDirtyBest()) return result;
    result.status = outOfBudget() ? 'unavailable' : 'redirect';
    result.disclosures = params.disclosures;
    emit({ type: 'done', status: 'unavailable' });
    return result;
  }

  // --- enrich (elevation; honest null when unavailable) ---
  step(emit, 'enrich', 'started');
  emit({ type: 'tool_call', tool: 'get_elevation_profile' });
  let climb: { climb_m: number } | null = null;
  try {
    const profile = await getElevationProfile(deps.valhallaUrl, best.routed.route.geometry);
    climb = profile ? { climb_m: profile.climb_m } : null;
    emit({ type: 'tool_result', tool: 'get_elevation_profile', ok: profile !== null });
  } catch {
    emit({ type: 'tool_result', tool: 'get_elevation_profile', ok: false });
  }
  step(
    emit,
    'enrich',
    'completed',
    climb ? `climb ${Math.round(climb.climb_m)} m` : 'no elevation',
  );

  // R18-2: an off-road pin is disclosed, never silently teleported
  if (best.routed.snapOffsetM > 150) {
    params.disclosures.push(
      `the drive starts ~${Math.round(best.routed.snapOffsetM)} m from your pin — the nearest drivable road`,
    );
  }
  result.status =
    params.relaxedConstraints.length > 0 || params.disclosures.length > 0 ? 'relaxed' : 'ok';
  if (outOfBudget()) result.status = 'best_so_far';
  result.route = best.routed.route;
  result.curviness = best.curviness;
  result.score = best.score;
  result.validation = best.validation;
  result.disclosures = params.disclosures;
  result.elevation = climb;
  result.stops = best.stops;
  result.waypoints = best.waypoints;
  result.countryScore = best.countryScore;
  result.arterialShare = best.arterialShare;
  result.urbanShare = best.urbanShare;
  // R19 honest expectation-setting: when the chosen drive spends real time in
  // town before it opens up, SAY so (arterial-locked origins — the audit's
  // "20-30 min commute to the good stuff" finding, disclosed not hidden).
  if (URBAN_CONTEXT_ON && urbanIndex !== null && result.route !== null) {
    const introM = urbanIntroM(urbanIndex, result.route.geometry);
    if (introM !== null && result.route.distance_m > 0) {
      const introMin = Math.round(
        ((introM / result.route.distance_m) * result.route.duration_s) / 60,
      );
      if (introMin >= 8) {
        result.disclosures.push(
          `about ${introMin} min through town/main streets before the drive opens up — the nearest countryside is a reach from this start`,
        );
      }
    }
  }
  // R21-4 honesty coverage: disclose the caveats a presented best carries, so
  // the driver isn't surprised (audit #11 undisclosed u-turns, #13 silent
  // duration tails, #3/#5 slivers). Informational only — added AFTER the status
  // decision above, so an otherwise-clean route keeps status 'ok' and never
  // silently flips to 'relaxed'; and they change no route selection.
  if (result.route !== null) {
    const ut = uturnCount(result.route);
    if (ut > 0) {
      result.disclosures.push(
        `includes ${ut} u-turn${ut > 1 ? 's' : ''} — the roads here need a turnaround to link the good stretches`,
      );
    }
    const target = constraints.duration_target_s;
    if (target !== null && target > 0) {
      const err = (result.route.duration_s - target) / target;
      if (Math.abs(err) > RESIZE_TRIGGER) {
        result.disclosures.push(
          `about ${Math.round(result.route.duration_s / 60)} min — a bit ${
            err < 0 ? 'under' : 'over'
          } the ${Math.round(target / 60)} you asked; the roads here don’t form a cleaner loop at that exact length`,
        );
      }
    }
    if (isLoop) {
      const lp = loopiness(result.route.geometry);
      if (lp !== null && lp < LOOPINESS_DISCLOSE_FLOOR) {
        result.disclosures.push(
          'this is more of an out-and-back than a loop — the roads here don’t form a tighter circuit',
        );
      }
    }
  }
  emit({
    type: 'done',
    status:
      result.status === 'ok'
        ? 'ok'
        : result.status === 'relaxed'
          ? 'relaxed'
          : result.status === 'best_so_far'
            ? 'best_so_far'
            : 'unavailable',
  });
  return result;
}
