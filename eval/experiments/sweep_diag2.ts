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
function simplify(coords: XY[], tolM: number): XY[] {
  if (coords.length < 3) return coords.slice();
  const lat0 = coords[0]![1];
  const kx = LAT_M * Math.cos((lat0 * Math.PI) / 180);
  const pts = coords.map((c) => [c[0] * kx, c[1] * LAT_M] as [number, number]);
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = pts[s]!,
      b = pts[e]!;
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    let worst = -1,
      worstD = tolM;
    for (let i = s + 1; i < e; i++) {
      const p = pts[i]!;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([s, worst], [worst, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}
function rings(
  coords: XY[],
  wM: number,
  skipStartM: number,
  skipEndM: number,
  tol: number,
): XY[][] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1]! + hav(coords[i - 1]!, coords[i]!));
  const total = cum[cum.length - 1]!;
  const kept = coords.filter((_, i) => cum[i]! >= skipStartM && cum[i]! <= total - skipEndM);
  const pts = simplify(kept, tol);
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
async function route(points: XY[], exclude: XY[][]) {
  const payload = {
    locations: points.map((p) => ({ lat: p[1], lon: p[0], type: 'break' })),
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
  };
}
async function main() {
  const pairs: Array<[string, XY, XY]> = [
    ['home→Campbellville', [-79.8827, 43.5312], [-80.02, 43.47]],
    ['home→north (Speyside)', [-79.8827, 43.5312], [-79.95, 43.62]],
    ['Southfields→Hockley', [-79.8335, 43.7565], [-79.95, 43.98]],
  ];
  for (const [label, a, b] of pairs) {
    const base = await route([a, b], []);
    if (!base.ok) {
      console.log(label, 'base fail');
      continue;
    }
    console.log(`${label}: base ${base.km.toFixed(1)} km ${base.min.toFixed(0)} min`);
    for (const hole of [500, 800, 1000, 1200, 1500, 2000]) {
      for (const w of [50]) {
        const ex = rings(base.coords, w, hole, hole, 20);
        const r = await route([a, b], ex);
        if (!r.ok) {
          console.log(`   hole ${hole} w${w}: ${ex.length} rings → FAIL ${r.err} (${r.ms} ms)`);
          continue;
        }
        const ov = edgeOverlapRatio(
          { type: 'LineString', coordinates: r.coords },
          { type: 'LineString', coordinates: base.coords },
        );
        console.log(
          `   hole ${hole} w${w}: ${ex.length} rings → ${r.km.toFixed(1)} km ${r.min.toFixed(0)} min, overlap ${ov.toFixed(2)} (${r.ms} ms)`,
        );
      }
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
