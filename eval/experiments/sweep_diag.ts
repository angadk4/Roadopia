// Diagnose exclude_polygons on the running engine: which holes/widths let a path exist.
import { edgeOverlapRatio } from '../../backend/src/planner/overlap';
import { decodePolyline } from '../../backend/src/valhalla/polyline';
const VALHALLA = 'http://127.0.0.1:8002';
interface DiagBody {
  error_code?: number;
  error?: string;
  trip: { legs: Array<{ shape: string }>; summary: { length: number; time: number } };
  warnings?: unknown;
}
type XY = [number, number];
const LAT_M = 111_320;
function hav(a: XY, b: XY): number {
  const R = 6371000,
    rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad,
    dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function rings(
  coords: XY[],
  wM: number,
  skipStartM: number,
  skipEndM: number,
  stepM: number,
): XY[][] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1]! + hav(coords[i - 1]!, coords[i]!));
  const total = cum[cum.length - 1]!;
  const pts: XY[] = [];
  let next = skipStartM;
  for (let i = 0; i < coords.length; i++) {
    if (cum[i]! > total - skipEndM) break;
    if (cum[i]! >= next) {
      pts.push(coords[i]!);
      next = cum[i]! + stepM;
    }
  }
  const out: XY[][] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!;
    const kx = LAT_M * Math.cos((a[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx,
      dy = (b[1] - a[1]) * LAT_M,
      len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * wM,
      ny = (dx / len) * wM;
    const P = (x: number, y: number): XY => [x / kx, y / LAT_M];
    const ax = a[0] * kx,
      ay = a[1] * LAT_M,
      bx = b[0] * kx,
      by = b[1] * LAT_M;
    out.push([
      P(ax + nx, ay + ny),
      P(bx + nx, by + ny),
      P(bx - nx, by - ny),
      P(ax - nx, ay - ny),
      P(ax + nx, ay + ny),
    ]);
  }
  return out;
}
async function route(points: XY[], exclude: XY[][], extra: Record<string, unknown> = {}) {
  const payload = {
    locations: points.map((p) => ({ lat: p[1], lon: p[0], type: 'break', ...extra })),
    costing: 'auto',
    costing_options: { auto: { use_highways: 0.2, use_living_streets: 0 } },
    ...(exclude.length ? { exclude_polygons: exclude } : {}),
  };
  const t = performance.now();
  const res = await fetch(`${VALHALLA}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as DiagBody;
  const ms = Math.round(performance.now() - t);
  if (!res.ok) return { ok: false as const, ms, err: `${body.error_code} ${body.error}` };
  const coords: XY[] = [];
  for (const leg of body.trip.legs)
    for (const p of decodePolyline(leg.shape) as XY[]) coords.push(p);
  return {
    ok: true as const,
    ms,
    coords,
    km: body.trip.summary.length,
    min: body.trip.summary.time / 60,
    warnings: body.warnings,
  };
}
async function main() {
  const a: XY = [-79.8827, 43.5312],
    b: XY = [-80.02, 43.47];
  const base = await route([a, b], []);
  if (!base.ok) throw new Error(base.err);
  console.log(`base ${base.km.toFixed(1)} km ${base.min.toFixed(0)} min ${base.ms} ms`);
  const total = base.coords.reduce((s, p, i) => (i ? s + hav(base.coords[i - 1]!, p) : 0), 0);
  const cases: Array<[string, XY[][]]> = [
    ['middle third only, w50', rings(base.coords, 50, total / 3, total / 3, 150)],
    ['all, holes 2km, w50', rings(base.coords, 50, 2000, 2000, 150)],
    ['all, holes 3km, w50', rings(base.coords, 50, 3000, 3000, 150)],
    ['all, holes 2km, w25', rings(base.coords, 25, 2000, 2000, 150)],
    ['all, holes 800, w50, coarse 400m', rings(base.coords, 50, 800, 800, 400)],
    [
      'one big rectangle around the middle 5 km',
      rings(base.coords, 50, total / 2 - 2500, total / 2 - 2500, 5000),
    ],
  ];
  for (const [label, ex] of cases) {
    const r = await route([a, b], ex);
    if (!r.ok) {
      console.log(`${label}: ${ex.length} rings → FAIL ${r.err} (${r.ms} ms)`);
      continue;
    }
    const ov = edgeOverlapRatio(
      { type: 'LineString', coordinates: r.coords },
      { type: 'LineString', coordinates: base.coords },
    );
    console.log(
      `${label}: ${ex.length} rings → ${r.km.toFixed(1)} km ${r.min.toFixed(0)} min, overlap ${ov.toFixed(2)} (${r.ms} ms) ${JSON.stringify(r.warnings ?? '')}`,
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
