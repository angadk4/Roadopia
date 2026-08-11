import { Client } from 'pg';

import { ribbonRoadKey } from '../../backend/src/planner/ribbon_chain';

async function main(): Promise<void> {
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();
  const sites = [
    { label: 'Guelph', lng: -80.248, lat: 43.545 },
    { label: 'Southfields', lng: -79.8335, lat: 43.7565 },
    { label: 'Cobourg', lng: -78.167, lat: 43.96 },
  ];
  const oldKey = (id: string): string =>
    id.includes(':ribbon:') ? id.slice(id.indexOf(':ribbon:') + 8) : id;
  for (const s of sites) {
    const r = await db.query<{ id: string }>(
      `select id from drive_cores
       where generator_version='r34-rib' and kind='ribbon'
         and st_dwithin(bbox::geography, st_setsrid(st_makepoint($1,$2),4326)::geography, 25000)`,
      [s.lng, s.lat],
    );
    const ids = r.rows.map((x) => x.id);
    console.log(
      `${s.label.padEnd(12)} rows ${String(ids.length).padStart(3)} · distinct OLD ${new Set(ids.map(oldKey)).size} · distinct NEW ${new Set(ids.map(ribbonRoadKey)).size}`,
    );
  }
  await db.end();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
