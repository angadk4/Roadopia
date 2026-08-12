/**
 * RQ40 (U12c) — WHO actually depends on the silent v1 fallback?
 *
 * The app loads v1 out-and-backs whenever the v2 measured menu comes back
 * empty (DiscoverHome load path) — Recovery §15 calls that a silent downgrade
 * of a premium surface. Before changing it, measure the real blast radius:
 * per gold origin, does v2 return cards, and if not, is the area a TRUE
 * DESERT (no curvy material) or merely UNSWEPT (material exists, no cores)?
 *
 * Run: npx tsx eval/experiments/rq40_discover_fallback.ts
 */
import { Client } from 'pg';

import { discoverCores } from '../../backend/src/planner/discover_cores';
import { LOOPS_HOLDOUT_V1 } from '../suites/holdout_v1';
import { LOOPS_GOLD_V1 } from '../suites/loops_gold_v1';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const MATERIAL_RADIUS_M = 15_000;
const MATERIAL_MIN_SEGS = 25; // same bar as the coverage map's desert test

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const origins = [
    { label: 'HOME (owner)', at: { lat: 43.7565, lng: -79.8335 } },
    ...LOOPS_GOLD_V1.map((f) => ({ label: f.label, at: f.at })),
    ...LOOPS_HOLDOUT_V1.map((f) => ({ label: `${f.label} (holdout)`, at: f.at })),
  ];
  let withCards = 0;
  const empties: Array<{ label: string; segs: number; desert: boolean }> = [];
  for (const o of origins) {
    const res = await discoverCores(o.at, { db, valhallaUrl: VALHALLA });
    const mat = await db.query<{ n: string }>(
      `select count(*)::text n from curvy_segments
       where st_dwithin(geom::geography, st_setsrid(st_makepoint($1,$2),4326)::geography, $3)`,
      [o.at.lng, o.at.lat, MATERIAL_RADIUS_M],
    );
    const segs = Number(mat.rows[0]!.n);
    if (res.drives.length > 0) {
      withCards++;
      console.log(`  ${o.label.padEnd(30)} ${res.drives.length} cards`);
    } else {
      const desert = segs < MATERIAL_MIN_SEGS;
      empties.push({ label: o.label, segs, desert });
      console.log(
        `  ${o.label.padEnd(30)} EMPTY → falls back to v1 · material ${segs} segs · ${desert ? 'TRUE DESERT' : 'UNSWEPT (material exists)'}`,
      );
    }
  }
  await db.end();
  console.log(
    `\n${withCards}/${origins.length} origins get measured cards · ${empties.length} depend on the v1 fallback ` +
      `(${empties.filter((e) => e.desert).length} true desert · ${empties.filter((e) => !e.desert).length} unswept)`,
  );
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
