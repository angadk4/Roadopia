/**
 * R18-0 — character distinctness: does asking for a different drive character
 * actually produce a different drive? 10 spread origins × {twisty, backroads,
 * scenic, simple} through the REAL planner; report per-origin pairwise overlap
 * of the presented bests + per-character curviness/arterial share.
 *
 * The R18 audit proved the v10 answer is "no" (byte-identical routes) — this
 * script is the standing measurement that the rebuild must move and hold.
 * Directional bars (gate from R18-4 on): every-pair overlap < 0.5 for pairs
 * involving `simple`; curv(twisty) ≥ 1.3 × curv(simple);
 * arterial(simple) ≥ arterial(backroads) + 0.15.
 *
 * Run: pnpm -C eval run character-distinctness   (stack up)
 */

import { Client } from 'pg';

import { pairOverlap } from '../backend/src/planner/overlap';
import { parseRules } from '../backend/src/planner/parse_rules';
import { arterialShareOf } from '../backend/src/planner/residential';
import { runPlanner } from '../backend/src/planner/run';
import { traceRoadClasses } from '../backend/src/valhalla/trace';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

const ORIGINS: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Hamilton', lat: 43.2557, lng: -79.8711 },
  { name: 'Caledon East', lat: 43.8628, lng: -79.8681 },
  { name: 'Guelph', lat: 43.5448, lng: -80.2482 },
  { name: 'Barrie', lat: 44.3894, lng: -79.6903 },
  { name: 'Uxbridge', lat: 44.1091, lng: -79.1204 },
  { name: 'St. Catharines', lat: 43.1594, lng: -79.2469 },
  { name: 'Collingwood', lat: 44.5001, lng: -80.2169 },
  { name: 'Stratford', lat: 43.3701, lng: -80.9822 },
  { name: 'Peterborough', lat: 44.3091, lng: -78.3197 },
  { name: 'London', lat: 42.9849, lng: -81.2453 },
];

const CHARACTERS = ['twisty', 'backroads', 'scenic', 'simple'] as const;
type Character = (typeof CHARACTERS)[number];

interface Cell {
  character: Character;
  geometry: import('@shared/types').LineString | null;
  curviness: number | null;
  arterialShare: number | null;
  durationMin: number | null;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const rows: Array<{ origin: string; cells: Cell[] }> = [];
  for (const o of ORIGINS) {
    const cells: Cell[] = [];
    for (const character of CHARACTERS) {
      const brief = `90 minute ${character} loop`;
      const parsed = parseRules(brief);
      // origin override must also clear the no-origin clarify state (§3.5) —
      // exactly what /plan does when the app supplies device coordinates
      const constraints = {
        ...parsed,
        origin: { lat: o.lat, lng: o.lng },
        missing: parsed.missing.filter((m) => m !== 'origin'),
        clarification: { needed: false, question: null },
      };
      let cell: Cell = {
        character,
        geometry: null,
        curviness: null,
        arterialShare: null,
        durationMin: null,
      };
      try {
        const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
        if (res.route) {
          let arterial: number | null = null;
          try {
            const trace = await traceRoadClasses(VALHALLA, res.route.geometry);
            arterial = arterialShareOf(trace.edges);
          } catch {
            arterial = null; // honest unknown
          }
          cell = {
            character,
            geometry: res.route.geometry,
            curviness: res.curviness,
            arterialShare: arterial,
            durationMin: Math.round(res.route.duration_s / 60),
          };
        }
      } catch {
        // no route — cell stays null (reported as such)
      }
      cells.push(cell);
    }
    rows.push({ origin: o.name, cells });
    const summary = cells
      .map((c) =>
        c.geometry
          ? `${c.character}: curv ${c.curviness?.toFixed(2)} art ${
              c.arterialShare === null ? '?' : Math.round(c.arterialShare * 100) + '%'
            } ${c.durationMin}min`
          : `${c.character}: NO ROUTE`,
      )
      .join(' | ');
    console.log(`[${rows.length}/${ORIGINS.length}] ${o.name}: ${summary}`);
  }
  await db.end();

  // pairwise overlap per origin
  console.log('\n-- pairwise overlap of bests (1.00 = identical route) --');
  const pairKeys: string[] = [];
  for (let i = 0; i < CHARACTERS.length; i++) {
    for (let j = i + 1; j < CHARACTERS.length; j++) {
      pairKeys.push(`${CHARACTERS[i]}~${CHARACTERS[j]}`);
    }
  }
  const pairSums = new Map<string, { sum: number; n: number; identical: number }>();
  for (const row of rows) {
    const parts: string[] = [];
    for (let i = 0; i < row.cells.length; i++) {
      for (let j = i + 1; j < row.cells.length; j++) {
        const a = row.cells[i]!;
        const b = row.cells[j]!;
        const key = `${a.character}~${b.character}`;
        if (!a.geometry || !b.geometry) {
          parts.push(`${key}: —`);
          continue;
        }
        const ov = pairOverlap(a.geometry, b.geometry);
        const agg = pairSums.get(key) ?? { sum: 0, n: 0, identical: 0 };
        agg.sum += ov;
        agg.n += 1;
        if (ov > 0.99) agg.identical += 1;
        pairSums.set(key, agg);
        parts.push(`${key}: ${ov.toFixed(2)}`);
      }
    }
    console.log(`${row.origin.padEnd(16)} ${parts.join('  ')}`);
  }

  console.log('\n-- distinctness summary --');
  for (const key of pairKeys) {
    const agg = pairSums.get(key);
    if (!agg || agg.n === 0) {
      console.log(`${key.padEnd(20)} no data`);
      continue;
    }
    console.log(
      `${key.padEnd(20)} mean overlap ${(agg.sum / agg.n).toFixed(2)}  identical ${agg.identical}/${agg.n}`,
    );
  }

  // per-character aggregates (the directional bars' inputs)
  console.log('\n-- per-character aggregates --');
  for (const character of CHARACTERS) {
    const cells = rows.map((r) => r.cells.find((c) => c.character === character)!);
    const curvs = cells.map((c) => c.curviness).filter((v): v is number => v !== null);
    const arts = cells.map((c) => c.arterialShare).filter((v): v is number => v !== null);
    const noRoute = cells.filter((c) => c.geometry === null).length;
    const meanOf = (xs: number[]): string =>
      xs.length === 0 ? '—' : (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
    console.log(
      `${character.padEnd(10)} mean curv ${meanOf(curvs)}  mean arterial ${meanOf(arts)}  no-route ${noRoute}/${rows.length}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
