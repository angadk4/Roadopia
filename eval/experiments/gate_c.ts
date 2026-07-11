/**
 * [GATE-C] curvature experiment (M4-T06; Protocol §12/§27).
 *
 * PRE-REGISTERED (before any result was computed — recorded here and in the
 * decision log): a formula PASSES as a road-level fun score iff
 *   Spearman ρ(formula, owner rating) ≥ τ_ρ = 0.70  AND  grid-FP ≤ τ_fp = 0.15,
 * where grid-FP = fraction of owner-rated-boring roads (rating ≤ 2) scoring
 * ABOVE the median formula score of owner-rated-fun roads (rating ≥ 4).
 * Decision rule: the SIMPLEST single formula clearing both; composite C8 only
 * if no single formula passes; if NOTHING passes, numeric fun-scoring is NOT
 * adopted — the per-km metric keeps its RETRIEVAL role only (a bendy-geometry
 * filter), and no user-facing "fun/twisty score" claim ships (Hard rule C
 * spirit). A separate RETRIEVAL-RECALL check then verifies the filter role:
 * every fun road (≥4) must be surfaced by find_curvy_roads at θ = 0.6.
 *
 * Ground truth: the owner's 40-road 1–5 sheet (eval/reports/
 * gate-c-rating-sheet.md, filled 2026-07-11) — range answers use midpoints.
 * Road-level scores aggregate ALL same-name segments within 4 km of the
 * sheet coordinate (length-weighted) — the sheet's printed value was a single
 * segment's max and is NOT what is correlated here.
 *
 * Run: pnpm -C eval run gate-c
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { spearmanRho } from '../src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const TAU_RHO = 0.7;
export const TAU_FP = 0.15;
export const THETA_RETRIEVAL = 0.6;

interface RatedRoad {
  name: string;
  lat: number;
  lng: number;
  rating: number;
  urban?: boolean;
}

/** Owner ratings, sheet rows 1–40 (ranges → midpoints). */
const ROADS: RatedRoad[] = [
  { name: 'Forks of the Credit Road', lat: 43.8016, lng: -79.9975, rating: 5 },
  { name: 'Hockley Road', lat: 43.9643, lng: -80.0732, rating: 3 },
  { name: 'River Road', lat: 44.2915, lng: -79.9019, rating: 3 },
  { name: 'Snake Road', lat: 43.3197, lng: -79.8926, rating: 4 },
  { name: 'Sydenham Road', lat: 43.2871, lng: -79.9504, rating: 3 },
  { name: 'Guelph Line', lat: 43.4313, lng: -79.9081, rating: 2 },
  { name: 'Mississauga Road', lat: 43.5351, lng: -79.6496, rating: 2 },
  { name: 'Winston Churchill Boulevard', lat: 43.7257, lng: -79.9583, rating: 2 },
  { name: 'Escarpment Sideroad', lat: 43.8415, lng: -79.9679, rating: 2 },
  { name: 'Heritage Road', lat: 43.6186, lng: -79.7879, rating: 2 },
  { name: 'Creditview Road', lat: 43.6435, lng: -79.7701, rating: 3.5 },
  { name: 'Mountainview Road', lat: 43.8735, lng: -79.8945, rating: 2.5 },
  { name: 'Kelso Road', lat: 43.5095, lng: -79.94, rating: 3 },
  { name: 'Campbellville Road', lat: 43.4792, lng: -79.9888, rating: 3 },
  { name: 'Safari Road', lat: 43.3323, lng: -80.1994, rating: 1.5 },
  { name: 'King Road', lat: 43.3371, lng: -79.8619, rating: 4 },
  { name: 'York Road', lat: 43.2755, lng: -79.9428, rating: 2 },
  { name: 'West River Road', lat: 43.2838, lng: -80.3464, rating: 5 },
  { name: 'Huntsmill Boulevard', lat: 43.81, lng: -79.3303, rating: 1, urban: true },
  { name: 'Stonehaven Avenue', lat: 44.0358, lng: -79.4383, rating: 2.5, urban: true },
  { name: 'North Service Road West', lat: 43.4164, lng: -79.7345, rating: 2, urban: true },
  { name: 'Cedar Springs Road', lat: 43.4072, lng: -79.9215, rating: 4 },
  { name: 'Bridge Road', lat: 43.4048, lng: -79.7232, rating: 2, urban: true },
  { name: '4th Line East', lat: 44.2028, lng: -80.0782, rating: 5 },
  { name: '15th Sideroad', lat: 44.1974, lng: -80.012, rating: 4.5 },
  { name: '2nd Line EHS', lat: 44.0761, lng: -80.0848, rating: 4.5 },
  { name: '25 Side Road', lat: 43.5581, lng: -80.0963, rating: 4 },
  { name: 'Doane Road', lat: 44.1201, lng: -79.4467, rating: 3 },
  { name: '10th Concession', lat: 43.9422, lng: -79.6876, rating: 3 },
  { name: '15 Side Road', lat: 43.5942, lng: -79.9585, rating: 3 },
  { name: '10 Side Road', lat: 43.579, lng: -79.9268, rating: 2 },
  { name: '20 Sideroad', lat: 44.0169, lng: -80.1733, rating: 3 },
  { name: '3rd Line EHS', lat: 44.0762, lng: -80.0679, rating: 1 },
  { name: '20 Mile Road', lat: 43.0879, lng: -79.4547, rating: 2 },
  { name: '5th Line', lat: 43.015, lng: -79.9353, rating: 3 },
  { name: '12th Line', lat: 44.1667, lng: -79.6123, rating: 4 },
  { name: '10th Sideroad', lat: 44.2082, lng: -79.6274, rating: 2 },
  { name: '20th Sideroad', lat: 44.3187, lng: -79.5789, rating: 2 },
  { name: '3rd Line', lat: 43.6875, lng: -80.0958, rating: 1 },
  { name: '4th Line', lat: 43.6419, lng: -80.2011, rating: 1 },
];

interface RoadAgg {
  road: RatedRoad;
  segCount: number;
  totalKm: number;
  c2: number; // length-weighted heading change per km
  c4: number; // length-weighted significant turns per km
  c7: number; // length-weighted circum curvature per km
  maxSegC7: number;
  maxSegLenM: number;
}

async function aggregate(db: Client, road: RatedRoad): Promise<RoadAgg | null> {
  const r = await db.query<{
    n: string;
    total_m: string;
    c2: string;
    c4: string;
    c7: string;
    max_c7: string;
    max_len: string;
  }>(
    `select count(*) as n, sum(length_m) as total_m,
            sum(heading_change_per_km * length_m) / sum(length_m) as c2,
            sum(significant_turns_per_km * length_m) / sum(length_m) as c4,
            sum(circum_curvature_per_km * length_m) / sum(length_m) as c7,
            max(circum_curvature_per_km) as max_c7,
            max(length_m) as max_len
     from curvy_segments
     where name = $1
       and st_dwithin(geom::geography,
                      st_setsrid(st_makepoint($2, $3), 4326)::geography, 4000)`,
    [road.name, road.lng, road.lat],
  );
  const row = r.rows[0];
  if (!row || Number(row.n) === 0) return null;
  return {
    road,
    segCount: Number(row.n),
    totalKm: Number(row.total_m) / 1000,
    c2: Number(row.c2),
    c4: Number(row.c4),
    c7: Number(row.c7),
    maxSegC7: Number(row.max_c7),
    maxSegLenM: Number(row.max_len),
  };
}

function gridFp(aggs: RoadAgg[], score: (a: RoadAgg) => number): number | null {
  const fun = aggs.filter((a) => a.road.rating >= 4).map(score);
  const boring = aggs.filter((a) => a.road.rating <= 2);
  if (fun.length === 0 || boring.length === 0) return null;
  const sorted = [...fun].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return boring.filter((a) => score(a) > median).length / boring.length;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const aggs: RoadAgg[] = [];
  const missing: string[] = [];
  for (const road of ROADS) {
    const a = await aggregate(db, road);
    if (a) aggs.push(a);
    else missing.push(road.name);
  }
  await db.end();

  const zOf = (vals: number[]): ((v: number) => number) => {
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length) || 1;
    return (v: number) => (v - m) / sd;
  };
  const z2 = zOf(aggs.map((a) => a.c2));
  const z4 = zOf(aggs.map((a) => a.c4));
  const z7 = zOf(aggs.map((a) => a.c7));

  const formulas: Array<{ id: string; desc: string; score: (a: RoadAgg) => number }> = [
    { id: 'C2', desc: 'heading change per km (lw mean)', score: (a) => a.c2 },
    { id: 'C4', desc: 'significant turns per km (lw mean)', score: (a) => a.c4 },
    { id: 'C7', desc: 'circumcircle curvature per km (lw mean)', score: (a) => a.c7 },
    { id: 'C7·L', desc: 'total curvature budget (C7 × total km)', score: (a) => a.c7 * a.totalKm },
    { id: 'log C7', desc: 'log1p of C7 (density, damped)', score: (a) => Math.log1p(a.c7) },
    {
      id: 'C8',
      desc: 'composite: mean z(C2, C4, C7)',
      score: (a) => (z2(a.c2) + z4(a.c4) + z7(a.c7)) / 3,
    },
  ];

  const lines: string[] = [
    '# [GATE-C] Curvature experiment — road-level formulas vs owner ratings (M4-T06)',
    '',
    `Pre-registered BEFORE computation: pass iff Spearman ρ ≥ ${TAU_RHO} AND grid-FP ≤ ${TAU_FP}`,
    '(grid-FP = share of rating-≤2 roads scoring above the median score of rating-≥4 roads).',
    'Decision rule: simplest single formula clearing both; C8 only if none does; if nothing',
    'passes → numeric fun-scoring NOT adopted; per-km curvature keeps its retrieval-filter role.',
    '',
    `Ground truth: owner sheet (40 roads, filled 2026-07-11); ${aggs.length} matched in the corpus` +
      (missing.length ? `; unmatched: ${missing.join(', ')}` : '') +
      '.',
    '',
    '| formula | description | Spearman ρ | grid-FP | passes |',
    '|---|---|---|---|---|',
  ];
  console.log(`[GATE-C] ${aggs.length}/${ROADS.length} roads matched in corpus`);
  const results: Array<{ id: string; rho: number | null; fp: number | null; pass: boolean }> = [];
  for (const f of formulas) {
    const rho = spearmanRho(aggs.map((a) => [f.score(a), a.road.rating] as [number, number]));
    const fp = gridFp(aggs, f.score);
    const pass = rho !== null && fp !== null && rho >= TAU_RHO && fp <= TAU_FP;
    results.push({ id: f.id, rho, fp, pass });
    const line = `| ${f.id} | ${f.desc} | ${rho === null ? '—' : rho.toFixed(3)} | ${fp === null ? '—' : fp.toFixed(3)} | ${pass ? 'YES' : 'no'} |`;
    lines.push(line);
    console.log(line);
  }

  // Retrieval-recall check: does θ=0.6 surface every fun road?
  const funRoads = aggs.filter((a) => a.road.rating >= 4);
  const surfaced = funRoads.filter((a) => a.maxSegC7 >= THETA_RETRIEVAL);
  const traversable = funRoads.filter((a) => a.maxSegLenM >= 1200);
  lines.push(
    '',
    '## Retrieval-filter role check (θ = 0.6)',
    '',
    `Fun roads (rating ≥ 4): ${funRoads.length}. Surfaced by find_curvy_roads at θ=0.6 ` +
      `(≥1 segment with C7 ≥ 0.6): ${surfaced.length}/${funRoads.length}. ` +
      `Traversal-eligible (≥1 segment ≥ 1.2 km): ${traversable.length}/${funRoads.length}.`,
    funRoads.length > surfaced.length
      ? `MISSED at θ=0.6: ${funRoads
          .filter((a) => a.maxSegC7 < THETA_RETRIEVAL)
          .map((a) => `${a.road.name} (max C7 ${a.maxSegC7.toFixed(2)})`)
          .join(', ')}`
      : 'No fun road is invisible to retrieval at θ=0.6.',
    '',
    '## Per-road data',
    '',
    '| road | rating | urban | segs | km | C2 | C4 | C7 | maxSegC7 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...aggs
      .sort((x, y) => y.road.rating - x.road.rating)
      .map(
        (a) =>
          `| ${a.road.name} | ${a.road.rating} | ${a.road.urban ? 'Y' : ''} | ${a.segCount} | ` +
          `${a.totalKm.toFixed(1)} | ${a.c2.toFixed(1)} | ${a.c4.toFixed(2)} | ${a.c7.toFixed(2)} | ${a.maxSegC7.toFixed(2)} |`,
      ),
  );

  const reportsDir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'curvature.md'), lines.join('\n') + '\n', 'utf8');
  console.log('\nwrote eval/reports/curvature.md');
  console.log(
    `retrieval recall at θ=0.6: ${surfaced.length}/${funRoads.length} fun roads surfaced`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
