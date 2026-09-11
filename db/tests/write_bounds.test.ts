import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Migration 0032 — the DIRECT write path is bounded at the table (Hard rule K).
 *
 * `authenticated` holds insert/update on routes and spots for the app's own
 * PATCH/DELETE calls, so a signed-in client can bypass every RPC cap by writing
 * the table directly. These tests run AS THE OWNER (role + JWT claims, exactly
 * what PostgREST sets) inside rolled-back transactions and assert the CHECK
 * constraints refuse what the RPCs refuse. Self-skips without a local stack.
 */

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client | null = null;
const userId = randomUUID();
let spotId = '';

beforeAll(async () => {
  const candidate = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await candidate.connect();
    db = candidate;
  } catch {
    db = null;
    return;
  }
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)
     on conflict (id) do nothing`,
    [userId, `bounds-${userId.slice(0, 8)}@test.local`],
  );
  await db.query(
    `insert into profiles (id, display_name) values ($1, 'Bounds Tester') on conflict (id) do nothing`,
    [userId],
  );
  const spot = await db.query<{ id: string }>(
    `insert into spots (owner_id, type, name, location, source, tags)
     values ($1, 'viewpoint', 'Bounds Lookout', st_setsrid(st_makepoint(-79.9, 43.3), 4326), 'user', '{view,quiet}')
     returning id`,
    [userId],
  );
  spotId = spot.rows[0]!.id;
});

afterAll(async () => {
  if (db) {
    await db.query('reset role');
    await db.query('delete from auth.users where id = $1', [userId]); // cascades profile + spot
    await db.end();
  }
});

/** Run statements as the signed-in owner inside a transaction that is always
 *  rolled back; the LAST statement's rows come back. (A function's own update
 *  is invisible to the statement that called it — hence separate statements.) */
async function asOwnerMany<T extends Record<string, unknown>>(
  steps: Array<[string, unknown[]]>,
): Promise<T[]> {
  if (!db) throw new Error('no db');
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query(
      `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
    );
    let rows: T[] = [];
    for (const [sql, params] of steps) {
      rows = (await db.query<T>(sql, params)).rows;
    }
    return rows;
  } finally {
    await db.query('rollback');
  }
}

/** One statement as the owner (rolled back). */
async function asOwner<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return asOwnerMany<T>([[sql, params]]);
}

/** A LineString of `n` points, as SQL. */
const line = (n: number): string =>
  `st_makeline(array(select st_makepoint(-79.9 + i * 0.000001, 43.2) from generate_series(1, ${n}) i))`;

const INSERT = (geometry: string, over: Record<string, string> = {}): string => {
  const cols: Record<string, string> = {
    owner_id: '$1',
    name: `'bounded'`,
    geometry,
    distance_m: '1000',
    duration_s: '60',
    origin_type: `'manual'`,
    visibility: `'private'`,
    ...over,
  };
  return `insert into routes (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')}) returning id`;
};

describe('0032 direct-write bounds (routes)', () => {
  it('a bounded direct insert still works (the app’s own PATCH/DELETE path stays open)', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await asOwner<{ id: string }>(INSERT(line(2)), [userId]);
    expect(rows).toHaveLength(1);
  });

  it('a 20,001-point geometry is refused at the table', async (ctx) => {
    if (!db) return ctx.skip();
    await expect(asOwner(INSERT(line(20_001)), [userId])).rejects.toThrow(/routes_geometry_pts/);
  });

  it('an oversized geometry_simplified is refused even beside a tiny geometry', async (ctx) => {
    if (!db) return ctx.skip();
    await expect(
      asOwner(INSERT(line(2), { geometry_simplified: line(20_001) }), [userId]),
    ).rejects.toThrow(/routes_geometry_simplified_pts/);
  });

  it('an 81-char name and a 2,001-char description are refused', async (ctx) => {
    if (!db) return ctx.skip();
    await expect(
      asOwner(INSERT(line(2), { name: `'${'x'.repeat(81)}'` }), [userId]),
    ).rejects.toThrow(/routes_name_len/);
    await expect(
      asOwner(INSERT(line(2), { description: `'${'x'.repeat(2001)}'` }), [userId]),
    ).rejects.toThrow(/routes_description_len/);
  });

  it('a 4,001-char agent_explanation and 2,001 maneuvers are refused', async (ctx) => {
    if (!db) return ctx.skip();
    await expect(
      asOwner(INSERT(line(2), { agent_explanation: `'${'x'.repeat(4001)}'` }), [userId]),
    ).rejects.toThrow(/routes_explanation_len/);
    await expect(
      asOwner(
        INSERT(line(2), {
          maneuvers: `(select jsonb_agg(jsonb_build_object('type','left','instruction','x')) from generate_series(1, 2001))`,
        }),
        [userId],
      ),
    ).rejects.toThrow(/routes_maneuvers_count/);
  });

  it('more than 20 stops, or a non-array stops value, is refused', async (ctx) => {
    if (!db) return ctx.skip();
    await expect(
      asOwner(
        INSERT(line(2), {
          stops: `(select jsonb_agg(jsonb_build_object('name','s')) from generate_series(1, 21))`,
        }),
        [userId],
      ),
    ).rejects.toThrow(/routes_stops_shape/);
    await expect(asOwner(INSERT(line(2), { stops: `'{}'::jsonb` }), [userId])).rejects.toThrow(
      /routes_stops_shape/,
    );
  });
});

describe('0032 direct-write bounds (spots + profiles)', () => {
  it('a user spot with an 81-char name is refused; a valid edit passes', async (ctx) => {
    if (!db) return ctx.skip();
    await expect(
      asOwner(`update spots set name = $2 where id = $1 returning id`, [spotId, 'x'.repeat(81)]),
    ).rejects.toThrow(/spots_user_bounds/);
    const ok = await asOwner<{ id: string }>(
      `update spots set name = 'Renamed lookout' where id = $1 returning id`,
      [spotId],
    );
    expect(ok).toHaveLength(1);
  });

  it('update_spot clears tags with [] and keeps them when the key is absent', async (ctx) => {
    if (!db) return ctx.skip();
    const cleared = await asOwnerMany<{ tags: string[] }>([
      [`select update_spot($1, '{"tags":[]}'::jsonb)`, [spotId]],
      [`select tags from spots where id = $1`, [spotId]],
    ]);
    expect(cleared[0]!.tags).toEqual([]);
    const kept = await asOwnerMany<{ tags: string[] }>([
      [`select update_spot($1, '{"description":"x"}'::jsonb)`, [spotId]],
      [`select tags from spots where id = $1`, [spotId]],
    ]);
    expect(kept[0]!.tags).toEqual(['view', 'quiet']);
  });

  it('profiles: a blank or 41-char display name is refused at the DB', async (ctx) => {
    if (!db) return ctx.skip();
    await expect(
      asOwner(`update profiles set display_name = '' where id = $1 returning id`, [userId]),
    ).rejects.toThrow(/profiles_display_name_len/);
    await expect(
      asOwner(`update profiles set display_name = $2 where id = $1 returning id`, [
        userId,
        'x'.repeat(41),
      ]),
    ).rejects.toThrow(/profiles_display_name_len/);
    const ok = await asOwner<{ display_name: string }>(
      `update profiles set display_name = 'Fine' where id = $1 returning display_name`,
      [userId],
    );
    expect(ok[0]!.display_name).toBe('Fine');
  });
});

describe('0032 stops + legs sanitisers', () => {
  it('sanitize_stops keeps the wire shape with explicit nulls and drops what would not parse', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await db!.query<{ out: unknown }>(`select sanitize_stops($1::jsonb) as out`, [
      JSON.stringify([
        {
          name: 'Ridge Café',
          type: 'cafe',
          requested_type: 'coffee',
          arrival_s: null,
          at_fraction: 0.5,
          location: { lat: 43.5, lng: -79.8 },
          waypoint_index: 1,
        },
        {
          name: 'bad',
          type: 'x',
          requested_type: 'nope',
          location: { lat: 1, lng: 1 },
          waypoint_index: 0,
        },
        {
          name: 'bad2',
          type: 'x',
          requested_type: 'fuel',
          location: { lat: 'a', lng: 1 },
          waypoint_index: 0,
        },
        'not an object',
      ]),
    ]);
    expect(rows.rows[0]!.out).toEqual([
      {
        name: 'Ridge Café',
        type: 'cafe',
        requested_type: 'coffee',
        arrival_s: null,
        at_fraction: 0.5,
        location: { lat: 43.5, lng: -79.8 },
        waypoint_index: 1,
      },
    ]);
    const none = await db!.query<{ out: unknown }>(`select sanitize_stops('"x"'::jsonb) as out`);
    expect(none.rows[0]!.out).toEqual([]);
  });

  it('sanitize_legs keeps all eight keys (nullable shares) or yields NULL', async (ctx) => {
    if (!db) return ctx.skip();
    const good = await db!.query<{ out: unknown }>(`select sanitize_legs($1::jsonb) as out`, [
      JSON.stringify({
        there_pct: 28,
        drive_pct: 49,
        home_pct: 23,
        there_m: 12000,
        drive_m: 21000,
        home_m: 9800,
        drive_backroad_pct: null,
        drive_main_pct: 12,
      }),
    ]);
    expect(good.rows[0]!.out).toEqual({
      there_pct: 28,
      drive_pct: 49,
      home_pct: 23,
      there_m: 12000,
      drive_m: 21000,
      home_m: 9800,
      drive_backroad_pct: null,
      drive_main_pct: 12,
    });
    const bad = await db!.query<{ out: unknown }>(
      `select sanitize_legs('{"there_pct": 128, "drive_pct": 1, "home_pct": 1, "there_m": 1, "drive_m": 1, "home_m": 1}'::jsonb) as out`,
    );
    expect(bad.rows[0]!.out).toBeNull();
    const absent = await db!.query<{ out: unknown }>(`select sanitize_legs(null) as out`);
    expect(absent.rows[0]!.out).toBeNull();
  });
});
