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

import { generateLoopCandidates, resizedSpeed } from '../backend/src/planner/candidates';
import { measureCurvature } from '../backend/src/planner/curvature';
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
} from '../backend/src/planner/loop';
import { pairOverlap } from '../backend/src/planner/overlap';
import { parseRules } from '../backend/src/planner/parse_rules';
import { weightsForPreset } from '../backend/src/planner/presets';
import { retrieveAnchorPoints, retrieveCandidates } from '../backend/src/planner/retrieve';
import { buildScope } from '../backend/src/planner/scope';
import {
  DURATION_PRESENT_PENALTY,
  mergeWeights,
  scoreCandidate,
  uturnCount,
  UTURN_PRESENT_PENALTY,
} from '../backend/src/planner/score';
import { DURATION_TOLERANCE_DEFAULT, validateCandidate } from '../backend/src/planner/validate';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

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

async function evaluateBrief(db: Client, brief: string): Promise<BriefReport> {
  const t0 = performance.now();
  const notes: string[] = [];
  const constraints = parseRules(brief);
  const origin = constraints.origin;
  if (origin === null || typeof origin === 'string') {
    throw new Error(`brief origin did not resolve: ${brief}`);
  }
  const durationS = constraints.duration_target_s ?? 5400;
  const weights = mergeWeights(weightsForPreset(constraints.preset), constraints.weights);

  // First pass at θ=0.6; if the presented set is thin, climb the ladder's first
  // rungs exactly as runPlanner would (τ ×1.3, θ ×0.67) and note the assist —
  // SPK-15 reports the PRESENTED experience, first-pass purity noted honestly.
  // One search pass: scope → retrieve → generate → assemble; returns the funnel.
  const baseSpeed = constraints.avoid.highways ? 42 : 55;
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
      stopTypes: constraints.stops.map((s) => s.type),
      ...(theta !== undefined ? { thetaCurvy: theta } : {}),
    });
    const anchorPoints = await retrieveAnchorPoints(db, scope);
    const candidates = generateLoopCandidates(origin, retrieved.segments, retrieved.spots, {
      anchorSpots: retrieved.spots.length > 0,
      durationS,
      anchorPoints,
      avgSpeedKmh: avgSpeedKmh ?? baseSpeed,
      ...(idPrefix !== undefined ? { idPrefix } : {}),
    });
    const attempts = await Promise.all(
      candidates.map(async (c) => {
        try {
          // round 9: targeted waypoint-drop repair rides on every assembly
          return await assembleLoopWithRepair(
            VALHALLA,
            origin,
            c,
            {
              exclude_highways: constraints.avoid.highways,
              exclude_tolls: constraints.avoid.tolls,
              exclude_ferries: constraints.avoid.ferries,
            },
            { repairSegments: retrieved.segments }, // round 11b INSERT material
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
    if (Math.abs(median - durationS) / durationS <= 0.25) break;
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

  const requestedStops = constraints.stops.reduce((s, x) => s + x.count, 0);
  const durationFiltered = prefilterByDuration(
    assembled,
    constraints.duration_target_s,
    (a) => a.route.duration_s,
  );
  if (durationFiltered.length < assembled.length) {
    notes.push(`duration-prefilter dropped ${assembled.length - durationFiltered.length}`);
  }
  const scored = durationFiltered.map((a) => {
    const curv = measureCurvature(a.route.geometry);
    const breakdown = scoreCandidate(
      {
        route: a.route,
        selfOverlap: a.selfOverlap,
        durationTargetS: constraints.duration_target_s,
        curviness: curv.curviness,
        twistinessPref: constraints.twistiness_pref,
        stopCover:
          requestedStops > 0 ? Math.min(1, a.candidate.spotIds.length / requestedStops) : 1,
        scenicSignal: 0,
        countryScore: a.countryScore, // round 11
      },
      weights,
    );
    // presentation key: any u-turn, wide-window spur (block spins), notable
    // there-and-back, or residential exposure ranks below every clean route
    // (rounds 2–7)
    const dirty =
      uturnCount(a.route) > 0 ||
      a.spursWide > 0 ||
      a.retraceRunM > RETRACE_RUN_SOFT_M ||
      (a.residentialShare ?? 0) > RESIDENTIAL_SOFT_SHARE ||
      (a.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M ||
      a.microloops > 0;
    // round 14: on-target outranks shorter within the same quality tier
    const durOff =
      constraints.duration_target_s !== null &&
      Math.abs(a.route.duration_s - constraints.duration_target_s) / constraints.duration_target_s >
        DURATION_TOLERANCE_DEFAULT;
    const presentKey =
      breakdown.score -
      (dirty ? UTURN_PRESENT_PENALTY : 0) -
      (durOff ? DURATION_PRESENT_PENALTY : 0);
    return { a, curv, breakdown, presentKey };
  });

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
    const verdict = validateCandidate({
      route: s.a.route,
      constraints,
      closureM: s.a.closureM,
      selfOverlap: s.a.selfOverlap,
      includedStops: s.a.candidate.spotIds.length,
      requestedStops,
    });
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
  const pass =
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
    targetS: durationS,
    curviness: best ? best.curv.curviness : null,
    bestGeometry: best ? best.a.route.geometry : null,
    ms: performance.now() - t0,
    pass,
    notes,
  };
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const reports: BriefReport[] = [];
  for (const brief of BRIEFS) {
    // one brief's failure must never kill the whole report (an eval harness
    // reports errors as data — found live when a 3 h brief 400'd the isochrone)
    let r: BriefReport;
    try {
      r = await evaluateBrief(db, brief);
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
      `[${reports.length}/${BRIEFS.length}] ${r.pass ? 'PASS' : 'fail'} ${Math.round(r.ms)}ms  ${brief}`,
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
            stroke: r.pass ? '#1a9850' : '#d73027',
            'stroke-width': 3,
            'stroke-opacity': 0.9,
          },
          geometry: r.bestGeometry,
        };
      }),
  };
  await writeFile(
    new URL('./spk15-routes.geojson', import.meta.url),
    JSON.stringify(featureCollection),
    'utf8',
  );
  console.log('\nwrote eval/spk15-routes.geojson — paste into geojson.io to inspect the loops');

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
  console.log('\n-- SPK-15 AC --');
  console.log(
    `≥ K_PRESENT distinct, overlap ≤ τ, low self-overlap, durErr ≤ 25 %, u-turn+spur+µloop-free best, retrace ≤ ${RETRACE_RUN_SOFT_M} m, residential ≤ ${RESIDENTIAL_SOFT_SHARE * 100} %, feasible: ` +
      `${passed === reports.length ? 'PASS (all briefs)' : `${passed}/${reports.length} briefs — inspect FAIL rows`}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
