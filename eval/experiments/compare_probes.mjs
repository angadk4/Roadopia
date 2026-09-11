// Compare two planner_probe.mjs result files (before vs after) for the loops mode.
//   node compare_probes.mjs before after
import fs from 'node:fs';

const dir = 'eval/experiments/out/'; // run from the repo root
const a = JSON.parse(
  fs.readFileSync(`${dir}probe_results_${process.argv[2] ?? 'before'}.json`, 'utf8'),
);
const b = JSON.parse(
  fs.readFileSync(`${dir}probe_results_${process.argv[3] ?? 'after'}.json`, 'utf8'),
);

const key = (r) =>
  `${r.origin}|${r.preset}|${r.target_min}|${r.again ? 'again' : ''}|${r.stopsAsked ? 'stops' : ''}`;
const served = (r) => r.done === 'ok' || r.done === 'relaxed' || r.done === 'best_so_far';
const source = (r) => {
  const s = (r.steps ?? []).find((x) => x.startsWith('drive_first_trip(served'));
  if (!s) return served(r) ? 'legacy' : '—';
  const m = /served (exact|alternate) (ring_corridor|ring|sweep)?/.exec(s);
  return m ? `${m[1]}/${m[2] ?? 'ring'}` : 'measured';
};
const errOf = (r) =>
  r.target_min && r.duration_min
    ? Math.round(((r.duration_min - r.target_min) / r.target_min) * 100)
    : null;
const short = (r) => {
  if (served(r)) {
    const e = errOf(r);
    return `${r.duration_min}m (${e >= 0 ? '+' : ''}${e}%) ${(r.distance_km ?? 0).toFixed(0)}km curv ${(r.curviness ?? 0).toFixed(2)} ${source(r)} ${Math.round(r.ms / 1000)}s`;
  }
  const err = (r.error ?? '').replace(/\s+/g, ' ');
  return `NONE ${Math.round((r.ms ?? 0) / 1000)}s: ${err.slice(0, 70)}`;
};

const bm = new Map(b.loops.map((r) => [key(r), r]));
console.log('origin | preset | ask | BEFORE | AFTER');
let servedA = 0;
let servedB = 0;
let exactA = 0;
let exactB = 0;
let sumErrA = 0,
  nA = 0,
  sumErrB = 0,
  nB = 0;
for (const ra of a.loops) {
  const rb = bm.get(key(ra));
  if (served(ra)) {
    servedA++;
    const e = Math.abs(errOf(ra) ?? 0);
    sumErrA += e;
    nA++;
    if (e <= 15) exactA++;
  }
  if (rb && served(rb)) {
    servedB++;
    const e = Math.abs(errOf(rb) ?? 0);
    sumErrB += e;
    nB++;
    if (e <= 15) exactB++;
  }
  console.log(
    `${ra.origin} | ${ra.preset} | ${ra.target_min}${ra.again ? ' again' : ''}${ra.stopsAsked ? ' +stop' : ''} | ${short(ra)} | ${rb ? short(rb) : 'n/a'}`,
  );
}
console.log(
  `\nserved: ${servedA}/${a.loops.length} → ${servedB}/${b.loops.length}; within ±15%: ${exactA} → ${exactB}; mean |err| of served: ${nA ? (sumErrA / nA).toFixed(0) : '-'}% → ${nB ? (sumErrB / nB).toFixed(0) : '-'}%`,
);
const unavailB = b.loops.filter((r) => !served(r));
console.log(
  `after: not served ${unavailB.length}: ${unavailB.map((r) => `${r.origin}/${r.target_min}: ${(r.error ?? '').slice(0, 60)}`).join(' || ')}`,
);
