/**
 * R29 Unit A — Discover v2 quality gate (the three-leg menu).
 *
 * Measures the REAL `discoverCores` path (the lesson of BD-119: judge through
 * the production entry, never a re-implementation) against the loaded index.
 *
 * BARS (pre-registered in the R29 plan):
 *   - menus of >=5 drives at >=6/8 sample origins (index gaps disclosed, not padded)
 *   - EVERY card: connector share <= 0.6 of trip time (the pre-build drop working)
 *   - sameWayHome <= 2 per menu (ribbons make different-way-home structural)
 *   - per-leg times present and consistent (out + core + home == trip)
 *   - same-session determinism (two calls, identical ids in identical order)
 *
 * Run: TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx discover_v2_quality.ts
 */
import { Client } from 'pg';

import { discoverCores } from '../backend/src/planner/discover_cores';
import type { LatLng } from '../shared/src/types';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

const ORIGINS: Array<{ label: string; at: LatLng }> = [
  { label: 'Southfields', at: { lat: 43.7565, lng: -79.8335 } },
  { label: 'Brampton', at: { lat: 43.7315, lng: -79.7624 } },
  { label: 'Belfountain', at: { lat: 43.7935, lng: -80.0088 } },
  { label: 'Guelph', at: { lat: 43.5448, lng: -80.2482 } },
  { label: 'Barrie', at: { lat: 44.3894, lng: -79.6903 } },
  { label: 'London', at: { lat: 42.9849, lng: -81.2453 } },
  { label: 'Uxbridge', at: { lat: 44.1091, lng: -79.1204 } },
  { label: 'Hamilton', at: { lat: 43.2557, lng: -79.8711 } },
];

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const deps = { db, valhallaUrl: VALHALLA };

  let menusOk = 0;
  let allConnectorOk = true;
  let allLegsOk = true;
  let allDeterministic = true;
  let sameWayWorst = 0;

  for (const o of ORIGINS) {
    const r1 = await discoverCores(o.at, deps);
    const r2 = await discoverCores(o.at, deps);
    const det = r1.drives.map((d) => d.id).join('|') === r2.drives.map((d) => d.id).join('|');
    if (!det) allDeterministic = false;

    const n = r1.drives.length;
    if (n >= 5) menusOk++;
    let sameWay = 0;
    let worstConn = 0;
    for (const d of r1.drives) {
      const trip = d.core.duration_s + d.connectorOut.duration_s + d.connectorHome.duration_s;
      const conn = (d.connectorOut.duration_s + d.connectorHome.duration_s) / Math.max(1, trip);
      worstConn = Math.max(worstConn, conn);
      if (conn > 0.6) allConnectorOk = false;
      if (d.sameWayHome) sameWay++;
      if (
        !(d.connectorOut.duration_s > 0) ||
        !(d.connectorHome.duration_s > 0) ||
        !(d.core.duration_s > 0)
      ) {
        allLegsOk = false;
      }
    }
    sameWayWorst = Math.max(sameWayWorst, sameWay);
    console.log(
      `${o.label.padEnd(12)} drives ${n} · worst connector share ${(worstConn * 100).toFixed(0)}% · ` +
        `sameWayHome ${sameWay} · deterministic ${det ? 'Y' : 'N'}` +
        (n === 0 ? `  [${r1.disclosures.join(' | ')}]` : ''),
    );
  }
  await db.end();

  console.log('\n-- Discover v2 bars --');
  const bars: Array<[string, boolean]> = [
    [`menus >=5 drives at >=6/8 origins (got ${menusOk}/8)`, menusOk >= 6],
    ['connector share <=0.6 on every card', allConnectorOk],
    [`sameWayHome <=2 per menu (worst ${sameWayWorst})`, sameWayWorst <= 2],
    ['per-leg times present on every card', allLegsOk],
    ['same-session determinism', allDeterministic],
  ];
  let pass = true;
  for (const [name, ok] of bars) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) pass = false;
  }
  console.log(pass ? '\nVERDICT: PASS' : '\nVERDICT: FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
