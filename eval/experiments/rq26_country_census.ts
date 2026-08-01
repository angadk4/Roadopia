/**
 * RQ26-A1 — THE COUNTRY-ROAD CENSUS. The build-or-cancel gate for the entire
 * R26 backlog (docs/R26_planner_backlog.md).
 *
 * The finding this tests: `curvy_segments` holds the WHOLE road network, but
 * every retrieval RPC gates drive material on `circum_curvature_per_km >= 0.6`
 * AND orders by curviness DESC, so ~16 000 km of tertiary/unclassified country
 * road (avg curvature ~0.10) is loaded, indexed, and never offered. Before
 * building the retrieval tier that admits it, answer the only question that
 * can cancel the plan:
 *
 *   IS THE MATERIAL ACTUALLY REACHABLE FROM THE ORIGINS WE MEASURE ON?
 *
 * Method: for each origin in BOTH populations every bar is judged against (the
 * 48-brief fixed suite and the 30-brief random fixture), build the REAL scope
 * the planner would use (isochrone via buildScope — not a straight-line proxy,
 * so "reach" means what the planner means), then measure inside that polygon:
 *   - country-road km (tertiary + unclassified), split VISIBLE (>= theta) vs
 *     INVISIBLE (< theta) under today's retrieval;
 *   - the RURAL subset (urban_share < URBAN_MAX) — town-locked country road is
 *     not the ask;
 *   - the curvature-band histogram, so we know what admitting it would feel
 *     like (straight-but-country vs gently-curvy).
 *
 * PRE-REGISTERED VERDICT (docs/R26_planner_backlog.md A1):
 *   BUILD  — >= 40 % of origins have >= 25 km of reachable RURAL country road
 *            currently INVISIBLE to retrieval. The material is there; the gates
 *            are the problem; Phase A proceeds.
 *   CANCEL — below that, the ceiling is the corpus/extract itself, and R26 is
 *            replaced by a corpus program (SPK-08 filter, data/extract.sh).
 *            Recorded publicly, not quietly.
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx experiments/rq26_country_census.ts
 */

import { readFileSync } from 'node:fs';

import { Client } from 'pg';

import { parseRules } from '../../backend/src/planner/parse_rules';
import { buildScope } from '../../backend/src/planner/scope';
import type { LatLng } from '../../shared/src/types';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

/** Today's retrieval floor (THETA_CURVY_DEFAULT). */
const THETA = Number(process.env['THETA'] ?? 0.6);
/** Above this urban share a "country" road is really a town street. */
const URBAN_MAX = Number(process.env['URBAN_MAX'] ?? 0.3);
/** Per-origin material bar (km of reachable rural country road). */
const KM_BAR = Number(process.env['KM_BAR'] ?? 25);
/** Fraction of origins that must clear KM_BAR to BUILD. */
const ORIGIN_FRACTION_BAR = Number(process.env['ORIGIN_BAR'] ?? 0.4);

interface Origin {
  label: string;
  point: LatLng;
  durationS: number;
  suite: 'fixed' | 'random';
}

/** The 48 fixed briefs live in loop_quality.ts; re-parse them the same way the
 *  harness does so the census speaks about the SAME origins the bars use. */
function fixedOrigins(): Origin[] {
  const src = readFileSync(new URL('../loop_quality.ts', import.meta.url), 'utf8');
  const m = src.match(/const BRIEFS: string\[\] = \[([\s\S]*?)\n\];/);
  if (!m) throw new Error('could not locate the fixed BRIEFS array');
  const briefs = [...m[1]!.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]!);
  const out: Origin[] = [];
  for (const brief of briefs) {
    const c = parseRules(brief);
    if (typeof c.origin !== 'object' || c.origin === null) continue; // unresolved name
    out.push({
      label: brief,
      point: c.origin as LatLng,
      durationS: c.duration_target_s ?? 5400,
      suite: 'fixed',
    });
  }
  return out;
}

function randomOrigins(): Origin[] {
  const rows = JSON.parse(
    readFileSync(new URL('../datasets/random-briefs-v1.json', import.meta.url), 'utf8'),
  ) as Array<{ brief: string; origin: LatLng }>;
  return rows.map((r) => ({
    label: r.brief,
    point: r.origin,
    durationS: parseRules(r.brief).duration_target_s ?? 5400,
    suite: 'random' as const,
  }));
}

interface Census {
  origin: Origin;
  /** All country-road km inside the reach polygon. */
  countryKm: number;
  /** …of which RURAL (urban_share < URBAN_MAX). */
  ruralKm: number;
  /** Rural country km TODAY VISIBLE to retrieval (curvature >= THETA). */
  ruralVisibleKm: number;
  /** Rural country km INVISIBLE today — the prize. */
  ruralInvisibleKm: number;
  /** Curvature histogram of the invisible rural set (km per band). */
  bands: { flat: number; gentle: number; moderate: number };
  /** For contrast: reachable MAIN-road km (what it rides instead). */
  mainKm: number;
}

async function censusFor(db: Client, o: Origin): Promise<Census | null> {
  let polygon: string;
  try {
    const scope = await buildScope(VALHALLA, {
      origin: o.point,
      shape: 'loop',
      durationS: o.durationS,
    });
    const ring = scope.rings[0];
    if (!ring || ring.length < 4) return null;
    polygon = JSON.stringify({
      type: 'Polygon',
      coordinates: [ring.map((p) => [p.lng, p.lat])],
    });
  } catch {
    return null;
  }
  const r = await db.query<{
    country_km: string;
    rural_km: string;
    rural_vis_km: string;
    flat_km: string;
    gentle_km: string;
    moderate_km: string;
    main_km: string;
  }>(
    `with reach as (select st_geomfromgeojson($1::text) g)
     select
       coalesce(sum(case when cs.highway in ('tertiary','unclassified')
                    then cs.length_m end),0)/1000                                     country_km,
       coalesce(sum(case when cs.highway in ('tertiary','unclassified')
                    and coalesce(cs.urban_share,0) < $2 then cs.length_m end),0)/1000 rural_km,
       coalesce(sum(case when cs.highway in ('tertiary','unclassified')
                    and coalesce(cs.urban_share,0) < $2
                    and cs.circum_curvature_per_km >= $3 then cs.length_m end),0)/1000 rural_vis_km,
       coalesce(sum(case when cs.highway in ('tertiary','unclassified')
                    and coalesce(cs.urban_share,0) < $2
                    and cs.circum_curvature_per_km < 0.15 then cs.length_m end),0)/1000 flat_km,
       coalesce(sum(case when cs.highway in ('tertiary','unclassified')
                    and coalesce(cs.urban_share,0) < $2
                    and cs.circum_curvature_per_km >= 0.15
                    and cs.circum_curvature_per_km < 0.35 then cs.length_m end),0)/1000 gentle_km,
       coalesce(sum(case when cs.highway in ('tertiary','unclassified')
                    and coalesce(cs.urban_share,0) < $2
                    and cs.circum_curvature_per_km >= 0.35
                    and cs.circum_curvature_per_km < $3 then cs.length_m end),0)/1000 moderate_km,
       coalesce(sum(case when cs.highway in ('primary','secondary')
                    then cs.length_m end),0)/1000                                     main_km
     from curvy_segments cs, reach
     where cs.geom && reach.g and st_intersects(cs.geom, reach.g)`,
    [polygon, URBAN_MAX, THETA],
  );
  const x = r.rows[0]!;
  const num = (s: string): number => Math.round(Number(s) * 10) / 10;
  const ruralKm = num(x.rural_km);
  const ruralVisibleKm = num(x.rural_vis_km);
  return {
    origin: o,
    countryKm: num(x.country_km),
    ruralKm,
    ruralVisibleKm,
    ruralInvisibleKm: Math.round((ruralKm - ruralVisibleKm) * 10) / 10,
    bands: { flat: num(x.flat_km), gentle: num(x.gentle_km), moderate: num(x.moderate_km) },
    mainKm: num(x.main_km),
  };
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const origins = [...fixedOrigins(), ...randomOrigins()];
  console.log(
    `RQ26-A1 census — ${origins.length} origins (fixed + random), theta ${THETA}, ` +
      `urban < ${URBAN_MAX}, bar ${KM_BAR} km rural-invisible\n`,
  );

  const rows: Census[] = [];
  for (const o of origins) {
    const c = await censusFor(db, o);
    if (c === null) {
      console.log(`  [skip] ${o.label.slice(0, 52)} — no scope`);
      continue;
    }
    rows.push(c);
    const clears = c.ruralInvisibleKm >= KM_BAR ? 'BUILD' : '     ';
    console.log(
      `  ${clears} ${o.suite.padEnd(6)} ${o.label.slice(0, 44).padEnd(44)} ` +
        `rural country ${String(c.ruralKm).padStart(7)} km · visible ${String(c.ruralVisibleKm).padStart(6)} ` +
        `· INVISIBLE ${String(c.ruralInvisibleKm).padStart(7)} · main ${String(c.mainKm).padStart(7)}`,
    );
  }
  await db.end();

  const sum = (f: (c: Census) => number): number =>
    Math.round(rows.reduce((a, c) => a + f(c), 0) * 10) / 10;
  const mean = (f: (c: Census) => number): number =>
    rows.length === 0 ? 0 : Math.round((sum(f) / rows.length) * 10) / 10;
  const median = (f: (c: Census) => number): number => {
    const s = rows.map(f).sort((a, b) => a - b);
    return s.length === 0 ? 0 : s[Math.floor((s.length - 1) / 2)]!;
  };
  const clearing = rows.filter((c) => c.ruralInvisibleKm >= KM_BAR);
  const frac = rows.length === 0 ? 0 : clearing.length / rows.length;

  console.log('\n-- RQ26-A1 census --');
  console.log(`origins measured: ${rows.length}`);
  console.log(
    `rural country road per origin: mean ${mean((c) => c.ruralKm)} km · median ${median((c) => c.ruralKm)} km`,
  );
  console.log(
    `  ...VISIBLE to retrieval today: mean ${mean((c) => c.ruralVisibleKm)} km ` +
      `(${Math.round(
        (100 * sum((c) => c.ruralVisibleKm)) /
          Math.max(
            1,
            sum((c) => c.ruralKm),
          ),
      )} %)`,
  );
  console.log(
    `  ...INVISIBLE (the prize):      mean ${mean((c) => c.ruralInvisibleKm)} km · median ${median((c) => c.ruralInvisibleKm)} km`,
  );
  console.log(
    `for contrast, reachable MAIN road: mean ${mean((c) => c.mainKm)} km — what it rides instead`,
  );
  console.log(
    `invisible-set curvature mix: flat(<0.15) ${sum((c) => c.bands.flat)} km · ` +
      `gentle(0.15-0.35) ${sum((c) => c.bands.gentle)} km · moderate(0.35-${THETA}) ${sum((c) => c.bands.moderate)} km`,
  );
  const byS = (s: 'fixed' | 'random'): string => {
    const sub = rows.filter((c) => c.origin.suite === s);
    const cl = sub.filter((c) => c.ruralInvisibleKm >= KM_BAR).length;
    return `${cl}/${sub.length} (${Math.round((100 * cl) / Math.max(1, sub.length))} %)`;
  };
  console.log(
    `origins clearing the ${KM_BAR} km bar: fixed ${byS('fixed')} · random ${byS('random')}`,
  );
  console.log(
    `TOTAL clearing: ${clearing.length}/${rows.length} = ${Math.round(frac * 100)} % ` +
      `(bar: >= ${Math.round(ORIGIN_FRACTION_BAR * 100)} %)`,
  );
  console.log(
    frac >= ORIGIN_FRACTION_BAR
      ? 'VERDICT: BUILD — the material is reachable; the retrieval gates are the problem. Phase A proceeds.'
      : 'VERDICT: CANCEL — the ceiling is the corpus itself. R26 is replaced by a corpus/extract program.',
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
