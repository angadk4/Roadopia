/**
 * SPK-15 — loop-generation quality report (THE core product gate).
 *
 * Runs the M3 deterministic pipeline over 15 FIXED loop briefs spread across the
 * corridor (origins × durations × characters) and reports, per brief:
 *   presented   — distinct candidates after diversify (target ≥ K_PRESENT = 4)
 *   maxOverlap  — max pairwise edge_overlap among presented (must ≤ τ = 0.6)
 *   selfOverlap — mean/max of presented (loops already filtered at 0.15 assembly cap)
 *   feasible    — count passing the M3-T11 gates
 *   durErr      — best candidate's |duration−target|/target
 *   curviness   — best candidate's C7 (1/km)
 *   ms          — wall time for the brief
 * plus an overall verdict against the SPK-15 AC. Honest output — the numbers are
 * whatever the pipeline actually produces on the real data tier + engine.
 *
 * Run: pnpm -C eval run loop-quality      (Supabase local + Valhalla must be up)
 */

import type { LineString } from '@shared/types';
import { Client } from 'pg';

import { generateLoopCandidates } from '../backend/src/planner/candidates';
import { measureCurvature } from '../backend/src/planner/curvature';
import {
  diversify,
  K_PRESENT_DEFAULT,
  TAU_OVERLAP_DEFAULT,
} from '../backend/src/planner/diversify';
import { assembleLoop } from '../backend/src/planner/loop';
import { pairOverlap } from '../backend/src/planner/overlap';
import { parseRules } from '../backend/src/planner/parse_rules';
import { weightsForPreset } from '../backend/src/planner/presets';
import { retrieveAnchorPoints, retrieveCandidates } from '../backend/src/planner/retrieve';
import { buildScope } from '../backend/src/planner/scope';
import { mergeWeights, scoreCandidate } from '../backend/src/planner/score';
import { validateCandidate } from '../backend/src/planner/validate';

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
];

interface BriefReport {
  brief: string;
  presented: number;
  feasible: number;
  maxPairOverlap: number;
  meanSelfOverlap: number;
  maxSelfOverlap: number;
  durErrPct: number | null;
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
  const searchPass = async (tauMult: number, theta?: number) => {
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
    });
    const attempts = await Promise.all(
      candidates.map(async (c) => {
        try {
          return await assembleLoop(VALHALLA, origin, c, {
            exclude_highways: constraints.avoid.highways,
            exclude_tolls: constraints.avoid.tolls,
            exclude_ferries: constraints.avoid.ferries,
          });
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
  const okFirst = attempts.filter((a): a is NonNullable<typeof a> => a !== null && a.accepted);
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
  const scored = assembled.map((a) => {
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
      },
      weights,
    );
    return { a, curv, breakdown };
  });

  const { kept } = diversify(
    scored.map((s) => ({
      id: s.a.candidate.id,
      score: s.breakdown.score,
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
      if (!best || s.breakdown.score > best.breakdown.score) best = s;
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

  const durErrPct = best ? (Math.abs(best.a.route.duration_s - durationS) / durationS) * 100 : null;
  if (candidates.length < K_PRESENT_DEFAULT) notes.push(`only ${candidates.length} generated`);
  if (assembled.length < kept.length) notes.push('assembly rejections occurred');

  // AC: ≥K distinct, overlap ≤ τ, feasible, LOW self-overlap = mean under the soft
  // line (0.15) with nothing past the hard-reject zone (assembly enforces 0.30).
  const pass =
    kept.length >= K_PRESENT_DEFAULT &&
    maxPairOverlap <= TAU_OVERLAP_DEFAULT &&
    feasible > 0 &&
    meanSelf <= 0.15 &&
    maxSelf <= 0.3;

  return {
    brief,
    presented: kept.length,
    feasible,
    maxPairOverlap,
    meanSelfOverlap: meanSelf,
    maxSelfOverlap: maxSelf,
    durErrPct,
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
    reports.push(await evaluateBrief(db, brief));
  }
  await db.end();

  // Dump the best route per brief for the [HUMAN] drivability inspection
  // (paste eval/spk15-routes.geojson into geojson.io — gitignored artifact).
  const { writeFile } = await import('node:fs/promises');
  const featureCollection = {
    type: 'FeatureCollection',
    features: reports
      .filter((r) => r.bestGeometry !== null)
      .map((r) => ({
        type: 'Feature',
        properties: {
          brief: r.brief,
          pass: r.pass,
          durErrPct: r.durErrPct,
          curviness: r.curviness,
          meanSelfOverlap: r.meanSelfOverlap,
        },
        geometry: r.bestGeometry,
      })),
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
      pad('curv', 7) +
      pad('ms', 7) +
      'verdict',
  );
  console.log('-'.repeat(110));
  for (const r of reports) {
    console.log(
      pad(r.brief.slice(0, 44), 46) +
        pad(r.presented, 6) +
        pad(r.feasible, 6) +
        pad(r.maxPairOverlap.toFixed(2), 7) +
        pad(`${r.meanSelfOverlap.toFixed(2)}/${r.maxSelfOverlap.toFixed(2)}`, 14) +
        pad(r.durErrPct === null ? '—' : r.durErrPct.toFixed(0), 9) +
        pad(r.curviness === null ? '—' : r.curviness.toFixed(2), 7) +
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
    `≥ K_PRESENT distinct, overlap ≤ τ, low self-overlap, feasible: ` +
      `${passed === reports.length ? 'PASS (all briefs)' : `${passed}/${reports.length} briefs — inspect FAIL rows`}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
