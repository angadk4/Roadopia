/**
 * RQ33 — mechanical application of the BD-156 pre-registered rules.
 * Written BEFORE any arm's results were read (the judge is registered too).
 *
 * Per surface: compare every challenger artifact against P0_incumbent on the
 * five rules; print PASS/FAIL per rule with the numbers; list qualifying
 * challengers ranked by (backroad gain, then continuity gain). This script
 * DECIDES nothing — it applies frozen rules; adoption still requires the
 * blind holdout review (owner).
 *
 * Run: npx tsx eval/experiments/rq33_rank.ts [loops|atob]
 */
import { readdirSync, readFileSync } from 'node:fs';

interface Row {
  status: string;
  durationMin: number | null;
  targetMin: number | null;
  backroadPct: number | null;
  turnsPer10min: number | null;
  oabLongestM: number | null;
  spurs: number | null;
  microloops: number | null;
  uturns: number | null;
  continuityMeanRunM: number | null;
  nameHopsPer10min: number | null;
  wallMs: number;
}

interface ArmStats {
  arm: string;
  n: number;
  routed: number;
  structural: number;
  backroadMean: number;
  contMean: number;
  hopsMean: number;
  turnsMean: number;
  durErrP80: number | null;
  wallMean: number;
}

function statsOf(arm: string, rows: Row[]): ArmStats {
  const ok = rows.filter((r) => r.durationMin !== null);
  const nums = (f: (r: Row) => number | null): number[] =>
    ok.map(f).filter((x): x is number => x !== null && Number.isFinite(x));
  const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  const errs = ok
    .filter((r) => r.targetMin !== null && r.targetMin > 0)
    .map((r) => Math.abs((r.durationMin! - r.targetMin!) / r.targetMin!) * 100)
    .sort((a, b) => a - b);
  return {
    arm,
    n: rows.length,
    routed: ok.length,
    structural: ok.reduce(
      (t, r) =>
        t +
        (r.spurs ?? 0) +
        (r.microloops ?? 0) +
        (r.uturns ?? 0) +
        ((r.oabLongestM ?? 0) > 1200 ? 1 : 0),
      0,
    ),
    backroadMean: mean(nums((r) => r.backroadPct)),
    contMean: mean(nums((r) => r.continuityMeanRunM)),
    hopsMean: mean(nums((r) => r.nameHopsPer10min)),
    turnsMean: mean(nums((r) => r.turnsPer10min)),
    durErrP80: errs.length ? errs[Math.floor(errs.length * 0.8)]! : null,
    wallMean: mean(nums((r) => r.wallMs)),
  };
}

function main(): void {
  const surface = process.argv[2] ?? 'atob';
  const dir = 'eval/reports/rq33';
  const files = readdirSync(dir).filter((f) => f.startsWith(`${surface}-`) && f.endsWith('.json'));
  const arms = new Map<string, ArmStats>();
  for (const f of files) {
    const arm = f.replace(`${surface}-`, '').replace('.json', '');
    const d = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { routes: Row[] };
    arms.set(arm, statsOf(arm, d.routes));
  }
  const inc = arms.get('P0_incumbent');
  if (!inc) throw new Error('incumbent artifact missing');

  console.log(`=== rq33 ${surface} — BD-156 rules vs P0_incumbent ===`);
  console.log(
    `P0_incumbent        routed ${inc.routed}/${inc.n} · structural ${inc.structural} · back ${inc.backroadMean.toFixed(1)}% · cont ${inc.contMean.toFixed(0)}m · turns ${inc.turnsMean.toFixed(1)} · durErrP80 ${inc.durErrP80?.toFixed(0) ?? '—'}% · wall ${inc.wallMean.toFixed(0)}ms`,
  );
  const qualified: Array<{ s: ArmStats; backGain: number; contGain: number }> = [];
  for (const [arm, s] of [...arms.entries()].sort()) {
    if (arm === 'P0_incumbent') continue;
    const backGain = s.backroadMean - inc.backroadMean;
    const contGain = inc.contMean > 0 ? (s.contMean - inc.contMean) / inc.contMean : 0;
    const r1 = s.structural <= inc.structural;
    const r2 = backGain >= 5 || (backGain > -1 && contGain >= 0.25);
    const r3 = s.durErrP80 === null || inc.durErrP80 === null || s.durErrP80 <= inc.durErrP80 + 3;
    const r4 = s.wallMean <= inc.wallMean * 1.2;
    const r5 = s.turnsMean <= inc.turnsMean * 1.1;
    const routedOk = s.routed >= inc.routed;
    const pass = r1 && r2 && r3 && r4 && r5 && routedOk;
    console.log(
      `${s.arm.padEnd(18)} routed ${s.routed}/${s.n}${routedOk ? ' ' : '✗'} · structural ${s.structural}${r1 ? ' ' : '✗'} · back ${s.backroadMean.toFixed(1)}% (${backGain >= 0 ? '+' : ''}${backGain.toFixed(1)})${r2 ? ' ' : '✗'} · cont ${s.contMean.toFixed(0)}m (${(contGain * 100).toFixed(0)}%) · turns ${s.turnsMean.toFixed(1)}${r5 ? ' ' : '✗'} · durErrP80 ${s.durErrP80?.toFixed(0) ?? '—'}%${r3 ? ' ' : '✗'} · wall ${s.wallMean.toFixed(0)}ms${r4 ? ' ' : '✗'}  ${pass ? '→ QUALIFIES' : ''}`,
    );
    if (pass) qualified.push({ s, backGain, contGain });
  }
  qualified.sort((a, b) => b.backGain - a.backGain || b.contGain - a.contGain);
  console.log(
    qualified.length > 0
      ? `\nQUALIFIED (rule-passing) in rank order: ${qualified.map((q) => q.s.arm).join(' > ')}\n→ top challenger goes to the BLIND HOLDOUT review (owner) — no adoption before it.`
      : `\nNO challenger passes the pre-registered rules on ${surface} — the incumbent survives its first real competition; record the refusal.`,
  );
}

main();
