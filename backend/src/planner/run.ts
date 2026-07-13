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

import type { GenerationEvent, LatLng, ParsedConstraints, RouteThroughOutput } from '@shared/types';
import { resolveDisposition } from '@shared/types';
import type { Client } from 'pg';

import { getElevationProfile } from '../valhalla/elevation';

import { assembleAtoB } from './atob';
import { generateAtoBCandidates, generateLoopCandidates, resizedSpeed } from './candidates';
import { measureCurvature } from './curvature';
import { diversify, prefilterByDuration } from './diversify';
import {
  assembleLoopWithRepair,
  RESIDENTIAL_RUN_SOFT_M,
  RESIDENTIAL_SOFT_SHARE,
  RETRACE_RUN_SOFT_M,
} from './loop';
import { weightsForPreset } from './presets';
import { initialParams, nextRelaxation, type SearchParams } from './relax';
import { retrieveAnchorPoints, retrieveCandidates } from './retrieve';
import { buildScope } from './scope';
import {
  DURATION_PRESENT_PENALTY,
  mergeWeights,
  scoreCandidate,
  uturnCount,
  UTURN_PRESENT_PENALTY,
  type ScoreBreakdown,
} from './score';
import { DURATION_TOLERANCE_DEFAULT, validateCandidate, type ValidationVerdict } from './validate';

export const WALL_CLOCK_BUDGET_MS = 25_000;
export const ITERATION_CAP = 3;

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
    // unresolved place-name origins need geocoding (M6); honest unavailable for now
    emit({ type: 'error', message: 'origin not resolvable to coordinates yet' });
    emit({ type: 'done', status: 'unavailable' });
    return result;
  }
  const destination = destinationLatLng(constraints);
  const isLoop = constraints.shape === 'loop';
  const durationS = constraints.duration_target_s ?? 5400;

  const baseWeights = mergeWeights(weightsForPreset(constraints.preset), constraints.weights);
  const requestedStopCount = constraints.stops.reduce((s, x) => s + x.count, 0);

  let params: SearchParams = initialParams(constraints);
  let best: {
    routed: {
      route: RouteThroughOutput;
      selfOverlap: number;
      candidateSpotCount: number;
      closureM: number | null;
    };
    score: ScoreBreakdown;
    curviness: number;
    validation: ValidationVerdict;
  } | null = null;
  let bestPresentKey = -Infinity;

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

    // retrieve
    step(emit, 'retrieve', 'started');
    emit({ type: 'tool_call', tool: 'find_curvy_roads' });
    const stopTypes = (
      params.dropNiceToHaveStops
        ? constraints.stops.filter((s) => s.importance === 'required')
        : constraints.stops
    ).map((s) => s.type);
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
    const anchorPoints = isLoop ? await retrieveAnchorPoints(deps.db, scope) : [];
    // no-highway loops average backroad speeds — size clusters accordingly
    const sizingSpeed = params.avoid.highways ? 42 : 55;
    const candidates = isLoop
      ? generateLoopCandidates(origin, retrieved.segments, retrieved.spots, {
          anchorSpots: retrieved.spots.length > 0,
          durationS, // duration-sized cluster choice (SPK-15)
          anchorPoints, // any-curviness return anchors (SPK-15 run 7)
          avgSpeedKmh: sizingSpeed,
        })
      : generateAtoBCandidates(origin, destination!, retrieved.segments, retrieved.spots, {
          anchorSpots: retrieved.spots.length > 0,
        });
    step(emit, 'generate_candidates', 'completed', `${candidates.length} waypoint sets`);

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
                    exclude_highways: params.avoid.highways,
                    exclude_tolls: params.avoid.tolls,
                    exclude_ferries: params.avoid.ferries,
                  },
                  { repairSegments: retrieved.segments }, // round 11b INSERT material
                );
                return {
                  candidate,
                  route: a.route,
                  selfOverlap: a.selfOverlap,
                  spursWide: a.spursWide,
                  retraceRunM: a.retraceRunM,
                  residentialShare: a.residentialShare,
                  residentialRunM: a.residentialRunM,
                  countryScore: a.countryScore,
                  microloops: a.microloops,
                  closureM: a.closureM as number | null,
                  assemblyAccepted: a.accepted,
                };
              }
              const a = await assembleAtoB(deps.valhallaUrl, origin, destination!, candidate, {
                costingOptions: {
                  exclude_highways: params.avoid.highways,
                  exclude_tolls: params.avoid.tolls,
                  exclude_ferries: params.avoid.ferries,
                },
              });
              return {
                candidate,
                route: a.route,
                selfOverlap: a.selfOverlap,
                spursWide: 0,
                retraceRunM: 0,
                residentialShare: null as number | null, // A→B: measured at M6
                residentialRunM: null as number | null,
                countryScore: null as number | null,
                microloops: 0,
                closureM: null as number | null,
                assemblyAccepted: a.accepted,
              };
            } catch {
              return null; // no-route candidates drop; the ladder handles emptiness
            }
          }),
        )
      ).filter((r): r is NonNullable<typeof r> => r !== null && r.assemblyAccepted);
    let routed = await routeAll(candidates);

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
        if (Math.abs(median - target) / target <= 0.25) break;
        sizingV = resizedSpeed(sizingV, target, median);
        const resized = generateLoopCandidates(origin, retrieved.segments, retrieved.spots, {
          anchorSpots: retrieved.spots.length > 0,
          durationS,
          anchorPoints,
          avgSpeedKmh: sizingV,
          idPrefix: `rz${attempt}-`,
        });
        batch = await routeAll(resized);
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
      const curv = measureCurvature(r.route.geometry);
      const spotCount = r.candidate.spotIds.length;
      const breakdown = scoreCandidate(
        {
          route: r.route,
          selfOverlap: r.selfOverlap,
          durationTargetS: constraints.duration_target_s,
          curviness: curv.curviness,
          twistinessPref: constraints.twistiness_pref,
          stopCover: requestedStopCount > 0 ? Math.min(1, spotCount / requestedStopCount) : 1,
          scenicSignal: 0, // gated ([GATE-S]); no numeric scenic input yet
          countryScore: r.countryScore, // round 11
        },
        baseWeights,
      );
      // presentation key: any u-turn, wide-window spur (block spins), or
      // notable there-and-back ranks below every clean route (rounds 2–6) —
      // last-resort material, never preferred content
      const dirty =
        uturnCount(r.route) > 0 ||
        r.spursWide > 0 ||
        r.retraceRunM > RETRACE_RUN_SOFT_M ||
        (r.residentialShare ?? 0) > RESIDENTIAL_SOFT_SHARE || // round 7
        (r.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M || // round 8b
        r.microloops > 0; // round 8
      // round 14: an on-target route outranks a shorter one of the same
      // quality tier (2nd lexicographic tier, below quality)
      const durOff =
        constraints.duration_target_s !== null &&
        Math.abs(r.route.duration_s - constraints.duration_target_s) /
          constraints.duration_target_s >
          DURATION_TOLERANCE_DEFAULT;
      const presentKey =
        breakdown.score -
        (dirty ? UTURN_PRESENT_PENALTY : 0) -
        (durOff ? DURATION_PRESENT_PENALTY : 0);
      return { r, curv, breakdown, presentKey };
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
    for (const kept of diversified.kept) {
      const s = (kept as { payload: (typeof scored)[number] }).payload;
      const verdict = validateCandidate(
        {
          route: s.r.route,
          constraints,
          closureM: s.r.closureM,
          selfOverlap: s.r.selfOverlap,
          includedStops: s.r.candidate.spotIds.length,
          requestedStops: params.dropNiceToHaveStops
            ? constraints.stops
                .filter((x) => x.importance === 'required')
                .reduce((a, x) => a + x.count, 0)
            : requestedStopCount,
          relaxedConstraints: params.relaxedConstraints,
        },
        { durationTolerance: params.durationTolerance },
      );
      if (!verdict.feasible) continue;
      feasibleThisRound++;
      if (!best || s.presentKey > bestPresentKey) {
        bestPresentKey = s.presentKey;
        best = {
          routed: {
            route: s.r.route,
            selfOverlap: s.r.selfOverlap,
            candidateSpotCount: s.r.candidate.spotIds.length,
            closureM: s.r.closureM,
          },
          score: s.breakdown,
          curviness: s.curv.curviness,
          validation: verdict,
        };
      }
    }
    step(emit, 'validate_route', 'completed', `${feasibleThisRound} feasible`);

    if (best) break; // stopping condition: a feasible candidate exists (§3.6)

    // no feasible candidate — climb the ladder
    step(emit, 'self_correct', 'started');
    const outcome = nextRelaxation(params);
    if (outcome.kind === 'redirect') {
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

  result.status =
    params.relaxedConstraints.length > 0 || params.disclosures.length > 0 ? 'relaxed' : 'ok';
  if (outOfBudget()) result.status = 'best_so_far';
  result.route = best.routed.route;
  result.curviness = best.curviness;
  result.score = best.score;
  result.validation = best.validation;
  result.disclosures = params.disclosures;
  result.elevation = climb;
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
