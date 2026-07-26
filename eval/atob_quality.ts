/**
 * R18-3 — A→B corridor quality: the loop suite's blind spot. The R18 audit
 * measured A→B routes as ~100 % fastest-path around ONE off-road centroid;
 * R18-3 gives A→B traversal spans, corridor chains (monotone by progress),
 * span-atomic repair, and always-trace measured truth. This harness is the
 * standing measurement: 12 corridor briefs through the REAL planner.
 *
 * FIRST RUN = BASELINE (eval/runs/r18-rebaseline/atob-r18-3-baseline.txt) —
 * no pre-R18-3 A→B eval existed, so deltas are tracked from here forward.
 * Determinism: report hash (minus ms) must be stable across runs.
 *
 * Run: pnpm -C eval run atob-quality   (stack up)
 */

import { createHash } from 'node:crypto';

import { Client } from 'pg';

import { parseRules } from '../backend/src/planner/parse_rules';
import { runPlanner } from '../backend/src/planner/run';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

/** 12 corridor briefs: mixed lengths/directions across the region, characterful
 *  and plain, one with a stop (legacy candidates carry it; chains are v1
 *  stop-free), one no-highways. */
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
  // R24-U16: the audit-v8 arterial-heavy + no-route offenders (the tune targets)
  'scenic drive from Cambridge to Paris',
  'scenic drive from Newmarket to Uxbridge',
  'drive from Aurora to Schomberg',
];

interface Row {
  brief: string;
  status: string;
  km: number | null;
  min: number | null;
  curv: number | null;
  arterialPct: number | null;
  countryScore: number | null;
  uturns: number | null;
  ms: number;
  note: string;
  /** R25-U0 road-class truth (%, audit-v11 buckets). */
  highwayPct: number | null;
  mainPct: number | null;
  backroadPct: number | null;
  hoodPct: number | null;
  /** R25-U0 continuity + flow. */
  backroadLongestM: number | null;
  hoodRunM: number | null;
  turnsPer10min: number | null;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const rows: Row[] = [];
  for (const brief of BRIEFS) {
    const constraints = parseRules(brief);
    const t0 = performance.now();
    let row: Row;
    try {
      const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
      const ms = Math.round(performance.now() - t0);
      const genEvent = res.events.find(
        (e) => e.type === 'step' && e.step === 'generate_candidates' && e.status === 'completed',
      ) as { detail?: string } | undefined;
      const chained = genEvent?.detail?.includes('corridor-chained') === true;
      row = {
        brief,
        status: res.status,
        km: res.route ? Math.round(res.route.distance_m / 100) / 10 : null,
        min: res.route ? Math.round(res.route.duration_s / 60) : null,
        curv: res.curviness,
        arterialPct: res.arterialShare === null ? null : Math.round(res.arterialShare * 100),
        countryScore: res.countryScore === null ? null : Math.round(res.countryScore * 100) / 100,
        uturns: res.route
          ? res.route.maneuvers.filter((m) => m.type.startsWith('uturn')).length
          : null,
        ms,
        note:
          (chained ? 'chained' : 'no-chain') +
          (res.disclosures.length > 0 ? `; ${res.disclosures.join(' / ')}` : ''),
        highwayPct: res.classMix ? Math.round(res.classMix.highwayShare * 100) : null,
        mainPct: res.classMix ? Math.round(res.classMix.mainShare * 100) : null,
        backroadPct: res.classMix ? Math.round(res.classMix.backroadShare * 100) : null,
        hoodPct: res.classMix ? Math.round(res.classMix.hoodShare * 100) : null,
        backroadLongestM: res.backroadLongestM == null ? null : Math.round(res.backroadLongestM),
        hoodRunM: res.hoodRunM == null ? null : Math.round(res.hoodRunM),
        turnsPer10min: res.turnsPer10min == null ? null : Math.round(res.turnsPer10min * 10) / 10,
      };
    } catch (err) {
      row = {
        brief,
        status: 'error',
        km: null,
        min: null,
        curv: null,
        arterialPct: null,
        countryScore: null,
        uturns: null,
        ms: Math.round(performance.now() - t0),
        note: err instanceof Error ? err.message.slice(0, 80) : 'unknown',
        highwayPct: null,
        mainPct: null,
        backroadPct: null,
        hoodPct: null,
        backroadLongestM: null,
        hoodRunM: null,
        turnsPer10min: null,
      };
    }
    rows.push(row);
    console.log(
      `[${rows.length}/${BRIEFS.length}] ${row.status.padEnd(10)} ${String(row.km ?? '—').padStart(6)}km ` +
        `${String(row.min ?? '—').padStart(4)}min curv=${row.curv?.toFixed(2) ?? '—'} ` +
        `art=${row.arterialPct === null ? '—' : row.arterialPct + '%'} ` +
        `ctry=${row.countryScore ?? '—'} ut=${row.uturns ?? '—'} ${row.ms}ms  ${row.brief}` +
        (row.note !== 'no-chain' ? `  [${row.note}]` : ''),
    );
  }
  await db.end();

  const ok = rows.filter((r) => r.status === 'ok' || r.status === 'relaxed');
  const meanOf = (xs: number[]): number =>
    xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
  const arts = ok.map((r) => r.arterialPct).filter((v): v is number => v !== null);
  const curvs = ok.map((r) => r.curv).filter((v): v is number => v !== null);
  const chainedCount = rows.filter((r) => r.note.startsWith('chained')).length;

  console.log('\n-- A→B corridor scoreboard (R18-3; first run = baseline) --');
  console.log(`routed (ok/relaxed): ${ok.length}/${BRIEFS.length}`);
  console.log(`chain candidates generated: ${chainedCount}/${BRIEFS.length} briefs`);
  console.log(`arterial share of bests: mean ${Math.round(meanOf(arts))} %`);
  console.log(`curviness of bests: mean ${meanOf(curvs).toFixed(2)}`);
  // R25-U0 road-class scoreboard
  const num = (xs: Array<number | null>): number[] => xs.filter((v): v is number => v !== null);
  const hw = num(ok.map((r) => r.highwayPct));
  const mn = num(ok.map((r) => r.mainPct));
  const bk = num(ok.map((r) => r.backroadPct));
  const hd = num(ok.map((r) => r.hoodPct));
  const t10 = num(ok.map((r) => r.turnsPer10min));
  console.log(
    `road class (R25): hwy mean ${meanOf(hw).toFixed(1)} % (${hw.filter((v) => v > 0).length} routes >0) · main mean ${Math.round(meanOf(mn))} % · backroad mean ${Math.round(meanOf(bk))} % · hood mean ${meanOf(hd).toFixed(1)} %`,
  );
  console.log(
    `continuity/flow (R25): backroad longest mean ${Math.round(meanOf(num(ok.map((r) => r.backroadLongestM))))} m · hood run max ${Math.max(0, ...num(ok.map((r) => r.hoodRunM)))} m · turns/10min mean ${meanOf(t10).toFixed(1)}`,
  );
  console.log(
    `u-turns in bests: ${ok.reduce((s, r) => s + (r.uturns ?? 0), 0)} across ${ok.length} routes`,
  );
  console.log(`mean wall time: ${Math.round(meanOf(rows.map((r) => r.ms)))} ms`);
  const hash = createHash('sha256')
    .update(JSON.stringify(rows.map((r) => ({ ...r, ms: 0 }))))
    .digest('hex')
    .slice(0, 16);
  console.log(`determinism hash: ${hash}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
