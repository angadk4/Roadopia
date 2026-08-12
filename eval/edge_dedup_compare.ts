/**
 * R37-U13 (BD-178) — EDGE-native vs GEOMETRIC same-ring verdicts, compared.
 *
 * The plan's validation step (Recovery §6 / execution plan U13): run BOTH
 * identity systems over the same pairs and study the DISAGREEMENTS before any
 * cutover — geometry stays canonical until edges are proven. No behavior
 * change; this is measurement.
 *
 *   geometric verdict: max(edgeOverlapRatio(a,b), edgeOverlapRatio(b,a)) > 0.5
 *                      (the production menu/dedup rule, cell-based)
 *   edge verdict:      directed-road-run overlap by LENGTH — shared
 *                      (wayId,dir) run length / min(total) > 0.5
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx edge_dedup_compare.ts r35-rib
 */
import { Client } from 'pg';

import { edgeOverlapRatio } from '../backend/src/planner/overlap';
import type { DirectedEdge } from '../backend/src/valhalla/trace';
import type { LineString } from '../shared/src/types';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DUR_BAND = 0.15;

interface Row {
  id: string;
  name: string;
  duration_s: number;
  geom_simplified: LineString;
  edges: DirectedEdge[] | null;
}

/** Length-weighted directed-road overlap: shared (wayId,dir) metres / min side. */
function edgeOverlapByLength(a: DirectedEdge[], b: DirectedEdge[]): number {
  const acc = (edges: DirectedEdge[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const e of edges) {
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
  const denom = Math.min(ta, tb);
  return denom > 0 ? shared / denom : 0;
}

const bboxOf = (g: LineString): [number, number, number, number] => {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (const [x, y] of g.coordinates as Array<[number, number]>) {
    if (x < a) a = x;
    if (y < b) b = y;
    if (x > c) c = x;
    if (y > d) d = y;
  }
  return [a, b, c, d];
};
const touch = (x: [number, number, number, number], y: [number, number, number, number]): boolean =>
  x[0] <= y[2] && y[0] <= x[2] && x[1] <= y[3] && y[1] <= x[3];

async function main(): Promise<void> {
  const version = process.argv[2] ?? 'r35-rib';
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const res = await db.query<Row>(
    `select id, name, duration_s, geom_simplified, edges
     from drive_cores where generator_version = $1 and kind = 'loop' and edges is not null`,
    [version],
  );
  await db.end();
  const rows = res.rows;
  const boxes = rows.map((r) => bboxOf(r.geom_simplified));
  let pairs = 0;
  let agreeDup = 0;
  let agreeDistinct = 0;
  const disagreements: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (!touch(boxes[i]!, boxes[j]!)) continue;
      const a = rows[i]!;
      const b = rows[j]!;
      const gap = Math.abs(a.duration_s - b.duration_s) / Math.max(a.duration_s, b.duration_s);
      if (gap > DUR_BAND) continue;
      pairs++;
      const geo =
        Math.max(
          edgeOverlapRatio(a.geom_simplified, b.geom_simplified),
          edgeOverlapRatio(b.geom_simplified, a.geom_simplified),
        ) > 0.5;
      const edg = edgeOverlapByLength(a.edges!, b.edges!) > 0.5;
      if (geo === edg) {
        if (geo) agreeDup++;
        else agreeDistinct++;
      } else {
        disagreements.push(
          `${geo ? 'GEO-dup/EDGE-distinct' : 'GEO-distinct/EDGE-dup'}: "${a.name}" ${Math.round(a.duration_s / 60)}m ${a.id.slice(0, 46)} vs "${b.name}" ${Math.round(b.duration_s / 60)}m ${b.id.slice(0, 46)}`,
        );
      }
    }
  }
  console.log(
    `${version}: ${pairs} same-band neighbor pairs · agree-dup ${agreeDup} · agree-distinct ${agreeDistinct} · DISAGREE ${disagreements.length} (${((100 * (agreeDup + agreeDistinct)) / Math.max(1, pairs)).toFixed(1)}% agreement)`,
  );
  for (const d of disagreements.slice(0, 12)) console.log(' ', d);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
