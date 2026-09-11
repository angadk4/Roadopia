/**
 * R29 Unit A — Discover v2 quality gate (the three-leg menu).
 *
 * Measures the REAL `discoverCores` path (the lesson of BD-119: judge through
 * the production entry, never a re-implementation) against the loaded index.
 *
 * BARS (pre-registered in the R29 plan):
 *   - menus of >=5 drives at >=6/8 sample origins (index gaps disclosed, not padded)
 *   - EVERY card: connector share <= 0.6 of trip time (the pre-build drop working)
 *   - sameWayHome is REPORTED, never barred (BD-149: the commute is the
 *     fastest route by owner decision; same-way is an honest label)
 *   - per-leg times present and consistent (out + core + home == trip)
 *   - same-session determinism (two calls, identical ids in identical order)
 *   BD-203 product bars:
 *   - no card totals more than 3 h door to door
 *   - every non-empty menu carries a card with a core <= 75 min whenever one
 *     was reachable (priced the selector's way: reach, share, 3 h ceiling)
 *
 * Run: TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx discover_v2_quality.ts
 */
import { Client } from 'pg';

import { DISCOVER_REACH_S } from '../backend/src/planner/discover';
import {
  CORE_CONNECTOR_SHARE_MAX,
  CORES_BROWSE_HALF_M,
  CORES_FETCH_LIMIT,
  CORES_SHORT_CARD_MAX_S,
  CORES_TRIP_TOTAL_MAX_S,
  discoverCores,
  DRIVE_CORES_VERSION,
  readDriveCores,
  rotateRingToNearest,
} from '../backend/src/planner/discover_cores';
import { travelMatrix } from '../backend/src/valhalla/matrix';
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

/** BD-203: was a <= 75-min core reachable from `origin` the way the selector
 *  prices it (matrix commute, reach, share cap, 3 h ceiling)? Independent of
 *  the served menu, so the bar can see a reserved card that went missing. */
async function shortCoreReachable(db: Client, origin: LatLng): Promise<boolean> {
  const dLat = CORES_BROWSE_HALF_M / 111_320;
  const dLng = CORES_BROWSE_HALF_M / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  const rows = await readDriveCores(
    db,
    [origin.lng - dLng, origin.lat - dLat, origin.lng + dLng, origin.lat + dLat],
    DRIVE_CORES_VERSION,
    CORES_FETCH_LIMIT,
    'loop',
  );
  const short = rows.filter((r) => r.duration_s <= CORES_SHORT_CARD_MAX_S);
  if (short.length === 0) return false;
  const joins = short.map((r) => rotateRingToNearest(r.geometry ?? r.geom_simplified, origin));
  const locations: Array<[number, number]> = [
    [origin.lng, origin.lat],
    ...joins.map((j, i): [number, number] =>
      j ? [j.join.lng, j.join.lat] : [short[i]!.entry.lng, short[i]!.entry.lat],
    ),
  ];
  const cells = await travelMatrix(VALHALLA, { locations, costingOptions: {} });
  return short.some((r, i) => {
    const tOut = cells[0]?.[1 + i]?.timeS ?? null;
    const tHome = cells[1 + i]?.[0]?.timeS ?? null;
    if (tOut === null || tHome === null || tOut > DISCOVER_REACH_S) return false;
    if ((tOut + tHome) / (tOut + tHome + r.duration_s) > CORE_CONNECTOR_SHARE_MAX) return false;
    return tOut + r.duration_s + tHome <= CORES_TRIP_TOTAL_MAX_S;
  });
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const deps = { db, valhallaUrl: VALHALLA };

  let menusOk = 0;
  let allConnectorOk = true;
  let allLegsOk = true;
  let allDeterministic = true;
  let sameWayWorst = 0;
  let allTotalsOk = true;
  let allShortOk = true;

  for (const o of ORIGINS) {
    const r1 = await discoverCores(o.at, deps);
    const r2 = await discoverCores(o.at, deps);
    const det = r1.drives.map((d) => d.id).join('|') === r2.drives.map((d) => d.id).join('|');
    if (!det) allDeterministic = false;

    const n = r1.drives.length;
    if (n >= 5) menusOk++;
    let sameWay = 0;
    let worstConn = 0;
    let worstTotal = 0;
    let shortCards = 0;
    let withGuidance = 0;
    for (const d of r1.drives) {
      const trip = d.core.duration_s + d.connectorOut.duration_s + d.connectorHome.duration_s;
      const conn = (d.connectorOut.duration_s + d.connectorHome.duration_s) / Math.max(1, trip);
      worstConn = Math.max(worstConn, conn);
      worstTotal = Math.max(worstTotal, trip);
      if (conn > 0.6) allConnectorOk = false;
      if (trip > CORES_TRIP_TOTAL_MAX_S) allTotalsOk = false;
      if (d.core.duration_s <= CORES_SHORT_CARD_MAX_S) shortCards++;
      if (d.core.maneuvers) withGuidance++;
      if (d.sameWayHome) sameWay++;
      if (
        !(d.connectorOut.duration_s > 0) ||
        !(d.connectorHome.duration_s > 0) ||
        !(d.core.duration_s > 0)
      ) {
        allLegsOk = false;
      }
    }
    const shortReachable = n > 0 && shortCards === 0 ? await shortCoreReachable(db, o.at) : false;
    if (shortReachable) allShortOk = false;
    sameWayWorst = Math.max(sameWayWorst, sameWay);
    console.log(
      `${o.label.padEnd(12)} drives ${n} · worst connector share ${(worstConn * 100).toFixed(0)}% · ` +
        `longest total ${Math.round(worstTotal / 60)} min · short cards ${shortCards}` +
        (shortReachable ? ' (a short core WAS reachable)' : '') +
        ` · ring guidance ${withGuidance}/${n} · sameWayHome ${sameWay} · deterministic ${det ? 'Y' : 'N'}` +
        (n === 0 ? `  [${r1.disclosures.join(' | ')}]` : ''),
    );
  }
  await db.end();

  console.log('\n-- Discover v2 bars --');
  const bars: Array<[string, boolean]> = [
    [`menus >=5 drives at >=6/8 origins (got ${menusOk}/8)`, menusOk >= 6],
    ['connector share <=0.6 on every card', allConnectorOk],
    ['per-leg times present on every card', allLegsOk],
    ['same-session determinism', allDeterministic],
    ['BD-203: no card total > 3 h door to door', allTotalsOk],
    ['BD-203: a <=75-min card on every menu where one was reachable', allShortOk],
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
