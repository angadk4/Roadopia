/**
 * R36-U12 (BD-168) — LOADER v2: incremental, provenance-stamped (Recovery
 * §12.2). The v1 loader is delete-per-version, which makes targeted top-ups
 * impossible (a Cobourg top-up would wipe the whole index — recorded as the
 * blocker in BD-152). Modes:
 *
 *   node … load_drive_cores_v2.ts <artifact.jsonl>                 # replace-version (v1 behaviour)
 *   node … load_drive_cores_v2.ts <artifact.jsonl> --merge         # upsert by id, delete nothing
 *   node … load_drive_cores_v2.ts <artifact.jsonl> --replace-cells # replace only the cells present
 *
 * Provenance: reads `<artifact>.manifest.json` (the sweep sidecar) and stamps
 * sweep_run_id / config_stamp / tileset_id on every inserted row.
 *
 * ID NAMESPACING (the collision law): `id` is the GLOBAL primary key but the
 * sweep's deterministic ids (`cell:loop:cand`) carry no version — the same
 * cell+candidate regenerates the same id in every sweep, so an un-namespaced
 * merge would silently STEAL rows from another version (measured: r35 ckpt ids
 * are format-identical to r34-rib's; the r34 carry dodged this by hand-renaming
 * `:ribbon:`→`:r34ribbon:`, which broke ribbon_chain's road dedup — see
 * ribbonRoadKey). v2 prefixes every id with `<version>:` at insert, so each
 * version owns a disjoint id space and re-loads stay idempotent.
 */
import { existsSync, readFileSync } from 'node:fs';

import { Client } from 'pg';

import type { LineString } from '../shared/src/types';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

interface CoreRow {
  id: string;
  kind: 'loop' | 'ribbon';
  name: string;
  cell: string;
  generator_version: string;
  bar_profile: 'strict' | 'cell_relaxed';
  geometry: LineString;
  geom_simplified: LineString;
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
  const path = process.argv[2];
  if (!path)
    throw new Error('usage: load_drive_cores_v2.ts <artifact.jsonl> [--merge|--replace-cells]');
  const mode = process.argv.includes('--merge')
    ? 'merge'
    : process.argv.includes('--replace-cells')
      ? 'replace-cells'
      : 'replace-version';

  const rows: CoreRow[] = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as CoreRow);
  if (rows.length === 0) throw new Error(`no rows in ${path}`);
  const versions = new Set(rows.map((r) => r.generator_version));
  if (versions.size !== 1) throw new Error(`mixed generator_versions: ${[...versions].join(',')}`);
  const version = rows[0]!.generator_version;

  // provenance from the manifest sidecar (honest nulls when absent)
  let sweepRunId: string | null = null;
  let configStamp: string | null = null;
  let tilesetId: string | null = null;
  const sidecar = `${path}.manifest.json`;
  if (existsSync(sidecar)) {
    const m = JSON.parse(readFileSync(sidecar, 'utf8')) as {
      suite?: string;
      generatedAt?: string;
      gitDescribe?: string;
      valhallaTilesetLastModified?: number | null;
      envOverrides?: Record<string, string>;
    };
    sweepRunId = `${m.suite ?? 'sweep'}@${m.generatedAt ?? '?'}`;
    configStamp = `${m.gitDescribe ?? '?'}|${Object.entries(m.envOverrides ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(',')}`;
    tilesetId =
      m.valhallaTilesetLastModified != null ? String(m.valhallaTilesetLastModified) : null;
  }

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query('begin');
    if (mode === 'replace-version') {
      await db.query('delete from drive_cores where generator_version = $1', [version]);
    } else if (mode === 'replace-cells') {
      const cells = [...new Set(rows.map((r) => r.cell))];
      await db.query(
        'delete from drive_cores where generator_version = $1 and cell = any($2::text[])',
        [version, cells],
      );
      console.log(`replace-cells: cleared ${cells.length} cells in ${version}`);
    }
    let upserts = 0;
    for (const r of rows) {
      const rowId = r.id.startsWith(`${version}:`) ? r.id : `${version}:${r.id}`;
      const res = await db.query(
        `insert into drive_cores (
           id, kind, name, cell, generator_version, bar_profile,
           geometry, geom_simplified, bbox, entry, exit,
           distance_m, duration_s, curviness, backroad_share, main_share,
           highway_share, hood_share, turns_per_10min, loopiness,
           sweep_run_id, config_stamp, tileset_id
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,
           st_makeenvelope($9,$10,$11,$12,4326),
           $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
         )
         on conflict (id) do update set
           kind = excluded.kind, name = excluded.name, cell = excluded.cell,
           bar_profile = excluded.bar_profile, geometry = excluded.geometry,
           geom_simplified = excluded.geom_simplified, bbox = excluded.bbox,
           entry = excluded.entry, exit = excluded.exit,
           distance_m = excluded.distance_m, duration_s = excluded.duration_s,
           curviness = excluded.curviness, backroad_share = excluded.backroad_share,
           main_share = excluded.main_share, highway_share = excluded.highway_share,
           hood_share = excluded.hood_share, turns_per_10min = excluded.turns_per_10min,
           loopiness = excluded.loopiness, sweep_run_id = excluded.sweep_run_id,
           config_stamp = excluded.config_stamp, tileset_id = excluded.tileset_id`,
        [
          rowId,
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
          sweepRunId,
          configStamp,
          tilesetId,
        ],
      );
      upserts += res.rowCount ?? 0;
    }
    await db.query('commit');
    const check = await db.query(
      `select count(*) n, count(*) filter (where bar_profile='strict') strict,
              count(distinct name) names
       from drive_cores where generator_version = $1 and kind='loop'`,
      [version],
    );
    console.log(
      `loaded ${upserts} rows (${mode}) into ${version} — loops now ${check.rows[0].n} (${check.rows[0].strict} strict) / ${check.rows[0].names} names — verified.`,
    );
  } catch (err) {
    await db.query('rollback');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
