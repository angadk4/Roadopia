/**
 * Round 12 — generation density A/B: cluster TRIPLES on rich budgets
 * (owner-ordered; the structural backroads lever named at BD-39).
 *
 * PRE-REGISTERED RULE (fixed before any run; §21 tune-on-DEV / validate-on-
 * VAL): adopt triples as the DEFAULT iff, on ≥90-minute DEV briefs vs the
 * current generator on the SAME briefs:
 *   (a) mean best countryScore +0.02 OR mean best curviness +5 % (density may
 *       express as either — more pinned corridors), AND
 *   (b) median |dur err| ≤ baseline + 2 pp (the round-5 failure mode), AND
 *   (c) feasible-rate ≥ baseline AND mean kept ≥ baseline − 0.3, AND
 *   (d) p90 wall ≤ 25 s.
 * VAL confirms directionally or no adoption.
 *
 * Run: pnpm -C eval run rq12
 */

import type { ParsedConstraints } from '@shared/types';
import { Client } from 'pg';

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

function bestOf(kept: KeptCandidate[]): KeptCandidate | null {
  const feas = kept.filter((k) => k.feasible);
  const from = feas.length ? feas : kept;
  return from.length ? from.reduce((b, k) => (k.presentKey > b.presentKey ? k : b)) : null;
}

interface ArmStats {
  label: string;
  meanCountry: number | null;
  meanCurv: number | null;
  medAbsErr: number | null;
  feasRate: number;
  meanKept: number;
  p90Ms: number | null;
}

async function runArm(
  db: Client,
  briefs: Array<{ e: RequestExample; c: ParsedConstraints }>,
  triples: boolean,
  label: string,
): Promise<ArmStats> {
  const countries: number[] = [];
  const curvs: number[] = [];
  const errs: number[] = [];
  const walls: number[] = [];
  let feas = 0;
  let keptSum = 0;
  for (const { e, c } of briefs) {
    try {
      const out = await planKeptSet(db, VALHALLA, c, undefined, { tripleClusters: triples });
      walls.push(out.ms);
      keptSum += out.kept.length;
      if (out.kept.some((k) => k.feasible)) feas++;
      const best = bestOf(out.kept);
      if (best) {
        if (best.countryScore !== null) countries.push(best.countryScore);
        curvs.push(best.curviness);
        errs.push(Math.abs((best.durationS - out.targetS) / out.targetS) * 100);
      }
      const triplesKept = out.kept.filter((k) => (k.id.match(/\+c/g) ?? []).length >= 2).length;
      console.log(
        `  [${label}] ${e.id}: kept ${out.kept.length} (triples ${triplesKept}) · best country ${best?.countryScore?.toFixed(2) ?? '—'} curv ${best?.curviness.toFixed(2) ?? '—'}`,
      );
    } catch (err) {
      console.log(`  [${label}] ${e.id}: ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
  const s: ArmStats = {
    label,
    meanCountry: mean(countries),
    meanCurv: mean(curvs),
    medAbsErr: percentile(errs, 50),
    feasRate: feas / briefs.length,
    meanKept: keptSum / briefs.length,
    p90Ms: percentile(walls, 90),
  };
  console.log(
    `  == ${label}: country μ ${s.meanCountry?.toFixed(3)} · curv μ ${s.meanCurv?.toFixed(2)} · med|err| ${s.medAbsErr?.toFixed(1)}% · feas ${(s.feasRate * 100).toFixed(0)}% · kept ${s.meanKept.toFixed(1)} · p90 ${Math.round((s.p90Ms ?? 0) / 1000)}s`,
  );
  return s;
}

function clears(t: ArmStats, b: ArmStats): boolean {
  const gain =
    (t.meanCountry !== null && b.meanCountry !== null && t.meanCountry >= b.meanCountry + 0.02) ||
    (t.meanCurv !== null && b.meanCurv !== null && t.meanCurv >= b.meanCurv * 1.05);
  return (
    gain &&
    t.medAbsErr !== null &&
    b.medAbsErr !== null &&
    t.medAbsErr <= b.medAbsErr + 2 &&
    t.feasRate >= b.feasRate &&
    t.meanKept >= b.meanKept - 0.3 &&
    (t.p90Ms ?? Infinity) <= 25_000
  );
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const rich = (split: RequestExample[]) =>
    split
      .map((e) => ({ e, c: resolveRunnableConstraints(e) }))
      .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null)
      .filter((x) => (x.c.duration_target_s ?? 5400) >= 5400);

  const dev = rich(reqset.dev).slice(0, 8);
  console.log(`DEV rich briefs (${dev.length}): ${dev.map((x) => x.e.id).join(', ')}\nbaseline:`);
  const devBase = await runArm(db, dev, false, 'DEV base');
  console.log('triples:');
  const devTriples = await runArm(db, dev, true, 'DEV tri');
  let adopt = clears(devTriples, devBase);
  console.log(`DEV verdict: ${adopt ? 'CLEARS' : 'does not clear'}`);

  if (adopt) {
    const val = rich(reqset.val);
    console.log(`VAL (${val.length}):`);
    const valBase = await runArm(db, val, false, 'VAL base');
    const valTriples = await runArm(db, val, true, 'VAL tri');
    adopt = clears(valTriples, valBase);
    console.log(`VAL verdict: ${adopt ? 'CONFIRMS' : 'REGRESSED — no adoption'}`);
  }
  await db.end();
  console.log(`\nDECISION: tripleClusters default = ${adopt}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
