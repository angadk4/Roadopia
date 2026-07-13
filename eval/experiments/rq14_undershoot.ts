/**
 * Round 14 — timing undershoot fix: widen the retrieval isochrone on the
 * resize retry when a pool is still SHORT (owner: "this timing issue is dumb").
 *
 * Measured bias: every timing failure is an undershoot (−26…−34 %), never long.
 * Root cause (confirmed in pipeline.ts): the resize retry rescales speed but
 * keeps tauMult 1, so it re-picks the SAME retrieved roads; the wider-search
 * fallback only fires on thin candidate COUNT, never on healthy-but-short. The
 * fix fetches farther curvy material proportional to the shortfall.
 *
 * PRE-REGISTERED RULE (fixed before any run; §21 tune-on-DEV / validate-on-VAL):
 * adopt widenOnUndershoot as the DEFAULT iff, vs baseline on the SAME briefs:
 *   PRIMARY, on the baseline-undershoot subset (best-route signed err < −20 %):
 *     (a) mean |signed dur err| drops by ≥ 5 pp (real convergence), AND
 *     (b) the count of >25 %-off bests does not rise.
 *   GUARDS, on ALL runnable briefs:
 *     (c) median |dur err| across all briefs ≤ baseline + 2 pp (no collateral
 *         on the towns that were already fine), AND
 *     (d) mean best-route cleanliness does not worsen — no rise in the count of
 *         bests carrying a spur / micro-loop / over-cap residential run (the
 *         length must not be bought with boredom or weaving), AND
 *     (e) p90 wall ≤ 25 s.
 * VAL confirms directionally or no adoption.
 *
 * Run: pnpm -C eval run rq14
 */

import type { ParsedConstraints } from '@shared/types';
import { Client } from 'pg';

import { RESIDENTIAL_RUN_SOFT_M, RESIDENTIAL_SOFT_SHARE } from '../../backend/src/planner/loop';
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
function dirty(k: KeptCandidate): boolean {
  return (
    k.spursWide > 0 ||
    k.microloops > 0 ||
    (k.residentialRunM ?? 0) > RESIDENTIAL_RUN_SOFT_M ||
    (k.residentialShare ?? 0) > RESIDENTIAL_SOFT_SHARE
  );
}

interface Row {
  id: string;
  signed: number | null; // best-route signed dur err, fraction
  dirty: boolean;
  wallMs: number;
}

async function runArm(
  db: Client,
  briefs: Array<{ e: RequestExample; c: ParsedConstraints }>,
  widen: boolean,
): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  for (const { e, c } of briefs) {
    try {
      const o = await planKeptSet(db, VALHALLA, c, undefined, { widenOnUndershoot: widen });
      const best = bestOf(o.kept);
      out.set(e.id, {
        id: e.id,
        signed: best ? (best.durationS - o.targetS) / o.targetS : null,
        dirty: best ? dirty(best) : false,
        wallMs: o.ms,
      });
    } catch {
      out.set(e.id, { id: e.id, signed: null, dirty: false, wallMs: 0 });
    }
  }
  return out;
}

function summarize(label: string, rows: Map<string, Row>): void {
  const errs = [...rows.values()]
    .filter((r) => r.signed !== null)
    .map((r) => Math.abs(r.signed!) * 100);
  const dirtyN = [...rows.values()].filter((r) => r.dirty).length;
  console.log(
    `  ${label}: med|err| ${percentile(errs, 50)?.toFixed(1)}% · dirty bests ${dirtyN} · p90 wall ${Math.round(
      (percentile(
        [...rows.values()].map((r) => r.wallMs),
        90,
      ) ?? 0) / 1000,
    )}s`,
  );
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const runnable = (split: RequestExample[]) =>
    split
      .map((e) => ({ e, c: resolveRunnableConstraints(e) }))
      .filter((x): x is { e: RequestExample; c: ParsedConstraints } => x.c !== null);

  const decide = (base: Map<string, Row>, wide: Map<string, Row>) => {
    const under = [...base.values()].filter((r) => r.signed !== null && r.signed < -0.2);
    const underIds = under.map((r) => r.id);
    const baseUnderErr = mean(under.map((r) => Math.abs(r.signed!) * 100))!;
    const wideUnderErr = mean(underIds.map((id) => Math.abs(wide.get(id)!.signed ?? 0) * 100))!;
    const baseOver25 = [...base.values()].filter(
      (r) => r.signed !== null && Math.abs(r.signed!) > 0.25,
    ).length;
    const wideOver25 = [...wide.values()].filter(
      (r) => r.signed !== null && Math.abs(r.signed!) > 0.25,
    ).length;
    const allErr = (m: Map<string, Row>) =>
      percentile(
        [...m.values()].filter((r) => r.signed !== null).map((r) => Math.abs(r.signed!) * 100),
        50,
      ) ?? 0;
    const dirtyN = (m: Map<string, Row>) => [...m.values()].filter((r) => r.dirty).length;
    const p90 =
      percentile(
        [...wide.values()].map((r) => r.wallMs),
        90,
      ) ?? 0;
    const converge = baseUnderErr - wideUnderErr;
    const pass =
      converge >= 5 &&
      wideOver25 <= baseOver25 &&
      allErr(wide) <= allErr(base) + 2 &&
      dirtyN(wide) <= dirtyN(base) &&
      p90 <= 25_000;
    return {
      under: under.length,
      baseUnderErr,
      wideUnderErr,
      converge,
      baseOver25,
      wideOver25,
      allBase: allErr(base),
      allWide: allErr(wide),
      dirtyBase: dirtyN(base),
      dirtyWide: dirtyN(wide),
      pass,
    };
  };

  console.log('DEV:');
  const dev = runnable(reqset.dev);
  const dBase = await runArm(db, dev, false);
  summarize('baseline', dBase);
  const dWide = await runArm(db, dev, true);
  summarize('widen   ', dWide);
  const dv = decide(dBase, dWide);
  console.log(
    `  undershoot subset (${dv.under}): mean|err| ${dv.baseUnderErr.toFixed(1)}% → ${dv.wideUnderErr.toFixed(1)}% (−${dv.converge.toFixed(1)} pp) · >25%-off ${dv.baseOver25}→${dv.wideOver25} · all-med ${dv.allBase.toFixed(1)}→${dv.allWide.toFixed(1)} · dirty ${dv.dirtyBase}→${dv.dirtyWide}`,
  );
  console.log(`  DEV verdict: ${dv.pass ? 'CLEARS' : 'does not clear'}`);

  let adopt = dv.pass;
  if (adopt) {
    console.log('VAL:');
    const val = runnable(reqset.val);
    const vBase = await runArm(db, val, false);
    summarize('baseline', vBase);
    const vWide = await runArm(db, val, true);
    summarize('widen   ', vWide);
    const vv = decide(vBase, vWide);
    console.log(
      `  undershoot subset (${vv.under}): mean|err| ${vv.baseUnderErr.toFixed(1)}% → ${vv.wideUnderErr.toFixed(1)}% · all-med ${vv.allBase.toFixed(1)}→${vv.allWide.toFixed(1)} · dirty ${vv.dirtyBase}→${vv.dirtyWide}`,
    );
    adopt = vv.converge > 0 && vv.allWide <= vv.allBase + 2 && vv.dirtyWide <= vv.dirtyBase;
    console.log(`  VAL verdict: ${adopt ? 'CONFIRMS' : 'REGRESSED — no adoption'}`);
  }
  await db.end();
  console.log(`\nDECISION: widenOnUndershoot default = ${adopt}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
