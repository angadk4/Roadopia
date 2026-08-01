/**
 * RQ26-B1 — the CONNECTOR COSTING probe. ~90-97 % of a route's metres are
 * Valhalla-chosen glue, and no lever has ever moved them: R25 proved
 * `exclude_*` was a no-op (BD-84), U19's via-steering refused (BD-93), and the
 * fun profile still rides `shortest`, which optimises distance and BYPASSES
 * every soft factor — including maneuver_penalty and every use_* preference.
 *
 * This probes the costing options nobody has swept, on live pairs, with the
 * verdict rule written BEFORE the run (the rq25_u19_probe shape — the probed
 * request is the shipped request):
 *
 *   `top_speed`      — a low ceiling makes fast roads unattractive. This is a
 *                      road-CLASS proxy that has never been tried, and unlike
 *                      `shortest` it is a soft factor the router actually
 *                      honours.
 *   `use_tracks` / `use_living_streets` — bounded checks that we are not
 *                      accidentally suppressing (or admitting) the wrong thing.
 *   `shortest` off + `use_highways:0` — the R25-proven working avoid, as the
 *                      control arm.
 *
 * QUALIFYING COMBO (pre-registered): median backroad Δ across pairs >= +5 pp
 * AND no pair regresses backroad by more than 5 pp AND median duration growth
 * <= 1.15 with no pair over 1.30 AND median highway metres not up. Best
 * qualifying combo by median backroad Δ (ties → smaller growth) is the
 * candidate for B2's A/B. NO qualifying combo ⇒ B1 REFUSES and B2 never runs.
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx experiments/rq26_connector_costing.ts
 */

import { Client } from 'pg';

import { BACKROADS } from '../../backend/src/planner/costing';
import { lookupInRegion } from '../../backend/src/planner/gazetteer';
import { classMixOf, tracedHighwayM } from '../../backend/src/planner/roadclass';
import { routeThrough, type AutoCostingOptions } from '../../backend/src/valhalla/route';
import { traceRoadClasses } from '../../backend/src/valhalla/trace';
import type { LatLng } from '../../shared/src/types';

const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

/** Corridor pairs spanning dense-corpus and bare-corridor regimes. */
const PAIRS: Array<[string, string]> = [
  ['acton', 'georgetown'],
  ['hockley', 'orangeville'],
  ['kimberley', 'markdale'],
  ['belfountain', 'brampton'],
  ['guelph', 'erin'],
  ['caledon', 'hockley'],
  ['cobourg', 'uxbridge'],
  ['stratford', 'woodstock'],
];

const OVERRIDES: Record<string, LatLng> = {
  kimberley: { lat: 44.34, lng: -80.56 },
  shelburne: { lat: 44.078, lng: -80.204 },
};
const town = (n: string): LatLng => {
  const o = OVERRIDES[n];
  if (o) return o;
  const h = lookupInRegion(n);
  if (!h) throw new Error(`gazetteer miss: ${n}`);
  return { lat: h.lat, lng: h.lng };
};

/** The arms. `base` is today's fun connector costing (BACKROADS + no-highway). */
const ARMS: Array<{ key: string; options: AutoCostingOptions }> = [
  { key: 'base(shortest)', options: { ...BACKROADS.options, exclude_highways: true } },
  // top_speed is only meaningful once `shortest` is dropped — shortest bypasses
  // every soft factor, which is exactly why the fun profile never honoured them.
  { key: 'noshort', options: { exclude_highways: true } },
  { key: 'noshort+ts70', options: { exclude_highways: true, top_speed: 70 } },
  { key: 'noshort+ts60', options: { exclude_highways: true, top_speed: 60 } },
  { key: 'noshort+ts50', options: { exclude_highways: true, top_speed: 50 } },
  { key: 'noshort+ts40', options: { exclude_highways: true, top_speed: 40 } },
  { key: 'ts50+tracks', options: { exclude_highways: true, top_speed: 50, use_tracks: 0.5 } },
  {
    key: 'ts50+noliving',
    options: { exclude_highways: true, top_speed: 50, use_living_streets: 0 },
  },
];

interface Mix {
  backroad: number;
  main: number;
  hood: number;
  hwyM: number;
  durS: number;
}

async function measure(o: AutoCostingOptions, a: LatLng, b: LatLng): Promise<Mix | null> {
  try {
    const r = await routeThrough(VALHALLA, {
      waypoints: [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ],
      costingOptions: o,
    });
    const t = await traceRoadClasses(VALHALLA, r.geometry);
    const mix = classMixOf(t.edges);
    if (mix === null) return null;
    return {
      backroad: mix.backroadShare,
      main: mix.mainShare,
      hood: mix.hoodShare,
      hwyM: tracedHighwayM(t.edges),
      durS: r.duration_s,
    };
  } catch {
    return null;
  }
}

const pct = (x: number): number => Math.round(x * 100);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[Math.floor((s.length - 1) / 2)]!;
};

async function main(): Promise<void> {
  const db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect(); // not queried; kept so the harness fails fast if the stack is down
  await db.end();

  const cells = new Map<
    string,
    Array<{
      pair: string;
      dBack: number;
      dMain: number;
      growth: number;
      dHwyM: number;
      dHood: number;
    }>
  >();

  for (const [an, bn] of PAIRS) {
    const A = town(an);
    const B = town(bn);
    const base = await measure(ARMS[0]!.options, A, B);
    if (base === null) {
      console.log(`${an}->${bn}: base untraceable — skipped`);
      continue;
    }
    console.log(
      `\n${an}->${bn}: base back ${pct(base.backroad)}% main ${pct(base.main)}% hood ${pct(base.hood)}% ` +
        `hwy ${Math.round(base.hwyM)}m ${Math.round(base.durS / 60)}min`,
    );
    for (const arm of ARMS.slice(1)) {
      const m = await measure(arm.options, A, B);
      if (m === null) {
        console.log(`  ${arm.key.padEnd(15)} FAILED`);
        continue;
      }
      const cell = {
        pair: `${an}->${bn}`,
        dBack: pct(m.backroad) - pct(base.backroad),
        dMain: pct(m.main) - pct(base.main),
        growth: Math.round((m.durS / Math.max(1, base.durS)) * 100) / 100,
        dHwyM: Math.round(m.hwyM - base.hwyM),
        dHood: pct(m.hood) - pct(base.hood),
      };
      const list = cells.get(arm.key) ?? [];
      list.push(cell);
      cells.set(arm.key, list);
      console.log(
        `  ${arm.key.padEnd(15)} back ${cell.dBack > 0 ? '+' : ''}${cell.dBack}pp  ` +
          `main ${cell.dMain > 0 ? '+' : ''}${cell.dMain}pp  hood ${cell.dHood > 0 ? '+' : ''}${cell.dHood}pp  ` +
          `x${cell.growth}  hwy ${cell.dHwyM > 0 ? '+' : ''}${cell.dHwyM}m`,
      );
    }
  }

  console.log('\n-- RQ26-B1 verdict (pre-registered) --');
  interface S {
    key: string;
    medBack: number;
    worstBack: number;
    medGrowth: number;
    worstGrowth: number;
    medHwy: number;
    medHood: number;
    ok: boolean;
  }
  const out: S[] = [];
  for (const [key, list] of cells) {
    const s: S = {
      key,
      medBack: median(list.map((c) => c.dBack)),
      worstBack: Math.min(...list.map((c) => c.dBack)),
      medGrowth: median(list.map((c) => c.growth)),
      worstGrowth: Math.max(...list.map((c) => c.growth)),
      medHwy: median(list.map((c) => c.dHwyM)),
      medHood: median(list.map((c) => c.dHood)),
      ok: false,
    };
    s.ok =
      s.medBack >= 5 &&
      s.worstBack >= -5 &&
      s.medGrowth <= 1.15 &&
      s.worstGrowth <= 1.3 &&
      s.medHwy <= 0;
    out.push(s);
    console.log(
      `${key.padEnd(15)} medBack ${s.medBack > 0 ? '+' : ''}${s.medBack}pp (worst ${s.worstBack}) · ` +
        `growth med x${s.medGrowth} (worst x${s.worstGrowth}) · medHwy ${s.medHwy}m · ` +
        `medHood ${s.medHood > 0 ? '+' : ''}${s.medHood}pp · ${s.ok ? 'QUALIFIES' : 'no'}`,
    );
  }
  const winners = out
    .filter((s) => s.ok)
    .sort(
      (a, b) => b.medBack - a.medBack || a.medGrowth - b.medGrowth || a.key.localeCompare(b.key),
    );
  console.log(
    winners.length === 0
      ? 'VERDICT: NO qualifying combo — B1 REFUSES; B2 does not run.'
      : `VERDICT: B2 candidate = ${winners[0]!.key} (median back +${winners[0]!.medBack}pp, growth x${winners[0]!.medGrowth}).`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
