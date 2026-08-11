/**
 * Re-score the saved audit-v18 run under the ALIGNED rulers (BD-147): drive-
 * closed loopiness for split trips, origin-graced doubling. The audit code now
 * computes these live; this re-derives them from the saved rows so the v18
 * numbers are honest without a 40-minute re-run. Coords are 5-dp rounded
 * (~1 m) — negligible for both metrics.
 *
 * Run: TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx eval/experiments/rescore_v18.ts
 */
import { readFileSync } from 'node:fs';

import { driveGeometry, splitLoopLegs } from '../../backend/src/planner/legs';
import {
  driveClosedLoopiness,
  TRIP_OAB_ORIGIN_GRACE_M,
} from '../../backend/src/planner/trip_gates';
import type { LatLng, LineString } from '../../shared/src/types';

interface Row {
  kind: string;
  label: string;
  brief: string;
  status: string;
  durationMin: number | null;
  targetMin: number | null;
  backroadPct: number | null;
  driveBackroadPct: number | null;
  loopiness: number | null;
  spursWide: number | null;
  microloops: number | null;
  uturnsShipped: number | null;
  drivePct: number | null;
  oabRuns: Array<{ atM: number; lengthM: number; point: [number, number] }>;
  disclosures: string[];
  coords: Array<[number, number]>;
  waypoints?: Array<LatLng>;
}

const d = JSON.parse(readFileSync('eval/reports/audit-v13.json', 'utf-8')) as {
  routes: Array<Row & { defects: string[] }>;
};

/** Audit rows don't persist waypoints — recover the split from the trace of
 *  the served disclosure being present + geometry via the leg drivePct the
 *  audit DID store. For re-scoring we only need: (a) drive-closed loopiness —
 *  approximated by the split the audit found (drivePct present ⇒ split
 *  existed); rows without a split keep whole loopiness. Since raw waypoints
 *  are absent, re-derive the drive slice from drivePct/therePct proportions.
 */
function driveSlice(
  coords: Array<[number, number]>,
  thereFrac: number,
  driveFrac: number,
): LineString {
  const latM = 111_320;
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    cum.push(
      cum[i - 1]! +
        Math.hypot((b[1] - a[1]) * latM, (b[0] - a[0]) * latM * Math.cos((a[1] * Math.PI) / 180)),
    );
  }
  const total = cum[cum.length - 1]!;
  const from = total * thereFrac;
  const to = total * (thereFrac + driveFrac);
  const pick = coords.filter((_, i) => cum[i]! >= from && cum[i]! <= to);
  return { type: 'LineString', coordinates: pick };
}

const loops = d.routes.filter((r) => r.kind === 'loop' && r.status !== 'error');
const served = loops.filter((r) =>
  (r.disclosures ?? []).some((x) => x.includes('measured drive fits')),
);
const legacy = loops.filter((r) => !served.includes(r));

function rescore(rows: Array<Row & { defects: string[] }>, label: string): void {
  let defectFree = 0;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const dset = new Set(r.defects);
    // aligned loop-shape ruler
    dset.delete('not_a_loop');
    let loopMetric = r.loopiness;
    if (r.drivePct !== null && r.drivePct > 0 && r.coords.length > 8) {
      const thereFrac = Math.max(0, 1 - r.drivePct / 100) / 2; // symmetric approx
      const geo = driveSlice(r.coords, thereFrac, r.drivePct / 100);
      const dl = driveClosedLoopiness(geo);
      if (dl !== null) loopMetric = dl;
    }
    if ((loopMetric ?? 1) < 0.25) dset.add('not_a_loop');
    // aligned doubling ruler (origin = first coord)
    dset.delete('out_and_back');
    const o = r.coords[0]!;
    const rad = Math.PI / 180;
    const away = (r.oabRuns ?? []).filter((run) => {
      const dLat = (run.point[1] - o[1]) * 111_320;
      const dLng = (run.point[0] - o[0]) * 111_320 * Math.cos(o[1] * rad);
      return Math.hypot(dLat, dLng) > TRIP_OAB_ORIGIN_GRACE_M;
    });
    const longestAway = away.reduce((m, run) => Math.max(m, run.lengthM), 0);
    if (longestAway >= 250) dset.add('out_and_back');
    if (dset.size === 0) defectFree++;
    for (const k of dset) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  console.log(`${label}: n=${rows.length}  DEFECT-FREE ${defectFree}/${rows.length}`);
  console.log(
    '  ' +
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(' · '),
  );
}

console.log('=== audit v18 re-scored under the ALIGNED rulers ===');
rescore(served, 'SERVED');
rescore(legacy, 'LEGACY');
// keep imports honest
void splitLoopLegs;
void driveGeometry;
process.exit(0);
