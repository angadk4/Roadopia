/**
 * Round 7 — residential-exposure fix experiment (owner: neighbourhood streets
 * "shouldn't be there at all in any route") → config frozen-m4t12-v2.
 *
 * The measurement + two-tier gate (soft 5 % presentation-dirty / hard 20 %
 * assembly reject, origin grace exempt) is already wired (loop.ts). This
 * experiment answers the remaining §21 question: does raising Valhalla's
 * `maneuver_penalty` (the ONE auto-costing lever that discourages
 * subdivision rat-runs — no residential knob exists in 3.7) further reduce
 * exposure without side effects?
 *
 * PRE-REGISTERED WINNER RULE (fixed before any run): sweep {5 (engine
 * default), 15, 30} on 10 DEV briefs; pick the HIGHEST penalty that
 *   (a) lowers the mean residential share of presented candidates vs 5,
 *   (b) keeps mean best-curviness ≥ baseline − 5 % (must not iron out the
 *       twisties: penalties hit named-road transitions, which chained
 *       backroads have), and
 *   (c) keeps median |dur err| ≤ baseline + 2 pp.
 * No value clearing all three → keep 5 (measurement + ranking already carry
 * round 7). Winner validated on VAL (16 briefs) vs penalty-5: feasible-rate
 * and med |err| must not regress > 2 pp, else fall back to 5.
 *
 * Run: pnpm -C eval run rq7   (Supabase local + Valhalla; no LLM)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedConstraints } from '@shared/types';
import { Client } from 'pg';

import { RESIDENTIAL_SOFT_SHARE } from '../../backend/src/planner/loop';
import { loadReqset } from '../src/datasets/load';
import type { RequestExample } from '../src/datasets/schema';
import { buildManifest, writeManifest } from '../src/harness/manifest';
import {
  planKeptSet,
  resolveRunnableConstraints,
  type KeptCandidate,
} from '../src/harness/pipeline';
import { mean, percentile } from '../src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const PENALTIES = [5, 15, 30];
const N_DEV_BRIEFS = 10;

interface ConfigStats {
  penalty: number;
  feasRate: number;
  medAbsErr: number | null;
  meanKept: number;
  /** mean residential share across ALL presented candidates (null-share = excluded). */
  meanResShare: number | null;
  /** share of presented candidates above the soft line. */
  dirtyResShare: number | null;
  /** mean curviness of the presented best. */
  meanBestCurv: number | null;
  unknownShares: number;
}

function bestOf(kept: KeptCandidate[]): KeptCandidate | null {
  const feas = kept.filter((k) => k.feasible);
  const from = feas.length ? feas : kept;
  return from.length ? from.reduce((b, k) => (k.presentKey > b.presentKey ? k : b)) : null;
}

async function runPenalty(
  db: Client,
  penalty: number,
  briefs: Array<{ e: RequestExample; c: ParsedConstraints }>,
  label: string,
): Promise<ConfigStats> {
  const errs: number[] = [];
  const shares: number[] = [];
  const bestCurvs: number[] = [];
  let dirty = 0;
  let withShare = 0;
  let unknown = 0;
  let feasBriefs = 0;
  let keptSum = 0;
  for (const { e, c } of briefs) {
    try {
      const out = await planKeptSet(db, VALHALLA, c, undefined, { maneuverPenaltyS: penalty });
      keptSum += out.kept.length;
      if (out.kept.some((k) => k.feasible)) feasBriefs++;
      for (const k of out.kept) {
        if (k.residentialShare === null) unknown++;
        else {
          withShare++;
          shares.push(k.residentialShare);
          if (k.residentialShare > RESIDENTIAL_SOFT_SHARE) dirty++;
        }
      }
      const best = bestOf(out.kept);
      if (best) {
        errs.push(Math.abs((best.durationS - out.targetS) / out.targetS) * 100);
        bestCurvs.push(best.curviness);
      }
    } catch (err) {
      console.log(`    ${e.id}: ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
  const stats: ConfigStats = {
    penalty,
    feasRate: feasBriefs / briefs.length,
    medAbsErr: percentile(errs, 50),
    meanKept: keptSum / briefs.length,
    meanResShare: mean(shares),
    dirtyResShare: withShare ? dirty / withShare : null,
    meanBestCurv: mean(bestCurvs),
    unknownShares: unknown,
  };
  console.log(
    `  ${label} penalty=${penalty}: res μ ${stats.meanResShare === null ? '—' : (stats.meanResShare * 100).toFixed(1) + '%'} · ` +
      `dirty ${stats.dirtyResShare === null ? '—' : (stats.dirtyResShare * 100).toFixed(0) + '%'} · ` +
      `curv μ ${stats.meanBestCurv?.toFixed(2)} · med|err| ${stats.medAbsErr?.toFixed(1)}% · ` +
      `kept ${stats.meanKept.toFixed(1)} · feas ${(stats.feasRate * 100).toFixed(0)}% · unknown ${stats.unknownShares}`,
  );
  return stats;
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const runnable = (split: RequestExample[]) =>
    split
      .map((e) => ({ e, c: resolveRunnableConstraints(e) }))
      .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null);
  const dev = runnable(reqset.dev).slice(0, N_DEV_BRIEFS);
  console.log(`DEV sweep (${dev.length} briefs): ${dev.map((x) => x.e.id).join(', ')}`);

  const results: ConfigStats[] = [];
  for (const p of PENALTIES) results.push(await runPenalty(db, p, dev, 'DEV'));

  const base = results.find((r) => r.penalty === 5)!;
  const eligible = results.filter(
    (r) =>
      r.penalty !== 5 &&
      r.meanResShare !== null &&
      base.meanResShare !== null &&
      r.meanResShare < base.meanResShare &&
      r.meanBestCurv !== null &&
      base.meanBestCurv !== null &&
      r.meanBestCurv >= base.meanBestCurv * 0.95 &&
      r.medAbsErr !== null &&
      base.medAbsErr !== null &&
      r.medAbsErr <= base.medAbsErr + 2,
  );
  eligible.sort((a, b) => b.penalty - a.penalty); // highest clearing penalty
  let winner = eligible.length ? eligible[0]!.penalty : 5;
  console.log(`\nDEV winner: maneuver_penalty=${winner}`);

  // VAL validation
  const val = runnable(reqset.val);
  console.log(`\nVAL validation (${val.length} briefs):`);
  const valBase = await runPenalty(db, 5, val, 'VAL');
  let valWin = valBase;
  if (winner !== 5) {
    valWin = await runPenalty(db, winner, val, 'VAL');
    if (
      valWin.feasRate < valBase.feasRate - 0.02 ||
      (valWin.medAbsErr ?? Infinity) > (valBase.medAbsErr ?? Infinity) + 2
    ) {
      console.log('winner regressed on VAL — falling back to 5');
      winner = 5;
      valWin = valBase;
    }
  }
  await db.end();

  const pct = (v: number | null, d = 1) => (v === null ? '—' : (v * 100).toFixed(d) + '%');
  const row = (r: ConfigStats) =>
    `| ${r.penalty} | ${pct(r.meanResShare)} | ${pct(r.dirtyResShare, 0)} | ${r.meanBestCurv?.toFixed(2)} | ${r.medAbsErr?.toFixed(1)}% | ${r.meanKept.toFixed(1)} | ${(r.feasRate * 100).toFixed(0)}% |`;
  const lines = [
    '# Round 7 — residential exposure: measurement gate + maneuver_penalty sweep',
    '',
    'The fix has two parts. (1) MEASUREMENT GATE (always on, this config): every',
    'otherwise-accepted candidate is traced (`/trace_attributes`, per-edge road class);',
    `residential share outside the 2.5 km origin grace > ${RESIDENTIAL_SOFT_SHARE * 100} % ranks below every clean`,
    'route at presentation AND fails the AC; > 20 % is rejected at assembly. Valhalla 3.7',
    'has NO residential costing knob (verified against source) — measuring is the only',
    'exact control. (2) COSTING: use_living_streets pinned 0; maneuver_penalty swept below.',
    '',
    'Pre-registered winner rule in experiments/rq7_residential.ts (fixed before any run).',
    '',
    '## DEV sweep (10 briefs)',
    '',
    '| maneuver_penalty | mean res share (presented) | above-soft share | best curv μ | med \\|err\\| | kept μ | feas |',
    '|---|---|---|---|---|---|---|',
    ...results.map(row),
    '',
    `Winner: **maneuver_penalty = ${winner}**${winner === 5 ? ' (engine default — no swept value cleared all three criteria; the measurement gate alone carries round 7)' : ''}.`,
    '',
    '## VAL validation (16 briefs)',
    '',
    '| maneuver_penalty | mean res share | above-soft share | best curv μ | med \\|err\\| | kept μ | feas |',
    '|---|---|---|---|---|---|---|',
    row(valBase),
    ...(winner !== 5 ? [row(valWin)] : []),
    '',
    `## Config frozen-m4t12-v2 deltas: use_living_streets 0 · maneuver_penalty ${winner} · ` +
      `RESIDENTIAL_SOFT_SHARE ${RESIDENTIAL_SOFT_SHARE} (presentation/AC) · RESIDENTIAL_HARD_SHARE 0.20 (assembly).`,
  ];
  const reportsDir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'residential.md'), lines.join('\n') + '\n', 'utf8');

  writeManifest(
    buildManifest({
      experimentId: 'rq7-residential',
      scoringConfigId: 'frozen-m4t12-v2',
      weights: {},
      datasetSplit: 'dev(10) + val(16)',
      datasetVersion: reqset.manifest.version,
      seed: 42,
      costLedger: { total_usd: 0, llm_calls: 0, notes: 'deterministic run — no LLM' },
    }),
  );
  console.log(`\nwrote eval/reports/residential.md · WINNER maneuver_penalty=${winner}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
