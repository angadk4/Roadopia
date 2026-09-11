/**
 * R18-3 — A→B corridor quality: the loop suite's blind spot. The R18 audit
 * measured A→B routes as ~100 % fastest-path around ONE off-road centroid;
 * R18-3 gives A→B traversal spans, corridor chains (monotone by progress),
 * span-atomic repair, and always-trace measured truth. This harness is the
 * standing measurement: 15 corridor briefs through the REAL planner.
 *
 * FIRST RUN = BASELINE (eval/runs/r18-rebaseline/atob-r18-3-baseline.txt) —
 * no pre-R18-3 A→B eval existed, so deltas are tracked from here forward.
 * Determinism: report hash (minus ms) must be stable across runs.
 *
 * BD-203 — `ATOB_SUITE=gold-v1` runs the FROZEN 25-corridor gold suite
 * (eval/suites/atob_gold_v1.ts; the rq39 brief 'backroads drive from A to B',
 * so rows compare with eval/reports/rq39/atob-on.asis.json) and reports, per
 * corridor: status · what was SERVED (planned / direct_law / direct_worth_it)
 * · detour ratio · duration ratio · backroad share of the served line vs the
 * direct · structural-law defects of the served line · disclosures. Two
 * INVARIANTS are asserted at the end (exit code 1 on violation):
 *   1. every 'planned' serve beats the direct on backroad share by
 *      ≥ ATOB_WORTH_IT_MIN_GAIN (the worth-it bar);
 *   2. no 'planned' serve has a duration ratio > ATOB_DURATION_RATIO_MAX,
 *      and none carries a law defect.
 * `OUT=<path>` writes { manifest, summary, routes } as JSON.
 *
 * Run: pnpm -C eval run atob-quality                       (stack up)
 *      ATOB_SUITE=gold-v1 OUT=eval/reports/x.json pnpm -C eval run atob-quality
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { Client } from 'pg';

import {
  ATOB_DURATION_RATIO_MAX,
  ATOB_WORTH_IT_MIN_GAIN,
  atobDefectLabels,
  atobStructuralDefects,
} from '../backend/src/planner/atob';
import { parseRules } from '../backend/src/planner/parse_rules';
import { runPlanner } from '../backend/src/planner/run';
import type { LatLng, ParsedConstraints } from '../shared/src/types';

import { buildManifest, manifestLine } from './manifest';
import { ATOB_GOLD_V1 } from './suites/atob_gold_v1';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const SUITE = process.env['ATOB_SUITE'] ?? '';
const OUT = process.env['OUT'] ?? '';

/** 15 corridor briefs: mixed lengths/directions across the region, characterful
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

interface Case {
  label: string;
  brief: string;
  constraints: ParsedConstraints;
  /** Known endpoints (gold suite); the legacy briefs resolve via the gazetteer. */
  a: LatLng | null;
  b: LatLng | null;
}

function cases(): Case[] {
  if (SUITE === 'gold-v1') {
    return ATOB_GOLD_V1.map((f) => {
      // rq39 parity: the same brief construction as the frozen baseline run
      const parsed = parseRules('backroads drive from A to B');
      return {
        label: f.label,
        brief: 'backroads drive',
        a: f.a,
        b: f.b,
        constraints: {
          ...parsed,
          origin: f.a,
          destination: f.b,
          shape: 'a_to_b' as const,
          missing: parsed.missing.filter((m) => m !== 'origin' && m !== 'destination'),
          clarification: { needed: false, question: null },
        },
      };
    });
  }
  return BRIEFS.map((brief) => {
    const constraints = parseRules(brief);
    const o = constraints.origin;
    const d = constraints.destination;
    return {
      label: brief,
      brief,
      constraints,
      a: o !== null && typeof o === 'object' ? o : null,
      b: d !== null && typeof d === 'object' ? d : null,
    };
  });
}

interface Row {
  label: string;
  brief: string;
  status: string;
  /** BD-203: 'planned' | 'direct_law' | 'direct_worth_it' | null (no route). */
  served: string | null;
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
  /** BD-203: the direct baseline + the ratios and law defects of the served line. */
  directKm: number | null;
  directMin: number | null;
  directBackroadPct: number | null;
  detourRatio: number | null;
  durationRatio: number | null;
  defects: string[];
  alternates: number;
  disclosures: string[];
  /** BD-203: the judge / worth-it / direct-serve trace lines (why it served what it served). */
  judge: string[];
}

function emptyRow(c: Case, status: string, ms: number, note: string): Row {
  return {
    label: c.label,
    brief: c.brief,
    status,
    served: null,
    km: null,
    min: null,
    curv: null,
    arterialPct: null,
    countryScore: null,
    uturns: null,
    ms,
    note,
    highwayPct: null,
    mainPct: null,
    backroadPct: null,
    hoodPct: null,
    backroadLongestM: null,
    hoodRunM: null,
    turnsPer10min: null,
    directKm: null,
    directMin: null,
    directBackroadPct: null,
    detourRatio: null,
    durationRatio: null,
    defects: [],
    alternates: 0,
    disclosures: [],
    judge: [],
  };
}

async function main(): Promise<void> {
  const manifest = await buildManifest({ suite: SUITE === 'gold-v1' ? 'atob-gold-v1' : 'atob-15' });
  console.log(manifestLine(manifest));
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const list = cases();
  const rows: Row[] = [];
  for (const c of list) {
    const t0 = performance.now();
    let row: Row;
    try {
      const res = await runPlanner(c.constraints, { db, valhallaUrl: VALHALLA });
      const ms = Math.round(performance.now() - t0);
      const genEvent = res.events.find(
        (e) => e.type === 'step' && e.step === 'generate_candidates' && e.status === 'completed',
      ) as { detail?: string } | undefined;
      const chained = genEvent?.detail?.includes('corridor-chained') === true;
      const judge = res.events
        .filter(
          (e): e is Extract<typeof e, { type: 'step' }> =>
            e.type === 'step' && e.step === 'validate_route' && e.status === 'completed',
        )
        .map((e) => e.detail ?? '')
        .filter((d) => /judge|worth-it|direct served|direct baseline/i.test(d));
      const base = res.atobBaseline ?? null;
      const defects =
        res.route !== null && c.a !== null && c.b !== null
          ? atobDefectLabels(atobStructuralDefects(res.route, c.a, c.b))
          : [];
      row = {
        ...emptyRow(c, res.status, ms, ''),
        served: res.atobServe ?? null,
        km: res.route ? Math.round(res.route.distance_m / 100) / 10 : null,
        min: res.route ? Math.round(res.route.duration_s / 60) : null,
        curv: res.curviness,
        arterialPct: res.arterialShare === null ? null : Math.round(res.arterialShare * 100),
        countryScore: res.countryScore === null ? null : Math.round(res.countryScore * 100) / 100,
        uturns: res.route
          ? res.route.maneuvers.filter((m) => m.type.startsWith('uturn')).length
          : null,
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
        directKm: base ? Math.round(base.distanceM / 100) / 10 : null,
        directMin: base ? Math.round(base.durationS / 60) : null,
        directBackroadPct:
          base && base.backroadShare !== null ? Math.round(base.backroadShare * 100) : null,
        detourRatio:
          res.route && base && base.distanceM > 0
            ? Math.round((res.route.distance_m / base.distanceM) * 100) / 100
            : null,
        durationRatio:
          res.route && base && base.durationS > 0
            ? Math.round((res.route.duration_s / base.durationS) * 100) / 100
            : null,
        defects,
        alternates: res.alternates.length,
        disclosures: res.disclosures,
        judge,
      };
    } catch (err) {
      row = emptyRow(
        c,
        'error',
        Math.round(performance.now() - t0),
        err instanceof Error ? err.message.slice(0, 80) : 'unknown',
      );
    }
    rows.push(row);
    console.log(
      `[${rows.length}/${list.length}] ${row.status.padEnd(10)} ${(row.served ?? '—').padEnd(15)} ` +
        `${String(row.km ?? '—').padStart(6)}km ${String(row.min ?? '—').padStart(4)}min ` +
        `det=${row.detourRatio ?? '—'} dur=${row.durationRatio ?? '—'} ` +
        `back=${row.backroadPct ?? '—'}%/direct ${row.directBackroadPct ?? '—'}% ` +
        `defects=${row.defects.length ? row.defects.join('+') : 'none'} alts=${row.alternates} ` +
        `${row.ms}ms  ${row.label}` +
        (row.note !== 'no-chain' && row.note !== '' ? `  [${row.note.slice(0, 160)}]` : ''),
    );
    for (const j of row.judge) console.log(`      · ${j.slice(0, 200)}`);
  }
  await db.end();

  const ok = rows.filter((r) => r.status === 'ok' || r.status === 'relaxed');
  const planned = rows.filter((r) => r.served === 'planned');
  const direct = rows.filter((r) => r.served !== null && r.served.startsWith('direct'));
  const noRoute = rows.filter((r) => r.km === null);
  const meanOf = (xs: number[]): number =>
    xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
  const num = (xs: Array<number | null>): number[] => xs.filter((v): v is number => v !== null);
  const pct = (xs: number[], q: number): number => {
    if (xs.length === 0) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  };
  const chainedCount = rows.filter((r) => r.note.startsWith('chained')).length;

  console.log(`\n-- A→B corridor scoreboard (${manifest.suite}) --`);
  console.log(`routed (ok/relaxed): ${ok.length}/${list.length}`);
  console.log(
    `served: planned ${planned.length} · direct (law) ${direct.filter((r) => r.served === 'direct_law').length} · ` +
      `direct (worth-it) ${direct.filter((r) => r.served === 'direct_worth_it').length} · ` +
      `direct (nothing assembled) ${direct.filter((r) => r.served === 'direct_no_route').length} · no route ${noRoute.length}`,
  );
  console.log(`chain candidates generated: ${chainedCount}/${list.length} briefs`);
  console.log(
    `arterial share of bests: mean ${Math.round(meanOf(num(ok.map((r) => r.arterialPct))))} %`,
  );
  console.log(`curviness of bests: mean ${meanOf(num(ok.map((r) => r.curv))).toFixed(2)}`);
  const hw = num(ok.map((r) => r.highwayPct));
  console.log(
    `road class (R25): hwy mean ${meanOf(hw).toFixed(1)} % (${hw.filter((v) => v > 0).length} routes >0) · main mean ${Math.round(meanOf(num(ok.map((r) => r.mainPct))))} % · backroad mean ${Math.round(meanOf(num(ok.map((r) => r.backroadPct))))} % · hood mean ${meanOf(num(ok.map((r) => r.hoodPct))).toFixed(1)} %`,
  );
  console.log(
    `planned serves: backroad mean ${Math.round(meanOf(num(planned.map((r) => r.backroadPct))))} % vs their directs ${Math.round(meanOf(num(planned.map((r) => r.directBackroadPct))))} % · detour mean ${meanOf(num(planned.map((r) => r.detourRatio))).toFixed(2)}× · duration mean ${meanOf(num(planned.map((r) => r.durationRatio))).toFixed(2)}×`,
  );
  console.log(
    `continuity/flow (R25): backroad longest mean ${Math.round(meanOf(num(ok.map((r) => r.backroadLongestM))))} m · hood run max ${Math.max(0, ...num(ok.map((r) => r.hoodRunM)))} m · turns/10min mean ${meanOf(num(ok.map((r) => r.turnsPer10min))).toFixed(1)}`,
  );
  console.log(
    `u-turns in bests: ${ok.reduce((s, r) => s + (r.uturns ?? 0), 0)} across ${ok.length} routes`,
  );
  const msAll = rows.map((r) => r.ms);
  console.log(
    `wall time: mean ${Math.round(meanOf(msAll))} ms · p50 ${Math.round(pct(msAll, 0.5))} ms · p90 ${Math.round(pct(msAll, 0.9))} ms · max ${Math.max(...msAll)} ms`,
  );
  const hash = createHash('sha256')
    .update(JSON.stringify(rows.map((r) => ({ ...r, ms: 0 }))))
    .digest('hex')
    .slice(0, 16);
  console.log(`determinism hash: ${hash}`);

  // --- BD-203 invariants (never a bar to game: a violation FAILS the run) ---
  const violations: string[] = [];
  const gainBar = Math.round(ATOB_WORTH_IT_MIN_GAIN * 100);
  for (const r of planned) {
    if (r.backroadPct !== null && r.directBackroadPct !== null) {
      if (r.backroadPct < r.directBackroadPct + gainBar) {
        violations.push(
          `${r.label}: planned serve at ${r.backroadPct}% backroad vs direct ${r.directBackroadPct}% (< +${gainBar} pp)`,
        );
      }
    } else {
      violations.push(`${r.label}: planned serve with an unmeasured backroad share`);
    }
    if (r.durationRatio !== null && r.durationRatio > ATOB_DURATION_RATIO_MAX) {
      violations.push(
        `${r.label}: planned serve at ${r.durationRatio}× the direct duration (> ${ATOB_DURATION_RATIO_MAX}×)`,
      );
    }
    if (r.defects.length > 0) {
      violations.push(`${r.label}: planned serve carries ${r.defects.join(', ')}`);
    }
  }
  console.log(
    violations.length === 0
      ? `invariants: PASS (every planned serve ≥ direct + ${gainBar} pp backroad, ≤ ${ATOB_DURATION_RATIO_MAX}× duration, 0 law defects)`
      : `invariants: FAIL\n  ${violations.join('\n  ')}`,
  );

  if (OUT !== '') {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          manifest,
          summary: {
            n: rows.length,
            routed: ok.length,
            planned: planned.length,
            directLaw: direct.filter((r) => r.served === 'direct_law').length,
            directWorthIt: direct.filter((r) => r.served === 'direct_worth_it').length,
            directNoRoute: direct.filter((r) => r.served === 'direct_no_route').length,
            noRoute: noRoute.length,
            wallMsP50: Math.round(pct(msAll, 0.5)),
            wallMsP90: Math.round(pct(msAll, 0.9)),
            violations,
            hash,
          },
          routes: rows,
        },
        null,
        1,
      ),
    );
    console.log(`wrote ${OUT}`);
  }
  if (violations.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
