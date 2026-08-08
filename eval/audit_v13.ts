/**
 * audit-v13 — the 90-run device-truth audit (owner-commissioned, 2026-07-29).
 *
 * The owner tested the app and reported four things the eval harnesses do NOT
 * report: "random drives down a road then u turns back again", "clear better
 * paths it doesn't take", "the text box isn't filling in the options", and
 * "half our AI integration" feeling gone. Every eval in this repo says the
 * planner improved. He says it got worse. One of us is measuring the wrong
 * thing, and the whole point of this harness is to find out which.
 *
 * 90 runs, exactly as commissioned:
 *   60 loops  — 40 spread across the region + 10 Brampton + 10 Southfields
 *               (Mayfield & Kennedy)
 *   20 A→B    — town pairs across the boundary
 *   30 Discover — menus from random in-region origins
 *
 * WHAT THIS DOES THAT THE OTHER HARNESSES DO NOT
 *
 * 1. INDEPENDENT out-and-back detection. `retraceRunM` / `spurPositions` /
 *    `uturnCount` are the shipped detectors, and the shipped detectors say the
 *    routes are clean. The owner says they are not. So this harness ALSO
 *    measures out-and-back geometrically from first principles — a point that
 *    comes back within OAB_NEAR_M of an earlier point while travelling in
 *    roughly the opposite direction — and reports BOTH. If the independent
 *    number is large while the shipped ones read zero, the detectors are the
 *    bug, not the routes.
 * 2. It reports EVERY presented drive, not just the winner (BD-113: only 10 of
 *    152 presented drives measure clean, and the user sees all of them).
 * 3. It dumps geometry + a per-point road-class strip so the routes are
 *    inspectable by a human, not just scored.
 *
 * Run from repo root (Supabase + Valhalla up):
 *   TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx eval/audit_v13.ts
 */
import { writeFileSync } from 'node:fs';

import { Client } from 'pg';

import { discoverDrives } from '../backend/src/planner/discover';
import { driveGeometry, splitLoopLegs } from '../backend/src/planner/legs';
import { corridorDoublingRatio, loopiness, selfOverlapRatio } from '../backend/src/planner/overlap';
import { parseRules } from '../backend/src/planner/parse_rules';
import { classMixOf } from '../backend/src/planner/roadclass';
import { runPlanner } from '../backend/src/planner/run';
import { isUrbanContext, urbanIndexFor, type UrbanIndex } from '../backend/src/planner/urban';
import { traceRoadClasses } from '../backend/src/valhalla/trace';
import type { LatLng, LineString } from '../shared/src/types';

const DB = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const OUT = process.env['OUT'] ?? 'eval/reports/audit-v13.json';
/** Subset caps for fast before/after comparisons; unset = the full 90. */
const N_LOOPS = Number(process.env['AUDIT_LOOPS'] ?? 60);
const N_ATOB = Number(process.env['AUDIT_ATOB'] ?? 20);
const N_DISC = Number(process.env['AUDIT_DISC'] ?? 30);

/* ------------------------------------------------------------------ helpers */

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
/**
 * Seeded, so a run is reproducible. `AUDIT_SEED` draws a FRESH set of origins:
 * re-running the same seed re-tests routes the fixes were tuned against, while
 * a new seed is a holdout — places the planner changes have never seen.
 */
const rnd = mulberry32(Number(process.env['AUDIT_SEED'] ?? 20260729));
const jit = (span: number): number => (rnd() - 0.5) * 2 * span;

function hav(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la = (a[1] * Math.PI) / 180;
  const lb = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a: [number, number], b: [number, number]): number {
  const y = Math.sin(((b[0] - a[0]) * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180);
  const x =
    Math.cos((a[1] * Math.PI) / 180) * Math.sin((b[1] * Math.PI) / 180) -
    Math.sin((a[1] * Math.PI) / 180) *
      Math.cos((b[1] * Math.PI) / 180) *
      Math.cos(((b[0] - a[0]) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Corridor half-width for "this is the same piece of road again", metres. */
const OAB_NEAR_M = 30;
/** Heading difference above which two passes count as OPPOSITE, degrees. */
const OAB_OPPOSED_DEG = 135;
/** Ignore doublings shorter than this — a roundabout is not an out-and-back. */
const OAB_MIN_RUN_M = 250;

/**
 * INDEPENDENT out-and-back measure — deliberately NOT reusing the shipped
 * detectors, because the shipped detectors are on trial here.
 *
 * Walks the polyline and, for each segment, asks whether any EARLIER segment
 * passed within OAB_NEAR_M while heading in the opposite direction. Contiguous
 * hits are grouped into runs; runs shorter than OAB_MIN_RUN_M are dropped so
 * roundabouts and junction furniture do not register.
 *
 * Returns total doubled metres, the longest single run, and the runs' midpoints
 * so a human can go and look at them on the map.
 */
export function outAndBack(geometry: LineString): {
  totalM: number;
  longestM: number;
  runs: Array<{ atM: number; lengthM: number; point: [number, number] }>;
} {
  const c = geometry.coordinates as Array<[number, number]>;
  if (c.length < 4) return { totalM: 0, longestM: 0, runs: [] };

  const segLen: number[] = [];
  const segBear: number[] = [];
  const cum: number[] = [0];
  for (let i = 0; i < c.length - 1; i++) {
    const l = hav(c[i]!, c[i + 1]!);
    segLen.push(l);
    segBear.push(bearing(c[i]!, c[i + 1]!));
    cum.push(cum[i]! + l);
  }

  // Coarse spatial bucketing so this stays O(n) — ~0.0005 deg ≈ 55 m cells.
  const key = (p: [number, number]): string =>
    `${Math.round(p[0] / 0.0005)}:${Math.round(p[1] / 0.0005)}`;
  const grid = new Map<string, number[]>();
  const opposed: boolean[] = new Array(segLen.length).fill(false);

  for (let i = 0; i < segLen.length; i++) {
    const mid: [number, number] = [(c[i]![0] + c[i + 1]![0]) / 2, (c[i]![1] + c[i + 1]![1]) / 2];
    // look in the 3x3 neighbourhood of cells for earlier segments
    const gx = Math.round(mid[0] / 0.0005);
    const gy = Math.round(mid[1] / 0.0005);
    for (let dx = -1; dx <= 1 && !opposed[i]; dx++) {
      for (let dy = -1; dy <= 1 && !opposed[i]; dy++) {
        for (const j of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
          // must be a genuinely separate visit, not the neighbouring segment
          if (i - j < 4) continue;
          const jm: [number, number] = [
            (c[j]![0] + c[j + 1]![0]) / 2,
            (c[j]![1] + c[j + 1]![1]) / 2,
          ];
          if (hav(mid, jm) > OAB_NEAR_M) continue;
          const d = Math.abs(segBear[i]! - segBear[j]!);
          const diff = d > 180 ? 360 - d : d;
          if (diff >= OAB_OPPOSED_DEG) {
            opposed[i] = true;
            break;
          }
        }
      }
    }
    const k = key(mid);
    const arr = grid.get(k);
    if (arr) arr.push(i);
    else grid.set(k, [i]);
  }

  const runs: Array<{ atM: number; lengthM: number; point: [number, number] }> = [];
  let i = 0;
  let total = 0;
  let longest = 0;
  while (i < opposed.length) {
    if (!opposed[i]) {
      i++;
      continue;
    }
    let len = 0;
    const start = i;
    while (i < opposed.length && opposed[i]) {
      len += segLen[i]!;
      i++;
    }
    if (len >= OAB_MIN_RUN_M) {
      total += len;
      longest = Math.max(longest, len);
      const midIdx = Math.floor((start + i) / 2);
      runs.push({
        atM: Math.round(cum[start]!),
        lengthM: Math.round(len),
        point: [+c[midIdx]![0].toFixed(5), +c[midIdx]![1].toFixed(5)],
      });
    }
  }
  return { totalM: Math.round(total), longestM: Math.round(longest), runs };
}

function roadBucket(rc: string): 'A' | 'B' | 'R' | 'H' | 'O' {
  if (/^(motorway|trunk)/.test(rc) || /link$/.test(rc)) return 'H';
  switch (rc) {
    case 'primary':
    case 'secondary':
      return 'A';
    case 'tertiary':
    case 'unclassified':
      return 'B';
    case 'residential':
    case 'service':
    case 'service_other':
    case 'living_street':
      return 'R';
    default:
      return 'O';
  }
}

/** Per-point class strip (H highway · A main · B backroad · R residential ·
 *  U urban-context override) so the route is readable at a glance. */
function classesAlong(
  coords: Array<[number, number]>,
  edges: Array<{ roadClass: string; lengthM: number }>,
  idx: UrbanIndex | null,
): string {
  const n = coords.length;
  if (n < 2) return '';
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
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const urban = idx !== null && isUrbanContext(idx, mid[0], mid[1], b[0] - a[0], b[1] - a[1]);
    out.push(urban && rc !== 'H' ? 'U' : rc);
  }
  return out.join('');
}

/* ------------------------------------------------------------------ origins */

const REGION_TOWNS: Array<[string, number, number]> = [
  ['Hamilton', 43.2557, -79.8711],
  ['Guelph', 43.5448, -80.2482],
  ['St. Catharines', 43.1594, -79.2469],
  ['Barrie', 44.3894, -79.6903],
  ['Orillia', 44.6082, -79.4197],
  ['Collingwood', 44.5001, -80.2169],
  ['Owen Sound', 44.569, -80.9406],
  ['Peterborough', 44.3091, -78.3197],
  ['Cobourg', 43.9593, -78.1677],
  ['Uxbridge', 44.1091, -79.1204],
  ['Orangeville', 43.9199, -80.0943],
  ['Stratford', 43.3701, -80.9822],
  ['London', 42.9849, -81.2453],
  ['Woodstock', 43.1315, -80.757],
  ['Belfountain', 43.7935, -80.0088],
  ['Creemore', 44.3236, -80.1044],
  ['Erin', 43.7736, -80.0714],
  ['Grand Bend', 43.3167, -81.7539],
  ['Goderich', 43.7454, -81.7135],
  ['Port Perry', 44.1053, -78.9448],
];

interface LoopOrigin {
  label: string;
  lat: number;
  lng: number;
  cluster: 'region' | 'brampton' | 'southfields';
  brief: string;
}

/** The characters a real user actually taps, in the proportions he'd use. */
const LOOP_BRIEFS = [
  '90 minute twisty loop',
  '2 hour backroads loop',
  '1 hour loop',
  '90 minute scenic loop',
  '2 hour twisty loop',
];

const loopOrigins: LoopOrigin[] = [];
for (let i = 0; i < 40; i++) {
  const t = REGION_TOWNS[i % REGION_TOWNS.length]!;
  loopOrigins.push({
    label: `${t[0]}${i >= REGION_TOWNS.length ? ' (2)' : ''}`,
    lat: +(t[1] + jit(0.02)).toFixed(5),
    lng: +(t[2] + jit(0.02)).toFixed(5),
    cluster: 'region',
    brief: LOOP_BRIEFS[i % LOOP_BRIEFS.length]!,
  });
}
const BRAMPTON: LatLng = { lat: 43.7315, lng: -79.7624 };
for (let i = 0; i < 10; i++) {
  loopOrigins.push({
    label: `Brampton ${i + 1}`,
    lat: +(BRAMPTON.lat + jit(0.03)).toFixed(5),
    lng: +(BRAMPTON.lng + jit(0.03)).toFixed(5),
    cluster: 'brampton',
    brief: LOOP_BRIEFS[i % LOOP_BRIEFS.length]!,
  });
}
/** Southfields = Mayfield & Kennedy (the owner's own neighbourhood). */
const SOUTHFIELDS: LatLng = { lat: 43.7565, lng: -79.8335 };
for (let i = 0; i < 10; i++) {
  loopOrigins.push({
    label: `Southfields ${i + 1}`,
    lat: +(SOUTHFIELDS.lat + jit(0.012)).toFixed(5),
    lng: +(SOUTHFIELDS.lng + jit(0.012)).toFixed(5),
    cluster: 'southfields',
    brief: LOOP_BRIEFS[i % LOOP_BRIEFS.length]!,
  });
}

const ATOB_PAIRS: Array<[string, LatLng, string, LatLng]> = [
  ['Hamilton', { lat: 43.2557, lng: -79.8711 }, 'Guelph', { lat: 43.5448, lng: -80.2482 }],
  ['Brampton', BRAMPTON, 'Belfountain', { lat: 43.7935, lng: -80.0088 }],
  ['Southfields', SOUTHFIELDS, 'Hockley', { lat: 44.0378, lng: -79.9089 }],
  ['Guelph', { lat: 43.5448, lng: -80.2482 }, 'Erin', { lat: 43.7736, lng: -80.0714 }],
  ['Barrie', { lat: 44.3894, lng: -79.6903 }, 'Collingwood', { lat: 44.5001, lng: -80.2169 }],
  ['Cobourg', { lat: 43.9593, lng: -78.1677 }, 'Uxbridge', { lat: 44.1091, lng: -79.1204 }],
  ['Stratford', { lat: 43.3701, lng: -80.9822 }, 'Woodstock', { lat: 43.1315, lng: -80.757 }],
  ['Orangeville', { lat: 43.9199, lng: -80.0943 }, 'Creemore', { lat: 44.3236, lng: -80.1044 }],
  ['London', { lat: 42.9849, lng: -81.2453 }, 'Grand Bend', { lat: 43.3167, lng: -81.7539 }],
  ['Owen Sound', { lat: 44.569, lng: -80.9406 }, 'Collingwood', { lat: 44.5001, lng: -80.2169 }],
  ['Peterborough', { lat: 44.3091, lng: -78.3197 }, 'Port Perry', { lat: 44.1053, lng: -78.9448 }],
  ['St. Catharines', { lat: 43.1594, lng: -79.2469 }, 'Hamilton', { lat: 43.2557, lng: -79.8711 }],
  ['Milton', { lat: 43.5183, lng: -79.8774 }, 'Erin', { lat: 43.7736, lng: -80.0714 }],
  ['Newmarket', { lat: 44.0592, lng: -79.4613 }, 'Uxbridge', { lat: 44.1091, lng: -79.1204 }],
  ['Kitchener', { lat: 43.4516, lng: -80.4925 }, 'Stratford', { lat: 43.3701, lng: -80.9822 }],
  ['Caledon', { lat: 43.8668, lng: -79.8663 }, 'Orangeville', { lat: 43.9199, lng: -80.0943 }],
  ['Georgetown', { lat: 43.6478, lng: -79.9198 }, 'Guelph', { lat: 43.5448, lng: -80.2482 }],
  ['Goderich', { lat: 43.7454, lng: -81.7135 }, 'Stratford', { lat: 43.3701, lng: -80.9822 }],
  ['Orillia', { lat: 44.6082, lng: -79.4197 }, 'Barrie', { lat: 44.3894, lng: -79.6903 }],
  ['Woodstock', { lat: 43.1315, lng: -80.757 }, 'London', { lat: 42.9849, lng: -81.2453 }],
];
const ATOB_BRIEFS = ['backroads drive', 'twisty drive', 'scenic drive', 'drive'];

const discoverOrigins: Array<{ label: string; lat: number; lng: number }> = [];
for (let i = 0; i < 30; i++) {
  const t = REGION_TOWNS[i % REGION_TOWNS.length]!;
  discoverOrigins.push({
    label: `${t[0]}${i >= REGION_TOWNS.length ? ` (${Math.floor(i / REGION_TOWNS.length) + 1})` : ''}`,
    lat: +(t[1] + jit(0.05)).toFixed(5),
    lng: +(t[2] + jit(0.05)).toFixed(5),
  });
}

/* --------------------------------------------------------------------- run */

interface RouteRow {
  kind: 'loop' | 'atob' | 'discover';
  idx: number;
  label: string;
  cluster?: string;
  brief: string;
  status: string;
  durationMin: number | null;
  targetMin: number | null;
  distanceKm: number | null;
  /** road-class truth, % of traced metres */
  highwayPct: number | null;
  mainPct: number | null;
  backroadPct: number | null;
  hoodPct: number | null;
  curviness: number | null;
  urbanPct: number | null;
  loopiness: number | null;
  selfOverlap: number | null;
  corridorDoubling: number | null;
  turnsPer10min: number | null;
  /** SHIPPED detectors — what the planner believes about itself */
  uturnsShipped: number | null;
  /** INDEPENDENT detector — what the geometry actually shows */
  oabTotalM: number | null;
  oabLongestM: number | null;
  oabRuns: Array<{ atM: number; lengthM: number; point: [number, number] }>;
  disclosures: string[];
  defects: string[];
  coords: Array<[number, number]>;
  classes: string;
  /** R27 three-leg split: the DRIVE measured on its own, without the escape. */
  drivePct: number | null;
  /**
   * R29 — doubling measured on the DRIVE SPAN alone. Under drive-first the
   * commute legs may legitimately share a road (disclosed sameWayHome — the
   * owner's own rule is "same roads twice unless absolutely NECESSARY", and
   * reaching a distant loop is the necessary case); doubling INSIDE the drive
   * remains a real defect. Blob-OAB conflates the two, so both are reported.
   */
  driveOabLongestM: number | null;
  driveBackroadPct: number | null;
  driveMainPct: number | null;
  therePct: number | null;
  /** presented menu (loops): every drive the user is offered, not just #1 */
  menu?: Array<{ durationMin: number; distanceKm: number; oabLongestM: number }>;
  error?: string;
}

async function traceRow(
  geo: LineString,
  idx: UrbanIndex | null,
): Promise<{ classes: string; mix: ReturnType<typeof classMixOf> }> {
  try {
    const t = await traceRoadClasses(VALHALLA, geo);
    const coords = geo.coordinates as Array<[number, number]>;
    return { classes: classesAlong(coords, t.edges, idx), mix: classMixOf(t.edges) };
  } catch {
    return { classes: '', mix: null };
  }
}

function defectsOf(r: Partial<RouteRow>): string[] {
  const d: string[] = [];
  if ((r.highwayPct ?? 0) > 1) d.push('highway');
  if ((r.mainPct ?? 0) > (r.backroadPct ?? 0)) d.push('main_majority');
  if ((r.hoodPct ?? 0) > 5) d.push('neighbourhood');
  if ((r.oabLongestM ?? 0) >= OAB_MIN_RUN_M) d.push('out_and_back');
  if ((r.turnsPer10min ?? 0) > 5) d.push('turn_soup');
  if (r.kind === 'loop' && (r.loopiness ?? 1) < 0.15) d.push('not_a_loop');
  if (r.targetMin !== null && r.targetMin !== undefined && r.durationMin) {
    if (Math.abs(r.durationMin - r.targetMin) / r.targetMin > 0.25) d.push('wrong_length');
  }
  return d;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const rows: RouteRow[] = [];
  const t00 = performance.now();

  const urbanCache = new Map<string, UrbanIndex | null>();
  const urbanFor = async (o: LatLng): Promise<UrbanIndex | null> => {
    const k = `${o.lat.toFixed(1)}:${o.lng.toFixed(1)}`;
    if (urbanCache.has(k)) return urbanCache.get(k)!;
    const v = await urbanIndexFor(db, {
      west: o.lng - 0.7,
      south: o.lat - 0.7,
      east: o.lng + 0.7,
      north: o.lat + 0.7,
    }).catch(() => null);
    urbanCache.set(k, v);
    return v;
  };

  // ---------------------------------------------------------------- 60 loops
  for (let i = 0; i < Math.min(N_LOOPS, loopOrigins.length); i++) {
    const o = loopOrigins[i]!;
    const parsed = parseRules(`${o.brief} from ${o.label}`);
    const constraints = {
      ...parsed,
      origin: { lat: o.lat, lng: o.lng },
      shape: 'loop' as const,
      destination: null,
      missing: parsed.missing.filter((m) => m !== 'origin'),
      clarification: { needed: false, question: null },
    };
    const targetMin = parsed.duration_target_s ? Math.round(parsed.duration_target_s / 60) : null;
    let row: RouteRow;
    try {
      const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
      if (!res.route) {
        row = {
          kind: 'loop',
          idx: i,
          label: o.label,
          cluster: o.cluster,
          brief: o.brief,
          status: res.status,
          durationMin: null,
          targetMin,
          distanceKm: null,
          highwayPct: null,
          mainPct: null,
          backroadPct: null,
          hoodPct: null,
          curviness: null,
          urbanPct: null,
          loopiness: null,
          selfOverlap: null,
          corridorDoubling: null,
          turnsPer10min: null,
          uturnsShipped: null,
          oabTotalM: null,
          oabLongestM: null,
          oabRuns: [],
          drivePct: null,
          driveBackroadPct: null,
          driveMainPct: null,
          therePct: null,
          disclosures: res.disclosures,
          defects: ['no_route'],
          coords: [],
          classes: '',
        };
      } else {
        const geo = res.route.geometry;
        const idx = await urbanFor({ lat: o.lat, lng: o.lng });
        const { classes, mix } = await traceRow(geo, idx);
        const oab = outAndBack(geo);
        const mins = res.route.duration_s / 60;
        const coords = (geo.coordinates as Array<[number, number]>).map(
          ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)] as [number, number],
        );
        // R27 — measure the DRIVE, not the escape to it.
        const split = splitLoopLegs(geo, res.waypoints ?? []);
        let driveMix = null;
        let driveOabLongestM: number | null = null;
        if (split) {
          const dgeo = driveGeometry(geo, split);
          driveOabLongestM = outAndBack(dgeo).longestM;
          try {
            const dt = await traceRoadClasses(VALHALLA, dgeo);
            driveMix = classMixOf(dt.edges);
          } catch {
            driveMix = null;
          }
        }
        const menu = res.alternates.slice(0, 4).map((a) => ({
          durationMin: Math.round(a.route.duration_s / 60),
          distanceKm: +(a.route.distance_m / 1000).toFixed(1),
          oabLongestM: outAndBack(a.route.geometry).longestM,
        }));
        row = {
          kind: 'loop',
          idx: i,
          label: o.label,
          cluster: o.cluster,
          brief: o.brief,
          status: res.status,
          durationMin: Math.round(mins),
          targetMin,
          distanceKm: +(res.route.distance_m / 1000).toFixed(1),
          highwayPct: mix ? Math.round(mix.highwayShare * 100) : null,
          mainPct: mix ? Math.round(mix.mainShare * 100) : null,
          backroadPct: mix ? Math.round(mix.backroadShare * 100) : null,
          hoodPct: mix ? Math.round(mix.hoodShare * 100) : null,
          curviness: res.curviness === null ? null : +res.curviness.toFixed(2),
          urbanPct: res.urbanShare === null ? null : Math.round(res.urbanShare * 100),
          loopiness: (() => {
            const l = loopiness(geo);
            return l === null ? null : +l.toFixed(2);
          })(),
          selfOverlap: +selfOverlapRatio(geo).toFixed(2),
          corridorDoubling: (() => {
            const c = corridorDoublingRatio(geo, { lat: o.lat, lng: o.lng });
            return c === null ? null : +c.toFixed(2);
          })(),
          turnsPer10min: mins > 0 ? +((res.route.maneuvers.length / mins) * 10).toFixed(1) : null,
          uturnsShipped: res.route.maneuvers.filter((m) => m.type.startsWith('uturn')).length,
          oabTotalM: oab.totalM,
          oabLongestM: oab.longestM,
          oabRuns: oab.runs,
          drivePct: split ? split.drivePct : null,
          driveOabLongestM,
          therePct: split ? split.therePct : null,
          driveBackroadPct: driveMix ? Math.round(driveMix.backroadShare * 100) : null,
          driveMainPct: driveMix ? Math.round(driveMix.mainShare * 100) : null,
          disclosures: res.disclosures,
          defects: [],
          coords,
          classes,
          menu,
        };
        row.defects = defectsOf(row);
      }
    } catch (err) {
      row = {
        kind: 'loop',
        idx: i,
        label: o.label,
        cluster: o.cluster,
        brief: o.brief,
        status: 'error',
        durationMin: null,
        targetMin,
        distanceKm: null,
        highwayPct: null,
        mainPct: null,
        backroadPct: null,
        hoodPct: null,
        curviness: null,
        urbanPct: null,
        loopiness: null,
        selfOverlap: null,
        corridorDoubling: null,
        turnsPer10min: null,
        uturnsShipped: null,
        oabTotalM: null,
        oabLongestM: null,
        oabRuns: [],
        drivePct: null,
        driveBackroadPct: null,
        driveMainPct: null,
        therePct: null,
        disclosures: [],
        defects: ['error'],
        coords: [],
        classes: '',
        error: err instanceof Error ? err.message.slice(0, 160) : 'unknown',
      };
    }
    rows.push(row);
    console.log(
      `[loop ${i + 1}/${Math.min(N_LOOPS, loopOrigins.length)}] ${row.status.padEnd(11)} ${o.label.padEnd(18)} ` +
        `back=${row.backroadPct ?? '-'}% main=${row.mainPct ?? '-'}% hwy=${row.highwayPct ?? '-'}% ` +
        `OAB=${row.oabLongestM ?? '-'}m uturns=${row.uturnsShipped ?? '-'} ${row.defects.join(',')}`,
    );
  }

  // ------------------------------------------------------------------ 20 A→B
  for (let i = 0; i < Math.min(N_ATOB, ATOB_PAIRS.length); i++) {
    const [an, a, bn, b] = ATOB_PAIRS[i]!;
    const brief = `${ATOB_BRIEFS[i % ATOB_BRIEFS.length]} from ${an} to ${bn}`;
    const parsed = parseRules(brief);
    const constraints = {
      ...parsed,
      origin: a,
      destination: b,
      shape: 'a_to_b' as const,
      missing: parsed.missing.filter((m) => m !== 'origin' && m !== 'destination'),
      clarification: { needed: false, question: null },
    };
    let row: RouteRow;
    try {
      const res = await runPlanner(constraints, { db, valhallaUrl: VALHALLA });
      if (!res.route) {
        row = {
          kind: 'atob',
          idx: i,
          label: `${an}→${bn}`,
          brief,
          status: res.status,
          durationMin: null,
          targetMin: null,
          distanceKm: null,
          highwayPct: null,
          mainPct: null,
          backroadPct: null,
          hoodPct: null,
          curviness: null,
          urbanPct: null,
          loopiness: null,
          selfOverlap: null,
          corridorDoubling: null,
          turnsPer10min: null,
          uturnsShipped: null,
          oabTotalM: null,
          oabLongestM: null,
          oabRuns: [],
          drivePct: null,
          driveBackroadPct: null,
          driveMainPct: null,
          therePct: null,
          disclosures: res.disclosures,
          defects: ['no_route'],
          coords: [],
          classes: '',
        };
      } else {
        const geo = res.route.geometry;
        const idx = await urbanFor(a);
        const { classes, mix } = await traceRow(geo, idx);
        const oab = outAndBack(geo);
        const mins = res.route.duration_s / 60;
        row = {
          kind: 'atob',
          idx: i,
          label: `${an}→${bn}`,
          brief,
          status: res.status,
          durationMin: Math.round(mins),
          targetMin: null,
          distanceKm: +(res.route.distance_m / 1000).toFixed(1),
          highwayPct: mix ? Math.round(mix.highwayShare * 100) : null,
          mainPct: mix ? Math.round(mix.mainShare * 100) : null,
          backroadPct: mix ? Math.round(mix.backroadShare * 100) : null,
          hoodPct: mix ? Math.round(mix.hoodShare * 100) : null,
          curviness: res.curviness === null ? null : +res.curviness.toFixed(2),
          urbanPct: res.urbanShare === null ? null : Math.round(res.urbanShare * 100),
          loopiness: null,
          selfOverlap: +selfOverlapRatio(geo).toFixed(2),
          corridorDoubling: null,
          turnsPer10min: mins > 0 ? +((res.route.maneuvers.length / mins) * 10).toFixed(1) : null,
          uturnsShipped: res.route.maneuvers.filter((m) => m.type.startsWith('uturn')).length,
          oabTotalM: oab.totalM,
          oabLongestM: oab.longestM,
          oabRuns: oab.runs,
          drivePct: null,
          driveBackroadPct: null,
          driveMainPct: null,
          therePct: null,
          disclosures: res.disclosures,
          defects: [],
          coords: (geo.coordinates as Array<[number, number]>).map(
            ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)] as [number, number],
          ),
          classes,
        };
        row.defects = defectsOf(row);
      }
    } catch (err) {
      row = {
        kind: 'atob',
        idx: i,
        label: `${an}→${bn}`,
        brief,
        status: 'error',
        durationMin: null,
        targetMin: null,
        distanceKm: null,
        highwayPct: null,
        mainPct: null,
        backroadPct: null,
        hoodPct: null,
        curviness: null,
        urbanPct: null,
        loopiness: null,
        selfOverlap: null,
        corridorDoubling: null,
        turnsPer10min: null,
        uturnsShipped: null,
        oabTotalM: null,
        oabLongestM: null,
        oabRuns: [],
        drivePct: null,
        driveBackroadPct: null,
        driveMainPct: null,
        therePct: null,
        disclosures: [],
        defects: ['error'],
        coords: [],
        classes: '',
        error: err instanceof Error ? err.message.slice(0, 160) : 'unknown',
      };
    }
    rows.push(row);
    console.log(
      `[atob ${i + 1}/${Math.min(N_ATOB, ATOB_PAIRS.length)}] ${row.status.padEnd(11)} ${row.label.padEnd(24)} ` +
        `back=${row.backroadPct ?? '-'}% main=${row.mainPct ?? '-'}% hwy=${row.highwayPct ?? '-'}% ` +
        `OAB=${row.oabLongestM ?? '-'}m ${row.defects.join(',')}`,
    );
  }

  // -------------------------------------------------------------- 30 Discover
  const discoverMenus: Array<Record<string, unknown>> = [];
  for (let i = 0; i < Math.min(N_DISC, discoverOrigins.length); i++) {
    const o = discoverOrigins[i]!;
    try {
      const res = await discoverDrives({ lat: o.lat, lng: o.lng }, { db, valhallaUrl: VALHALLA });
      const drives: Array<Record<string, unknown>> = [];
      for (const d of res.drives.slice(0, 6)) {
        const geo = d.geometry as LineString | undefined;
        const oab = geo ? outAndBack(geo) : { totalM: 0, longestM: 0, runs: [] };
        let mix = null;
        let classes = '';
        if (geo) {
          const idx = await urbanFor({ lat: o.lat, lng: o.lng });
          const t = await traceRow(geo, idx);
          mix = t.mix;
          classes = t.classes;
        }
        drives.push({
          name: d.name ?? d.title ?? '(unnamed)',
          minutes: d.minutes ?? null,
          lengthM: d.length_m ?? null,
          highwayPct: mix ? Math.round(mix.highwayShare * 100) : null,
          mainPct: mix ? Math.round(mix.mainShare * 100) : null,
          backroadPct: mix ? Math.round(mix.backroadShare * 100) : null,
          hoodPct: mix ? Math.round(mix.hoodShare * 100) : null,
          oabLongestM: oab.longestM,
          coords: geo
            ? (geo.coordinates as Array<[number, number]>).map(
                ([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)] as [number, number],
              )
            : [],
          classes,
        });
      }
      discoverMenus.push({
        idx: i,
        label: o.label,
        origin: { lat: o.lat, lng: o.lng },
        count: res.drives.length,
        disclosures: res.disclosures,
        drives,
      });
      console.log(
        `[disc ${i + 1}/${Math.min(N_DISC, discoverOrigins.length)}] ${o.label.padEnd(18)} ${res.drives.length} drives · ` +
          `worstOAB=${Math.max(0, ...drives.map((d) => Number(d['oabLongestM'] ?? 0)))}m`,
      );
    } catch (err) {
      discoverMenus.push({
        idx: i,
        label: o.label,
        origin: { lat: o.lat, lng: o.lng },
        count: 0,
        disclosures: [],
        drives: [],
        error: err instanceof Error ? err.message.slice(0, 160) : 'unknown',
      });
      console.log(`[disc ${i + 1}/30] ${o.label} ERROR`);
    }
  }

  await db.end();

  const loops = rows.filter((r) => r.kind === 'loop');
  const atob = rows.filter((r) => r.kind === 'atob');
  const clean = (rs: RouteRow[]): number => rs.filter((r) => r.defects.length === 0).length;
  const mean = (xs: number[]): number =>
    xs.length === 0 ? 0 : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  const num = (rs: RouteRow[], f: (r: RouteRow) => number | null): number[] =>
    rs.map(f).filter((v): v is number => v !== null);

  const tally = new Map<string, number>();
  for (const r of rows) for (const d of r.defects) tally.set(d, (tally.get(d) ?? 0) + 1);

  const summary = {
    generatedAt: new Date().toISOString(),
    runtimeMin: Math.round((performance.now() - t00) / 60000),
    loops: {
      n: loops.length,
      clean: clean(loops),
      backroadPct: mean(num(loops, (r) => r.backroadPct)),
      mainPct: mean(num(loops, (r) => r.mainPct)),
      highwayPct: mean(num(loops, (r) => r.highwayPct)),
      hoodPct: mean(num(loops, (r) => r.hoodPct)),
      loopiness: mean(num(loops, (r) => r.loopiness)),
      turnsPer10min: mean(num(loops, (r) => r.turnsPer10min)),
      withOutAndBack: loops.filter((r) => (r.oabLongestM ?? 0) >= OAB_MIN_RUN_M).length,
      oabLongestMaxM: Math.max(0, ...num(loops, (r) => r.oabLongestM)),
      shippedUturnsTotal: num(loops, (r) => r.uturnsShipped).reduce((a, b) => a + b, 0),
    },
    atob: {
      n: atob.length,
      clean: clean(atob),
      backroadPct: mean(num(atob, (r) => r.backroadPct)),
      mainPct: mean(num(atob, (r) => r.mainPct)),
      withOutAndBack: atob.filter((r) => (r.oabLongestM ?? 0) >= OAB_MIN_RUN_M).length,
    },
    discover: {
      n: discoverMenus.length,
      totalDrives: discoverMenus.reduce((t, m) => t + (m['drives'] as unknown[]).length, 0),
      emptyMenus: discoverMenus.filter((m) => (m['drives'] as unknown[]).length === 0).length,
    },
    defectTally: [...tally.entries()].sort((a, b) => b[1] - a[1]),
  };

  writeFileSync(OUT, JSON.stringify({ summary, routes: rows, discover: discoverMenus }));
  console.log('\n=== audit-v13 summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${OUT}`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
