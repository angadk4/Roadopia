/**
 * R36-U12 (BD-168) — GLOBAL index dedup for loop cores (Recovery §12.1).
 *
 * Overlapping sweep cells (12 km scope on an 8 km grid) store the SAME
 * physical ring many times (BD-150 measured 270 rows / 82 distinct names).
 * The serve-time menu dedup hides this from users but the STORAGE stays
 * bloated and every "distinct rings" count lies. This tool removes redundant
 * loop rows within one generator_version.
 *
 * DUPLICATE (frozen before running): same physical ring = mutual geometry
 * overlap max(edgeOverlapRatio(a,b), edgeOverlapRatio(b,a)) > 0.5 — the SAME
 * function + threshold production's menu dedup uses — AND duration within 15%
 * (TRIP_EXACT_BAND). The band matters at the index: a 45-min sub-ring of a
 * 120-min ring shares most of its edges but serves a different ask — NOT a dup.
 *
 * KEEP-BEST per group: bar_profile 'strict' first, then the BD-167 row-level
 * quality q = backroad + 0.25·min(curv,3)/3 − 0.5·hood − 0.15·max(0,turns−5)/5
 * (core_bars.judgeCoreLayered scores curv=0 at metrics level; rows add it),
 * then lexicographic id for determinism.
 *
 * DRY-RUN BY DEFAULT — prints groups; `--apply` deletes in one transaction.
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx dedup_index.ts r35-rib [--apply]
 */
import { Client } from 'pg';

import { edgeOverlapRatio } from '../backend/src/planner/overlap';
import type { LineString } from '../shared/src/types';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OVERLAP_DUP = 0.5; // production menu-dedup threshold (discover_cores BD-150)
const DURATION_BAND = 0.15; // TRIP_EXACT_BAND — same-ask rows only

interface LoopRow {
  id: string;
  name: string;
  cell: string;
  bar_profile: 'strict' | 'cell_relaxed';
  geom_simplified: LineString;
  duration_s: number;
  backroad_share: number;
  curviness: number;
  hood_share: number;
  turns_per_10min: number;
}

const rowQuality = (r: LoopRow): number =>
  r.backroad_share +
  (0.25 * Math.min(r.curviness, 3)) / 3 -
  0.5 * r.hood_share -
  (0.15 * Math.max(0, r.turns_per_10min - 5)) / 5;

const bboxOf = (g: LineString): [number, number, number, number] => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of g.coordinates as Array<[number, number]>) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
};

const bboxTouch = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

async function main(): Promise<void> {
  const version = process.argv[2] ?? 'r34-rib';
  const apply = process.argv.includes('--apply');
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const res = await db.query<LoopRow>(
    `select id, name, cell, bar_profile, geom_simplified, duration_s,
            backroad_share, curviness, hood_share, turns_per_10min
     from drive_cores where generator_version = $1 and kind = 'loop'`,
    [version],
  );
  const rows = res.rows;
  console.log(`${version}: ${rows.length} loop rows`);
  const boxes = rows.map((r) => bboxOf(r.geom_simplified));

  // union-find over duplicate pairs
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  let pairsTested = 0;
  let dupPairs = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (!bboxTouch(boxes[i]!, boxes[j]!)) continue;
      const a = rows[i]!;
      const b = rows[j]!;
      const durGap = Math.abs(a.duration_s - b.duration_s) / Math.max(a.duration_s, b.duration_s);
      if (durGap > DURATION_BAND) continue;
      pairsTested++;
      const ov = Math.max(
        edgeOverlapRatio(a.geom_simplified, b.geom_simplified),
        edgeOverlapRatio(b.geom_simplified, a.geom_simplified),
      );
      if (ov > OVERLAP_DUP) {
        dupPairs++;
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(i);
    groups.set(r, g);
  }
  const doomed: string[] = [];
  let multi = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    multi++;
    const ranked = [...g].sort((x, y) => {
      const a = rows[x]!;
      const b = rows[y]!;
      if (a.bar_profile !== b.bar_profile) return a.bar_profile === 'strict' ? -1 : 1;
      return rowQuality(b) - rowQuality(a) || a.id.localeCompare(b.id);
    });
    const keep = rows[ranked[0]!]!;
    for (const idx of ranked.slice(1)) doomed.push(rows[idx]!.id);
    if (multi <= 8) {
      console.log(
        `  group ×${g.length} "${keep.name}" (${Math.round(keep.duration_s / 60)} min) — keep ${keep.bar_profile} ${keep.id}`,
      );
    }
  }
  console.log(
    `pairs tested ${pairsTested} · dup pairs ${dupPairs} · groups ${multi} · rows to remove ${doomed.length}` +
      ` → ${rows.length - doomed.length} distinct-standing rows`,
  );

  if (apply && doomed.length > 0) {
    await db.query('begin');
    await db.query(
      'delete from drive_cores where generator_version = $1 and id = any($2::text[])',
      [version, doomed],
    );
    await db.query('commit');
    const after = await db.query<{ n: string }>(
      `select count(*)::text n from drive_cores where generator_version=$1 and kind='loop'`,
      [version],
    );
    console.log(`APPLIED — ${version} loops now ${after.rows[0]!.n} (was ${rows.length}).`);
  } else if (doomed.length > 0) {
    console.log('dry-run (pass --apply to delete).');
  }
  await db.end();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
