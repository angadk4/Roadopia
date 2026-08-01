/**
 * R25-U13 — the OFFLINE drive-core sweep (ACP-001). Grid the region, generate
 * loop + ribbon core candidates per cell with the EXISTING machinery, trace
 * every candidate, accept only what clears core_bars.ts, dedup, keep the best
 * few per cell, and write a deterministic JSONL artifact for the loader.
 *
 * RUNS ON THE DEV BOX ONLY (local Valhalla + Supabase) — a full sweep is tens
 * of thousands of engine calls; the 2-vCPU VPS also serves live traffic
 * (ACP-001 §3). Refresh cadence: per corpus rebuild, never nightly.
 *
 * Determinism (resume/verify): no RNG, no Date.now() in ids or content;
 * collect-then-sort before writing; the artifact hash must be byte-identical
 * across two runs (asserted by running twice — see VERIFY in the ACP).
 *
 * Why this can succeed where re-ranking was refused 4×: offline we do not
 * re-price — we GENERATE MANY and REJECT what measures badly. Selection under
 * a hard measured bar is a different mechanism (audit-v11's structural
 * lesson), and the per-bar rejection histogram below is the pre-registered
 * kill-condition instrument: <3 passing cores in >40 % of live cells → name
 * the binding bar, don't quietly relax it.
 *
 * Run (from eval/):
 *   TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx build_drive_cores.ts
 * Env:
 *   CELLS="lng,lat;lng,lat"  sweep only these cell centres (smoke/dev)
 *   GENERATOR_VERSION=r25-1  build tag written to every row (default r25-dev)
 *   OUT=path.jsonl           artifact path (default eval/out/drive_cores.jsonl)
 */

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Client } from 'pg';

import { generateLoopCandidates, traversalSpanOf } from '../backend/src/planner/candidates';
import { mergeRoadPieces } from '../backend/src/planner/chain';
import {
  CORE_RIBBON_ENDPOINT_MIN_M,
  judgeCore,
  type CoreMetrics,
} from '../backend/src/planner/core_bars';
import { BACKROADS } from '../backend/src/planner/costing';
import { measureCurvature } from '../backend/src/planner/curvature';
import { assembleLoopWithRepair } from '../backend/src/planner/loop';
import {
  corridorDoublingRatio,
  edgeOverlapRatio,
  loopiness,
  microloopEvents,
  selfOverlapRatio,
  spurPositions,
} from '../backend/src/planner/overlap';
import { retrieveCandidates } from '../backend/src/planner/retrieve';
import { classMixOf, tracedHighwayM, turnsPer10minOf } from '../backend/src/planner/roadclass';
import type { Scope } from '../backend/src/planner/scope';
import { uturnCount } from '../backend/src/planner/score';
import { routeThrough } from '../backend/src/valhalla/route';
import { traceRoadClasses } from '../backend/src/valhalla/trace';
import { haversineMeters } from '../data/curvature/geometry';
import type { LatLng, LineString, RouteThroughOutput } from '../shared/src/types';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const GENERATOR_VERSION = process.env['GENERATOR_VERSION'] ?? 'r25-dev';
const OUT = process.env['OUT'] ?? join('out', 'drive_cores.jsonl');

/** ~8 km sweep cells (ACP-001). */
export const CELL_SIZE_M = 8000;
/** Retrieval window around a cell centre — cores may run past the cell edge. */
const CELL_SCOPE_HALF_M = Number(process.env['CELL_SCOPE_HALF_M'] ?? 12_000);
/** Per-cell keeps (ACP: best 2-4). */
const CELL_KEEP_MAX = 4;
/**
 * Candidate loop pseudo-origins per cell (top merged-road endpoints).
 *
 * R26-D5: the index's whole thesis is GENERATE MANY, keep only what measures
 * clean — but measured over 1 177 cells it generates 16 candidates per cell and
 * keeps 0.4. 31 % of slots never assemble and the rest fail ~1.5 quality bars
 * EACH, so candidates are not marginal-by-one-bar (which is exactly why
 * relaxing any single bar unlocked almost nothing — BD-112). Widening the
 * generator is the lever the diagnosis points at, not a looser bar.
 */
const LOOP_ORIGINS_PER_CELL = Number(process.env['LOOP_ORIGINS_PER_CELL'] ?? 2);
/** Loop candidates assembled per pseudo-origin (budget guard). */
const LOOP_CANDIDATES_PER_ORIGIN = Number(process.env['LOOP_CANDIDATES_PER_ORIGIN'] ?? 6);
/** Ribbon candidates judged per cell. */
const RIBBONS_PER_CELL = 4;
/** Dedup: a kept core may share at most this fraction of another's edges. */
const CORE_DEDUP_OVERLAP_MAX = 0.5;
/** Loop core duration target (s) — a 60-90 min DRIVE core. */
const LOOP_CORE_DURATION_S = 5400;

interface CoreRow {
  id: string;
  kind: 'loop' | 'ribbon';
  name: string;
  cell: string;
  generator_version: string;
  bar_profile: 'strict';
  geometry: LineString;
  geom_simplified: LineString;
  bbox: [number, number, number, number]; // minLng,minLat,maxLng,maxLat
  entry: LatLng;
  exit: LatLng;
  distance_m: number;
  duration_s: number;
  curviness: number;
  backroad_share: number;
  main_share: number;
  highway_share: number;
  hood_share: number;
  turns_per_10min: number;
  loopiness: number | null;
}

/** Square scope around a centre — the offline stand-in for the isochrone
 *  (deterministic, zero engine calls; generosity is fine, the bar decides). */
function squareScope(centre: LatLng, halfM: number): Scope {
  const dLat = halfM / 111_320;
  const dLng = halfM / (111_320 * Math.cos((centre.lat * Math.PI) / 180));
  const ring: LatLng[] = [
    { lat: centre.lat - dLat, lng: centre.lng - dLng },
    { lat: centre.lat - dLat, lng: centre.lng + dLng },
    { lat: centre.lat + dLat, lng: centre.lng + dLng },
    { lat: centre.lat + dLat, lng: centre.lng - dLng },
    { lat: centre.lat - dLat, lng: centre.lng - dLng },
  ];
  return { rings: [ring], tauOutS: 0, shape: 'loop' };
}

/** Douglas-Peucker-free cheap simplify: keep every Nth point + endpoints at
 *  roughly the target spacing (served geometry; full geometry stays in-row). */
function simplify(geometry: LineString, spacingM: number): LineString {
  const c = geometry.coordinates as Array<[number, number]>;
  if (c.length <= 2) return geometry;
  const out: Array<[number, number]> = [c[0]!];
  let acc = 0;
  for (let i = 1; i < c.length - 1; i++) {
    acc += haversineMeters(c[i - 1]!, c[i]!);
    if (acc >= spacingM) {
      // 5-dp rounding halves the payload on its own (ACP-001 §9)
      out.push([Math.round(c[i]![0] * 1e5) / 1e5, Math.round(c[i]![1] * 1e5) / 1e5]);
      acc = 0;
    }
  }
  out.push(c[c.length - 1]!);
  return { type: 'LineString', coordinates: out };
}

function bboxOf(geometry: LineString): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of geometry.coordinates as Array<[number, number]>) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Interior through-points so a ribbon pre-build FOLLOWS the corpus road. */
function interiorPoints(geometry: LineString, n: number): Array<[number, number]> {
  const c = geometry.coordinates as Array<[number, number]>;
  if (c.length <= 2) return [];
  const out: Array<[number, number]> = [];
  for (let k = 1; k <= n; k++) {
    const idx = Math.round((k / (n + 1)) * (c.length - 1));
    out.push(c[Math.min(c.length - 2, Math.max(1, idx))]!);
  }
  return out;
}

async function measureRoute(
  route: RouteThroughOutput,
  kind: 'loop' | 'ribbon',
  origin: LatLng,
): Promise<{ metrics: CoreMetrics; mixTraceOk: boolean }> {
  let mix = null;
  let highwayM = 0;
  let mixTraceOk = false;
  try {
    const traced = await traceRoadClasses(VALHALLA, route.geometry);
    mix = classMixOf(traced.edges);
    highwayM = tracedHighwayM(traced.edges);
    mixTraceOk = mix !== null;
  } catch {
    /* untraced → judgeCore fails it ('untraced') */
  }
  const entry = { lat: route.geometry.coordinates[0]![1], lng: route.geometry.coordinates[0]![0] };
  const last = route.geometry.coordinates[route.geometry.coordinates.length - 1]!;
  return {
    mixTraceOk,
    metrics: {
      kind,
      mix,
      highwayM,
      turnsPer10min: turnsPer10minOf(route),
      uturns: uturnCount(route),
      spursWide: spurPositions(route.geometry, origin).length,
      microloops: microloopEvents(route.geometry, origin),
      loopiness: kind === 'loop' ? loopiness(route.geometry) : null,
      corridorDoubling: kind === 'ribbon' ? corridorDoublingRatio(route.geometry, entry) : null,
      endpointSeparationM:
        kind === 'ribbon' ? haversineMeters([entry.lng, entry.lat], [last[0], last[1]]) : null,
      selfOverlap: kind === 'ribbon' ? selfOverlapRatio(route.geometry) : null,
    },
  };
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // cells: env-listed centres (smoke), else derive from the corpus extent
  let centres: LatLng[];
  if (process.env['CELLS']) {
    centres = process.env['CELLS'].split(';').map((s) => {
      const [lng, lat] = s.split(',').map(Number);
      return { lat: lat!, lng: lng! };
    });
  } else {
    const ext = await db.query<{ minlng: number; minlat: number; maxlng: number; maxlat: number }>(
      `select st_xmin(e) as minlng, st_ymin(e) as minlat,
              st_xmax(e) as maxlng, st_ymax(e) as maxlat
       from (select st_extent(geom::geometry) as e from curvy_segments) x`,
    );
    const { minlng, minlat, maxlng, maxlat } = ext.rows[0]!;
    centres = [];
    const dLat = CELL_SIZE_M / 111_320;
    for (let lat = minlat + dLat / 2; lat < maxlat; lat += dLat) {
      const dLng = CELL_SIZE_M / (111_320 * Math.cos((lat * Math.PI) / 180));
      for (let lng = minlng + dLng / 2; lng < maxlng; lng += dLng) {
        centres.push({ lat, lng });
      }
    }
  }
  // R26-D1 full-sweep support. The derive-from-extent grid is 1 528 cells over a
  // bbox that includes Lake Ontario, Lake Huron and land outside the extract, so
  // most cells hold no corpus at all. One presence query replaces 1 528 retrieval
  // round-trips. SAFETY: a bare bbox-intersects test is strictly BROADER than any
  // filtered retrieval (no curviness floor, no urban cap), so a cell it calls dead
  // cannot be live for `retrieveCandidates` — this can only skip work, never
  // coverage. `liveCells` is still counted in the loop from real retrieval, so the
  // kill-condition denominator is unchanged.
  if (!process.env['CELLS']) {
    const before = centres.length;
    // ANISOTROPIC on purpose. `squareScope` derives its longitude half-width as
    // halfM / (111 320 · cos(lat)), so the real cell is WIDER in longitude than
    // in latitude — at 44 °N, 0.150 ° vs 0.108 °. Expanding equally in both axes
    // would make the probe NARROWER than the scope it is standing in for and
    // could drop a cell whose only corpus sits in that longitude margin, quietly
    // shrinking coverage and the kill-condition denominator. So the longitude
    // half-width is taken at the region's HIGHEST latitude (smallest cos, widest
    // degree span), which makes the probe a superset of every cell's true scope
    // and keeps "dead here ⇒ certainly dead for retrieval" actually true.
    const dLat = CELL_SCOPE_HALF_M / 111_320;
    const maxAbsLat = Math.max(...centres.map((c) => Math.abs(c.lat))) + dLat;
    const maxDLng = CELL_SCOPE_HALF_M / (111_320 * Math.cos((maxAbsLat * Math.PI) / 180));
    // Coordinates go over as two double precision[] and the point is built in
    // SQL. Binding an EWKT string array as `geometry[]` fails to parse in the
    // array literal (Postgres ReadArrayToken) — measured, not assumed.
    const probe = await db.query<{ i: number }>(
      `select i from (
         select ordinality - 1 as i, st_setsrid(st_point(p.lng, p.lat), 4326) as pt
         from unnest($1::double precision[], $2::double precision[])
              with ordinality as p(lng, lat, ordinality)
       ) c
       where exists (
         select 1 from curvy_segments cs
         where cs.geom && st_expand(c.pt, $3::double precision, $4::double precision)
       )`,
      [centres.map((c) => c.lng), centres.map((c) => c.lat), maxDLng, dLat],
    );
    const liveIdx = new Set(probe.rows.map((r) => Number(r.i)));
    centres = centres.filter((_, i) => liveIdx.has(i));
    console.log(
      `live-cell prefilter: ${before} grid cells → ${centres.length} with corpus present`,
    );
  }

  // Resume: rows already computed are replayed from the checkpoint and their
  // cells skipped. The final artifact is still collect-then-SORT over every row,
  // so a resumed run produces the byte-identical artifact a single run would.
  const CKPT = `${OUT}.ckpt.jsonl`;
  interface Ckpt {
    cell: string;
    rows: CoreRow[];
    filled: boolean;
    hist: Record<string, number>;
    /** Guards against resuming a checkpoint built by a different generator or
     *  over a different cell set — silently blending those would produce an
     *  artifact that matches no single configuration. */
    stamp: string;
  }
  const STAMP = `${GENERATOR_VERSION}|${centres.length}|${CELL_SIZE_M}|${CELL_SCOPE_HALF_M}|${CELL_KEEP_MAX}`;
  const resumed: CoreRow[] = [];
  const doneCells = new Set<string>();
  // Every checkpoint record is by construction a LIVE cell: the two `continue`
  // paths (out-of-corpus, zero segments) both return before a record is written.
  // So resuming can rebuild liveCells exactly, and filled/hist are carried
  // explicitly — without this a resumed run would report its kill condition over
  // only the newly-processed cells and silently lose every earlier rejection.
  let resumedLive = 0;
  let resumedFilled = 0;
  const resumedHist = new Map<string, number>();
  if (process.env['RESUME'] === 'on' && existsSync(CKPT)) {
    for (const line of readFileSync(CKPT, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      let rec: Ckpt;
      try {
        rec = JSON.parse(line) as Ckpt;
      } catch {
        // A run killed mid-append leaves a TORN final line. Skipping it costs
        // one cell of work; aborting the resume (or deleting the checkpoint to
        // get past it) costs the whole run.
        console.log('resume: skipping a torn checkpoint line (interrupted append)');
        continue;
      }
      if (rec.stamp !== STAMP) {
        throw new Error(
          `checkpoint stamp mismatch: ${rec.stamp} != ${STAMP}. Refusing to blend ` +
            `a checkpoint from a different generator/cell-set. Delete ${CKPT} to start fresh.`,
        );
      }
      doneCells.add(rec.cell);
      resumed.push(...rec.rows);
      resumedLive++;
      if (rec.filled) resumedFilled++;
      for (const [k, v] of Object.entries(rec.hist)) {
        resumedHist.set(k, (resumedHist.get(k) ?? 0) + v);
      }
    }
    console.log(
      `resume: ${doneCells.size} cells already done, ${resumed.length} cores replayed, ` +
        `${resumedFilled} previously filled`,
    );
  } else if (existsSync(CKPT)) {
    writeFileSync(CKPT, ''); // fresh run — never silently blend with a stale checkpoint
  }
  console.log(`sweep: ${centres.length} cells, generator_version=${GENERATOR_VERSION}`);

  const rows: CoreRow[] = [...resumed];
  const histogram = new Map<string, number>(resumedHist); // per-bar rejection counts
  const bump = (f: string): void => void histogram.set(f, (histogram.get(f) ?? 0) + 1);
  const errorCells: Array<{ cell: string; error: string }> = [];
  let liveCells = resumedLive;
  let filledCells = resumedFilled;

  for (let ci = 0; ci < centres.length; ci++) {
    const centre = centres[ci]!;
    const cellId = `c${centre.lng.toFixed(3)}_${centre.lat.toFixed(3)}`;
    if (doneCells.has(cellId)) continue;
    let retrieved;
    try {
      retrieved = await retrieveCandidates(db, squareScope(centre, CELL_SCOPE_HALF_M), {
        segmentLimit: 3000,
      });
    } catch (err: unknown) {
      // R26 audit finding: this used to swallow EVERY failure as "out-of-corpus
      // cell (lake, edge)". A transient DB error, a pool timeout or a bad query
      // therefore silently became a dead cell — corrupting the kill condition's
      // own denominator with no trace, in a run long enough for such errors to
      // be near-certain. A genuinely dead cell is now impossible to reach here:
      // the live-cell prefilter already proved corpus is present, so anything
      // thrown at this point IS an error and is counted and reported.
      errorCells.push({ cell: cellId, error: err instanceof Error ? err.message : String(err) });
      console.log(`[${ci + 1}/${centres.length}] ${cellId}: ERROR — ${errorCells.at(-1)!.error}`);
      continue;
    }
    if (retrieved.segments.length === 0) continue;
    liveCells++;
    const histAtCellStart = new Map(histogram);

    const merged = mergeRoadPieces(retrieved.segments)
      .filter((m) => m.name !== '')
      .sort(
        (a, b) =>
          Math.min(b.curviness, 3) * b.lengthM - Math.min(a.curviness, 3) * a.lengthM ||
          a.id.localeCompare(b.id),
      );

    const cellKept: Array<{ row: CoreRow; quality: number }> = [];
    const overlapsKept = (g: LineString): boolean =>
      cellKept.some((k) => edgeOverlapRatio(g, k.row.geometry) > CORE_DEDUP_OVERLAP_MAX);

    // --- ribbons: long whole roads, routed along their own geometry ---
    for (const road of merged
      .filter((m) => m.lengthM >= CORE_RIBBON_ENDPOINT_MIN_M)
      .slice(0, RIBBONS_PER_CELL)) {
      const [a, b] = traversalSpanOf(road);
      try {
        const route = await routeThrough(VALHALLA, {
          waypoints: [
            [a.lng, a.lat],
            ...interiorPoints(road.geometry, Math.min(8, Math.round(road.lengthM / 2500))),
            [b.lng, b.lat],
          ],
          costingOptions: { ...BACKROADS.options, exclude_highways: true },
          middleType: 'through',
        });
        const { metrics } = await measureRoute(route, 'ribbon', a);
        const verdict = judgeCore(metrics);
        if (!verdict.pass) {
          verdict.failures.forEach(bump);
          continue;
        }
        if (overlapsKept(route.geometry)) continue;
        const mix = metrics.mix!;
        const curv = measureCurvature(route.geometry).curviness;
        cellKept.push({
          quality: mix.backroadShare * Math.min(curv, 3),
          row: {
            id: `${cellId}:ribbon:${road.id}`,
            kind: 'ribbon',
            name: road.name,
            cell: cellId,
            generator_version: GENERATOR_VERSION,
            bar_profile: 'strict',
            geometry: route.geometry,
            geom_simplified: simplify(route.geometry, 10),
            bbox: bboxOf(route.geometry),
            entry: a,
            exit: b,
            distance_m: route.distance_m,
            duration_s: Math.round(route.duration_s),
            curviness: curv,
            backroad_share: mix.backroadShare,
            main_share: mix.mainShare,
            highway_share: mix.highwayShare,
            hood_share: mix.hoodShare,
            turns_per_10min: metrics.turnsPer10min ?? 0,
            loopiness: null,
          },
        });
      } catch {
        bump('route_failed');
      }
    }

    // --- loops: pseudo-origins ON the best roads (the core IS the drive) ---
    const origins = merged.slice(0, LOOP_ORIGINS_PER_CELL).map((m) => traversalSpanOf(m)[0]);
    for (let oi = 0; oi < origins.length; oi++) {
      const origin = origins[oi]!;
      const candidates = generateLoopCandidates(origin, retrieved.segments, [], {
        durationS: LOOP_CORE_DURATION_S,
        avgSpeedKmh: BACKROADS.sizingSpeedNoHighwayKmh,
        idPrefix: `${cellId}-o${oi}-`,
      }).slice(0, LOOP_CANDIDATES_PER_ORIGIN);
      for (const cand of candidates) {
        try {
          const a = await assembleLoopWithRepair(
            VALHALLA,
            origin,
            cand,
            { ...BACKROADS.options, exclude_highways: true },
            { avoidHighways: true, repairSegments: retrieved.segments },
          );
          if (!a.accepted) {
            bump('assembly_rejected');
            continue;
          }
          const { metrics } = await measureRoute(a.route, 'loop', origin);
          const verdict = judgeCore(metrics);
          if (!verdict.pass) {
            verdict.failures.forEach(bump);
            continue;
          }
          if (overlapsKept(a.route.geometry)) continue;
          const mix = metrics.mix!;
          const curv = measureCurvature(a.route.geometry).curviness;
          cellKept.push({
            quality: mix.backroadShare * Math.min(curv, 3),
            row: {
              id: `${cellId}:loop:${cand.id}`,
              kind: 'loop',
              name: merged[0]?.name ?? cellId,
              cell: cellId,
              generator_version: GENERATOR_VERSION,
              bar_profile: 'strict',
              geometry: a.route.geometry,
              geom_simplified: simplify(a.route.geometry, 10),
              bbox: bboxOf(a.route.geometry),
              entry: origin,
              exit: origin,
              distance_m: a.route.distance_m,
              duration_s: Math.round(a.route.duration_s),
              curviness: curv,
              backroad_share: mix.backroadShare,
              main_share: mix.mainShare,
              highway_share: mix.highwayShare,
              hood_share: mix.hoodShare,
              turns_per_10min: metrics.turnsPer10min ?? 0,
              loopiness: metrics.loopiness,
            },
          });
        } catch {
          bump('route_failed');
        }
      }
    }

    cellKept.sort((x, y) => y.quality - x.quality || x.row.id.localeCompare(y.row.id));
    const kept = cellKept.slice(0, CELL_KEEP_MAX).map((k) => k.row);
    rows.push(...kept);
    if (kept.length >= 3) filledCells++;
    const histDelta: Record<string, number> = {};
    for (const [k, v] of histogram) {
      const d = v - (histAtCellStart.get(k) ?? 0);
      if (d !== 0) histDelta[k] = d;
    }
    mkdirSync(dirname(CKPT), { recursive: true });
    appendFileSync(
      CKPT,
      `${JSON.stringify({ cell: cellId, rows: kept, filled: kept.length >= 3, hist: histDelta } satisfies Ckpt)}\n`,
    );
    console.log(
      `[${ci + 1}/${centres.length}] ${cellId}: segments ${retrieved.segments.length}, kept ${kept.length}`,
    );
  }
  await db.end();

  rows.sort((a, b) => a.id.localeCompare(b.id));
  const artifact = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, artifact);
  const hash = createHash('sha256').update(artifact).digest('hex').slice(0, 16);

  console.log('\n-- drive-core sweep --');
  console.log(
    `cores kept: ${rows.length} (${rows.filter((r) => r.kind === 'loop').length} loops, ${rows.filter((r) => r.kind === 'ribbon').length} ribbons)`,
  );
  console.log(`live cells: ${liveCells}; cells with ≥3 cores: ${filledCells}`);
  console.log(
    `per-bar rejection histogram: ${[...histogram.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k}×${v}`)
      .join(' · ')}`,
  );
  // ACP-001 pre-registered kill condition — REPORTED, never auto-relaxed
  if (liveCells > 0 && filledCells / liveCells < 0.6) {
    console.log(
      `⚠️ KILL CONDITION: <3 cores in ${liveCells - filledCells}/${liveCells} live cells (>40 %) — ` +
        'the binding bar above must be named and relaxed per-cell (bar_profile=cell_relaxed), not silently.',
    );
  }
  if (liveCells > 0 && filledCells / liveCells > 0.9) {
    console.log('note: >90 % of cells filled — the bar may be too loose; raise before U14 ships.');
  }
  if (errorCells.length > 0) {
    console.log(
      `⚠️ ${errorCells.length} cells ERRORED and are NOT counted as live or dead — ` +
        `the kill-condition denominator excludes them: ${errorCells.map((e) => e.cell).join(', ')}`,
    );
  }
  console.log(`artifact: ${OUT}`);
  console.log(`artifact hash: ${hash} (must be byte-identical across two runs)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
