/**
 * RQ25-U6a — the A→B LOSS diagnostic. Run BEFORE any A→B fix (plan ordering
 * law #4): audit-v11 found hamilton→guelph assembles a 4-span chain (accepted,
 * 0.00 self-overlap, 61 % arterial, zero reject reasons) and then presents an
 * 89.5 % arterial single-touch route instead. The chain did not die at
 * assembly — it lost at PRESENTATION. This script asks the one question "WHY
 * did lower-arterial rank below higher-arterial?" per brief, with the answer
 * recorded into one of the plan's pre-registered branches:
 *
 *   (i)   dirty flip (res_run / uturn / …)      → U5 is the fix
 *   (ii)  contextHeavy (urban −2)               → adjust the A→B grace
 *   (iii) clean both, nothing rewards road mix  → U10 is the fix
 *   (iv)  culled before scoring                 → U7 / prefilter territory
 *
 * Method: run the REAL planner over the 15 atob_quality briefs with the
 * R25-U6a `onScored` observability hook (read-only; selection untouched).
 * For each brief, compare the WINNER (max presentKey) against the CONTENDER —
 * the scored candidate with the lowest mainShare (min 25 % backroad advantage
 * over the winner to count as genuinely better material). Decompose the key
 * gap term by term.
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx experiments/rq25_atob_loss.ts
 */

import { Client } from 'pg';

import { parseRules } from '../../backend/src/planner/parse_rules';
import { runPlanner, type ScoredDebugRow } from '../../backend/src/planner/run';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

/** Same 15 briefs as atob_quality.ts — the standing A→B measurement set. */
const BRIEFS: string[] = [
  'Scenic drive to Niagara Falls from St. Catharines',
  'drive from Hamilton to Guelph',
  'twisty drive from Guelph to Orangeville',
  'backroads drive from Barrie to Collingwood',
  'drive from Waterloo to Stratford',
  'scenic drive from Caledon East to Creemore',
  'drive from Peterborough to Bancroft',
  'twisty drive from Hamilton to Simcoe',
  'drive from London to Goderich',
  'drive from Oshawa to Peterborough with a coffee stop',
  'drive from Milton to Elora, no highways',
  'backroads drive from Cobourg to Uxbridge',
  'scenic drive from Cambridge to Paris',
  'scenic drive from Newmarket to Uxbridge',
  'drive from Aurora to Schomberg',
];

type Branch = 'i_dirty' | 'ii_context' | 'iii_no_mix_reward' | 'iv_culled' | 'no_contender';

function fmtRow(s: ScoredDebugRow): string {
  const mix = s.classMix;
  const mixStr = mix
    ? `hwy ${Math.round(mix.highwayShare * 100)}/main ${Math.round(mix.mainShare * 100)}/back ${Math.round(
        mix.backroadShare * 100,
      )}/hood ${Math.round(mix.hoodShare * 100)}`
    : 'untraced';
  return (
    `${s.id.padEnd(14)} key ${s.presentKey.toFixed(2).padStart(8)}  score ${s.score.toFixed(2)}  ` +
    `${mixStr.padEnd(28)} art ${s.arterialShare === null ? ' —' : Math.round(s.arterialShare * 100)}%  ` +
    `curv ${s.curviness.toFixed(2)}  ${Math.round(s.durationS / 60)}min  ` +
    `${s.dirty ? `DIRTY[${s.dirtyClauses.join(',')}] u=${s.units}` : 'clean'}` +
    `${s.durOff ? ' durOff' : ''}${s.contextHeavy ? ` ctxHeavy(urb ${s.urbanShare === null ? '?' : Math.round(s.urbanShare * 100)}%)` : ''}` +
    `${s.residentialRunM !== null && s.residentialRunM > 500 ? ` resRun ${Math.round(s.residentialRunM)}m` : ''}`
  );
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const branchCounts: Record<Branch, number> = {
    i_dirty: 0,
    ii_context: 0,
    iii_no_mix_reward: 0,
    iv_culled: 0,
    no_contender: 0,
  };

  for (const brief of BRIEFS) {
    const constraints = parseRules(brief);
    const iterations: ScoredDebugRow[][] = [];
    const res = await runPlanner(constraints, {
      db,
      valhallaUrl: VALHALLA,
      onScored: (rows) => iterations.push(rows),
    });
    // last iteration's pool is the one the presenter chose from
    const pool = iterations.at(-1) ?? [];
    console.log(`\n=== ${brief}  [status ${res.status}; ${pool.length} scored]`);
    if (pool.length === 0) {
      branchCounts.iv_culled += 1; // nothing ever reached scoring
      console.log('  no scored candidates at all → branch (iv) culled/starved');
      continue;
    }
    const byKey = [...pool].sort((a, b) => b.presentKey - a.presentKey || (a.id < b.id ? -1 : 1));
    const winner = byKey[0]!;
    // contender = lowest mainShare among traced candidates with a REAL
    // backroad advantage (≥10 pp more backroad than the winner)
    const traced = pool.filter((s) => s.classMix !== null);
    const contender = [...traced]
      .sort((a, b) => a.classMix!.mainShare - b.classMix!.mainShare || (a.id < b.id ? -1 : 1))
      .find(
        (s) =>
          s.id !== winner.id &&
          (winner.classMix === null ||
            s.classMix!.backroadShare >= winner.classMix.backroadShare + 0.1),
      );
    console.log(`  WINNER    ${fmtRow(winner)}`);
    if (!contender) {
      branchCounts.no_contender += 1;
      console.log(
        '  no better-mix contender in the scored pool → the pool itself is the problem (U19 territory, not ranking)',
      );
      continue;
    }
    console.log(`  CONTENDER ${fmtRow(contender)}`);
    // Decompose why the contender lost (branch attribution, most specific first)
    let branch: Branch;
    if (contender.dirty && !winner.dirty) {
      branch = 'i_dirty';
    } else if (contender.contextHeavy && !winner.contextHeavy) {
      branch = 'ii_context';
    } else {
      branch = 'iii_no_mix_reward';
    }
    branchCounts[branch] += 1;
    const gap = winner.presentKey - contender.presentKey;
    console.log(
      `  → branch (${branch})  keyGap ${gap.toFixed(2)}  ` +
        `(scoreGap ${(winner.score - contender.score).toFixed(2)}, ` +
        `contender ${contender.dirty ? `dirty[${contender.dirtyClauses.join(',')}]` : 'clean'}` +
        `${contender.durOff && !winner.durOff ? ', durOff-only-contender' : ''})`,
    );
  }
  await db.end();

  console.log('\n-- RQ25-U6a branch tally (pre-registered) --');
  console.log(`(i)   dirty flip        → U5 fixes:        ${branchCounts.i_dirty}`);
  console.log(`(ii)  contextHeavy      → A→B grace fix:   ${branchCounts.ii_context}`);
  console.log(`(iii) no mix reward     → U10 fixes:       ${branchCounts.iii_no_mix_reward}`);
  console.log(`(iv)  culled pre-score  → prefilter/U7:    ${branchCounts.iv_culled}`);
  console.log(`      no contender      → U19 (generation): ${branchCounts.no_contender}`);
  console.log(
    '\nverdict rule: the largest bucket names the FIRST A→B fix; ' +
      '`no_contender` majority → ranking fixes are inert for A→B, skip to U19.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
