/**
 * Round 8 — micro-loop root-cause A/B: middle-waypoint 'through' vs 'via'
 * (owner: routes "spin the crescent" — small closed circuits).
 *
 * Hypothesis: 'through' waypoints FORBID u-turns, so when a search waypoint
 * needs a heading reversal Valhalla silently circles a residential block (a
 * micro-loop no earlier detector saw). 'via' permits the u-turn instead —
 * converting the hidden spin into a VISIBLE u-turn the existing two-tier
 * u-turn machinery already rejects (≥2) or demotes (≥1).
 *
 * PRE-REGISTERED DECISION RULE (fixed before any run): switch production to
 * 'via' IFF, over the probe briefs, it (a) lowers the mean micro-loop count
 * of presented candidates AND (b) does not lower the mean count of briefs
 * with ≥1 CLEAN feasible candidate (clean = no u-turn, no spur, no
 * micro-loop, residential ≤ soft) AND (c) median |dur err| within +2 pp.
 * Ties → keep 'through' (the incumbent).
 *
 * Run: pnpm -C eval run rq8   (Supabase local + Valhalla; no LLM)
 */

import type { ParsedConstraints } from '@shared/types';
import { Client } from 'pg';

import { RESIDENTIAL_SOFT_SHARE } from '../../backend/src/planner/loop';
import { loadReqset } from '../src/datasets/load';
import type { RequestExample } from '../src/datasets/schema';
import {
  planKeptSet,
  resolveRunnableConstraints,
  type KeptCandidate,
} from '../src/harness/pipeline';
import { mean, percentile } from '../src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const N_BRIEFS = 8;

function isClean(k: KeptCandidate): boolean {
  return (
    k.uturns === 0 &&
    k.spursWide === 0 &&
    k.microloops === 0 &&
    (k.residentialShare ?? 1) <= RESIDENTIAL_SOFT_SHARE
  );
}

async function runArm(
  db: Client,
  middleType: 'through' | 'via',
  briefs: Array<{ e: RequestExample; c: ParsedConstraints }>,
): Promise<void> {
  const loopCounts: number[] = [];
  const uturnCounts: number[] = [];
  const errs: number[] = [];
  let briefsWithClean = 0;
  let keptTotal = 0;
  for (const { e, c } of briefs) {
    try {
      const out = await planKeptSet(db, VALHALLA, c, undefined, { middleType });
      keptTotal += out.kept.length;
      for (const k of out.kept) {
        loopCounts.push(k.microloops);
        uturnCounts.push(k.uturns);
      }
      if (out.kept.some(isClean)) briefsWithClean++;
      const feas = out.kept.filter((k) => k.feasible);
      const from = feas.length ? feas : out.kept;
      if (from.length) {
        const best = from.reduce((b, k) => (k.presentKey > b.presentKey ? k : b));
        errs.push(Math.abs((best.durationS - out.targetS) / out.targetS) * 100);
      }
      console.log(
        `  [${middleType}] ${e.id}: kept ${out.kept.length} · µloops/cand ${out.kept.map((k) => k.microloops).join(',') || '—'} · clean? ${out.kept.some(isClean) ? 'YES' : 'no'}`,
      );
    } catch (err) {
      console.log(`  [${middleType}] ${e.id}: ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(
    `  == ${middleType}: µloop μ ${mean(loopCounts)?.toFixed(2)} · uturn μ ${mean(uturnCounts)?.toFixed(2)} · ` +
      `briefs-with-clean ${briefsWithClean}/${briefs.length} · med|err| ${percentile(errs, 50)?.toFixed(1)}% · kept ${keptTotal}`,
  );
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const briefs = reqset.dev
    .map((e) => ({ e, c: resolveRunnableConstraints(e) }))
    .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null)
    .slice(0, N_BRIEFS);
  console.log(`A/B briefs: ${briefs.map((x) => x.e.id).join(', ')}\n`);
  await runArm(db, 'through', briefs);
  console.log();
  await runArm(db, 'via', briefs);
  await db.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
