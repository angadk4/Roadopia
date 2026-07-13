/**
 * Non-destructive migration apply (M6): run ONE migration file against the
 * local stack (`supabase db reset` replays everything but wipes seeded data;
 * this applies just the new file). Usage:
 *
 *   pnpm -C db apply supabase/migrations/0005_planner_definer.sql
 *
 * Idempotent by convention: our migrations use `create or replace` /
 * `if not exists` where re-running matters.
 */

import { readFileSync } from 'node:fs';

import { Client } from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: pnpm -C db apply <migration.sql>');
  process.exit(1);
}

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function main(): Promise<void> {
  const sql = readFileSync(file!, 'utf8');
  const db = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 3_000 });
  await db.connect();
  try {
    await db.query('begin');
    await db.query(sql);
    await db.query('commit');
    console.log(`applied ${file}`);
  } catch (err) {
    await db.query('rollback');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
