/**
 * SPK-15 — loop-generation quality report (THE core product gate).
 *
 * Runs the M3 deterministic pipeline over FIXED loop briefs spread across the
 * region (40 as of BD-22: origins × durations × characters, cities AND rural
 * between-city origins, corner-to-corner of the owner coverage circle) and
 * reports, per brief:
 *   presented   — distinct candidates after diversify (target ≥ K_PRESENT = 4)
 *   maxOverlap  — max pairwise edge_overlap among presented (must ≤ τ = 0.6)
 *   selfOverlap — mean/max of presented (loops already filtered at 0.15 assembly cap)
 *   feasible    — count passing the M3-T11 gates
 *   durErr      — best candidate's |duration−target|/target (AC: ≤ 25 %, BD-21)
 *   curviness   — best candidate's C7 (1/km)
 *   ms          — wall time for the brief
 * plus an overall verdict against the SPK-15 AC. Honest output — the numbers are
 * whatever the pipeline actually produces on the real data tier + engine.
 *
 * Run: pnpm -C eval run loop-quality      (Supabase local + Valhalla must be up)
 */

import type { LineString } from '@shared/types';
import { Client } from 'pg';

import { bundleForRequest } from '../backend/src/planner/bundles';
import { generateLoopCandidates, resizedSpeed } from '../backend/src/planner/candidates';
import {
  buildChainCandidates,
  buildSpanPool,
  CHAIN_MIN_SPANS,
  chainMatrixLocations,
} from '../backend/src/planner/chain';
import { profileExcludesHighways, profileForRequest } from '../backend/src/planner/costing';
import { measureCurvatureClassAware } from '../backend/src/planner/curvature';
import {
  diversify,
  K_PRESENT_DEFAULT,
  prefilterByDuration,
  TAU_OVERLAP_DEFAULT,
} from '../backend/src/planner/diversify';
import {
  assembleLoopWithRepair,
  RESIDENTIAL_RUN_SOFT_M,
  RESIDENTIAL_SOFT_SHARE,
  RETRACE_RUN_SOFT_M,
  SELF_OVERLAP_CAP,
} from '../backend/src/planner/loop';
import {
  corridorDoublingRatio,
  curvyShareOf,
  loopiness,
  pairOverlap,
} from '../backend/src/planner/overlap';
import { parseRules } from '../backend/src/planner/parse_rules';
import { weightsForPreset } from '../backend/src/planner/presets';
import {
  retrieveAnchorPoints,
  retrieveCandidates,
  type CandidateSegment,
} from '../backend/src/planner/retrieve';
import { cleanDriveVerdict } from '../backend/src/planner/roadclass';
import {
  CHAIN_CANDIDATES_ON,
  CHARACTER_BUNDLES_ON,
  RESIZE_TRIGGER,
  TWISTY_CURVY_RANK,
  SHAPE_QUALITY_ON,
  URBAN_CONTEXT_ON,
} from '../backend/src/planner/run';
import { buildScope } from '../backend/src/planner/scope';
import {
  ARTERIAL_SHARE_SOFT,
  CORRIDOR_DOUBLING_SOFT,
  fallbackOffenceUnits,
  LOOPINESS_SOFT_FLOOR,
  mergeWeights,
  presentationKey,
  scoreCandidate,
  TRACE_NULL_STRICT_ON,
  uturnCount,
} from '../backend/src/planner/score';
import { resolveStopArrivals, stopCoverageOf, stopCoverScore } from '../backend/src/planner/stops';
import { urbanIndexFor, urbanShareOf } from '../backend/src/planner/urban';
import { DURATION_TOLERANCE_DEFAULT, validateCandidate } from '../backend/src/planner/validate';
import { travelMatrix } from '../backend/src/valhalla/matrix';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
/** R18-1 A/B switch: COSTING_PROFILES=legacy reruns the BD-21 baseline. */
const COSTING_MODE =
  process.env['COSTING_PROFILES'] === 'legacy' ? ('legacy' as const) : ('on' as const);

/** The 15 fixed briefs (§SPK-15): origins × durations × characters, loops only. */
const BRIEFS: string[] = [
  '90 minute twisty loop from Hamilton, no highways',
  '1 hour loop from Dundas with a coffee stop',
  '45 minute loop from Ancaster',
  '2 hour scenic loop from Grimsby',
  '90 minute backroads loop from St. Catharines',
  '1 hour twisty loop from Waterdown',
  '2 hour loop from Niagara Falls with a viewpoint',
  '45 minute chill loop from Burlington',
  '3 hour loop from Caledonia',
  '90 minute loop from Welland, avoid tolls',
  'one hour very twisty loop from Pelham',
  '2 hour rural loop from Smithville',
  '1 hour loop from Fonthill with a fuel stop',
  '90 minute forest loop from Kilbride',
  '2 hour twisty loop from Thorold, no highways',
  // --- south-central-ontario expansion briefs (owner-requested regions, BD-19) ---
  '90 minute twisty loop from Georgetown',
  '2 hour loop from Caledon',
  '1 hour loop from Erin with a coffee stop',
  '90 minute backroads loop from Bolton',
  '2 hour scenic loop from Newmarket',
  '1 hour twisty loop from Uxbridge',
  '90 minute loop from Port Perry',
  '2 hour loop from Peterborough',
  '90 minute loop from Cobourg',
  // --- region v3 / owner round-2 towns (BD-20) ---
  '1 hour loop from Stouffville',
  '2 hour loop from Barrie',
  '90 minute twisty loop from Guelph',
  '90 minute loop from Kitchener',
  '1 hour loop from Brantford',
  '90 minute loop from Cayuga',
  '1 hour twisty loop from Milton',
  '90 minute loop from Mississauga',
  '90 minute twisty loop from Orangeville',
  // --- rural / between-cities origins (owner round 3: "the loops should be in
  // the cities AND the surroundings... all areas in between", BD-21) ---
  '2 hour loop from Creemore',
  '90 minute twisty loop from Belfountain',
  '1 hour backroads loop from St. Jacobs',
  // --- region v4: the owner coverage circle (BD-22) — NW wedge (Grey/Bruce,
  // Blue Mountains) and the eastern Trent Hills fringe ---
  '2 hour twisty loop from Collingwood',
  '2 hour scenic loop from Owen Sound',
  '90 minute loop from Orillia',
  '90 minute loop from Campbellford',
  // --- region v5: west-to-London expansion (owner round 10, BD-38) — London,
  // the Erie shore, the Huron shore, and the in-between towns ---
  '2 hour loop from London',
  '90 minute twisty loop from Stratford',
  '1 hour loop from Woodstock',
  '90 minute backroads loop from St. Thomas',
  '1 hour loop from Port Stanley',
  '1 hour backroads loop from Delhi',
  '2 hour scenic loop from Grand Bend',
  '90 minute loop from Goderich',
];

interface BriefReport {
  brief: string;
  presented: number;
  feasible: number;
  maxPairOverlap: number;
  meanSelfOverlap: number;
  maxSelfOverlap: number;
  durErrPct: number | null;
  /** Best route's SIGNED duration error % (negative = shorter than asked). */
  durErrSignedPct: number | null;
  bestDurationS: number | null;
  bestDistanceM: number | null;
  /** U-turn maneuvers in the presented best (AC: must be 0, owner round 4). */
  bestUturns: number | null;
  /** Spur events in the presented best (AC: must be 0, owner round 5). */
  bestSpurs: number | null;
  /** Longest same-road doubling in the best, metres (AC ≤ soft cap, round 6). */
  bestRetraceM: number | null;
  /** Residential share of the best, % (AC ≤ soft share, round 7; null = trace failed). */
  bestResidentialPct: number | null;
  /** Crescent/block spins in the best (AC: must be 0, round 8). */
  bestMicroloops: number | null;
  /** Longest contiguous residential run in the best, m (AC ≤ soft cap, round 8b). */
  bestResidentialRunM: number | null;
  /** Route countryness of the best, 0..1 (round 11; reported, no AC bar yet). */
  bestCountryScore: number | null;
  /** R25-U0 road-class truth of the best (audit-v11 buckets), % of metres. */
  bestHighwayPct: number | null;
  bestMainPct: number | null;
  bestBackroadPct: number | null;
  bestHoodPct: number | null;
  /** R25-U0 backroad continuity of the best (m). */
  bestBackroadLongestM: number | null;
  bestBackroadMeanM: number | null;
  /** R25-U0 longest hood-class run of the best (m), ungraced. */
  bestHoodRunM: number | null;
  /** R25-U0 flow: total maneuvers per 10 min + raw count. */
  bestTurnsPer10min: number | null;
  bestManeuvers: number | null;
  /** R25-U0 composite clean-drive verdict (audit bar; null = no best). */
  cleanDrive: boolean | null;
  defects: string[];
  // --- R18-0 essence metrics (report-only; gates arrive in later units) ---
  /** Arterial (motorway/trunk/primary/secondary/ramp) share of the best, %. */
  bestArterialPct: number | null;
  bestUrbanPct: number | null;
  /** Share of the best's steps on RETRIEVED curvy segments (forced-vs-free). */
  bestCurvyShare: number | null;
  /** Isoperimetric quotient of the best (thin out-and-back → ~0; circle → 1). */
  bestLoopiness: number | null;
  /** Directed corridor-doubling ratio (parallel-road out-and-back detector). */
  bestCorridorDoubling: number | null;
  /** Provisional graded offence units of the best (R18-2 formalizes). */
  bestDirtyUnits: number | null;
  targetS: number;
  curviness: number | null;
  ms: number;
  pass: boolean;
  notes: string[];
  /** Best kept route's geometry — dumped for the [HUMAN] drivability inspection. */
  bestGeometry: LineString | null;
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

export const URBAN_AC_MAX_PCT = 20;

async function evaluateBrief(
  db: Client,
  brief: string,
  originOverride?: { lat: number; lng: number },
): Promise<BriefReport> {
  const t0 = performance.now();
  const notes: string[] = [];
  const parsed = parseRules(brief);
  const constraints = originOverride ? { ...parsed, origin: originOverride } : parsed;
  const origin = constraints.origin;
  if (origin === null || typeof origin === 'string') {
    throw new Error(`brief origin did not resolve: ${brief}`);
  }
  const durationS = constraints.duration_target_s ?? 5400;
  // R18-4 bundle parity with run.ts: weights, arterial bar, duration
  // tolerance, scenic's auto nice-to-have viewpoint
  const bundle = CHARACTER_BUNDLES_ON ? bundleForRequest(constraints) : null;
  const weights = mergeWeights(
    bundle?.weights ?? weightsForPreset(constraints.preset),
    constraints.weights,
  );
  const urbanShareBar = bundle?.urbanShareSoft ?? 0.2;
  // R19 parity with run.ts. MEASUREMENT is unconditional (the A/B baseline
  // needs urban-share-of-bests too); URBAN_CONTEXT_ON gates only CONSUMPTION
  // (the presentation tier).
  const urbanIndex = await urbanIndexFor(db, {
    west: origin.lng - 0.65,
    south: origin.lat - 0.65,
    east: origin.lng + 0.65,
    north: origin.lat + 0.65,
  }).catch(() => null);
  const durTolerance = bundle?.durationTolerance ?? DURATION_TOLERANCE_DEFAULT;
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

  // First pass at θ=0.6; if the presented set is thin, climb the ladder's first
  // rungs exactly as runPlanner would (τ ×1.3, θ ×0.67) and note the assist —
  // SPK-15 reports the PRESENTED experience, first-pass purity noted honestly.
  // One search pass: scope → retrieve → generate → assemble; returns the funnel.
  const profile = profileForRequest(constraints, COSTING_MODE);
  const baseSpeed = constraints.avoid.highways
    ? profile.sizingSpeedNoHighwayKmh
    : profile.sizingSpeedKmh;
  // R18-0: union of every pass's retrieved curvy segments — the material the
  // generator was OFFERED; curvyShare measures how much the best actually drives
  const allSegments = new Map<string, CandidateSegment>();
  const searchPass = async (
    tauMult: number,
    theta?: number,
    avgSpeedKmh?: number,
    idPrefix?: string,
  ) => {
    const scope = await buildScope(VALHALLA, {
      origin,
      shape: 'loop',
      durationS: Math.round(durationS * tauMult),
    });
    const retrieved = await retrieveCandidates(db, scope, {
      stopTypes: requestStops.map((s) => s.type),
      ...(theta !== undefined ? { thetaCurvy: theta } : {}),
    });
    for (const seg of retrieved.segments) allSegments.set(seg.id, seg);
    const anchorPoints = await retrieveAnchorPoints(db, scope);
    let candidates = generateLoopCandidates(origin, retrieved.segments, retrieved.spots, {
      stopRequests: requestStops, // R16-3: typed per-unit anchoring
      durationS,
      anchorPoints,
      avgSpeedKmh: avgSpeedKmh ?? baseSpeed,
      ...(idPrefix !== undefined ? { idPrefix } : {}),
      curvyRank: TWISTY_CURVY_RANK && bundle?.id === 'twisty', // R22-1b parity
    });
    // R18-3 parity with run.ts: chained candidates for stop-free briefs
    if (CHAIN_CANDIDATES_ON && constraints.stops.length === 0) {
      const pool = buildSpanPool(origin, retrieved.segments, durationS, avgSpeedKmh ?? baseSpeed);
      if (pool.length >= CHAIN_MIN_SPANS) {
        try {
          const matrix = await travelMatrix(VALHALLA, {
            locations: chainMatrixLocations(origin, pool),
            costingOptions: profile.options,
          });
          const chains = buildChainCandidates(origin, pool, matrix, {
            durationS,
            anchorPoints,
            ...(idPrefix !== undefined ? { idPrefix } : {}),
          });
          candidates = [...chains, ...candidates];
        } catch {
          notes.push('chains skipped (matrix unavailable)');
        }
      }
    }
    const attempts = await Promise.all(
      candidates.map(async (c) => {
        try {
          // round 9: targeted waypoint-drop repair rides on every assembly
          return await assembleLoopWithRepair(
            VALHALLA,
            origin,
            c,
            {
              ...profile.options, // R18-1: fun-vs-fast connector costing (parity with run.ts)
              // R25-U3v2 parity with run.ts: only a USER-asked no-highways
              // changes the costing; the imposed fun rule enforces via the
              // avoidHighways trace-reject (keeps shortest = backroad character).
              exclude_highways: constraints.avoid.highways,
              exclude_tolls: constraints.avoid.tolls,
              exclude_ferries: constraints.avoid.ferries,
            },
            {
              repairSegments: retrieved.segments, // round 11b INSERT material
              avoidHighways: constraints.avoid.highways || profileExcludesHighways(profile),
            },
          );
        } catch {
          return null;
        }
      }),
    );
    return { candidates, attempts };
  };

  // Quick kept-estimate for the assist trigger: dedup by τ on accepted geometries
  // (score order is irrelevant for COUNTING distinct corridors).
  const distinctCount = (ok: Array<{ route: { geometry: LineString } }>): number => {
    const keptGeoms: LineString[] = [];
    for (const a of ok) {
      if (keptGeoms.every((g) => pairOverlap(a.route.geometry, g) <= TAU_OVERLAP_DEFAULT)) {
        keptGeoms.push(a.route.geometry);
      }
    }
    return keptGeoms.length;
  };

  // First pass; the assist fires on the TRUE criterion — distinct KEPT corridors
  // (run 9: healthy funnels still dedup below K). Run 10 fix: the assisted pass
  // MERGES with the first pass (union of accepted candidates, ids deduped) —
  // replacing threw away good first-pass corridors and regressed.
  const first = await searchPass(1);
  let candidates = first.candidates;
  let attempts = first.attempts;
  const okOf = (atts: typeof attempts) =>
    atts.filter((a): a is NonNullable<typeof a> => a !== null && a.accepted);

  // Duration-resize retry (owner rounds 3+6, mirrors runPlanner): a batch
  // median >25 % off target ⇒ regenerate with the miss-scaled speed; up to TWO
  // attempts, each judged on the LATEST batch (prefixed ids never collide).
  let batchOk = okOf(attempts);
  let sizingV = baseSpeed;
  for (let attempt = 1; attempt <= 2 && batchOk.length > 0; attempt++) {
    const durs = batchOk.map((a) => a.route.duration_s).sort((x, y) => x - y);
    const median = durs[Math.floor(durs.length / 2)]!;
    if (Math.abs(median - durationS) / durationS <= RESIZE_TRIGGER) break;
    sizingV = resizedSpeed(sizingV, durationS, median);
    const rz = await searchPass(1, undefined, sizingV, `rz${attempt}-`);
    candidates = [...candidates, ...rz.candidates];
    attempts = [...attempts, ...rz.attempts];
    batchOk = okOf(rz.attempts);
    notes.push(
      `resized×${attempt} (median ${Math.round(median / 60)} min vs target ${Math.round(durationS / 60)} min → v ${Math.round(sizingV)})`,
    );
  }

  const okFirst = okOf(attempts);
  if (distinctCount(okFirst) < K_PRESENT_DEFAULT) {
    const second = await searchPass(1.3, 0.4);
    const seenIds = new Set(candidates.map((c) => c.id));
    candidates = [...candidates, ...second.candidates.filter((c) => !seenIds.has(c.id))];
    const seenAttempt = new Set(attempts.filter((a) => a !== null).map((a) => a!.candidate.id));
    attempts = [
      ...attempts,
      ...second.attempts.filter((a) => a === null || !seenAttempt.has(a.candidate.id)),
    ];
    notes.push('ladder-assisted (merged τ×1.3, θ 0.4)');
  }

  const routedCount = attempts.filter((a) => a !== null).length;
  const rejectHistogram = new Map<string, number>();
  for (const a of attempts) {
    if (a && !a.accepted) {
      for (const reason of a.rejectReasons) {
        const key = reason.split(' ')[0]!;
        rejectHistogram.set(key, (rejectHistogram.get(key) ?? 0) + 1);
      }
    }
  }
  const assembled = attempts.filter((a): a is NonNullable<typeof a> => a !== null && a.accepted);
  notes.push(
    `funnel gen ${candidates.length}→routed ${routedCount}→ok ${assembled.length}` +
      (rejectHistogram.size
        ? ` (rej: ${[...rejectHistogram.entries()].map(([k, v]) => `${k}×${v}`).join(',')})`
        : ''),
  );

  const durationFiltered = prefilterByDuration(
    assembled,
    constraints.duration_target_s,
    (a) => a.route.duration_s,
  );
  if (durationFiltered.length < assembled.length) {
    notes.push(`duration-prefilter dropped ${assembled.length - durationFiltered.length}`);
  }
  const scored = durationFiltered.map((a) => {
    const curv = measureCurvatureClassAware(a.route.geometry, a.trace); // parity with run.ts (FB-5)
    const breakdown = scoreCandidate(
      {
        route: a.route,
        selfOverlap: a.selfOverlap,
        durationTargetS: constraints.duration_target_s,
        curviness: curv.curviness,
        twistinessPref: constraints.twistiness_pref,
        stopCover: stopCoverScore(stopCoverageOf(requestStops, a.candidate.stops)),
        scenicSignal: 0,
        countryScore: a.countryScore, // round 11
      },
      weights,
    );
    // presentation key: any u-turn, wide-window spur (block spins), notable
    // there-and-back, or residential exposure ranks below every clean route
    // (rounds 2–7)
    // R21-1 parity with run.ts (BRIEFS are all loops → isLoop implicit)
    const shapeLoopiness = SHAPE_QUALITY_ON ? loopiness(a.route.geometry) : null;
    const shapeCorridor = SHAPE_QUALITY_ON ? corridorDoublingRatio(a.route.geometry, origin) : null;
    const dirty =
      uturnCount(a.route) > 0 ||
      a.spursWide > 0 ||
      a.retraceRunM > RETRACE_RUN_SOFT_M ||
      (a.residentialShare ?? 0) > RESIDENTIAL_SOFT_SHARE ||
      (a.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M ||
      a.microloops > 0 ||
      (shapeLoopiness !== null && shapeLoopiness < LOOPINESS_SOFT_FLOOR) ||
      (shapeCorridor !== null && shapeCorridor > CORRIDOR_DOUBLING_SOFT) ||
      (SHAPE_QUALITY_ON && a.selfOverlap > SELF_OVERLAP_CAP) ||
      // R25-U8c parity with run.ts: unmeasured IS dirty under the strict flag
      (TRACE_NULL_STRICT_ON && a.trace === null);
    // round 14: on-target outranks shorter within the same quality tier
    const durOff =
      constraints.duration_target_s !== null &&
      Math.abs(a.route.duration_s - constraints.duration_target_s) / constraints.duration_target_s >
        durTolerance;
    // R18-1 third tier (parity with run.ts; R18-4 bundle-aware bar + gate)
    const urbShare = urbanShareOf(urbanIndex, a.route.geometry, [origin]);
    const contextHeavy = URBAN_CONTEXT_ON
      ? urbShare !== null && urbShare > urbanShareBar
      : (profile.id === 'fun' || profile.id === 'backroads') &&
        a.arterialShare !== null &&
        a.arterialShare > ARTERIAL_SHARE_SOFT;
    // R18-2 parity with run.ts: graded dirtiness + within-tier duration grade
    const units = fallbackOffenceUnits({
      uturns: uturnCount(a.route),
      microloops: a.microloops,
      spursWide: a.spursWide,
      selfOverlap: a.selfOverlap,
      retraceRunM: a.retraceRunM,
      residentialShare: a.residentialShare,
      residentialRunM: a.residentialRunM,
      traceNull: a.trace === null,
      loopiness: shapeLoopiness, // R21-1 (null → 0)
      corridorDoubling: shapeCorridor,
    });
    // R25-U9a: THE shared presentation key — eval can no longer drift from prod.
    const presentKey = presentationKey({
      score: breakdown.score,
      dirty,
      units,
      durOff,
      contextHeavy,
      durationS: a.route.duration_s,
      durationTargetS: durationS,
      turnsPer10min: a.turnsPer10min ?? null, // R25-U9b (grade 0 while flag off)
      backroadLongestM: a.backroadLongestM ?? null, // R25-U10 continuity (flag off → 0)
      mixExempt: profile.id === 'simple',
    });
    return { a, curv, breakdown, presentKey };
  });

  // R18-3 adoption diagnostic: pool countryScore variance (rq11 measured
  // ~0.007 — "every candidate rode the same arterials"; chains must raise it
  // above 0.05 or adoption is refused per the pre-registered rule)
  const ctryVals = scored.map((s) => s.a.countryScore).filter((v): v is number => v !== null);
  if (ctryVals.length >= 2) {
    const mean = ctryVals.reduce((a, b) => a + b, 0) / ctryVals.length;
    const variance = ctryVals.reduce((a, b) => a + (b - mean) ** 2, 0) / ctryVals.length;
    notes.push(`ctryVar ${variance.toFixed(4)}`);
  }

  const { kept } = diversify(
    scored.map((s) => ({
      id: s.a.candidate.id,
      score: s.presentKey,
      geometry: s.a.route.geometry,
      payload: s,
    })),
  );

  let feasible = 0;
  let best: (typeof scored)[number] | null = null;
  for (const k of kept) {
    const s = (k as unknown as { payload: (typeof scored)[number] }).payload;
    const verdict = validateCandidate(
      {
        route: s.a.route,
        constraints,
        closureM: s.a.closureM,
        selfOverlap: s.a.selfOverlap,
        stopCoverage: stopCoverageOf(requestStops, s.a.candidate.stops),
        stops: resolveStopArrivals(s.a.candidate.stops, s.a.route),
      },
      { durationTolerance: durTolerance },
    ); // R18-4 bundle parity
    if (verdict.feasible) {
      feasible++;
      if (!best || s.presentKey > best.presentKey) best = s;
    }
  }

  let maxPairOverlap = 0;
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      maxPairOverlap = Math.max(maxPairOverlap, pairOverlap(kept[i]!.geometry, kept[j]!.geometry));
    }
  }
  const selfOverlaps = kept.map(
    (k) => (k as unknown as { payload: (typeof scored)[number] }).payload.a.selfOverlap,
  );
  const meanSelf = selfOverlaps.length
    ? selfOverlaps.reduce((a, b) => a + b, 0) / selfOverlaps.length
    : 0;
  const maxSelf = selfOverlaps.length ? Math.max(...selfOverlaps) : 0;

  const durErrSignedPct = best ? ((best.a.route.duration_s - durationS) / durationS) * 100 : null;
  const durErrPct = durErrSignedPct === null ? null : Math.abs(durErrSignedPct);
  const repairedKept = kept.filter((k) => k.id.includes('-rp')).length;
  if (repairedKept > 0) notes.push(`repaired×${repairedKept}`);
  if (candidates.length < K_PRESENT_DEFAULT) notes.push(`only ${candidates.length} generated`);
  if (assembled.length < kept.length) notes.push('assembly rejections occurred');

  // AC: ≥K distinct, overlap ≤ τ, feasible, LOW self-overlap = mean under the soft
  // line (0.15) with nothing past the hard-reject zone (assembly enforces 0.30),
  // (BD-21) the presented best within ±25 % of the asked duration, and
  // (BD-22/23, owner rounds 4–5) the presented best is U-TURN-FREE and SPUR-FREE.
  const bestUturns = best ? uturnCount(best.a.route) : null;
  const bestSpurs = best ? best.a.spursWide : null;
  const bestRetraceM = best ? best.a.retraceRunM : null;
  // round 7: null (trace failed) counts as NOT passing — unknown ≠ clean
  const bestResidentialPct =
    best && best.a.residentialShare !== null ? best.a.residentialShare * 100 : null;
  const bestMicroloops = best ? best.a.microloops : null;
  const bestResidentialRunM = best ? best.a.residentialRunM : null;
  const bestCountryScore = best ? best.a.countryScore : null;
  // --- R18-0 essence metrics (report-only) ---
  const bestArterialPct = best && best.a.arterialShare !== null ? best.a.arterialShare * 100 : null;
  const bestUrbanPct = best
    ? (() => {
        const u = urbanShareOf(urbanIndex, best.a.route.geometry, [origin]);
        return u === null ? null : u * 100;
      })()
    : null;
  const bestCurvyShare = best
    ? curvyShareOf(best.a.route.geometry, [...allSegments.values()])
    : null;
  const bestLoopiness = best ? loopiness(best.a.route.geometry) : null;
  const bestCorridorDoubling = best ? corridorDoublingRatio(best.a.route.geometry, origin) : null;
  const bestDirtyUnits = best
    ? fallbackOffenceUnits({
        uturns: uturnCount(best.a.route),
        microloops: best.a.microloops,
        spursWide: best.a.spursWide,
        selfOverlap: best.a.selfOverlap,
        retraceRunM: best.a.retraceRunM,
        residentialShare: best.a.residentialShare,
        residentialRunM: best.a.residentialRunM,
        traceNull: best.a.trace === null,
        loopiness: SHAPE_QUALITY_ON ? bestLoopiness : null, // R21-1 parity
        corridorDoubling: SHAPE_QUALITY_ON ? bestCorridorDoubling : null,
      })
    : null;
  // --- R25-U0: road-class truth + continuity + flow + clean-drive verdict ---
  const bestMix = best ? best.a.classMix : null;
  const bestHighwayPct = bestMix === null ? null : bestMix.highwayShare * 100;
  const bestMainPct = bestMix === null ? null : bestMix.mainShare * 100;
  const bestBackroadPct = bestMix === null ? null : bestMix.backroadShare * 100;
  const bestHoodPct = bestMix === null ? null : bestMix.hoodShare * 100;
  const bestBackroadLongestM = best ? best.a.backroadLongestM : null;
  const bestBackroadMeanM = best ? best.a.backroadMeanM : null;
  const bestHoodRunM = best ? best.a.hoodRunM : null;
  const bestTurnsPer10min = best ? best.a.turnsPer10min : null;
  const bestManeuvers = best ? best.a.route.maneuvers.length : null;
  const cleanVerdict = best
    ? cleanDriveVerdict({
        mix: bestMix,
        hoodRunM: bestHoodRunM,
        turnsPer10min: bestTurnsPer10min,
        loopiness: bestLoopiness,
        durErrAbs: durErrPct === null ? null : durErrPct / 100,
        uturns: bestUturns ?? 0,
        spursWide: bestSpurs ?? 0,
        microloops: bestMicroloops ?? 0,
        retraceRunM: bestRetraceM ?? 0,
        traced: best.a.trace !== null,
      })
    : null;
  // R19 honest-composite axis: a best that "passes" by driving town streets
  // (urban > 20 %) is the disease, not a pass (owner 2026-07-18). Null share
  // (index unavailable) is fail-open.
  const urbanOk = bestUrbanPct === null || bestUrbanPct <= URBAN_AC_MAX_PCT;
  const pass =
    urbanOk &&
    kept.length >= K_PRESENT_DEFAULT &&
    maxPairOverlap <= TAU_OVERLAP_DEFAULT &&
    feasible > 0 &&
    meanSelf <= 0.15 &&
    maxSelf <= 0.3 &&
    durErrPct !== null &&
    durErrPct <= 25 &&
    bestUturns === 0 &&
    bestSpurs === 0 &&
    bestRetraceM !== null &&
    bestRetraceM <= RETRACE_RUN_SOFT_M &&
    bestResidentialPct !== null &&
    bestResidentialPct <= RESIDENTIAL_SOFT_SHARE * 100 &&
    bestMicroloops === 0 &&
    bestResidentialRunM !== null &&
    bestResidentialRunM <= RESIDENTIAL_RUN_SOFT_M;

  return {
    brief,
    presented: kept.length,
    feasible,
    maxPairOverlap,
    meanSelfOverlap: meanSelf,
    maxSelfOverlap: maxSelf,
    durErrPct,
    durErrSignedPct,
    bestDurationS: best ? best.a.route.duration_s : null,
    bestDistanceM: best ? best.a.route.distance_m : null,
    bestUturns,
    bestSpurs,
    bestRetraceM,
    bestResidentialPct,
    bestMicroloops,
    bestResidentialRunM,
    bestCountryScore,
    bestHighwayPct,
    bestMainPct,
    bestBackroadPct,
    bestHoodPct,
    bestBackroadLongestM,
    bestBackroadMeanM,
    bestHoodRunM,
    bestTurnsPer10min,
    bestManeuvers,
    cleanDrive: cleanVerdict === null ? null : cleanVerdict.clean,
    defects: cleanVerdict === null ? ['no_best'] : cleanVerdict.defects,
    bestArterialPct,
    bestUrbanPct,
    bestCurvyShare,
    bestLoopiness,
    bestCorridorDoubling,
    bestDirtyUnits,
    targetS: durationS,
    curviness: best ? best.curv.curviness : null,
    bestGeometry: best ? best.a.route.geometry : null,
    ms: performance.now() - t0,
    pass,
    notes,
  };
}

interface SuiteJob {
  brief: string;
  origin?: { lat: number; lng: number };
}

/** SUITE=random loads the committed seeded fixture (R18-0 formalization of the
 *  40-route audit protocol); default = the fixed 48-brief SPK-15 corpus. */
async function loadSuite(): Promise<{ name: string; jobs: SuiteJob[] }> {
  if (process.env['SUITE'] === 'random') {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(
      new URL('./datasets/random-briefs-v1.json', import.meta.url),
      'utf8',
    );
    const jobs = JSON.parse(raw) as SuiteJob[];
    return { name: 'random', jobs };
  }
  return { name: 'fixed', jobs: BRIEFS.map((brief) => ({ brief })) };
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const suite = await loadSuite();
  const reports: BriefReport[] = [];
  for (const { brief, origin: originOverride } of suite.jobs) {
    // one brief's failure must never kill the whole report (an eval harness
    // reports errors as data — found live when a 3 h brief 400'd the isochrone)
    let r: BriefReport;
    try {
      r = await evaluateBrief(db, brief, originOverride);
    } catch (err) {
      r = {
        brief,
        presented: 0,
        feasible: 0,
        maxPairOverlap: 0,
        meanSelfOverlap: 0,
        maxSelfOverlap: 0,
        durErrPct: null,
        durErrSignedPct: null,
        bestDurationS: null,
        bestDistanceM: null,
        bestUturns: null,
        bestSpurs: null,
        bestRetraceM: null,
        bestResidentialPct: null,
        bestMicroloops: null,
        bestResidentialRunM: null,
        bestCountryScore: null,
        bestHighwayPct: null,
        bestMainPct: null,
        bestBackroadPct: null,
        bestHoodPct: null,
        bestBackroadLongestM: null,
        bestBackroadMeanM: null,
        bestHoodRunM: null,
        bestTurnsPer10min: null,
        bestManeuvers: null,
        cleanDrive: null,
        defects: ['no_best'],
        bestArterialPct: null,
        bestUrbanPct: null,
        bestCurvyShare: null,
        bestLoopiness: null,
        bestCorridorDoubling: null,
        bestDirtyUnits: null,
        targetS: 0,
        curviness: null,
        ms: 0,
        pass: false,
        notes: [`ERROR: ${err instanceof Error ? err.message : String(err)}`],
        bestGeometry: null,
      };
    }
    reports.push(r);
    // live progress — the full table still prints at the end
    console.log(
      `[${reports.length}/${suite.jobs.length}] ${r.pass ? 'PASS' : 'fail'} ${Math.round(r.ms)}ms  ${brief}`,
    );
  }
  await db.end();

  // Dump the best route per brief for the [HUMAN] drivability inspection
  // (paste eval/spk15-routes.geojson into geojson.io — gitignored artifact).
  const { writeFile } = await import('node:fs/promises');
  // Owner round 3: the old properties carried NO routed duration/distance, so a
  // 4 h route read as "90 minute loop" in geojson.io. name/routed_min/distance_km
  // now state the truth per feature; stroke colours pass green / fail red.
  const featureCollection = {
    type: 'FeatureCollection',
    features: reports
      .filter((r) => r.bestGeometry !== null)
      .map((r) => {
        const routedMin = r.bestDurationS === null ? null : Math.round(r.bestDurationS / 60);
        const km = r.bestDistanceM === null ? null : Math.round(r.bestDistanceM / 100) / 10;
        // plain-English reason(s) a brief failed — the shown best route often
        // IS fine; the miss is a menu-size or timing bar it can't show itself
        const reasons: string[] = [];
        if (r.feasible === 0) reasons.push('no feasible route');
        if (r.presented < K_PRESENT_DEFAULT) {
          reasons.push(`only ${r.presented} of ${K_PRESENT_DEFAULT} alternates`);
        }
        if (r.maxPairOverlap > TAU_OVERLAP_DEFAULT) reasons.push('alternates too similar');
        if (r.durErrPct !== null && r.durErrPct > 25) {
          reasons.push(
            `${r.durErrSignedPct! > 0 ? '+' : ''}${Math.round(r.durErrSignedPct!)}% off the asked time`,
          );
        }
        if ((r.bestUturns ?? 0) > 0) reasons.push('has a u-turn');
        if ((r.bestSpurs ?? 0) > 0) reasons.push('darts in and back somewhere');
        if ((r.bestRetraceM ?? 0) > RETRACE_RUN_SOFT_M) {
          reasons.push(`${Math.round((r.bestRetraceM ?? 0) / 100) / 10} km doubles back`);
        }
        if ((r.bestResidentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M) {
          reasons.push(
            `${Math.round((r.bestResidentialRunM ?? 0) / 100) / 10} km through a neighbourhood`,
          );
        } else if ((r.bestResidentialPct ?? 0) > RESIDENTIAL_SOFT_SHARE * 100) {
          reasons.push(`${r.bestResidentialPct}% neighbourhood streets`);
        }
        if ((r.bestMicroloops ?? 0) > 0) reasons.push('circles a block');
        return {
          type: 'Feature',
          properties: {
            name: `${r.brief} — routed ${routedMin ?? '?'} min / ${km ?? '?'} km${r.pass ? '' : ' (FAIL)'}`,
            brief: r.brief,
            pass: r.pass,
            why_red: r.pass ? null : reasons.join('; '),
            target_min: Math.round(r.targetS / 60),
            routed_min: routedMin,
            distance_km: km,
            durErrSignedPct: r.durErrSignedPct === null ? null : Math.round(r.durErrSignedPct),
            uturns: r.bestUturns,
            spurs: r.bestSpurs,
            retrace_m: r.bestRetraceM === null ? null : Math.round(r.bestRetraceM),
            res_pct: r.bestResidentialPct === null ? null : Math.round(r.bestResidentialPct),
            res_run_m: r.bestResidentialRunM === null ? null : Math.round(r.bestResidentialRunM),
            country:
              r.bestCountryScore === null ? null : Math.round(r.bestCountryScore * 100) / 100,
            microloops: r.bestMicroloops,
            curviness: r.curviness,
            meanSelfOverlap: r.meanSelfOverlap,
            arterial_pct: r.bestArterialPct === null ? null : Math.round(r.bestArterialPct),
            curvy_share:
              r.bestCurvyShare === null ? null : Math.round(r.bestCurvyShare * 100) / 100,
            loopiness: r.bestLoopiness === null ? null : Math.round(r.bestLoopiness * 100) / 100,
            corridor_doubling:
              r.bestCorridorDoubling === null
                ? null
                : Math.round(r.bestCorridorDoubling * 100) / 100,
            dirty_units: r.bestDirtyUnits,
            stroke: r.pass ? '#1a9850' : '#d73027',
            'stroke-width': 3,
            'stroke-opacity': 0.9,
          },
          geometry: r.bestGeometry,
        };
      }),
  };
  const geojsonName =
    suite.name === 'random' ? 'spk15-routes-random.geojson' : 'spk15-routes.geojson';
  await writeFile(
    new URL(`./${geojsonName}`, import.meta.url),
    JSON.stringify(featureCollection),
    'utf8',
  );
  console.log(`\nwrote eval/${geojsonName} — paste into geojson.io to inspect the loops`);

  console.log('=== SPK-15 loop-generation quality report ===\n');
  console.log(
    pad('brief', 46) +
      pad('kept', 6) +
      pad('feas', 6) +
      pad('maxOv', 7) +
      pad('selfOv μ/max', 14) +
      pad('durErr%', 9) +
      pad('min', 6) +
      pad('curv', 7) +
      pad('res%', 6) +
      pad('ctry', 6) +
      pad('µloop', 7) +
      pad('art%', 6) +
      pad('urb%', 6) +
      pad('cvy%', 6) +
      pad('lpi', 6) +
      pad('corD', 6) +
      pad('ms', 7) +
      'verdict',
  );
  console.log('-'.repeat(116));
  for (const r of reports) {
    console.log(
      pad(r.brief.slice(0, 44), 46) +
        pad(r.presented, 6) +
        pad(r.feasible, 6) +
        pad(r.maxPairOverlap.toFixed(2), 7) +
        pad(`${r.meanSelfOverlap.toFixed(2)}/${r.maxSelfOverlap.toFixed(2)}`, 14) +
        pad(
          r.durErrSignedPct === null
            ? '—'
            : `${r.durErrSignedPct >= 0 ? '+' : ''}${r.durErrSignedPct.toFixed(0)}`,
          9,
        ) +
        pad(r.bestDurationS === null ? '—' : Math.round(r.bestDurationS / 60), 6) +
        pad(r.curviness === null ? '—' : r.curviness.toFixed(2), 7) +
        pad(r.bestResidentialPct === null ? '—' : Math.round(r.bestResidentialPct), 6) +
        pad(r.bestCountryScore === null ? '—' : r.bestCountryScore.toFixed(2), 6) +
        pad(r.bestMicroloops === null ? '—' : r.bestMicroloops, 7) +
        pad(r.bestArterialPct === null ? '—' : Math.round(r.bestArterialPct), 6) +
        pad(r.bestUrbanPct === null ? '—' : Math.round(r.bestUrbanPct), 6) +
        pad(r.bestCurvyShare === null ? '—' : Math.round(r.bestCurvyShare * 100), 6) +
        pad(r.bestLoopiness === null ? '—' : r.bestLoopiness.toFixed(2), 6) +
        pad(r.bestCorridorDoubling === null ? '—' : r.bestCorridorDoubling.toFixed(2), 6) +
        pad(Math.round(r.ms), 7) +
        (r.pass ? 'PASS' : `FAIL ${r.notes.join('; ')}`),
    );
  }

  const passed = reports.filter((r) => r.pass).length;
  const meanKept = reports.reduce((s, r) => s + r.presented, 0) / reports.length;
  const meanDurErr =
    reports.filter((r) => r.durErrPct !== null).reduce((s, r) => s + r.durErrPct!, 0) /
    Math.max(1, reports.filter((r) => r.durErrPct !== null).length);
  const meanMs = reports.reduce((s, r) => s + r.ms, 0) / reports.length;

  console.log('\n-- summary --');
  console.log(`briefs passing all AC: ${passed}/${reports.length}`);
  console.log(`mean presented: ${meanKept.toFixed(1)} (target ≥ ${K_PRESENT_DEFAULT})`);
  console.log(`mean duration error of best: ${meanDurErr.toFixed(0)} %`);
  console.log(`mean wall time per brief: ${Math.round(meanMs)} ms`);

  // --- R18-0 essence scoreboard (report-only; the rebuild's headline numbers) ---
  const vals = (f: (r: BriefReport) => number | null): number[] =>
    reports
      .map(f)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
  const pct = (sorted: number[], q: number): number | null =>
    sorted.length === 0
      ? null
      : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const mean = (sorted: number[]): number | null =>
    sorted.length === 0 ? null : sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const fmt = (v: number | null, digits = 2): string => (v === null ? '—' : v.toFixed(digits));

  const noRoute = reports.filter((r) => r.bestGeometry === null).length;
  const absErr = vals((r) => (r.durErrSignedPct === null ? null : Math.abs(r.durErrSignedPct)));
  const art = vals((r) => r.bestArterialPct);
  const cvy = vals((r) => r.bestCurvyShare);
  const lpi = vals((r) => r.bestLoopiness);
  const corD = vals((r) => r.bestCorridorDoubling);
  const units = vals((r) => r.bestDirtyUnits);
  console.log(`\n-- essence scoreboard (R18-0; suite=${suite.name}) --`);
  console.log(`no-route briefs: ${noRoute}/${reports.length}`);
  console.log(`|durErr| p50/p80: ${fmt(pct(absErr, 0.5), 0)} % / ${fmt(pct(absErr, 0.8), 0)} %`);
  console.log(
    `arterial share of bests: mean ${fmt(mean(art), 0)} % · p80 ${fmt(pct(art, 0.8), 0)} %`,
  );
  const urb = vals((r) => r.bestUrbanPct);
  console.log(
    `urban share of bests:    mean ${fmt(mean(urb), 0)} % · p80 ${fmt(pct(urb, 0.8), 0)} % (R19)`,
  );
  console.log(`curvy share of bests:    mean ${fmt(mean(cvy))} · p20 ${fmt(pct(cvy, 0.2))}`);
  console.log(`loopiness of bests:      p20 ${fmt(pct(lpi, 0.2))}`);
  console.log(`corridor doubling:       p80 ${fmt(pct(corD, 0.8))}`);
  console.log(`dirty units of bests:    mean ${fmt(mean(units))} · max ${fmt(pct(units, 1.0))}`);

  // --- R25-U0 clean-drive scoreboard (audit-v11 bar, now first-class) -------
  const hw = vals((r) => r.bestHighwayPct);
  const mn = vals((r) => r.bestMainPct);
  const bk = vals((r) => r.bestBackroadPct);
  const hd = vals((r) => r.bestHoodPct);
  const bkLong = vals((r) => r.bestBackroadLongestM);
  const hdRun = vals((r) => r.bestHoodRunM);
  const t10 = vals((r) => r.bestTurnsPer10min);
  const cleanCount = reports.filter((r) => r.cleanDrive === true).length;
  const defectTally = new Map<string, number>();
  for (const r of reports)
    for (const d of r.defects) defectTally.set(d, (defectTally.get(d) ?? 0) + 1);
  const defectsPerRoute =
    reports.reduce((s, r) => s + r.defects.length, 0) / Math.max(1, reports.length);
  console.log(`\n-- R25 clean-drive scoreboard (audit-v11 bar) --`);
  console.log(
    `CLEAN DRIVES: ${cleanCount}/${reports.length} · defects/route ${defectsPerRoute.toFixed(2)}`,
  );
  console.log(
    `defect tally: ${
      [...defectTally.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}×${v}`)
        .join(' · ') || 'none'
    }`,
  );
  console.log(
    `road class of bests:     hwy mean ${fmt(mean(hw), 1)} % (${reports.filter((r) => (r.bestHighwayPct ?? 0) > 0.5).length} routes >0) · main mean ${fmt(mean(mn), 0)} % p80 ${fmt(pct(mn, 0.8), 0)} % · backroad mean ${fmt(mean(bk), 0)} % p20 ${fmt(pct(bk, 0.2), 0)} % · hood mean ${fmt(mean(hd), 1)} %`,
  );
  console.log(
    `backroad>main bests:     ${reports.filter((r) => r.bestBackroadPct !== null && r.bestMainPct !== null && r.bestBackroadPct > r.bestMainPct).length}/${reports.length}`,
  );
  console.log(
    `backroad continuity:     longest mean ${fmt(mean(bkLong), 0)} m · p20 ${fmt(pct(bkLong, 0.2), 0)} m`,
  );
  console.log(
    `hood runs of bests:      p80 ${fmt(pct(hdRun, 0.8), 0)} m · max ${fmt(pct(hdRun, 1.0), 0)} m`,
  );
  console.log(
    `turns/10min of bests:    mean ${fmt(mean(t10), 1)} · p80 ${fmt(pct(t10, 0.8), 1)} · max ${fmt(pct(t10, 1.0), 1)} · >5: ${reports.filter((r) => (r.bestTurnsPer10min ?? 0) > 5).length}/${reports.length}`,
  );

  // determinism hash: byte-stable across identical runs (ms stripped)
  const { createHash } = await import('node:crypto');
  const hashable = reports.map((r) => ({ ...r, ms: 0 }));
  const hash = createHash('sha256').update(JSON.stringify(hashable)).digest('hex').slice(0, 16);
  console.log(`determinism hash: ${hash}`);

  console.log('\n-- SPK-15 AC --');
  console.log(
    `≥ K_PRESENT distinct, overlap ≤ τ, low self-overlap, durErr ≤ 25 %, u-turn+spur+µloop-free best, retrace ≤ ${RETRACE_RUN_SOFT_M} m, residential ≤ ${RESIDENTIAL_SOFT_SHARE * 100} %, urban ≤ ${URBAN_AC_MAX_PCT} %, feasible: ` +
      `${passed === reports.length ? 'PASS (all briefs)' : `${passed}/${reports.length} briefs — inspect FAIL rows`}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
