/**
 * Moderation console (M10-T07; FR-301/302; §55 — reads/actions are
 * service-side ONLY; the app has no moderation surface).
 *
 *   npx tsx eval/moderate.ts list
 *   npx tsx eval/moderate.ts remove <report_id> [note...]
 *   npx tsx eval/moderate.ts dismiss <report_id>
 *
 * `remove` deletes the reported target (route / spot / photo). Storage
 * blobs CANNOT be deleted from SQL (protect_delete, see 0029) — affected
 * photo paths are collected first and swept via the Storage REST API with
 * the service key (loopback demo defaults; env overrides for hosted).
 * Every removal writes a moderation_actions row (FR-302) with actor null
 * (console action) and the note; the report flips to 'actioned'/'dismissed'.
 * Connects via DATABASE_URL (local default matches the dev stack).
 */

import { Client } from 'pg';

type TargetType = 'route' | 'spot' | 'photo';
const TABLES: Record<TargetType, string> = { route: 'routes', spot: 'spots', photo: 'photos' };

const SUPABASE_URL = (process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
const LOCAL_DEMO_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const SERVICE_KEY =
  process.env['SUPABASE_SERVICE_ROLE_KEY'] ??
  (/127\.0\.0\.1|localhost/.test(SUPABASE_URL) ? LOCAL_DEMO_SERVICE_KEY : '');

async function sweepBlobs(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (!SERVICE_KEY) {
    console.warn(`NOTE: no service key — ${paths.length} blob(s) not swept:`, paths.join(', '));
    return;
  }
  for (const path of paths) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/photos/${path}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok && res.status !== 404) console.warn(`blob sweep failed (${res.status}): ${path}`);
  }
}

/** Photo paths that will die with this target (photo itself, or a spot's set). */
async function pathsOf(db: Client, targetType: TargetType, targetId: string): Promise<string[]> {
  if (targetType === 'photo') {
    const { rows } = await db.query('select storage_path, thumb_path from photos where id = $1', [
      targetId,
    ]);
    return rows.flatMap((r) => [r.storage_path as string, r.thumb_path as string]);
  }
  if (targetType === 'spot') {
    const { rows } = await db.query(
      'select storage_path, thumb_path from photos where spot_id = $1',
      [targetId],
    );
    return rows.flatMap((r) => [r.storage_path as string, r.thumb_path as string]);
  }
  return [];
}

async function main(): Promise<void> {
  const [cmd, reportId, ...noteParts] = process.argv.slice(2);
  const db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();
  try {
    if (cmd === 'list') {
      const { rows } = await db.query(
        `select id, target_type, target_id, reason, status, created_at
           from reports order by created_at desc limit 50`,
      );
      if (rows.length === 0) {
        console.log('No reports.');
        return;
      }
      for (const r of rows) {
        console.log(
          `${r.id}  [${r.status}]  ${r.target_type} ${r.target_id}\n  "${r.reason}"  (${new Date(
            r.created_at as string,
          ).toISOString()})`,
        );
      }
      return;
    }

    if ((cmd === 'remove' || cmd === 'dismiss') && reportId) {
      const { rows } = await db.query(
        'select target_type, target_id, status from reports where id = $1',
        [reportId],
      );
      const report = rows[0];
      if (!report) {
        console.error('No such report.');
        process.exitCode = 1;
        return;
      }
      if (cmd === 'dismiss') {
        await db.query("update reports set status = 'dismissed' where id = $1", [reportId]);
        console.log(`Report ${reportId} dismissed (target untouched).`);
        return;
      }

      const targetType = report.target_type as TargetType;
      const table = TABLES[targetType];
      const blobPaths = await pathsOf(db, targetType, report.target_id as string);
      await db.query('begin');
      try {
        const gone = await db.query(`delete from ${table} where id = $1 returning id`, [
          report.target_id,
        ]);
        // FR-302: the action is logged even if the target was already gone
        await db.query(
          `insert into moderation_actions (actor_id, target_type, target_id, action, note)
           values (null, $1, $2, 'remove', $3)`,
          [targetType, report.target_id, noteParts.join(' ') || null],
        );
        await db.query("update reports set status = 'actioned' where id = $1", [reportId]);
        await db.query('commit');
        await sweepBlobs(blobPaths);
        console.log(
          gone.rows.length > 0
            ? `Removed ${targetType} ${report.target_id}; action logged; report actioned.`
            : `${targetType} ${report.target_id} was already gone; action logged; report actioned.`,
        );
      } catch (err) {
        await db.query('rollback');
        throw err;
      }
      return;
    }

    console.log('Usage: moderate.ts list | remove <report_id> [note] | dismiss <report_id>');
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
