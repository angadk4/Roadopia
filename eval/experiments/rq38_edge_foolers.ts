/**
 * R37-U13 (BD-178) — the ANTI-FOOL pin: cases where cell-geometry overlap
 * cannot answer "same road, same direction" and directed edges can.
 * Uses REAL stored geometries (no hand-built coordinates):
 *   1. a ribbon vs ITSELF → both systems must say identical (sanity);
 *   2. a ribbon vs its REVERSAL → cells say ~1.0 overlap (same pavement),
 *      directed edges must say ~0 shared (opposite direction) — the exact
 *      distinction same-way-home / opposed-retrace logic needs;
 *   3. the corpus-level comparison (edge_dedup_compare) already showed ZERO
 *      geometric over-merges among kept rings — recorded there.
 *
 * Run: npx tsx eval/experiments/rq38_edge_foolers.ts
 */
import { Client } from 'pg';

import { edgeOverlapRatio } from '../../backend/src/planner/overlap';
import { traceEdgeIds, type DirectedEdge } from '../../backend/src/valhalla/trace';
import type { LineString } from '../../shared/src/types';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

function directedOverlap(a: DirectedEdge[], b: DirectedEdge[]): number {
  const acc = (es: DirectedEdge[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const e of es) {
      if (e.wayId === null) continue;
      const k = `${e.wayId}${e.forward ? '+' : '-'}`;
      m.set(k, (m.get(k) ?? 0) + e.lengthM);
    }
    return m;
  };
  const ma = acc(a);
  const mb = acc(b);
  let shared = 0;
  let ta = 0;
  let tb = 0;
  for (const [k, v] of ma) {
    ta += v;
    const w = mb.get(k);
    if (w !== undefined) shared += Math.min(v, w);
  }
  for (const v of mb.values()) tb += v;
  return Math.min(ta, tb) > 0 ? shared / Math.min(ta, tb) : 0;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const r = await db.query<{ id: string; name: string; geom_simplified: LineString }>(
    `select id, name, geom_simplified from drive_cores
     where generator_version='r35-rib' and kind='ribbon' and curviness > 2
     limit 1`,
  );
  const rib = r.rows[0] ?? null;
  await db.end();
  if (rib === null) throw new Error('no Forks of the Credit ribbon found');
  const fwd = rib.geom_simplified;
  const rev: LineString = {
    type: 'LineString',
    coordinates: [...(fwd.coordinates as Array<[number, number]>)].reverse(),
  };
  const eFwd = await traceEdgeIds(VALHALLA, fwd);
  const eFwd2 = await traceEdgeIds(VALHALLA, fwd);
  const eRev = await traceEdgeIds(VALHALLA, rev);

  const cellSelf = edgeOverlapRatio(fwd, fwd);
  const cellRev = Math.max(edgeOverlapRatio(fwd, rev), edgeOverlapRatio(rev, fwd));
  const edgeSelf = directedOverlap(eFwd, eFwd2);
  const edgeRev = directedOverlap(eFwd, eRev);

  console.log(`fixture: "${rib.name}" (${rib.id.slice(0, 50)})`);
  console.log(
    `  self:     cell ${cellSelf.toFixed(2)} · directed-edge ${edgeSelf.toFixed(2)}  (both must be ~1)`,
  );
  console.log(
    `  reversed: cell ${cellRev.toFixed(2)} · directed-edge ${edgeRev.toFixed(2)}  (cells CANNOT tell direction; edges must)`,
  );
  const pass = cellSelf > 0.9 && edgeSelf > 0.9 && cellRev > 0.5 && edgeRev < 0.2; // 0.5 = the production dup bar: where cells say "same", edges must say "opposite"
  console.log(
    pass
      ? 'ANTI-FOOL PIN: PASS — directed edges answer what cells cannot'
      : 'PIN FAILED — investigate before any cutover',
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
