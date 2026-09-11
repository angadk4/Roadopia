// Why do REVERSED ring pieces pick up u-turns when driven through dense samples?
import { Client } from 'pg';

import {
  routeCorridorLeg,
  defaultCorridorRouteFn,
  departureBearing,
  type XY,
} from '../../backend/src/planner/corridor';
import { readDriveCores } from '../../backend/src/planner/discover_cores';
import { pieceChunks, piecesFromRows } from '../../backend/src/planner/loop_sweep';
import { routeThrough } from '../../backend/src/valhalla/route';
const VALHALLA = 'http://127.0.0.1:8002';
async function main() {
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();
  const origin = { lat: 43.7565, lng: -79.8335 };
  const half = 22_000 / 111_320;
  const bbox: [number, number, number, number] = [
    origin.lng - half,
    origin.lat - half,
    origin.lng + half,
    origin.lat + half,
  ];
  const ribbons = await readDriveCores(db, bbox, 'r35-rib', 50, 'ribbon');
  const loops = await readDriveCores(db, bbox, 'r35-rib', 50, 'loop');
  await db.end();
  const pieces = piecesFromRows(ribbons, loops, origin).filter(
    (p) => /Creditview|Twiss/.test(p.name) && p.kind === 'ring_half',
  );
  for (const p of pieces.slice(0, 3)) {
    for (const reversed of [false, true]) {
      const pc = reversed ? p.coords.slice().reverse() : p.coords;
      const chunks = pieceChunks(pc);
      for (const variant of ['through+heading', 'through', 'via+heading'] as const) {
        let cur: XY = pc[0]!;
        let heading: number | null = variant.includes('heading') ? departureBearing(pc) : null;
        let uturns = 0;
        let ms = 0;
        const notes: string[] = [];
        for (const chunk of chunks) {
          const t = performance.now();
          try {
            const r = await routeThrough(VALHALLA, {
              waypoints: [cur, ...chunk],
              costingOptions: { use_highways: 0.2, use_living_streets: 0 },
              middleType: variant.startsWith('via') ? 'via' : 'through',
              ...(heading !== null ? { startHeading: { deg: heading } } : {}),
            });
            ms += performance.now() - t;
            const us = r.maneuvers.filter((m) => m.type.startsWith('uturn'));
            uturns += us.length;
            for (const m of us)
              notes.push(`${m.instruction} (${(m.street_names ?? []).join('/')})`);
            const c = r.geometry.coordinates as XY[];
            cur = c[c.length - 1]!;
            heading = heading !== null ? departureBearing(c.slice(-4).reverse()) + 180 : null;
          } catch (e) {
            notes.push(`FAIL ${(e as Error).message.slice(0, 60)}`);
            break;
          }
        }
        console.log(
          `${p.id.slice(-30)} ${reversed ? '↓' : '↑'} ${variant}: ${chunks.length} chunks, ${uturns} u-turns, ${Math.round(ms)} ms ${notes.slice(0, 3).join(' | ')}`,
        );
      }
    }
  }
  void routeCorridorLeg;
  void defaultCorridorRouteFn;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
