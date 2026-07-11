/**
 * [GATE-S] scenicness experiment — numeric scenic signal vs labels-only
 * (M4-T07; Protocol §13 / §27; Master Spec §32).
 *
 * PRE-REGISTERED DECISION RULE (fixed before any correlation was computed):
 * a numeric scenic term ships IFF some cumulative variant reaches
 *   Spearman ρ(variant, owner scenic ordinal) ≥ τ_scenic = 0.70
 * (the same bar [GATE-C] set for shipping a numeric term, BD-26); if one
 * clears it, the SMALLEST clearing variant ships (§13.2); each added input
 * must also earn its place via incremental ρ. If nothing clears:
 * **labels/signals only (S0/S1) — the scenic WEIGHT stays 0 (Hard rule C)**
 * and no numeric scenic score is presented anywhere.
 *
 * Ground truth: the owner's 40-road SCENIC 1–5 sheet
 * (eval/reports/scenic-label-sheet.md, filled 2026-07-11; ranges → midpoints;
 * blanks skipped). Road identity/coords reuse the [GATE-C] canonical mapping;
 * ratings are parsed from the sheet BY ROW NUMBER (same order).
 *
 * Signals (grounded inputs only, §32), computed per road over the same
 * name+4 km segment aggregation as [GATE-C], length-weighted:
 *   tag    — share of length within 50 m of a scenic=yes way (S1)…
 *            ZERO such features exist in the region extract (found at load:
 *            data/load_scenic.ts → scenic_tag count 0) — reported as no-data.
 *   view   — viewpoint spots within 1 km per km of road (S2 input)
 *   water  — share of length within 300 m of water (S3 input)
 *   forest — share of length within 150 m of forest/wood (S4 input)
 *   [S5 elevation — NOT COMPUTABLE: no DEM in the data tier; spec §32 keeps
 *    elevation a *displayed* profile, protocol [H] expects no incremental ρ]
 *   urban  — residential ways within 300 m per km (S6 penalty input)
 *   class  — length-weighted countryClassFactor (S7's road-class awareness)
 * Cumulative variants (z-scored blends): S1=tag · S2=S1+view · S3=S2+water ·
 * S4=S3+forest · S6=S4−urban · S7=S6+class.
 *
 * Run: pnpm -C eval run gate-s   (Supabase local with scenic_features loaded)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { buildManifest, writeManifest } from '../src/harness/manifest';
import { spearmanRho } from '../src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const TAU_SCENIC = 0.7;

/** Canonical road → coordinate mapping (identical to [GATE-C]'s ROADS). */
const ROADS: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Forks of the Credit Road', lat: 43.8016, lng: -79.9975 },
  { name: 'Hockley Road', lat: 43.9643, lng: -80.0732 },
  { name: 'River Road', lat: 44.2915, lng: -79.9019 },
  { name: 'Snake Road', lat: 43.3197, lng: -79.8926 },
  { name: 'Sydenham Road', lat: 43.2871, lng: -79.9504 },
  { name: 'Guelph Line', lat: 43.4313, lng: -79.9081 },
  { name: 'Mississauga Road', lat: 43.5351, lng: -79.6496 },
  { name: 'Winston Churchill Boulevard', lat: 43.7257, lng: -79.9583 },
  { name: 'Escarpment Sideroad', lat: 43.8415, lng: -79.9679 },
  { name: 'Heritage Road', lat: 43.6186, lng: -79.7879 },
  { name: 'Creditview Road', lat: 43.6435, lng: -79.7701 },
  { name: 'Mountainview Road', lat: 43.8735, lng: -79.8945 },
  { name: 'Kelso Road', lat: 43.5095, lng: -79.94 },
  { name: 'Campbellville Road', lat: 43.4792, lng: -79.9888 },
  { name: 'Safari Road', lat: 43.3323, lng: -80.1994 },
  { name: 'King Road', lat: 43.3371, lng: -79.8619 },
  { name: 'York Road', lat: 43.2755, lng: -79.9428 },
  { name: 'West River Road', lat: 43.2838, lng: -80.3464 },
  { name: 'Huntsmill Boulevard', lat: 43.81, lng: -79.3303 },
  { name: 'Stonehaven Avenue', lat: 44.0358, lng: -79.4383 },
  { name: 'North Service Road West', lat: 43.4164, lng: -79.7345 },
  { name: 'Cedar Springs Road', lat: 43.4072, lng: -79.9215 },
  { name: 'Bridge Road', lat: 43.4048, lng: -79.7232 },
  { name: '4th Line East', lat: 44.2028, lng: -80.0782 },
  { name: '15th Sideroad', lat: 44.1974, lng: -80.012 },
  { name: '2nd Line EHS', lat: 44.0761, lng: -80.0848 },
  { name: '25 Side Road', lat: 43.5581, lng: -80.0963 },
  { name: 'Doane Road', lat: 44.1201, lng: -79.4467 },
  { name: '10th Concession', lat: 43.9422, lng: -79.6876 },
  { name: '15 Side Road', lat: 43.5942, lng: -79.9585 },
  { name: '10 Side Road', lat: 43.579, lng: -79.9268 },
  { name: '20 Sideroad', lat: 44.0169, lng: -80.1733 },
  { name: '3rd Line EHS', lat: 44.0762, lng: -80.0679 },
  { name: '20 Mile Road', lat: 43.0879, lng: -79.4547 },
  { name: '5th Line', lat: 43.015, lng: -79.9353 },
  { name: '12th Line', lat: 44.1667, lng: -79.6123 },
  { name: '10th Sideroad', lat: 44.2082, lng: -79.6274 },
  { name: '20th Sideroad', lat: 44.3187, lng: -79.5789 },
  { name: '3rd Line', lat: 43.6875, lng: -80.0958 },
  { name: '4th Line', lat: 43.6419, lng: -80.2011 },
];

/** Owner scenic ratings parsed from the sheet BY ROW NUMBER (1-indexed). */
function parseScenicSheet(): Map<number, number> {
  const path = fileURLToPath(new URL('../reports/scenic-label-sheet.md', import.meta.url));
  const ratings = new Map<number, number>();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\|\s*(\d+)\s*\|.*\|\s*(\d(?:\.\d)?)\s*(?:-\s*(\d(?:\.\d)?))?\s*\|\s*$/.exec(line);
    if (!m) continue;
    const lo = Number(m[2]);
    const rating = m[3] ? (lo + Number(m[3])) / 2 : lo;
    if (rating >= 1 && rating <= 5) ratings.set(Number(m[1]), rating);
  }
  return ratings;
}

interface RoadSignals {
  name: string;
  rating: number;
  totalKm: number;
  tag: number;
  view: number;
  water: number;
  forest: number;
  urban: number;
  classFactor: number;
}

/** All signals for one road in a single round trip (gist && prefilter + exact geography check). */
async function signalsOf(
  db: Client,
  road: { name: string; lat: number; lng: number },
  rating: number,
): Promise<RoadSignals | null> {
  const r = await db.query<Record<string, string>>(
    `with segs as (
       select geom, length_m, highway from curvy_segments
       where name = $1
         and st_dwithin(geom::geography,
                        st_setsrid(st_makepoint($2, $3), 4326)::geography, 4000)
     )
     select
       count(*) as n,
       sum(length_m) as total_m,
       coalesce(sum(length_m * (exists (
         select 1 from scenic_features f
         where f.kind = 'scenic_tag' and f.geom && st_expand(segs.geom, 0.002)
           and st_dwithin(f.geom::geography, segs.geom::geography, 50)))::int) / nullif(sum(length_m), 0), 0) as tag_share,
       coalesce(sum(length_m * (exists (
         select 1 from scenic_features f
         where f.kind = 'water' and f.geom && st_expand(segs.geom, 0.006)
           and st_dwithin(f.geom::geography, segs.geom::geography, 300)))::int) / nullif(sum(length_m), 0), 0) as water_share,
       coalesce(sum(length_m * (exists (
         select 1 from scenic_features f
         where f.kind = 'forest' and f.geom && st_expand(segs.geom, 0.004)
           and st_dwithin(f.geom::geography, segs.geom::geography, 150)))::int) / nullif(sum(length_m), 0), 0) as forest_share,
       coalesce(sum((
         select count(*) from spots s
         where s.type = 'viewpoint'
           and st_dwithin(s.location, segs.geom::geography, 1000))) / nullif(sum(length_m) / 1000, 0), 0) as view_per_km,
       coalesce(sum((
         select count(*) from curvy_segments r2
         where r2.highway = 'residential' and r2.geom && st_expand(segs.geom, 0.006)
           and st_dwithin(r2.geom::geography, segs.geom::geography, 300))) / nullif(sum(length_m) / 1000, 0), 0) as urban_per_km,
       coalesce(sum(length_m * case segs.highway
         when 'unclassified' then 1.0 when 'tertiary' then 0.95
         when 'secondary' then 0.5 when 'primary' then 0.15
         else 0.15 end) / nullif(sum(length_m), 0), 0) as class_factor
     from segs`,
    [road.name, road.lng, road.lat],
  );
  const row = r.rows[0];
  if (!row || Number(row['n']) === 0) return null;
  return {
    name: road.name,
    rating,
    totalKm: Number(row['total_m']) / 1000,
    tag: Number(row['tag_share']),
    view: Number(row['view_per_km']),
    water: Number(row['water_share']),
    forest: Number(row['forest_share']),
    urban: Number(row['urban_per_km']),
    classFactor: Number(row['class_factor']),
  };
}

function zOf(vals: number[]): (v: number) => number {
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length) || 1;
  return (v) => (v - m) / sd;
}

async function main(): Promise<void> {
  const ratings = parseScenicSheet();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const check = await db.query(`select kind, count(*) n from scenic_features group by kind`);
  console.log(
    'scenic_features:',
    check.rows.map((r: { kind: string; n: string }) => `${r.kind}=${r.n}`).join(' '),
  );

  const roads: RoadSignals[] = [];
  const unmatched: string[] = [];
  for (let i = 0; i < ROADS.length; i++) {
    const rating = ratings.get(i + 1);
    if (rating === undefined) continue; // blank row — owner does not know it
    const s = await signalsOf(db, ROADS[i]!, rating);
    if (s) roads.push(s);
    else unmatched.push(ROADS[i]!.name);
  }
  await db.end();
  console.log(`${roads.length} roads with signals + rating (${unmatched.length} unmatched)`);

  const zTag = zOf(roads.map((r) => r.tag));
  const zView = zOf(roads.map((r) => r.view));
  const zWater = zOf(roads.map((r) => r.water));
  const zForest = zOf(roads.map((r) => r.forest));
  const zUrban = zOf(roads.map((r) => r.urban));
  const zClass = zOf(roads.map((r) => r.classFactor));

  const variants: Array<{ id: string; desc: string; score: (r: RoadSignals) => number }> = [
    { id: 'S1', desc: 'scenic=yes tags only', score: (r) => zTag(r.tag) },
    { id: 'S2', desc: 'S1 + viewpoint proximity', score: (r) => zTag(r.tag) + zView(r.view) },
    {
      id: 'S3',
      desc: 'S2 + water proximity',
      score: (r) => zTag(r.tag) + zView(r.view) + zWater(r.water),
    },
    {
      id: 'S4',
      desc: 'S3 + forest proximity',
      score: (r) => zTag(r.tag) + zView(r.view) + zWater(r.water) + zForest(r.forest),
    },
    {
      id: 'S6',
      desc: 'S4 − urban-density penalty',
      score: (r) =>
        zTag(r.tag) + zView(r.view) + zWater(r.water) + zForest(r.forest) - zUrban(r.urban),
    },
    {
      id: 'S7',
      desc: 'S6 + road-class awareness',
      score: (r) =>
        zTag(r.tag) +
        zView(r.view) +
        zWater(r.water) +
        zForest(r.forest) -
        zUrban(r.urban) +
        zClass(r.classFactor),
    },
  ];

  // diagnostics: each raw input alone
  const singles: Array<{ id: string; rho: number | null }> = [
    { id: 'view', rho: spearmanRho(roads.map((r) => [r.view, r.rating])) },
    { id: 'water', rho: spearmanRho(roads.map((r) => [r.water, r.rating])) },
    { id: 'forest', rho: spearmanRho(roads.map((r) => [r.forest, r.rating])) },
    { id: 'urban(−)', rho: spearmanRho(roads.map((r) => [-r.urban, r.rating])) },
    { id: 'class', rho: spearmanRho(roads.map((r) => [r.classFactor, r.rating])) },
  ];

  let prevRho: number | null = null;
  const rows: string[] = [];
  let winner: { id: string; rho: number } | null = null;
  for (const v of variants) {
    const rho = spearmanRho(roads.map((r) => [v.score(r), r.rating] as [number, number]));
    const inc = rho !== null && prevRho !== null ? rho - prevRho : null;
    const pass = rho !== null && rho >= TAU_SCENIC;
    if (pass && winner === null) winner = { id: v.id, rho };
    rows.push(
      `| ${v.id} | ${v.desc} | ${rho === null ? '— (no variance)' : rho.toFixed(3)} | ${inc === null ? '—' : (inc >= 0 ? '+' : '') + inc.toFixed(3)} | ${pass ? 'YES' : 'no'} |`,
    );
    if (rho !== null) prevRho = rho;
    console.log(`${v.id}: ρ=${rho === null ? '—' : rho.toFixed(3)}`);
  }

  const lines = [
    '# [GATE-S] Scenicness — numeric scenic signal vs labels-only (M4-T07)',
    '',
    `Pre-registered rule (fixed before results; see experiments/gate_s.ts header): a numeric`,
    `scenic term ships iff some cumulative variant reaches Spearman ρ ≥ ${TAU_SCENIC} against the`,
    "owner's 40-road scenic ordinal (the [GATE-C] bar for numeric terms); smallest clearing",
    'variant ships. Default: labels/signals only (S0/S1), scenic weight stays 0 (Hard rule C).',
    '',
    `Ground truth: ${roads.length} owner-rated roads (blanks skipped, ranges → midpoints).`,
    'Signals from grounded data only (§32): scenic_features (water 77 028 / forest 111 768 /' +
      ' scenic_tag 0 — ZERO scenic=yes ways exist in the region extract, so S1 is no-data),',
    'spots viewpoints (402), residential density + road class from curvy_segments.',
    'S5 (elevation) EXCLUDED: no DEM in the data tier; spec §32 keeps elevation a displayed',
    'profile, and the protocol hypothesis expects no incremental ρ from it.',
    '',
    '## Single-input diagnostics (Spearman ρ vs scenic rating)',
    '',
    '| input | ρ |',
    '|---|---|',
    ...singles.map((s) => `| ${s.id} | ${s.rho === null ? '—' : s.rho.toFixed(3)} |`),
    '',
    '## Cumulative variants (§13.1 ladder)',
    '',
    `| variant | inputs | ρ | incremental | ≥ ${TAU_SCENIC} |`,
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## DECISION ([GATE-S], per the pre-registered rule)',
    '',
    winner
      ? `**ADOPT ${winner.id} (ρ = ${winner.rho.toFixed(3)})** — the smallest variant clearing τ_scenic = ${TAU_SCENIC}; its weights go into M4-T12 and the scenic term arms in scoring behind the §13.3 language rules.`
      : `**NO variant clears τ_scenic = ${TAU_SCENIC} → numeric scenic scoring is NOT adopted.** Roadopia ships S0/S1: scenic spots/labels are SHOWN (viewpoints on the map, concrete facts in explanations — "passes 2 viewpoints, ~6 km along water") but no numeric scenic score exists anywhere and the scoring weight stays 0 (Hard rule C, spec §32). Honest negative per §24.`,
    '',
    'Binding language rules regardless of outcome (§13.3): "likely scenic", "passes N',
    'viewpoints", "has scenic signals" are allowed; "this IS a scenic route" and any',
    'numeric scenic score presented as truth are forbidden.',
  ];

  const reportsDir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'scenic.md'), lines.join('\n') + '\n', 'utf8');

  writeManifest(
    buildManifest({
      experimentId: 'gate-s-scenic',
      scoringConfigId: 'n/a (correlation study)',
      weights: {},
      datasetSplit: 'owner 40-road scenic sheet',
      datasetVersion: 'scenic-label-sheet 2026-07-11',
      seed: 42,
      costLedger: { total_usd: 0, llm_calls: 0, notes: 'deterministic run — no LLM' },
    }),
  );

  console.log('\nwrote eval/reports/scenic.md');
  console.log(
    `DECISION: ${winner ? `ADOPT ${winner.id} (ρ=${winner.rho.toFixed(3)})` : 'labels-only (no variant ≥ ' + TAU_SCENIC + ')'}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
