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
  CharacterTag,
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
import { traceRoadClasses } from '../valhalla/trace';

import { assembleAtoBWithRepair, ATOB_ASSEMBLY_RELAX_ON } from './atob';
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
import { CONNECTOR_KEY_TOLERANCE, CONNECTOR_REFINE_ON, refineLoopFinalist } from './connectors';
import { CORE_REACH_FRAC, CORE_SEED_MAX, CORE_SEED_ON, coreSeedCandidates } from './core_seed';
import { profileExcludesHighways, profileForRequest, type CostingMode } from './costing';
import { selfIntersections, summarizeCrossings } from './crossings';
import { measureCurvatureClassAware } from './curvature';
import { CORES_BROWSE_LIMIT, DRIVE_CORES_VERSION, readDriveCores } from './discover_cores';
import { diversify, prefilterByDuration } from './diversify';
import { DRIVE_FIRST_ON, readDriveFirstCores } from './drive_first';
import { atobDriveFirst, ATOB_DRIVE_FIRST_ON } from './drive_first_atob';
import { driveFirstTrip, STATS_PROVENANCE_MIN } from './drive_first_trip';
import { driveGeometry, splitLoopLegs, type LegSplit } from './legs';
import {
  assembleLoop,
  assembleLoopWithRepair,
  EPSILON_CLOSURE_M,
  OUT_AND_BACK_REJECT_M,
  RELAXED_ASSEMBLY_CAPS,
  RESIDENTIAL_RUN_SOFT_M,
  SELF_OVERLAP_RELAXED,
  RESIDENTIAL_SOFT_SHARE,
  RETRACE_RUN_SOFT_M,
  SELF_OVERLAP_CAP,
} from './loop';
import { computeOriginStem, STEM_ON } from './origin_stem';
import { outAndBack } from './outandback';
import { corridorDoublingRatio, loopiness } from './overlap';
import { weightsForPreset } from './presets';
import { initialParams, nextRelaxation, type SearchParams } from './relax';
import { AVOID_DISC_RADIUS_M, resolveLocations, type ResolvedLocation } from './resolve_locations';
import { retrieveAnchorPoints, retrieveCandidates } from './retrieve';
import { revisitCount } from './revisit';
import {
  chainRibbons,
  RIBBON_CHAINS_ON,
  ribbonMatrixLocations,
  ribbonPool,
  ribbonsAsSegments,
} from './ribbon_chain';
import { classMixOf, type ClassMix } from './roadclass';
import { buildScope } from './scope';
import {
  ARTERIAL_SHARE_SOFT,
  CORRIDOR_DOUBLING_SOFT,
  DUR_HARD_TIER_ON,
  DURATION_HARD_ERR,
  fallbackOffenceUnits,
  LOOPINESS_SOFT_FLOOR,
  mergeWeights,
  presentationKey,
  scoreCandidate,
  TRACE_NULL_STRICT_ON,
  uturnCount,
  type ScoreBreakdown,
} from './score';
import { resolveStopArrivals, stopCoverageOf, stopCoverScore, type ResolvedStop } from './stops';
import { TRIP_EXACT_BAND, tripShapeMetrics } from './trip_gates';
import {
  URBAN_CONTEXT_ON,
  urbanIndexFor,
  urbanIntroM,
  urbanShareOf,
  type UrbanIndex,
} from './urban';
import { DURATION_TOLERANCE_DEFAULT, validateCandidate, type ValidationVerdict } from './validate';

/** R29 Unit C — ribbons in the A→B corridor pool. OFF = byte-identical. */
const RIBBON_ATOB_ON = (process.env['RIBBON_ATOB'] ?? 'off') !== 'off';

export const WALL_CLOCK_BUDGET_MS = 25_000;
/** R34-U8: nothing structurally dirty ships — the legacy pipeline's output
 *  passes the same final judge as measured trips, or the result is an honest
 *  no-clean state. Off = pre-R34 serving. */
export const CLEAN_ALTERNATIVES_ON = (process.env['CLEAN_DURATION_ALTERNATIVES'] ?? 'on') !== 'off';
/** R36 (BD-169): an out-of-band clean ALTERNATE no longer preempts the legacy
 *  generator — it is HELD while legacy tries for the exact band, and the
 *  better serve wins at the exits (rq36 measured the preemption: Uxbridge
 *  60-min ask served 97 min while a clean 66-min legacy loop existed).
 *  Off = the R34-U8 behavior, byte-identical. */
export const ALT_HOLD_LEGACY_ON = (process.env['ALT_HOLD_LEGACY'] ?? 'on') !== 'off';
/** R18-2: 3 → 5 so the ladder's deeper rungs (soft-relax, avoid-relax,
 *  assembly-relax) actually EXECUTE — under 3, rungs 3-4 never ran. Budget
 *  seams unchanged; worst case ≈ 18 s < 25 s. */
export const ITERATION_CAP = 5;
/** R18-2: resize fires at a 15 % median miss (was 25 % — the 10-20 % zone sat
 *  in a dead band between this trigger and the 20 % presentation demotion). */
export const RESIZE_TRIGGER = 0.15;
/**
 * R25-U7b — a THIRD resize attempt (audit-v11: 7/60 loops over the asked time
 * by >25 %, worst +93 %). resizedSpeed scales by the observed miss, so each
 * attempt roughly halves the error; two attempts strand briefs whose terrain
 * speed is far from the 38/50 km/h prior. One more regeneration only ever runs
 * when attempt 2 STILL misses the median trigger — the common case pays zero.
 */
export const RESIZE_ATTEMPTS_3_ON = process.env['RESIZE_ATTEMPTS_3'] === 'on';
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
 * tier order is preserved by construction (dirtyPenaltyOf caps at
 * TIER_DIRTY + DIRTY_GRADE_CAP — 230 under the R25 V2 cap, 204.5 with
 * HOOD_MEASURE_V2=off; both far below the next tier).
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
 * like the default (byte-identical). Replaced the REFUTED retrieval-θ notch
 * (BD-69: retrieval is already curviest-first, so a θ floor was inert).
 *
 * R23 — ROLLED BACK (BD-74 reverses the BD-70 adoption). Audit-v6 showed the
 * lever is a coin-flip, not reliably better: +8 origins / −7 (Terra Cotta
 * 1.18 → 0.00), because emphasising a single road's curviness can pick a
 * twistier road that makes a LESS curvy overall loop. The owner collapsed the
 * "Twisty" tier entirely (R23 2-stop Direct/Scenic-backroads), so no twisty
 * ask remains. OFF = byte-identical to the default; the plumbing stays dormant
 * (BD-40 re-runnability), like CHAIN_CANDIDATES_ON below.
 *
 * A/B (this session, 48-brief fixed suite): ON hash fbec02d22906a45a (17/48
 * AC) vs OFF hash 129ab3f744330649 (16/48 AC) — the flag was marginally better
 * on the bench (why BD-70 adopted it), but audit-v6 on random origins showed a
 * coin-flip (+8/−7). OFF is the pre-R22-1 baseline; rankVal → c.weight.
 */
export const TWISTY_CURVY_RANK = false;
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
 *
 * R24-U14/U15 — REFUSED AGAIN (4th time; 2026-07-22, 48-brief A/B vs the U1
 * τ_ref=8 baseline). U1's de-switchback RE-PRICING (effectiveCurviness) was the
 * "plausible lever" this note named — flipping chains ON with it moved curvyShare
 * only 0.11 → 0.12 (+1 pp; PRIMARY bar was ≥ +10 pp), arterial share stayed FLAT
 * (71 → 70 %), and wall time blew to 14 980 ms (baseline 8 665; kill-condition
 * ≤ +1-2 s). AC did rise 20 → 24, but the PRIMARY curvyShare bar + the latency
 * kill-condition both fail. ROOT CAUSE (structural, not a pricing miss): the
 * CONNECTORS between scattered curvy spans ride arterials, so no span re-pricing,
 * ordering, or hard angular-monotone closure moves the arterial share — a
 * beam-search rebuild would hit the same wall. The full LOOP_PATHSEARCH_ON
 * rebuild was therefore NOT built. Loop quality ships on U1's de-switchback
 * alone (the felt "too many turns" fix). Env-gated default OFF (byte-identical);
 * CHAIN_CANDIDATES=on re-runs the experiment.
 */
export const CHAIN_CANDIDATES_ON = process.env['CHAIN_CANDIDATES'] === 'on';
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
  /** R25-U6a — pure observability: called once per iteration with the FULL
   *  presentation-key decomposition of every scored candidate. Never changes
   *  selection (read-only snapshot); exists so the A→B loss diagnostic can ask
   *  "why did the 61 %-arterial chain lose to the 89 %-arterial single-touch?"
   *  with recorded answers instead of guesses. */
  onScored?: (rows: ScoredDebugRow[]) => void;
}

/** R25-U6a — one scored candidate's decomposition (observability only). */
export interface ScoredDebugRow {
  id: string;
  score: number;
  presentKey: number;
  dirty: boolean;
  /** WHICH dirty clauses fired (empty when clean) — the diagnostic's branch (i). */
  dirtyClauses: string[];
  units: number;
  durOff: boolean;
  contextHeavy: boolean;
  urbanShare: number | null;
  curviness: number;
  durationS: number;
  distanceM: number;
  selfOverlap: number;
  uturns: number;
  spursWide: number;
  microloops: number;
  retraceRunM: number;
  residentialShare: number | null;
  residentialRunM: number | null;
  arterialShare: number | null;
  classMix: ClassMix | null;
  backroadLongestM: number | null;
  /** R27 — longest stretch driven twice, metres. */
  outAndBackLongestM: number | null;
  traceNull: boolean;
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
  /** R25-U0 road-class truth of the chosen route (audit-v11 buckets);
   *  optional so minimal results (out-and-back, early exits) stay valid. */
  classMix?: ClassMix | null;
  /**
   * R27 — the three-leg split of a loop: getting there · THE DRIVE · getting
   * home, with the drive's own measured road class. audit-v14 measured the
   * escape from the door at 83 % main+urban against 34 % in the middle, and
   * nearly HALF of a "90 minute loop" being the commute to and from it. Every
   * number the app showed averaged those together, which is why the road-class
   * figure could never be moved by any routing lever. null = not a loop, or no
   * meaningful drive span (see splitLoopLegs' minDriveFrac).
   */
  legs?: {
    therePct: number;
    drivePct: number;
    homePct: number;
    thereM: number;
    driveM: number;
    homeM: number;
    /** Road class of the DRIVE alone, % of its traced metres. */
    driveBackroadPct: number | null;
    driveMainPct: number | null;
  } | null;
  /** R25-U0 backroad continuity of the chosen route (m). */
  backroadLongestM?: number | null;
  backroadMeanM?: number | null;
  /** R25-U0 longest hood-class run (m), ungraced. */
  hoodRunM?: number | null;
  /** R25-U0 flow: maneuvers per 10 driving minutes. */
  turnsPer10min?: number | null;
  /** R25-U8b — character treatments that actually RAN (derived from the
   *  resolved bundle, never copied from the ask). The route payload and the
   *  explain prompt read THIS, so the narration physically cannot claim a
   *  treatment that never happened (audit-v11 issue #10: 'scenic' tagged on
   *  routes that got zero scenic handling). Optional: minimal results omit it. */
  characterApplied?: CharacterTag[];
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

  // R30 (BD-146, the owner's ruler) — DRIVE-FIRST TRIP, judged AS DRIVEN.
  // The ask means the WHOLE TRIP: a measured core is picked so that
  // out + drive + home fits the requested time, the commutes route DIRECT
  // (a person driving to the fun road), and `judgeTrip` REJECTS any candidate
  // that misses the ask, doesn't look like a loop, doubles, stubs, or is
  // mostly commute. R29's drive-only ruler (BD-135/142) measured as 106 min
  // served for a 60-minute ask with 0.14 loopiness — the owner drove it and
  // overrode it. Fail-open: nothing passes → the legacy planner runs
  // unchanged, and the trace says exactly which gates killed which cores.
  // R35-U11: the unavoidable-origin stem, measured ONCE per loop request
  // (8 fastest probes to compass targets; ~0.4 s) — replaces the fixed 1 km
  // doubling grace with network-proven necessity, for the trip gates AND the
  // final judge. Long stems are disclosed on served results.
  let originStemM: number | null = null;
  if (isLoop && STEM_ON) {
    originStemM = await computeOriginStem(deps.valhallaUrl, origin, {
      ...(constraints.avoid.highways === true ? { exclude_highways: true } : {}),
    });
  }
  // R36 (BD-169): a clean out-of-band alternate HELD while the legacy pipeline
  // tries for the exact band. `heldAlternate` replays the drive-first serve;
  // `restoreHeld` first resets every field legacy may have touched.
  let heldAlternate: (() => void) | null = null;
  let heldServeBase: string[] = [];
  const restoreHeld = (): void => {
    result.route = null;
    result.curviness = null;
    result.score = null;
    result.validation = null;
    result.disclosures = [...heldServeBase];
    result.elevation = null;
    result.legs = null;
    result.classMix = null;
    result.backroadLongestM = null;
    result.backroadMeanM = null;
    result.hoodRunM = null;
    result.turnsPer10min = null;
    result.alternates = [];
    result.stops = [];
    result.waypoints = [];
    result.countryScore = null;
    result.arterialShare = null;
    result.urbanShare = null;
    heldAlternate?.();
  };
  if (isLoop && DRIVE_FIRST_ON && constraints.duration_target_s !== null) {
    const outcome = await driveFirstTrip(
      deps.db,
      deps.valhallaUrl,
      origin,
      constraints.duration_target_s,
      {
        avoidHighways: constraints.avoid.highways === true,
        ...(originStemM !== null ? { oabGraceM: originStemM } : {}),
        // The attempt may spend at most 40 % of the wall; the legacy planner
        // keeps the rest (measured: unbounded stacking hit 25.8 s live).
        deadlineMs: Date.now() + WALL_CLOCK_BUDGET_MS * 0.4,
      },
    );
    const trip = outcome.trip;
    if (trip !== null) {
      const mins = (x: number): number => Math.round(x / 60);
      const exact = trip.tier === 'exact';
      const applyTripServe = (): void => {
        result.status = 'ok';
        // ONE routed request end to end — real geometry, real maneuvers, real
        // duration, real has_* flags (v4: no glued seams, rq30c).
        result.route = {
          geometry: trip.route.geometry,
          distance_m: trip.route.distance_m,
          duration_s: trip.route.duration_s,
          legs: trip.route.legs,
          maneuvers: trip.route.maneuvers,
          has_highway: trip.route.has_highway,
          has_toll: trip.route.has_toll,
          has_ferry: trip.route.has_ferry,
          has_unpaved: trip.route.has_unpaved,
        };
        // R34-U9 provenance: the core's MEASURED numbers are advertised only
        // when the routed drive is essentially the measured ring.
        result.curviness = trip.fidelity >= STATS_PROVENANCE_MIN ? trip.core.curviness : null;
        // Waypoints mark J1 / arc-mid / J2 — the audit's geometric split needs
        // them; the USER-facing result carries NO leg framing (BD-149: "that
        // loop should be the full drive as the loop itself").
        result.waypoints = [trip.drive.entry, trip.drive.mid, trip.drive.exit];
        result.legs = null;
        const driveName = trip.drive.frac < 0.97 ? `most of ${trip.core.name}` : trip.core.name;
        if (exact) {
          result.disclosures.push(
            `Built a ${mins(trip.durationS)}-minute loop around ${driveName} — measured roads, honest time.`,
          );
        } else {
          // R34-U8: an honest ALTERNATE duration — never a silent miss.
          result.disclosures.push(
            `No clean ${Math.round((constraints.duration_target_s ?? 0) / 60)}-minute loop fits from here — ` +
              `built a clean ${mins(trip.durationS)}-minute one around ${driveName} instead.`,
          );
        }
        for (const alt of outcome.alternates) {
          result.disclosures.push(
            `Also built a clean ${mins(alt.durationS)}-minute option around ${alt.core.name}.`,
          );
        }
        if (originStemM !== null && originStemM >= 1_500) {
          result.disclosures.push(
            `This area has one practical way out — the first and last ~${Math.round(
              originStemM / 1000,
            )} km repeat by necessity.`,
          );
        }
        step(
          emit,
          'drive_first_trip',
          'completed',
          `served ${trip.tier} ${trip.core.id} (x ${trip.metrics.knots}/${trip.metrics.pierces}, stem ${originStemM ?? '\u2014'}m, fidelity ${trip.fidelity.toFixed(2)}, ` +
            `loopiness ${trip.metrics.loopiness?.toFixed(2) ?? '—'}, ` +
            `commute ${Math.round(trip.metrics.commuteShare * 100)}%` +
            (outcome.rejected.length > 0
              ? `; rejected ${outcome.rejected.map((r) => `${r.id}: ${r.failures.join('+')}`).join(', ')}`
              : '') +
            ')',
        );
      };
      if (exact || !ALT_HOLD_LEGACY_ON) {
        applyTripServe();
        return result;
      }
      // BD-169: hold the out-of-band clean alternate; legacy gets its shot at
      // the exact band and the better serve wins at the exits.
      heldServeBase = [...result.disclosures];
      heldAlternate = applyTripServe;
      step(
        emit,
        'drive_first_trip',
        'completed',
        `holding clean ${mins(trip.durationS)}-min alternate ${trip.core.id} — ` +
          `trying for an exact ${Math.round((constraints.duration_target_s ?? 0) / 60)}-min loop live`,
      );
    }
    if (heldAlternate === null && outcome.rejected.length > 0) {
      // The truth, not an excuse: which cores were tried and which of the
      // owner's rules each one broke (BD-146 — gates reject, disclosures
      // don't excuse).
      step(
        emit,
        'drive_first_trip',
        'completed',
        `no candidate passed as-driven gates — ${outcome.rejected
          .map((r) => `${r.id}: ${r.failures.join('+')}`)
          .join(', ')}`,
      );
    }
    if (heldAlternate === null) {
      result.disclosures.push(
        'No measured drive fits that time cleanly from this start yet — planned live instead.',
      );
    }
  }

  // R31 (BD-151) — A→B DRIVE-FIRST: the best measured ribbon ON THE WAY,
  // served as one routed request (A → through-samples → B), judged as driven
  // (fidelity, spurs, doubling, the standing detour cap). Fail-open to the
  // legacy corridor planner with the rejections in the trace.
  if (!isLoop && ATOB_DRIVE_FIRST_ON && destination !== null) {
    const outcome = await atobDriveFirst(deps.db, deps.valhallaUrl, origin, destination, {
      avoidHighways: constraints.avoid.highways === true,
      costingOptions: profileForRequest(constraints, deps.costingMode ?? 'on').options,
      // Date.now(), NOT t0: t0 rides performance.now() (process uptime), and
      // the module compares epoch — mixing them made the deadline read as
      // already-expired, silently rejecting every candidate as time_budget.
      deadlineMs: Date.now() + WALL_CLOCK_BUDGET_MS * 0.4,
    });
    const trip = outcome.trip;
    if (trip !== null) {
      result.status = 'ok';
      result.route = {
        geometry: trip.route.geometry,
        distance_m: trip.route.distance_m,
        duration_s: trip.route.duration_s,
        legs: trip.route.legs,
        maneuvers: trip.route.maneuvers,
        has_highway: trip.route.has_highway,
        has_toll: trip.route.has_toll,
        has_ferry: trip.route.has_ferry,
        has_unpaved: trip.route.has_unpaved,
      };
      // curviness: length-weighted over the chained measured ribbons
      const chainLen = trip.ribbons.reduce((v, r) => v + r.distance_m, 0);
      result.curviness =
        trip.ribbons.reduce((v, r) => v + r.curviness * r.distance_m, 0) / Math.max(1, chainLen);
      result.waypoints = trip.ribbons.map((r) => r.entry);
      result.legs = null;
      const names = trip.ribbons.map((r) => r.name);
      const nameLine =
        names.length === 1
          ? names[0]!
          : names.length === 2
            ? `${names[0]} and ${names[1]}`
            : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      result.disclosures.push(
        `Routed you along ${nameLine} on the way — measured backroad stretches, ` +
          `about ${Math.round((trip.detourRatio - 1) * 100)}% longer than the direct route.`,
      );
      step(
        emit,
        'drive_first_trip',
        'completed',
        `served atob chain [${trip.ribbons.map((r) => r.id).join('>')}] (fidelity ${trip.metrics.fidelity.toFixed(2)}, detour ${trip.detourRatio.toFixed(2)}×` +
          (outcome.rejected.length > 0
            ? `; rejected ${outcome.rejected.map((r) => `${r.id}: ${r.failures.join('+')}`).join(', ')}`
            : '') +
          ')',
      );
      return result;
    }
    if (outcome.rejected.length > 0) {
      step(
        emit,
        'drive_first_trip',
        'completed',
        `no ribbon passed on this corridor — ${outcome.rejected
          .map((r) => `${r.id}: ${r.failures.join('+')}`)
          .join(', ')}`,
      );
    }
  }

  // R18-4 character bundles: the levers a character ACTUALLY moves (costing
  // rides profileForRequest below; here: weights, arterial bar, duration
  // tolerance, scenic's optional viewpoint garnish)
  const bundle = CHARACTER_BUNDLES_ON ? bundleForRequest(constraints) : null;
  // R25-U8b — the treatments that actually RAN (from the resolved bundle),
  // never the ask. plan.ts tags the route and feeds the explain prompt from
  // THIS list, so narration can't claim a treatment that never happened.
  {
    const applied: CharacterTag[] = [];
    if (bundle?.id === 'twisty') applied.push('twisty');
    if (bundle?.id === 'backroads') applied.push('backroad');
    if (bundle?.scenicApplied === true) applied.push('scenic');
    result.characterApplied = applied;
  }
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
  // R25-U3: a Fun & Explorative LOOP never includes highway — imposed as a
  // hard avoid at ladder init, which buys for free: the working costing lever
  // (U2 translation), the no-highway sizing speed (:798), rung-4 relaxation
  // with an honest disclosure, and real validation rows (effectiveAvoid).
  // A→B is exempt (owner decision — some town pairs have no non-highway path).
  if (isLoop && profileExcludesHighways(profile) && !params.avoid.highways) {
    params.avoid.highways = true;
    params.imposedHighways = true;
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
      /** R25-U0 road-class truth + continuity + flow (null = untraced). */
      classMix: ClassMix | null;
      backroadLongestM: number | null;
      backroadMeanM: number | null;
      hoodRunM: number | null;
      turnsPer10min: number | null;
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
        outAndBackLongestM: outAndBack(r.route.geometry).longestM,
        revisitPlaces: revisitCount(r.route.geometry, origin),
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

  /**
   * BD-163 — THE FINAL STRUCTURAL JUDGE, callable from EVERY exit that ships
   * a loop route. BD-160 installed it only at the main exit; the
   * `presentDirtyBest` early returns (ladder-exhausted + budget-exhausted —
   * by definition the DIRTIEST material in the system) bypassed it, which is
   * exactly how the owner's X-square survived BD-161/162 (device, 2026-08-11:
   * "still shows squares exactly same as before"). The R32 invariant said
   * "no candidate path may bypass the final judge" — now it cannot: returns
   * true if the route was rejected (result becomes an honest no-clean state).
   */
  const applyFinalStructuralJudge = (): boolean => {
    if (!CLEAN_ALTERNATIVES_ON || !isLoop || result.route === null) return false;
    const shape = tripShapeMetrics(
      result.route.geometry,
      origin,
      originStemM !== null ? { oabGraceM: originStemM } : {},
    );
    const structural: string[] = [];
    if (shape.spurs > 0) structural.push(`street stubs ×${shape.spurs}`);
    if (shape.microloops > 0) structural.push(`crescents ×${shape.microloops}`);
    if (shape.oabLongestM > OUT_AND_BACK_REJECT_M) {
      structural.push(`${Math.round(shape.oabLongestM)} m doubled`);
    }
    const x = summarizeCrossings(selfIntersections(result.route.geometry, origin));
    const crossings = x.knots + x.pierces;
    if (crossings > 0) structural.push(`self-crossings ×${crossings}`);
    if (structural.length === 0) {
      // forensic PASS line — every shipped loop's shape verdict is in the trace
      step(
        emit,
        'validate_route',
        'completed',
        `final judge PASS (x 0/0, stubs 0, crescents 0, oab≤${Math.round(shape.oabLongestM)}m, stem ${originStemM ?? '—'}m)`,
      );
      return false;
    }
    step(emit, 'validate_route', 'completed', `FINAL JUDGE reject: ${structural.join(', ')}`);
    result.route = null;
    result.status = 'unavailable';
    result.legs = null;
    result.disclosures = [
      `No clean ${Math.round((constraints.duration_target_s ?? 3600) / 60)}-minute loop from this exact start right now — ` +
        `the best live attempt had ${structural.join(' and ')}, which we don't ship.`,
    ];
    return true;
  };

  /** Present the least-dirty fallback with honest disclosure (returns false
   *  when no eligible material exists — the true redirect case). */
  const presentDirtyBest = (): boolean => {
    // BD-169: a HELD clean measured alternate always beats a "least-flawed
    // dirty" presentation — and rescues the true-redirect case too (the
    // request IS served, so return true even when dirtyBest is null).
    if (heldAlternate !== null) {
      restoreHeld();
      emit({ type: 'done', status: 'ok' });
      return true;
    }
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
        effectiveAvoid: params.avoid, // R25-U3: imposed avoids get real rows
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
    // BD-163: the dirtiest material meets the judge like everything else.
    if (applyFinalStructuralJudge()) {
      emit({ type: 'done', status: 'unavailable' });
      return true; // the request IS answered — with the honest no-clean state
    }
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
    // R25-U3v2: sizing follows the COSTING — an imposed avoid keeps shortest
    // (enforced by trace-reject), so its sizing speed is the profile normal.
    const costingAvoidsHighways = params.avoid.highways && params.imposedHighways !== true;
    const sizingSpeed = costingAvoidsHighways
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
    // (Removed, BD-149: the R29 single-ribbon prepend was measured VACUOUS —
    // ribbons average 9 min, nothing fit a loop ask (BD-136) — and its
    // "planned live" disclosure duplicated the trip attempt's. The measured
    // path is the early drive-first TRIP; this pipeline is the honest
    // fallback.)
    // R29 Unit B — RIBBON CHAINS (BD-135/136): 3-6 measured ribbons chained
    // into one drive that FILLS the ask, with routed links between them. One
    // travel matrix; measured durations price the ribbons (the matrix's
    // fastest-path shortcut under-prices them ~3x). Fail-open on matrix or
    // index errors — the legacy pool must never be hostage to either.
    if (isLoop && RIBBON_CHAINS_ON && !outOfBudget()) {
      try {
        const chainRibbonsRows = await readDriveFirstCores(deps.db, origin, durationS);
        const rpool = ribbonPool(origin, chainRibbonsRows);
        if (rpool.length >= 2 && durationS !== null) {
          emit({ type: 'tool_call', tool: 'travel_matrix' });
          const rmatrix = await travelMatrix(deps.valhallaUrl, {
            locations: ribbonMatrixLocations(origin, rpool),
            costingOptions: profile.options,
          });
          const rchains = chainRibbons(origin, chainRibbonsRows, rmatrix, durationS);
          if (rchains.length > 0) candidates = [...rchains, ...candidates];
        }
      } catch {
        /* ribbon chains skipped — legacy pool stands */
      }
    }
    // R28-2 CORE SEEDS — measured-clean drives from the offline index, entered
    // as ORDINARY candidates in the same pool. No privileges: every assembly
    // reject, score, diversify pass and the never-empty fallback apply to them
    // unchanged, so a core wins only if it actually measures better. Five
    // ranking levers and three costing levers have been refused against the
    // 43 %-vs-86 % backroad gap (docs/R28_plan.md); this is the generation-side
    // answer. Fail-open: the live pool must never be hostage to the index.
    let coreNote = '';
    if (isLoop && CORE_SEED_ON && !outOfBudget()) {
      try {
        // Query the REACH box, not Discover's 45 km browse box. The definer
        // returns the top N by QUALITY within the bbox, so a wide box hands back
        // 20 excellent cores that are all too far to reach — measured: every one
        // of them filtered out, 0 seeded. Sizing the bbox to the reach budget
        // makes the quality ranking operate over cores that can actually be used.
        const reachM = Math.max(8_000, ((durationS ?? 5_400) * CORE_REACH_FRAC * 55_000) / 3_600);
        const half = reachM / 111_320;
        const cores = await readDriveCores(
          deps.db,
          [origin.lng - half, origin.lat - half, origin.lng + half, origin.lat + half],
          DRIVE_CORES_VERSION,
          CORES_BROWSE_LIMIT,
        );
        const seeded = coreSeedCandidates(cores, durationS, CORE_SEED_MAX, origin);
        if (seeded.length > 0) {
          candidates = [...candidates, ...seeded];
          coreNote = ` +${seeded.length} core seeds`;
        }
      } catch {
        coreNote = ' (core index unavailable)';
      }
    }
    void coreNote;
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
      // R29 Unit C — RIBBON_ATOB: measured ribbons join the corridor span pool.
      // Collinear-along-the-corridor is the GOOD case here (it is what killed
      // loop tours). Fail-open: an index error leaves the corpus pool intact.
      let corridorSegments = retrieved.segments;
      if (RIBBON_ATOB_ON) {
        try {
          const west = Math.min(origin.lng, destination!.lng) - 0.15;
          const east = Math.max(origin.lng, destination!.lng) + 0.15;
          const south = Math.min(origin.lat, destination!.lat) - 0.15;
          const north = Math.max(origin.lat, destination!.lat) + 0.15;
          const ribbonRows = await readDriveCores(
            deps.db,
            [west, south, east, north],
            DRIVE_CORES_VERSION,
            40,
            'ribbon',
          );
          const extra = ribbonsAsSegments(ribbonRows);
          if (extra.length > 0) corridorSegments = [...retrieved.segments, ...extra];
        } catch {
          /* corpus pool stands */
        }
      }
      const chains = buildCorridorChains(origin, destination!, corridorSegments);
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
                    // R25-U3v2: only a USER-asked no-highways changes the
                    // costing (U2 real levers); the imposed rule enforces via
                    // the avoidHighways trace-reject below, preserving shortest.
                    exclude_highways: costingAvoidsHighways,
                    exclude_tolls: params.avoid.tolls,
                    exclude_ferries: params.avoid.ferries,
                    exclude_unpaved: params.avoid.unpaved, // best-effort; trace scan = truth (R16-2)
                  },
                  {
                    repairSegments: retrieved.segments, // round 11b INSERT material
                    shouldStop: outOfBudget, // R18-2 repair cost bound
                    avoidHighways: params.avoid.highways, // R25-U3v2 trace reject
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
                  classMix: a.classMix, // R25-U0 road-class truth
                  backroadLongestM: a.backroadLongestM,
                  backroadMeanM: a.backroadMeanM,
                  hoodRunM: a.hoodRunM,
                  turnsPer10min: a.turnsPer10min,
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
                  // R25-U6d: rung 5 finally reaches A→B — the self-overlap cap
                  // relaxes, the DETOUR cap NEVER does (falsified, BD-82)
                  ...(ATOB_ASSEMBLY_RELAX_ON && params.assemblyRelax
                    ? { selfOverlapCap: SELF_OVERLAP_RELAXED }
                    : {}),
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
                classMix: a.classMix, // R25-U0 road-class truth
                backroadLongestM: a.backroadLongestM,
                backroadMeanM: a.backroadMeanM,
                hoodRunM: a.hoodRunM,
                turnsPer10min: a.turnsPer10min,
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
      const maxResizeAttempts = RESIZE_ATTEMPTS_3_ON ? 3 : 2; // R25-U7b
      for (
        let attempt = 1;
        attempt <= maxResizeAttempts && batch.length > 0 && !outOfBudget();
        attempt++
      ) {
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
    // R25-U19: the scoring body is a NAMED closure so connector refinement can
    // re-score a refined finalist through the IDENTICAL path (pure refactor;
    // `scored` below is byte-identical to the old inline map)
    const scoreRoutedRow = (r: (typeof routed)[number]) => {
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
      // last-resort material, never preferred content. R25-U6a: each clause
      // is NAMED so the loss diagnostic can report which one fired — the
      // boolean is derived from the list, semantics unchanged.
      const dirtyClauses: string[] = [];
      if (uturnCount(r.route) > 0) dirtyClauses.push('uturn');
      if (r.spursWide > 0) dirtyClauses.push('spur');
      if (r.retraceRunM > RETRACE_RUN_SOFT_M) dirtyClauses.push('retrace');
      if ((r.residentialShare ?? 0) > RESIDENTIAL_SOFT_SHARE) dirtyClauses.push('res_share'); // round 7
      if ((r.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M) dirtyClauses.push('res_run'); // round 8b
      if (r.microloops > 0) dirtyClauses.push('microloop'); // round 8
      // R21-1: degenerate loop shape + the previously-inert 0.15-0.30 self-
      // overlap units (all null/off → false → byte-identical no-op)
      if (shapeLoopiness !== null && shapeLoopiness < LOOPINESS_SOFT_FLOOR) {
        dirtyClauses.push('loopiness');
      }
      if (shapeCorridor !== null && shapeCorridor > CORRIDOR_DOUBLING_SOFT) {
        dirtyClauses.push('corridor_doubling');
      }
      if (SHAPE_QUALITY_ON && isLoop && r.selfOverlap > SELF_OVERLAP_CAP) {
        dirtyClauses.push('self_overlap');
      }
      // R25-U8c: unmeasured IS dirty — a route nobody traced can never
      // outrank a measured-clean pool-mate (audit issue #13)
      if (TRACE_NULL_STRICT_ON && r.trace === null) dirtyClauses.push('trace_null');
      const dirty = dirtyClauses.length > 0;
      // BD-146: the ask means the TRIP the driver sits through — EVERY
      // candidate is judged on its real door-to-door duration. (R29 judged
      // `drive-`/`rchain-` candidates on the drive leg alone; that ruler is
      // how "1 hour" shipped 106-minute trips, and the owner killed it.)
      const judgedDurationS = r.route.duration_s;
      // round 14: an on-target route outranks a shorter one of the same
      // quality tier (2nd lexicographic tier, below quality)
      const durOff =
        constraints.duration_target_s !== null &&
        Math.abs(judgedDurationS - constraints.duration_target_s) / constraints.duration_target_s >
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
        outAndBackLongestM: outAndBack(r.route.geometry).longestM,
        revisitPlaces: revisitCount(r.route.geometry, origin),
        traceNull: r.trace === null,
        loopiness: shapeLoopiness, // R21-1 (null → 0)
        corridorDoubling: shapeCorridor,
      });
      // R25-U9a: THE shared presentation key (score.ts presentationKey) —
      // run.ts, eval and the tier-order proof can no longer drift.
      const presentKey = presentationKey({
        score: breakdown.score,
        dirty,
        units,
        durOff,
        contextHeavy, // R19: urban context tier
        durationS: judgedDurationS,
        durationTargetS: constraints.duration_target_s,
        turnsPer10min: r.turnsPer10min ?? null, // R25-U9b (grade 0 while flag off)
        backroadLongestM: r.backroadLongestM ?? null,
        // R27 — the owner's first-order rule finally reaches the ranking.
        mainPct: r.classMix ? r.classMix.mainShare * 100 : null,
        backroadPct: r.classMix ? r.classMix.backroadShare * 100 : null,
        mixExempt: profile.id === 'simple', // fast main roads are the ask
      });
      return {
        r,
        curv,
        breakdown,
        presentKey,
        urbanShare,
        dirtyClauses,
        units,
        durOff,
        contextHeavy,
      };
    };
    const scored = durationFiltered.map(scoreRoutedRow);
    step(emit, 'score_rank', 'completed', `${scored.length} scored`);
    // R25-U6a observability: full decomposition per scored candidate (never
    // changes selection — a read-only snapshot for the loss diagnostic).
    deps.onScored?.(
      scored.map((s) => ({
        id: s.r.candidate.id,
        score: s.breakdown.score,
        presentKey: s.presentKey,
        dirty: s.dirtyClauses.length > 0,
        dirtyClauses: s.dirtyClauses,
        units: s.units,
        durOff: s.durOff,
        contextHeavy: s.contextHeavy,
        urbanShare: s.urbanShare,
        curviness: s.curv.curviness,
        durationS: s.r.route.duration_s,
        distanceM: s.r.route.distance_m,
        selfOverlap: s.r.selfOverlap,
        uturns: uturnCount(s.r.route),
        spursWide: s.r.spursWide,
        microloops: s.r.microloops,
        retraceRunM: s.r.retraceRunM,
        residentialShare: s.r.residentialShare,
        residentialRunM: s.r.residentialRunM,
        arterialShare: s.r.arterialShare,
        classMix: s.r.classMix ?? null,
        backroadLongestM: s.r.backroadLongestM ?? null,
        outAndBackLongestM: outAndBack(s.r.route.geometry).longestM,
        traceNull: s.r.trace === null,
      })),
    );

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

    // R25-U19 — corridor-following connector refinement on the DIVERSIFY-KEPT
    // finalists only (~4/brief; plain assembleLoop, never repair — the review
    // measured repair at up to 18 engine calls/finalist). The shared helper
    // accepts only on measured material gain (backroad share/run) within the
    // duration-growth cap and full assembly cleanliness; the swap needs
    // presentKey within CONNECTOR_KEY_TOLERANCE (the key has no share channel
    // — BD-88 cancelled it as pool-inert — so strict key-improve would blind
    // the lever). Rows re-rank normally afterwards. Flag off ⇒ untouched.
    if (CONNECTOR_REFINE_ON && isLoop && !outOfBudget()) {
      let refinedCount = 0;
      for (const kept of diversified.kept) {
        if (outOfBudget()) break;
        const s = (kept as { payload: (typeof scored)[number] }).payload;
        const refined = await refineLoopFinalist(
          deps.valhallaUrl,
          origin,
          {
            candidate: s.r.candidate,
            route: s.r.route,
            classMix: s.r.classMix ?? null,
            backroadLongestM: s.r.backroadLongestM ?? null,
          },
          retrieved.segments,
          (cand) =>
            assembleLoop(
              deps.valhallaUrl,
              origin,
              cand,
              {
                ...profile.options,
                exclude_highways: costingAvoidsHighways,
                exclude_tolls: params.avoid.tolls,
                exclude_ferries: params.avoid.ferries,
                exclude_unpaved: params.avoid.unpaved,
              },
              {
                avoidHighways: params.avoid.highways,
                ...(params.assemblyRelax ? RELAXED_ASSEMBLY_CAPS : {}),
              },
            ),
        );
        if (refined === null) continue;
        const rescored = scoreRoutedRow({
          candidate: refined.candidate,
          route: refined.route,
          selfOverlap: refined.selfOverlap,
          spursWide: refined.spursWide,
          retraceRunM: refined.retraceRunM,
          residentialShare: refined.residentialShare,
          residentialRunM: refined.residentialRunM,
          countryScore: refined.countryScore,
          arterialShare: refined.arterialShare,
          microloops: refined.microloops,
          closureM: refined.closureM as number | null,
          snapOffsetM: refined.snapOffsetM,
          trace: refined.trace,
          classMix: refined.classMix,
          backroadLongestM: refined.backroadLongestM,
          backroadMeanM: refined.backroadMeanM,
          hoodRunM: refined.hoodRunM,
          turnsPer10min: refined.turnsPer10min,
          assemblyAccepted: refined.accepted,
        });
        if (rescored.presentKey + CONNECTOR_KEY_TOLERANCE < s.presentKey) continue;
        // swap the WHOLE row + the wrapper's ranking/report fields (a stale
        // wrapper geometry would misreport overlap — review finding)
        (kept as { payload: typeof rescored }).payload = rescored;
        (kept as { score: number }).score = rescored.presentKey;
        (kept as { geometry: typeof rescored.r.route.geometry }).geometry =
          rescored.r.route.geometry;
        refinedCount++;
      }
      if (refinedCount > 0) {
        step(emit, 'self_correct', 'completed', `connector refinement ×${refinedCount}`);
      }
    }

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
          effectiveAvoid: params.avoid, // R25-U3: imposed avoids get real rows
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
            // R25-U0: road-class truth + continuity + flow carried to the result
            classMix: s.r.classMix,
            backroadLongestM: s.r.backroadLongestM,
            backroadMeanM: s.r.backroadMeanM,
            hoodRunM: s.r.hoodRunM,
            turnsPer10min: s.r.turnsPer10min,
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
        step(
          emit,
          'self_correct',
          'completed',
          heldAlternate !== null
            ? 'ladder exhausted — held measured alternate served'
            : 'ladder exhausted — least-flawed fallback',
        );
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
  // R25-U0: road-class truth + continuity + flow of the chosen route
  result.classMix = best.routed.classMix ?? null;
  result.backroadLongestM = best.routed.backroadLongestM ?? null;
  result.backroadMeanM = best.routed.backroadMeanM ?? null;
  result.hoodRunM = best.routed.hoodRunM ?? null;
  result.turnsPer10min = best.routed.turnsPer10min ?? null;
  // R27 — the three-leg split. Computed on the CHOSEN route only (one extra
  // trace, and only for loops), so the card can say "getting there 14 min ·
  // the drive 62 · home 16" instead of averaging the commute into the drive.
  result.legs = null;
  if (isLoop && result.route !== null) {
    const split: LegSplit | null = splitLoopLegs(result.route.geometry, result.waypoints);
    if (split !== null) {
      let driveBackroadPct: number | null = null;
      let driveMainPct: number | null = null;
      try {
        const dt = await traceRoadClasses(
          deps.valhallaUrl,
          driveGeometry(result.route.geometry, split),
        );
        const dm = classMixOf(dt.edges);
        if (dm !== null) {
          driveBackroadPct = Math.round(dm.backroadShare * 100);
          driveMainPct = Math.round(dm.mainShare * 100);
        }
      } catch {
        // trace is best-effort; the split itself is still worth reporting
      }
      result.legs = {
        therePct: split.therePct,
        drivePct: split.drivePct,
        homePct: split.homePct,
        thereM: split.thereM,
        driveM: split.driveM,
        homeM: split.homeM,
        driveBackroadPct,
        driveMainPct,
      };
    }
  }
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
        // R25-U7a: calling +93 % "a bit over" was a lie — past the hard bar
        // the copy says "well". Same flag as the tier so OFF stays byte-identical.
        const degree = DUR_HARD_TIER_ON && Math.abs(err) > DURATION_HARD_ERR ? 'well' : 'a bit';
        result.disclosures.push(
          `about ${Math.round(result.route.duration_s / 60)} min — ${degree} ${
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
  // BD-163: the single judge closure guards this exit too (see its docstring).
  applyFinalStructuralJudge();
  // BD-169: held measured alternate vs the legacy attempt — legacy wins only
  // with a clean, unrelaxed, exact-band loop; anything else (including a
  // final-judge reject just above) serves the held alternate.
  if (heldAlternate !== null) {
    const target = constraints.duration_target_s;
    const legacyWins =
      result.status === 'ok' &&
      result.route !== null &&
      params.relaxedConstraints.length === 0 &&
      target !== null &&
      Math.abs(result.route.duration_s - target) / target <= TRIP_EXACT_BAND;
    if (!legacyWins) {
      restoreHeld();
      emit({ type: 'done', status: 'ok' });
      return result;
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
