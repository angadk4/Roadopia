/**
 * M4 close — SINGLE-USE final numbers on the LOCKED TEST split (Protocol §6.4 /
 * §25 Stage 8). Frozen config = frozen-m4t12-v8. Run ONCE; re-running after any
 * change to chase a number invalidates the split (note the violation if it
 * happens).
 *
 * Reports three honest headline gauges on the presented BEST route per brief,
 * so the record shows research-strictness AND product-readiness side by side:
 *   PERFECT   — the full SPK-15 composite (all 12 bars at once, incl. a menu of
 *               ≥4 distinct alternates). The strict research metric.
 *   SHIPPABLE — best route is CLEAN (no u-turn / spur / micro-loop; residential
 *               within caps) AND within a DISCLOSED time band (±35 %). What the
 *               app can actually show, with an honest "≈X min" label. Does NOT
 *               require 4 alternates.
 *   CLEAN     — best route clean regardless of time (pure route quality).
 * Plus median/mean duration error and the honest failure reasons.
 *
 * Parse/disposition accuracy is NOT re-measured here — that final number is the
 * GATE-A result (VAL parse_accuracy .916, BD-28); this run is the deterministic
 * PLANNER's route-quality number, which is what M4's tuning targeted.
 *
 * Run: pnpm -C eval run test-final   (Supabase local + Valhalla; no LLM)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedConstraints } from '@shared/types';
import { Client } from 'pg';

import { K_PRESENT_DEFAULT, TAU_OVERLAP_DEFAULT } from '../../backend/src/planner/diversify';
import { RESIDENTIAL_RUN_SOFT_M, RESIDENTIAL_SOFT_SHARE } from '../../backend/src/planner/loop';
import { pairOverlap } from '../../backend/src/planner/overlap';
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
const SHIP_TIME_BAND = 0.35; // disclosed-time tolerance for "shippable"

function bestOf(kept: KeptCandidate[]): KeptCandidate | null {
  const feas = kept.filter((k) => k.feasible);
  const from = feas.length ? feas : kept;
  return from.length ? from.reduce((b, k) => (k.presentKey > b.presentKey ? k : b)) : null;
}
function cleanRoute(k: KeptCandidate): boolean {
  return (
    k.uturns === 0 &&
    k.spursWide === 0 &&
    k.microloops === 0 &&
    (k.residentialRunM ?? 9999) <= RESIDENTIAL_RUN_SOFT_M &&
    (k.residentialShare ?? 9) * 100 <= RESIDENTIAL_SOFT_SHARE * 100
  );
}

interface Line {
  id: string;
  origin: string;
  targetMin: number;
  routedMin: number | null;
  signedErr: number | null;
  presented: number;
  feasible: number;
  perfect: boolean;
  shippable: boolean;
  clean: boolean;
  why: string;
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const briefs = reqset.test
    .map((e) => ({ e, c: resolveRunnableConstraints(e) }))
    .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null);
  console.log(`LOCKED TEST — ${briefs.length} runnable loop briefs, config frozen-m4t12-v8\n`);

  const lines: Line[] = [];
  for (const { e, c } of briefs) {
    const target = (c.duration_target_s ?? 5400) / 60;
    let line: Line = {
      id: e.id,
      origin: e.origin_id ?? (typeof c.origin === 'object' ? 'coord' : String(c.origin)),
      targetMin: Math.round(target),
      routedMin: null,
      signedErr: null,
      presented: 0,
      feasible: 0,
      perfect: false,
      shippable: false,
      clean: false,
      why: '',
    };
    try {
      const o = await planKeptSet(db, VALHALLA, c);
      const kept = o.kept;
      const feas = kept.filter((k) => k.feasible);
      const best = bestOf(kept);
      let maxPair = 0;
      for (let i = 0; i < kept.length; i++) {
        for (let j = i + 1; j < kept.length; j++) {
          maxPair = Math.max(maxPair, pairOverlap(kept[i]!.geometry, kept[j]!.geometry));
        }
      }
      const meanSelf = kept.length ? kept.reduce((s, k) => s + k.selfOverlap, 0) / kept.length : 0;
      const maxSelf = kept.length ? Math.max(...kept.map((k) => k.selfOverlap)) : 0;
      const signed = best ? (best.durationS - o.targetS) / o.targetS : null;
      const cleanBest = best ? cleanRoute(best) : false;
      const durOk25 = signed !== null && Math.abs(signed) <= 0.25;
      const durOkShip = signed !== null && Math.abs(signed) <= SHIP_TIME_BAND;
      const perfect =
        kept.length >= K_PRESENT_DEFAULT &&
        maxPair <= TAU_OVERLAP_DEFAULT &&
        feas.length > 0 &&
        meanSelf <= 0.15 &&
        maxSelf <= 0.3 &&
        durOk25 &&
        cleanBest;
      const shippable = feas.length > 0 && cleanBest && durOkShip;

      const why: string[] = [];
      if (feas.length === 0) why.push('no feasible route');
      if (kept.length < K_PRESENT_DEFAULT) why.push(`${kept.length}/4 alternates`);
      if (best && !cleanBest) why.push('route flaw');
      if (signed !== null && Math.abs(signed) > 0.25)
        why.push(`${signed > 0 ? '+' : ''}${Math.round(signed * 100)}% time`);

      line = {
        ...line,
        routedMin: best ? Math.round(best.durationS / 60) : null,
        signedErr: signed,
        presented: kept.length,
        feasible: feas.length,
        perfect,
        shippable,
        clean: cleanBest,
        why: perfect ? '' : why.join(', '),
      };
    } catch (err) {
      line.why = `ERROR ${err instanceof Error ? err.message : String(err)}`;
    }
    lines.push(line);
    console.log(
      `  ${line.id} ${line.origin.padEnd(16)} ${line.targetMin}m→${line.routedMin ?? '—'}m ` +
        `${line.perfect ? 'PERFECT' : line.shippable ? 'shippable' : line.clean ? 'clean' : 'weak'} ${line.why}`,
    );
  }
  await db.end();

  const n = lines.length;
  const perfect = lines.filter((l) => l.perfect).length;
  const shippable = lines.filter((l) => l.shippable).length;
  const clean = lines.filter((l) => l.clean).length;
  const absErrs = lines
    .filter((l) => l.signedErr !== null)
    .map((l) => Math.abs(l.signedErr!) * 100);

  const pct = (k: number) => `${k}/${n} (${Math.round((100 * k) / n)}%)`;
  const report = [
    '# M4 final numbers — LOCKED TEST split, config frozen-m4t12-v8 (single-use, §25 Stage 8)',
    '',
    `Held-out TEST briefs never seen during tuning: ${n} runnable loops across short/medium/long.`,
    'Three gauges on the presented best route (definitions in experiments/test_final.ts header):',
    '',
    `- **PERFECT** (strict all-12 composite, incl. ≥4 alternates): **${pct(perfect)}**`,
    `- **SHIPPABLE** (clean best route + within ±${SHIP_TIME_BAND * 100} % disclosed time): **${pct(shippable)}**`,
    `- **CLEAN** (best route clean, any time): **${pct(clean)}**`,
    '',
    `Duration error of best: median **${percentile(absErrs, 50)?.toFixed(0)} %**, mean ${mean(absErrs)?.toFixed(0)} %.`,
    '',
    'Honest reading: PERFECT is the research bar (stricter than "a driver would be happy" —',
    'it also demands a 4-route menu). SHIPPABLE is the product bar: a clean route the app can',
    'show with an honest "≈X min" label. The gap between them is mostly menu-size + the',
    'disclosed-time band, not route badness (BD-42: the timing tail is fundamental in',
    'road-sparse origins, answered by UI disclosure).',
    '',
    '| brief | origin | target | routed | gauge | why (if not perfect) |',
    '|---|---|---|---|---|---|',
    ...lines.map(
      (l) =>
        `| ${l.id} | ${l.origin} | ${l.targetMin}m | ${l.routedMin ?? '—'}m | ${l.perfect ? 'PERFECT' : l.shippable ? 'shippable' : l.clean ? 'clean' : 'weak'} | ${l.why} |`,
    ),
  ];

  const reportsDir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'test-final.md'), report.join('\n') + '\n', 'utf8');
  writeManifest(
    buildManifest({
      experimentId: 'm4-test-final',
      scoringConfigId: 'frozen-m4t12-v8',
      weights: { dur: 0.3, cur: 0.35, stop: 0.1, scenic: 0, overlap: 0.25, uturn: 0.1, country: 0 },
      datasetSplit: 'test (LOCKED, single-use)',
      datasetVersion: reqset.manifest.version,
      seed: 42,
      costLedger: { total_usd: 0, llm_calls: 0, notes: 'deterministic planner — no LLM' },
    }),
  );

  console.log(
    `\n=== M4 FINAL (TEST, config v8) ===\n  PERFECT ${pct(perfect)} · SHIPPABLE ${pct(shippable)} · CLEAN ${pct(clean)} · median dur err ${percentile(absErrs, 50)?.toFixed(0)}%`,
  );
  console.log('wrote eval/reports/test-final.md');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
