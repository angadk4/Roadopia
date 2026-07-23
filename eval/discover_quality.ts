/**
 * discover-quality harness (baseline-first; discovery has no adopt-or-refuse
 * precedent). Over a FLAT cohort (the far-reach case the reframe exists to fix)
 * + a RICH cohort, it measures the R24 /discover menu — curated, out-and-back,
 * PRE-BUILT — and a REPETITION cohort (nearby origins should reorder).
 *
 * R24 bars: curated 5-6 · top drives genuinely curvy · bearing spread · every
 * drive PRE-BUILT with a REAL measured total · a tapped drive drives ≥80% of the
 * road (by construction: the route IS the drive) · classics blended · nearby
 * origins produce non-identical menus.
 *
 * The COMMITTED determinism proof is the golden fixture (discover.test.ts); here
 * the live menu is asserted same-session only (BD-69 env-sensitivity).
 *
 *   TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx eval/discover_quality.ts
 */
import { createHash } from 'node:crypto';

import { Client } from 'pg';

import { discoverDrives } from '../backend/src/planner/discover';
import { buildOutAndBack } from '../backend/src/planner/out_and_back';
import { haversineMeters } from '../data/curvature/geometry';
import type { NearbyDrive } from '../shared/src/types';

const DB = 'postgresql://postgres:postgres@localhost:54322/postgres';
const VALHALLA = 'http://127.0.0.1:8002';

// pre-registered bars (soft — the scoreboard reports actuals; a miss is flagged).
const BAR_MENU_MIN = 5; // curated 5-6 (owner accepted smaller menus)
const BAR_TOP3_CURV = 1.0; // the top drives should be genuinely curvy
const BAR_SPREAD_SECTORS = 3; // menu entries span ≥3 bearing sectors (not one massif)
const BAR_ON_ROAD = 0.8; // a tapped drive drives ≥80% of the road

interface Origin {
  label: string;
  lat: number;
  lng: number;
  cohort: 'flat' | 'rich';
}
const ORIGINS: Origin[] = [
  { label: 'Kimberley', lat: 44.34, lng: -80.56, cohort: 'flat' },
  { label: 'Stratford', lat: 43.37, lng: -80.98, cohort: 'flat' },
  { label: 'Woodstock', lat: 43.13, lng: -80.75, cohort: 'flat' },
  { label: 'Dunnville', lat: 42.9, lng: -79.62, cohort: 'flat' },
  { label: 'Southfields', lat: 43.752, lng: -79.76, cohort: 'rich' },
  { label: 'Caledon', lat: 43.87, lng: -79.87, cohort: 'rich' },
  { label: 'Hockley', lat: 44.02, lng: -80.05, cohort: 'rich' },
];

/** Nearby origin pairs (~8-14 km apart) — the repetition cohort. Nearby doors
 *  should see NON-IDENTICAL menus (the origin-relative fix); the top pick may
 *  legitimately match when one classic dominates a whole radius. */
const REPETITION_PAIRS: Array<[Origin, Origin]> = [
  [
    { label: 'Erin', lat: 43.78, lng: -80.07, cohort: 'rich' },
    { label: 'Belfountain', lat: 43.79, lng: -80.01, cohort: 'rich' },
  ],
  [
    { label: 'Guelph', lat: 43.55, lng: -80.25, cohort: 'rich' },
    { label: 'Rockwood', lat: 43.61, lng: -80.14, cohort: 'rich' },
  ],
];

function sector(origin: Origin, p: { lat: number; lng: number }): number {
  const b = (Math.atan2(p.lng - origin.lng, p.lat - origin.lat) * 180) / Math.PI;
  return Math.floor((((b % 360) + 360) % 360) / 45); // 8 sectors
}

function onRoadPct(road: NearbyDrive['geometry'], route: { coordinates: number[][] }): number {
  const pts = route.coordinates as Array<[number, number]>;
  let hit = 0;
  for (const [rlng, rlat] of road.coordinates as Array<[number, number]>) {
    if (pts.some(([lng, lat]) => haversineMeters([lng, lat], [rlng, rlat]) <= 30)) hit++;
  }
  return hit / road.coordinates.length;
}

/** On-road fraction for a tapped drive — from the PRE-BUILT route when present
 *  (the instant-tap path), else the fallback out-and-back build. */
async function tapOnRoad(o: Origin, d: NearbyDrive): Promise<number> {
  if (d.route) return onRoadPct(d.geometry, d.route.geometry);
  const res = await buildOutAndBack(
    { lat: o.lat, lng: o.lng },
    { entry: d.entry, exit: d.exit, name: d.name, curviness: d.curviness },
    { valhallaUrl: VALHALLA },
  );
  return res.route ? onRoadPct(d.geometry, res.route.geometry) : 0;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const deps = { db, valhallaUrl: VALHALLA };
  const rows: string[] = [];
  let fails = 0;
  const hashes: string[] = [];

  for (const o of ORIGINS) {
    const origin = { lat: o.lat, lng: o.lng };
    const r1 = await discoverDrives(origin, deps);
    const r2 = await discoverDrives(origin, deps);
    const deterministic = JSON.stringify(r1.drives) === JSON.stringify(r2.drives);
    hashes.push(createHash('sha256').update(JSON.stringify(r1.drives)).digest('hex').slice(0, 8));
    const m = r1.drives;
    const named = m.every((d) => d.name !== '');
    const realTimes = m.every((d) => d.driveTimeToStartS > 0 && d.driveTimeToStartM > 0);
    const top3 = m.slice(0, 3);
    const top3curv = top3.length ? top3.reduce((s, d) => s + d.curviness, 0) / top3.length : 0;
    const sectors = new Set(m.map((d) => sector(o, d.entry))).size;
    const classics = m.filter((d) => d.source === 'classic').length;
    const measured = m.filter((d) => d.durationSource === 'measured' && d.route).length;
    const empty = m.length === 0;

    // on-road of the top drive (the drive the user is most likely to tap)
    const onRoadTop = m.length ? await tapOnRoad(o, m[0]!) : null;

    const menuOk = empty ? r1.disclosures.length > 0 : m.length >= BAR_MENU_MIN;
    const curvOk = empty || top3curv >= BAR_TOP3_CURV;
    const spreadOk = m.length < BAR_SPREAD_SECTORS || sectors >= BAR_SPREAD_SECTORS;
    const measuredOk = empty || measured === m.length; // every drive pre-built
    const onRoadOk = onRoadTop === null || onRoadTop >= BAR_ON_ROAD;
    const pass =
      named && realTimes && menuOk && curvOk && spreadOk && deterministic && measuredOk && onRoadOk;
    if (!pass) fails++;

    rows.push(
      `${pass ? 'PASS' : 'FAIL'} ${o.label.padEnd(11)} [${o.cohort}] ` +
        `${String(m.length).padStart(2)} drives (${classics} classic)  ` +
        `top3curv ${top3curv.toFixed(2)}  sectors ${sectors}  built ${measured}/${m.length}  ` +
        `det ${deterministic ? 'Y' : 'N'}  onRoad ${onRoadTop === null ? '-' : (onRoadTop * 100).toFixed(0)}%` +
        (pass
          ? ''
          : `  <-- named=${named} times=${realTimes} menu=${menuOk} curv=${curvOk} spread=${spreadOk} built=${measuredOk} onRoad=${onRoadOk}`),
    );
  }

  // --- repetition cohort: nearby origins should reorder (non-identical menus) ---
  const repRows: string[] = [];
  let repFails = 0;
  for (const [a, b] of REPETITION_PAIRS) {
    const ra = (await discoverDrives({ lat: a.lat, lng: a.lng }, deps)).drives;
    const rb = (await discoverDrives({ lat: b.lat, lng: b.lng }, deps)).drives;
    const setA = new Set(ra.map((d) => d.segmentId));
    const shared = rb.filter((d) => setA.has(d.segmentId)).length;
    const jaccard = shared / new Set([...ra, ...rb].map((d) => d.segmentId)).size;
    const topDiffers = ra[0]?.segmentId !== rb[0]?.segmentId;
    const menuDiffers = jaccard < 1.0; // the pre-registered bar (not strict top-1)
    if (!menuDiffers) repFails++;
    const km = (haversineMeters([a.lng, a.lat], [b.lng, b.lat]) / 1000).toFixed(0);
    repRows.push(
      `${menuDiffers ? 'PASS' : 'FAIL'} ${a.label}↔${b.label} (${km}km)  ` +
        `menu jaccard ${jaccard.toFixed(2)} (shared ${shared})  top-1 ${topDiffers ? 'differs' : 'same'}`,
    );
  }
  await db.end();

  console.log('\n-- R24 discover-quality --');
  console.log(rows.join('\n'));
  console.log('\n-- repetition cohort (nearby origins → non-identical menus) --');
  console.log(repRows.join('\n'));
  console.log(
    `\nbars: menu>=${BAR_MENU_MIN}|empty+disclosure · top3curv>=${BAR_TOP3_CURV} · spread>=${BAR_SPREAD_SECTORS} sectors ` +
      `· every drive PRE-BUILT (measured) · onRoad>=${BAR_ON_ROAD * 100}% · same-session determinism · nearby menus differ`,
  );
  console.log(`origins passing all bars: ${ORIGINS.length - fails}/${ORIGINS.length}`);
  console.log(
    `repetition pairs passing:  ${REPETITION_PAIRS.length - repFails}/${REPETITION_PAIRS.length}`,
  );
  console.log(`per-origin menu hashes (same-session): ${hashes.join(' ')}`);
  process.exit(0);
}
main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
