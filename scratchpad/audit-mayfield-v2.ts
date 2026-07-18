/**
 * Mayfield & Kennedy audit v2 (R19) — same 40 deterministic origins as v1,
 * now with urban-CONTEXT truth: per-point classes combine road class AND
 * surroundings (owner: "main roads are fine when surrounded by fields;
 * neighbourhoods are not"):
 *   U = urban context (any class, town on both sides / inside) — red
 *   C = country ARTERIAL (main road through fields — the owner's "fine") — teal
 *   B = country backroad — green
 *   R = residential class outside built areas (cottage lanes etc.) — amber
 * Run from repo root:
 *   BRIEF="90 minute loop" OUT="scratchpad/audit-v2-default.json" \
 *     TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx scratchpad/audit-mayfield-v2.ts
 */
import { writeFileSync } from 'node:fs';

import { Client } from 'pg';

import { corridorDoublingRatio, loopiness, selfOverlapRatio } from '../backend/src/planner/overlap';
import { parseRules } from '../backend/src/planner/parse_rules';
import { runPlanner } from '../backend/src/planner/run';
import {
  isUrbanContext,
  urbanIndexFor,
  urbanIntroM,
  type UrbanIndex,
} from '../backend/src/planner/urban';
import { traceRoadClasses } from '../backend/src/valhalla/trace';

const DB = 'postgresql://postgres:postgres@localhost:54322/postgres';
const VALHALLA = 'http://localhost:8002';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260718);
const jit = (span: number): number => (rnd() - 0.5) * 2 * span;

interface Origin {
  label: string;
  lat: number;
  lng: number;
  cluster: 'mayfield_kennedy' | 'regional';
}
const MK = { lat: 43.7825, lng: -79.762 };
const origins: Origin[] = [];
for (let i = 0; i < 26; i++) {
  origins.push({
    label: `MK-${String(i + 1).padStart(2, '0')}`,
    lat: +(MK.lat + jit(0.03)).toFixed(5),
    lng: +(MK.lng + jit(0.035)).toFixed(5),
    cluster: 'mayfield_kennedy',
  });
}
const pockets: Array<[string, number, number]> = [
  ['Bolton', 43.874, -79.735],
  ['Caledon East', 43.868, -79.868],
  ['Georgetown', 43.651, -79.918],
  ['Springdale', 43.76, -79.72],
  ['Brampton S', 43.7, -79.76],
  ['Orangeville', 43.919, -80.094],
  ['Erin', 43.782, -80.07],
  ['Inglewood', 43.8, -79.93],
  ['Nobleton', 43.905, -79.652],
  ['Kleinburg', 43.842, -79.628],
  ['Acton', 43.633, -80.037],
  ['Tottenham', 44.02, -79.8],
  ['Alliston', 44.152, -79.866],
  ['Milton N', 43.55, -79.86],
];
for (const [name, lat, lng] of pockets) {
  origins.push({
    label: name,
    lat: +(lat + jit(0.008)).toFixed(5),
    lng: +(lng + jit(0.008)).toFixed(5),
    cluster: 'regional',
  });
}

function roadBucket(roadClass: string): 'A' | 'B' | 'R' | 'O' {
  if (/link$/.test(roadClass)) return 'A';
  switch (roadClass) {
    case 'motorway':
    case 'trunk':
    case 'primary':
    case 'secondary':
      return 'A';
    case 'tertiary':
    case 'unclassified':
      return 'B';
    case 'residential':
    case 'service':
    case 'living_street':
      return 'R';
    default:
      return 'O';
  }
}

function classesAlong(
  coords: Array<[number, number]>,
  edges: Array<{ roadClass: string; lengthM: number }>,
  idx: UrbanIndex | null,
): string[] {
  const n = coords.length;
  if (n < 2) return [];
  const hav = (a: [number, number], b: [number, number]): number => {
    const R = 6371000;
    const dLat = ((b[1] - a[1]) * Math.PI) / 180;
    const dLng = ((b[0] - a[0]) * Math.PI) / 180;
    const la = (a[1] * Math.PI) / 180;
    const lb = (b[1] * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1]! + hav(coords[i - 1]!, coords[i]!));
  const geomLen = cum[n - 1]!;
  const traceLen = edges.reduce((s, e) => s + e.lengthM, 0);
  const scale = traceLen > 0 && geomLen > 0 ? geomLen / traceLen : 0;
  const bounds: Array<{ end: number; b: string }> = [];
  let acc = 0;
  for (const e of edges) {
    acc += e.lengthM * scale;
    bounds.push({ end: acc, b: roadBucket(e.roadClass) });
  }
  const out: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    const midD = (cum[i]! + cum[i + 1]!) / 2;
    let rc = bounds.length ? bounds[bounds.length - 1]!.b : 'O';
    for (const bd of bounds) {
      if (midD <= bd.end) {
        rc = bd.b;
        break;
      }
    }
    // context: urban wins over class; country arterial gets its own bucket
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const urban = idx !== null && isUrbanContext(idx, mid[0], mid[1], b[0] - a[0], b[1] - a[1]);
    if (urban) out.push('U');
    else if (rc === 'A') out.push('C');
    else out.push(rc);
  }
  return out;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const brief = process.env['BRIEF'] ?? '90 minute loop';
  const routes: unknown[] = [];
  for (let i = 0; i < origins.length; i++) {
    const o = origins[i]!;
    const parsed = parseRules(brief);
    const constraints = {
      ...parsed,
      origin: { lat: o.lat, lng: o.lng },
      missing: parsed.missing.filter((m) => m !== 'origin'),
      clarification: { needed: false, question: null },
    };
    const t0 = performance.now();
    let row: Record<string, unknown>;
    try {
      const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (!res.route) {
        row = { ...o, status: res.status, disclosures: res.disclosures, coords: [], classes: [] };
        console.log(`[${i + 1}/40] ${res.status} ${secs}s  ${o.label} (no route)`);
      } else {
        const geo = res.route.geometry;
        const coords = (geo.coordinates as Array<[number, number]>).map(
          ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)] as [number, number],
        );
        const idx = await urbanIndexFor(db, {
          west: o.lng - 0.65,
          south: o.lat - 0.65,
          east: o.lng + 0.65,
          north: o.lat + 0.65,
        }).catch(() => null);
        let classes: string[] = [];
        try {
          const trace = await traceRoadClasses(VALHALLA, geo);
          classes = classesAlong(coords, trace.edges, idx);
        } catch {
          classes = classesAlong(coords, [], idx);
        }
        const intro = idx ? urbanIntroM(idx, geo) : null;
        const introMin =
          intro === null || res.route.distance_m === 0
            ? null
            : Math.round(((intro / res.route.distance_m) * res.route.duration_s) / 60);
        row = {
          ...o,
          status: res.status,
          durationMin: Math.round(res.route.duration_s / 60),
          distanceKm: +(res.route.distance_m / 1000).toFixed(1),
          curviness: res.curviness === null ? null : +res.curviness.toFixed(2),
          arterialPct: res.arterialShare === null ? null : Math.round(res.arterialShare * 100),
          urbanPct: res.urbanShare === null ? null : Math.round(res.urbanShare * 100),
          introMin,
          countryScore: res.countryScore === null ? null : +res.countryScore.toFixed(2),
          uturns: res.route.maneuvers.filter((m) => m.type.startsWith('uturn')).length,
          selfOverlap: +selfOverlapRatio(geo).toFixed(2),
          loopiness: (() => {
            const l = loopiness(geo);
            return l === null ? null : +l.toFixed(2);
          })(),
          corridorDoubling: (() => {
            const c = corridorDoublingRatio(geo, { lat: o.lat, lng: o.lng });
            return c === null ? null : +c.toFixed(2);
          })(),
          disclosures: res.disclosures,
          coords,
          classes,
        };
        console.log(
          `[${i + 1}/40] ${res.status} ${secs}s  ${o.label}  urban=${row['urbanPct']}% art=${row['arterialPct']}% curv=${row['curviness']} intro=${introMin}min`,
        );
      }
    } catch (err) {
      row = {
        ...o,
        status: 'error',
        error: err instanceof Error ? err.message.slice(0, 100) : 'unknown',
        coords: [],
        classes: [],
      };
      console.log(`[${i + 1}/40] ERROR  ${o.label}`);
    }
    routes.push(row);
  }
  await db.end();
  const out = {
    anchor: { name: 'Mayfield Rd × Kennedy Rd', ...MK },
    brief,
    count: routes.length,
    routes,
  };
  writeFileSync(process.env['OUT'] ?? 'scratchpad/audit-v2.json', JSON.stringify(out));
  console.log('wrote', process.env['OUT'] ?? 'scratchpad/audit-v2.json');
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
