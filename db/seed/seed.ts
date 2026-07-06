/**
 * M2-T09 — seed the data tier so the map is never empty (Spec §10 SC).
 *
 *   1. OSM car-spot seeds from data/pois.json (extract_pois.ts): owner_id = null,
 *      source = 'osm', display-only.
 *   2. Six REAL corridor drives routed through the LOCAL Valhalla (pinned config)
 *      at seed time — real geometry/distance/duration, never hand-faked lines.
 *      Seed routes carry free_tags ['seed'], owner null, visibility 'public';
 *      geometry_simplified + bbox are computed in SQL per the task guidance.
 *
 * Idempotent: deletes source='osm' spots and 'seed'-tagged routes, then reinserts.
 * Requires: supabase local running + migrations applied + local Valhalla on :8002.
 *
 * Run: pnpm -C db run seed
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { decodePolyline } from '../../backend/src/valhalla/polyline';

const HERE = dirname(fileURLToPath(import.meta.url));
const POIS = join(HERE, '..', '..', 'data', 'pois.json');
const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA_URL = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

interface PoiRow {
  type: string;
  name: string;
  lon: number;
  lat: number;
}

/** Known-good corridor drives (name, description, [lon,lat] waypoints). */
const SEED_DRIVES: Array<{
  name: string;
  description: string;
  tags: string[];
  waypoints: Array<[number, number]>;
}> = [
  {
    name: 'Snake Road Sweep',
    description: 'The serpentine Aldershot classic up to Waterdown.',
    tags: ['twisty', 'forest'],
    waypoints: [
      [-79.8443, 43.3075],
      [-79.912, 43.331],
    ],
  },
  {
    name: 'Sydenham Climb',
    description: 'Dundas valley floor to the brow via the switchback.',
    tags: ['twisty', 'scenic'],
    waypoints: [
      [-79.954, 43.268],
      [-79.911, 43.301],
    ],
  },
  {
    name: 'Niagara Parkway Cruise',
    description: 'River-hugging cruise from Niagara-on-the-Lake to the Falls.',
    tags: ['scenic', 'flowing'],
    waypoints: [
      [-79.0715, 43.2553],
      [-79.076, 43.09],
    ],
  },
  {
    name: 'Effingham Twisties',
    description: 'Short Hills backroads between Pelham and St. Catharines.',
    tags: ['twisty', 'backroad'],
    waypoints: [
      [-79.332, 43.033],
      [-79.271, 43.115],
    ],
  },
  {
    name: 'Mountain Brow Run',
    description: 'Along the Hamilton escarpment edge, lookout to lookout.',
    tags: ['scenic', 'backroad'],
    waypoints: [
      [-79.856, 43.241],
      [-79.777, 43.211],
    ],
  },
  {
    name: 'Kilbride Backroads',
    description: 'Rolling rural sweep below Rattlesnake Point.',
    tags: ['rural', 'flowing'],
    waypoints: [
      [-79.942, 43.472],
      [-79.972, 43.426],
    ],
  },
  // --- south-central-ontario expansion seeds (BD-19) ---
  {
    name: 'Forks of the Credit Run',
    description: 'The famous hairpin road through the Credit River forks.',
    tags: ['twisty', 'forest'],
    waypoints: [
      [-80.0117, 43.7926], // Belfountain
      [-79.943, 43.7936], // Inglewood
    ],
  },
  {
    name: 'Hockley Valley Road',
    description: 'Rolling wooded sweepers along the Nottawasaga headwaters.',
    tags: ['twisty', 'scenic'],
    waypoints: [
      [-80.042, 43.9358], // Orangeville east
      [-79.893, 43.995], // Hockley village
    ],
  },
];

interface ValhallaTrip {
  trip: {
    legs: Array<{ shape: string }>;
    summary: {
      time: number;
      length: number;
      has_highway?: boolean;
      has_toll?: boolean;
      has_ferry?: boolean;
    };
  };
}

async function route(waypoints: Array<[number, number]>): Promise<ValhallaTrip> {
  const res = await fetch(`${VALHALLA_URL}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locations: waypoints.map(([lon, lat]) => ({ lat, lon })),
      costing: 'auto',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Valhalla /route HTTP ${res.status}`);
  return (await res.json()) as ValhallaTrip;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // --- OSM spots ---
  const pois = JSON.parse(await readFile(POIS, 'utf8')) as PoiRow[];
  await db.query('begin');
  try {
    await db.query(`delete from spots where source = 'osm'`);
    const BATCH = 500;
    for (let i = 0; i < pois.length; i += BATCH) {
      const slice = pois.slice(i, i + BATCH);
      const values: string[] = [];
      const params: (string | number)[] = [];
      slice.forEach((p, j) => {
        const b = j * 4;
        values.push(
          `($${b + 1}, $${b + 2}, st_setsrid(st_makepoint($${b + 3}, $${b + 4}), 4326), 'osm')`,
        );
        params.push(p.type, p.name, p.lon, p.lat);
      });
      await db.query(
        `insert into spots (type, name, location, source) values ${values.join(',')}`,
        params,
      );
    }
    await db.query('commit');
  } catch (err) {
    await db.query('rollback');
    throw err;
  }

  // --- seed routes (routed live through Valhalla) ---
  await db.query(`delete from routes where 'seed' = any (free_tags)`);
  for (const drive of SEED_DRIVES) {
    const trip = await route(drive.waypoints);
    const coords = trip.trip.legs.flatMap((leg, i) => {
      const pts = decodePolyline(leg.shape);
      return i === 0 ? pts : pts.slice(1);
    });
    const wkt = `LINESTRING(${coords.map(([lon, lat]) => `${lon} ${lat}`).join(',')})`;
    const s = trip.trip.summary;
    await db.query(
      `insert into routes
         (name, description, geometry, geometry_simplified, bbox, is_loop, waypoints,
          distance_m, duration_s, origin_type, visibility, character_tags, free_tags,
          highway_flag, toll_flag, ferry_flag)
       values
         ($1, $2,
          st_geomfromtext($3, 4326),
          st_simplifypreservetopology(st_geomfromtext($3, 4326), 0.0002),
          st_envelope(st_geomfromtext($3, 4326)),
          false, $4::jsonb, $5, $6, 'manual', 'public', $7, '{seed}', $8, $9, $10)`,
      [
        drive.name,
        drive.description,
        wkt,
        JSON.stringify(drive.waypoints.map(([lon, lat]) => ({ lat, lng: lon }))),
        s.length * 1000,
        Math.round(s.time),
        drive.tags,
        s.has_highway ?? false,
        s.has_toll ?? false,
        s.has_ferry ?? false,
      ],
    );
    console.log(
      `route: ${drive.name} — ${s.length.toFixed(1)} km / ${Math.round(s.time / 60)} min`,
    );
  }

  const spots = await db.query<{ type: string; n: string }>(
    `select type, count(*)::text as n from spots where source = 'osm' group by type order by type`,
  );
  const routes = await db.query<{ n: string }>(
    `select count(*)::text as n from routes where 'seed' = any (free_tags)`,
  );
  console.log('=== seed summary (M2-T09) ===');
  console.log('osm spots:', spots.rows.map((r) => `${r.type}=${r.n}`).join(' '));
  console.log('seed routes:', routes.rows[0]!.n);
  await db.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
