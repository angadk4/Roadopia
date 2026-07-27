/**
 * RQ25-U19 PROBE — the falsify-first gate for the connector rebuild. Runs the
 * ACTUAL shipped transform (backend/src/planner/connectors.ts — no prototype
 * drift) over the plan's live pairs, sweeping spacing × radius, and applies a
 * PRE-REGISTERED verdict before any integration is judged:
 *
 *   QUALIFYING COMBO: median backroad Δ across pairs > +5 pp, AND no pair
 *   regresses backroad by more than 5 pp, AND median duration growth ≤ 1.15
 *   with no pair over 1.25, AND median highway share not up.
 *   Best qualifying combo (by median backroad Δ, ties → smaller duration
 *   growth) becomes the integration's frozen parameters.
 *   NO qualifying combo → U19 is REFUSED AT THE PROBE, recorded, integration
 *   never lands. (The planning prototype measured +11/0/−18 pp — this may
 *   genuinely refuse.)
 *
 * Pairs deliberately include the prototype's FAILURE case (Acton→Georgetown,
 * −18 pp) and the inert case (Kimberley→Markdale, 0 backroad corpus nearby).
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx experiments/rq25_u19_probe.ts
 */

import { Client } from 'pg';

import { planConnectorVias } from '../../backend/src/planner/connectors';
import { BACKROADS } from '../../backend/src/planner/costing';
import { lookupInRegion } from '../../backend/src/planner/gazetteer';
import { retrieveCandidates } from '../../backend/src/planner/retrieve';
import { classMixOf, tracedHighwayM } from '../../backend/src/planner/roadclass';
import type { Scope } from '../../backend/src/planner/scope';
import { routeThrough } from '../../backend/src/valhalla/route';
import { traceRoadClasses } from '../../backend/src/valhalla/trace';
import type { LatLng, LineString } from '../../shared/src/types';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

const PAIRS: Array<[string, string]> = [
  ['acton', 'georgetown'], // the prototype's −18 pp failure case
  ['hockley', 'orangeville'], // the prototype's win case
  ['kimberley', 'markdale'], // the inert case (no backroad corpus)
  ['belfountain', 'brampton'],
  ['guelph', 'erin'],
  ['caledon', 'hockley'],
];
const SPACINGS = [2000, 2500, 3500];
const RADII = [800, 1200, 1600];

/** Same override set the audit captures use for gazetteer gaps. */
const OVERRIDES: Record<string, LatLng> = {
  kimberley: { lat: 44.34, lng: -80.56 },
  shelburne: { lat: 44.078, lng: -80.204 },
};
const town = (name: string): LatLng => {
  const o = OVERRIDES[name];
  if (o) return o;
  const h = lookupInRegion(name);
  if (!h) throw new Error(`gazetteer miss: ${name}`);
  return { lat: h.lat, lng: h.lng };
};

/** Rectangle scope covering the routed corridor + margin (no isochrone call). */
function corridorScope(geometry: LineString, marginM: number): Scope {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of geometry.coordinates as Array<[number, number]>) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  const dLat = marginM / 111_320;
  const midLat = (minLat + maxLat) / 2;
  const dLng = marginM / (111_320 * Math.cos((midLat * Math.PI) / 180));
  const ring: LatLng[] = [
    { lat: minLat - dLat, lng: minLng - dLng },
    { lat: minLat - dLat, lng: maxLng + dLng },
    { lat: maxLat + dLat, lng: maxLng + dLng },
    { lat: maxLat + dLat, lng: minLng - dLng },
    { lat: minLat - dLat, lng: minLng - dLng },
  ];
  return { rings: [ring], tauOutS: 0, shape: 'a_to_b' };
}

interface Mix {
  backroad: number;
  main: number;
  hood: number;
  highwayM: number;
  durationS: number;
}

async function measure(geometry: LineString, durationS: number): Promise<Mix | null> {
  try {
    const traced = await traceRoadClasses(VALHALLA, geometry);
    const mix = classMixOf(traced.edges);
    if (mix === null) return null;
    return {
      backroad: mix.backroadShare,
      main: mix.mainShare,
      hood: mix.hoodShare,
      highwayM: tracedHighwayM(traced.edges),
      durationS,
    };
  } catch {
    return null;
  }
}

const pct = (x: number): number => Math.round(x * 100);

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  interface Cell {
    pair: string;
    backroadDpp: number;
    mainDpp: number;
    growth: number;
    hwyUpM: number;
    vias: number;
  }
  const byCombo = new Map<string, Cell[]>();

  for (const [aName, bName] of PAIRS) {
    const A = town(aName);
    const B = town(bName);
    const costingOptions = { ...BACKROADS.options, exclude_highways: true };
    const base = await routeThrough(VALHALLA, {
      waypoints: [
        [A.lng, A.lat],
        [B.lng, B.lat],
      ],
      costingOptions,
    });
    const baseMix = await measure(base.geometry, base.duration_s);
    if (baseMix === null) {
      console.log(`${aName}→${bName}: base untraceable — skipped`);
      continue;
    }
    const retrieved = await retrieveCandidates(db, corridorScope(base.geometry, 4000), {
      segmentLimit: 3000,
    });
    console.log(
      `\n${aName}→${bName}: base back ${pct(baseMix.backroad)}% main ${pct(baseMix.main)}% ` +
        `hwy ${Math.round(baseMix.highwayM)}m ${Math.round(base.duration_s / 60)}min · corpus ${retrieved.segments.length}`,
    );

    for (const spacingM of SPACINGS) {
      for (const radiusM of RADII) {
        const key = `s${spacingM}/r${radiusM}`;
        const vias = planConnectorVias(
          base.geometry.coordinates as Array<[number, number]>,
          retrieved.segments,
          { spacingM, radiusM },
        );
        if (vias.length === 0) {
          (byCombo.get(key) ?? byCombo.set(key, []).get(key)!).push({
            pair: `${aName}→${bName}`,
            backroadDpp: 0,
            mainDpp: 0,
            growth: 1,
            hwyUpM: 0,
            vias: 0,
          });
          continue;
        }
        try {
          const refined = await routeThrough(VALHALLA, {
            waypoints: [
              [A.lng, A.lat],
              ...vias.map((v) => [v.point.lng, v.point.lat] as [number, number]),
              [B.lng, B.lat],
            ],
            costingOptions,
            middleType: 'through',
          });
          const mix = await measure(refined.geometry, refined.duration_s);
          if (mix === null) continue;
          const cell: Cell = {
            pair: `${aName}→${bName}`,
            backroadDpp: pct(mix.backroad) - pct(baseMix.backroad),
            mainDpp: pct(mix.main) - pct(baseMix.main),
            growth: Math.round((mix.durationS / Math.max(1, baseMix.durationS)) * 100) / 100,
            hwyUpM: Math.round(mix.highwayM - baseMix.highwayM),
            vias: vias.length,
          };
          (byCombo.get(key) ?? byCombo.set(key, []).get(key)!).push(cell);
          console.log(
            `  ${key}: back ${cell.backroadDpp > 0 ? '+' : ''}${cell.backroadDpp}pp ` +
              `main ${cell.mainDpp > 0 ? '+' : ''}${cell.mainDpp}pp ×${cell.growth} ` +
              `hwyΔ ${cell.hwyUpM}m vias ${cell.vias}`,
          );
        } catch {
          console.log(`  ${key}: refined route FAILED`);
        }
      }
    }
  }
  await db.end();

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? NaN : s[Math.floor((s.length - 1) / 2)]!;
  };

  console.log('\n-- RQ25-U19 verdict (pre-registered) --');
  interface Summary {
    key: string;
    medBack: number;
    worstBack: number;
    medGrowth: number;
    worstGrowth: number;
    medHwyUp: number;
    qualifies: boolean;
  }
  const summaries: Summary[] = [];
  for (const [key, cells] of [...byCombo.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const s: Summary = {
      key,
      medBack: median(cells.map((c) => c.backroadDpp)),
      worstBack: Math.min(...cells.map((c) => c.backroadDpp)),
      medGrowth: median(cells.map((c) => c.growth)),
      worstGrowth: Math.max(...cells.map((c) => c.growth)),
      medHwyUp: median(cells.map((c) => c.hwyUpM)),
      qualifies: false,
    };
    s.qualifies =
      s.medBack > 5 &&
      s.worstBack >= -5 &&
      s.medGrowth <= 1.15 &&
      s.worstGrowth <= 1.25 &&
      s.medHwyUp <= 0;
    summaries.push(s);
    console.log(
      `${key}: median back ${s.medBack > 0 ? '+' : ''}${s.medBack}pp (worst ${s.worstBack}pp) · ` +
        `growth med ×${s.medGrowth} (worst ×${s.worstGrowth}) · hwyΔ med ${s.medHwyUp}m · ` +
        `${s.qualifies ? 'QUALIFIES' : 'no'}`,
    );
  }
  const winners = summaries
    .filter((s) => s.qualifies)
    .sort(
      (a, b) => b.medBack - a.medBack || a.medGrowth - b.medGrowth || a.key.localeCompare(b.key),
    );
  if (winners.length === 0) {
    console.log('VERDICT: NO qualifying combo — U19 is REFUSED AT THE PROBE. Do not integrate.');
  } else {
    console.log(
      `VERDICT: integrate with ${winners[0]!.key} (median back +${winners[0]!.medBack}pp).`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
