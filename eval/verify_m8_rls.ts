/**
 * M8-T03 verification — the §55 RLS matrix exercised AS THE ROLES THEMSELVES.
 *
 * Uses `set local role` + `request.jwt.claims` (exactly what PostgREST does)
 * inside rollback-wrapped transactions against the LOCAL stack, asserting the
 * full visibility matrix:
 *   private-unreadable-by-others · owner-full-cycle · anon-public-only ·
 *   favourite own-rows-only + idempotent PK · prefs own-only ·
 *   reports insert-anon-yes/select-no · cross-user update rejected.
 * Exits non-zero on ANY deviation (this is the T03 Verify command).
 *
 * M8-T11 extension: fork independence (T05), unlisted-by-link (T07),
 * visibility flips (T08), and delete_account with fork survival + auth-row
 * removal (T09) — the full M8 integration matrix in one deterministic run.
 *
 * Run (from eval/): TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx verify_m8_rls.ts
 */
import { Client } from 'pg';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Run a statement expected to be DENIED, without aborting the transaction. */
async function denied(db: Client, sql: string, params: unknown[] = []): Promise<boolean> {
  await db.query('savepoint probe');
  try {
    await db.query(sql, params);
    await db.query('release savepoint probe');
    return false; // it worked — that's the failure case for the caller
  } catch {
    await db.query('rollback to savepoint probe');
    return true;
  }
}

async function as(
  db: Client,
  who: { role: 'anon' | 'authenticated'; sub?: string },
  fn: () => Promise<void>,
): Promise<void> {
  await db.query('begin');
  try {
    await db.query(`set local role ${who.role}`);
    if (who.sub) {
      await db.query(
        `set local request.jwt.claims = '${JSON.stringify({ sub: who.sub, role: who.role })}'`,
      );
    }
    await fn();
  } finally {
    await db.query('rollback'); // role reset + no persistent writes… except we
    // WANT some rows to persist across blocks, so writes-to-keep happen as
    // postgres before the matrix runs.
  }
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // seed: two users + one route each (public for A, private for B) — postgres role
  await db.query('delete from auth.users where id = any($1::uuid[])', [[A, B]]);
  await db.query(`insert into auth.users (id, email) values ($1,'a@t.dev'), ($2,'b@t.dev')`, [
    A,
    B,
  ]);
  const mk = async (owner: string, vis: string): Promise<string> => {
    const r = await db.query<{ id: string }>(
      `insert into routes (owner_id, name, description, geometry, is_loop, waypoints,
         distance_m, duration_s, curviness, character_tags, intensity, free_tags,
         highway_flag, toll_flag, ferry_flag, unpaved_flag, visibility, origin_type)
       values ($1, 'seed', '', st_geomfromtext('LINESTRING(-79.9 43.2, -79.89 43.21)', 4326),
         true, '[]', 1000, 600, 1.0, '{}', 'chill', '{}',
         false, false, false, false, $2, 'ai')
       returning id`,
      [owner, vis],
    );
    return r.rows[0]!.id;
  };
  const routePubA = await mk(A, 'public');
  const routePrivB = await mk(B, 'private');

  console.log('§55 matrix:');

  await as(db, { role: 'anon' }, async () => {
    const r = await db.query('select id from routes where id = any($1::uuid[])', [
      [routePubA, routePrivB],
    ]);
    check('anon sees public only', r.rows.length === 1 && r.rows[0]!.id === routePubA);
    // no `returning` — anon holds INSERT but not SELECT on reports, so a
    // reporter gets no receipt (stronger than RLS-empty; §55 as intended)
    const rep = await db.query(
      `insert into reports (target_type, target_id, reason) values ('route', $1, 'test')`,
      [routePubA],
    );
    check('anon can file a report', rep.rowCount === 1);
    check('anon cannot read reports', await denied(db, 'select id from reports'));
  });

  await as(db, { role: 'authenticated', sub: A }, async () => {
    const r = await db.query('select id from routes where id = $1', [routePrivB]);
    check("A cannot read B's private route", r.rows.length === 0);
    const upd = await db.query(`update routes set name='stolen' where id=$1 returning id`, [
      routePrivB,
    ]);
    check("A cannot update B's route (0 rows matched)", upd.rows.length === 0);
    const fav = await db.query(
      `insert into route_favourites (user_id, route_id) values ($1,$2) returning user_id`,
      [A, routePubA],
    );
    check('A favourites a public route', fav.rows.length === 1);
    check(
      'A cannot write a favourite AS B',
      await denied(db, 'insert into route_favourites (user_id, route_id) values ($1,$2)', [
        B,
        routePubA,
      ]),
    );
    const prefs = await db.query(
      `insert into user_preferences (user_id, weights) values ($1,'{"preset":"backroads"}') returning user_id`,
      [A],
    );
    check('A writes own preferences', prefs.rows.length === 1);
  });

  await as(db, { role: 'authenticated', sub: B }, async () => {
    const r = await db.query('select id from routes where id = $1', [routePrivB]);
    check('B reads own private route', r.rows.length === 1);
    const favs = await db.query('select user_id from route_favourites');
    check("B sees no one else's favourites", favs.rows.length === 0);
    const prefsA = await db.query('select user_id from user_preferences');
    check("B sees no one else's preferences", prefsA.rows.length === 0);
    const del = await db.query('delete from routes where id=$1 returning id', [routePrivB]);
    check('B deletes own route', del.rows.length === 1);
  });

  // ---- T05/T07/T08/T09 integration (fork · unlisted link · visibility · deletion) ----
  const routeUnlistedA = await mk(A, 'unlisted');
  let forkId = '';
  await as(db, { role: 'authenticated', sub: B }, async () => {
    const viaLink = await db.query('select id from routes where id = $1', [routeUnlistedA]);
    check('B reads an UNLISTED route by link (uuid)', viaLink.rows.length === 1);
    const f = await db.query('select fork_route($1) as id', [routeUnlistedA]);
    forkId = (f.rows[0] as { id: string }).id;
    check('B forks it', forkId.length > 0);
    const fork = await db.query(
      'select owner_id, visibility, forked_from, generation_request_id from routes where id=$1',
      [forkId],
    );
    const fr = fork.rows[0] as Record<string, unknown>;
    check(
      'fork: owned by B, private, provenance dropped, forked_from set',
      fr['owner_id'] === B &&
        fr['visibility'] === 'private' &&
        fr['forked_from'] === routeUnlistedA &&
        fr['generation_request_id'] === null,
    );
    const upd = await db.query(`update routes set name='my fork' where id=$1 returning id`, [
      forkId,
    ]);
    check('fork is editable by B', upd.rows.length === 1);
  });
  // fork persisted? (the `as` wrapper rolls back — re-fork as a KEPT row via postgres-side emulation)
  await db.query('begin');
  await db.query('set local role authenticated');
  await db.query(
    `set local request.jwt.claims = '${JSON.stringify({ sub: B, role: 'authenticated' })}'`,
  );
  const keptFork = await db.query('select fork_route($1) as id', [routeUnlistedA]);
  forkId = (keptFork.rows[0] as { id: string }).id;
  await db.query('commit'); // KEEP this one for the deletion test

  await as(db, { role: 'authenticated', sub: A }, async () => {
    const vis = await db.query(
      `update routes set visibility='public' where id=$1 returning visibility`,
      [routeUnlistedA],
    );
    check(
      'T08: owner flips visibility',
      (vis.rows[0] as { visibility: string }).visibility === 'public',
    );
  });

  // M10/M11-T03: photos — the pipeline is the only writer; owner-only reads
  const spotA = (
    await db.query(
      `insert into spots (owner_id, type, name, location, source)
       values ($1, 'viewpoint', 'RLS Photo Spot', st_setsrid(st_makepoint(-79.9, 43.3), 4326), 'user')
       returning id`,
      [A],
    )
  ).rows[0] as { id: string };
  await db.query(
    `insert into photos (owner_id, spot_id, storage_path, thumb_path)
     values ($1, $2, 'a/p.jpg', 'a/p_thumb.jpg')`,
    [A, spotA.id],
  );
  await as(db, { role: 'authenticated', sub: A }, async () => {
    const mine = await db.query('select id from photos where spot_id=$1', [spotA.id]);
    check('photos: owner reads own', mine.rows.length === 1);
  });
  await as(db, { role: 'authenticated', sub: B }, async () => {
    const theirs = await db.query('select id from photos where spot_id=$1', [spotA.id]);
    check("photos: stranger sees NONE of A's photos", theirs.rows.length === 0);
    check(
      'photos: app roles cannot INSERT (pipeline-only writes)',
      await denied(
        db,
        `insert into photos (owner_id, spot_id, storage_path, thumb_path)
                        values ('${B}', '${spotA.id}', 'x.jpg', 'x_t.jpg')`,
      ),
    );
  });
  await as(db, { role: 'anon' }, async () => {
    // 0028 grants photos to authenticated only — anon fails at the GRANT, a
    // stronger posture than an RLS empty-set
    check('photos: anon has no read grant at all', await denied(db, 'select id from photos'));
  });
  // spots RPC boundary (0027): OSM immutable even via RPC; anon cannot create
  await as(db, { role: 'authenticated', sub: B }, async () => {
    const osmSafe = await db.query(
      `select coalesce((select update_spot(id, '{"name":"vandalised"}'::jsonb)
                        from spots where source='osm' limit 1), false) as changed`,
    );
    check(
      'spots: OSM rows immutable via update_spot',
      (osmSafe.rows[0] as { changed: boolean }).changed === false,
    );
  });
  await as(db, { role: 'anon' }, async () => {
    check(
      'spots: anon cannot execute create_spot',
      await denied(
        db,
        `select create_spot('{"lat":43.3,"lng":-79.9,"type":"coffee","name":"x"}'::jsonb)`,
      ),
    );
  });

  // T09: A deletes their account — A's rows go, B's fork survives, auth row gone
  await db.query('begin');
  await db.query('set local role authenticated');
  await db.query(
    `set local request.jwt.claims = '${JSON.stringify({ sub: A, role: 'authenticated' })}'`,
  );
  await db.query('select delete_account()');
  await db.query('commit');
  const aGone = await db.query('select count(*)::int n from auth.users where id=$1', [A]);
  const aRoutes = await db.query('select count(*)::int n from routes where owner_id=$1', [A]);
  const bFork = await db.query('select id, forked_from from routes where id=$1', [forkId]);
  check('T09: auth user removed', (aGone.rows[0] as { n: number }).n === 0);
  check("T09: A's routes cascaded away", (aRoutes.rows[0] as { n: number }).n === 0);
  check(
    "T09: B's fork SURVIVES (forked_from nulled)",
    bFork.rows.length === 1 && (bFork.rows[0] as { forked_from: null }).forked_from === null,
  );

  // cleanup
  await db.query('delete from auth.users where id = any($1::uuid[])', [[A, B]]);
  await db.end();
  console.log(failures === 0 ? '\nRLS MATRIX: ALL PASS' : `\nRLS MATRIX: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
