/**
 * R25-U13 — load the drive-core sweep artifact into `drive_cores` (migration
 * 0016). The `data/load_curvy.ts` convention: read the deterministic JSONL,
 * replace the target generator_version's rows in ONE transaction, verify the
 * count. The definer (`discover_drive_cores`) pins `generator_version`, so a
 * half-loaded new version can never be served — flip versions only after the
 * load commits.
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx load_drive_cores.ts out/drive_cores.jsonl
 */

import { readFileSync } from 'node:fs';

import { Client } from 'pg';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

interface CoreRow {
  id: string;
  kind: 'loop' | 'ribbon';
  name: string;
  cell: string;
  generator_version: string;
  bar_profile: 'strict' | 'cell_relaxed';
  geometry: unknown;
  geom_simplified: unknown;
  bbox: [number, number, number, number];
  entry: { lat: number; lng: number };
  exit: { lat: number; lng: number };
  distance_m: number;
  duration_s: number;
  curviness: number;
  backroad_share: number;
  main_share: number;
  highway_share: number;
  hood_share: number;
  turns_per_10min: number;
  loopiness: number | null;
}

async function main(): Promise<void> {
  const path = process.argv[2] ?? 'out/drive_cores.jsonl';
  const rows: CoreRow[] = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as CoreRow);
  if (rows.length === 0) throw new Error(`no rows in ${path}`);
  const versions = new Set(rows.map((r) => r.generator_version));
  if (versions.size !== 1) throw new Error(`mixed generator_versions: ${[...versions].join(',')}`);
  const version = rows[0]!.generator_version;

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query('begin');
    await db.query('delete from drive_cores where generator_version = $1', [version]);
    for (const r of rows) {
      await db.query(
        `insert into drive_cores (
           id, kind, name, cell, generator_version, bar_profile,
           geometry, geom_simplified, bbox, entry, exit,
           distance_m, duration_s, curviness, backroad_share, main_share,
           highway_share, hood_share, turns_per_10min, loopiness
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,
           st_makeenvelope($9,$10,$11,$12,4326),
           $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
         )`,
        [
          r.id,
          r.kind,
          r.name,
          r.cell,
          r.generator_version,
          r.bar_profile,
          JSON.stringify(r.geometry),
          JSON.stringify(r.geom_simplified),
          r.bbox[0],
          r.bbox[1],
          r.bbox[2],
          r.bbox[3],
          JSON.stringify(r.entry),
          JSON.stringify(r.exit),
          r.distance_m,
          r.duration_s,
          r.curviness,
          r.backroad_share,
          r.main_share,
          r.highway_share,
          r.hood_share,
          r.turns_per_10min,
          r.loopiness,
        ],
      );
    }
    const count = await db.query<{ n: string }>(
      'select count(*)::text as n from drive_cores where generator_version = $1',
      [version],
    );
    if (Number(count.rows[0]!.n) !== rows.length) {
      throw new Error(`verify failed: loaded ${count.rows[0]!.n} != artifact ${rows.length}`);
    }
    await db.query('commit');
    console.log(`loaded ${rows.length} cores (version ${version}) — verified.`);
  } catch (err) {
    await db.query('rollback');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
