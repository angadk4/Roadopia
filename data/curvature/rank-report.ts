/**
 * SPK-10 — curvature ranking report (Protocol §12.2 evaluation).
 *
 * Matches the hand-label set to computed curvature (labeled-ways.json from build-table),
 * aggregating same-named ways near each label's `near` point (length-weighted), then
 * reports — for both candidate formulas C2 (heading/km) and C7 (circumradius) —
 * Spearman ρ vs the human ordinal, the per-class mean, and the urban-grid false-positive
 * rate at candidate THETA_CURVY values. This is the evidence for the SPK-10 AC
 * ("ranks twisty above grid") and the M4 [GATE-C] input. No DB needed.
 *
 * Run: pnpm -C data curvature:report   (after curvature:build)
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { haversineMeters } from './geometry';
import { baseName, LABELS, type Ordinal } from './labels';
import { gridFalsePositiveRate, spearman } from './stats';

const HERE = dirname(fileURLToPath(import.meta.url));
const MATCH_RADIUS_M = 5000;

interface LabeledWay {
  name: string;
  highway: string;
  lengthM: number;
  c2: number;
  c7: number;
  lon: number;
  lat: number;
}

interface Matched {
  name: string;
  ordinal: Ordinal;
  klass: string;
  c2: number;
  c7: number;
  ways: number;
  km: number;
}

function lwMean(ways: LabeledWay[], pick: (w: LabeledWay) => number): number {
  let num = 0;
  let den = 0;
  for (const w of ways) {
    num += pick(w) * w.lengthM;
    den += w.lengthM;
  }
  return den > 0 ? num / den : 0;
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

async function main(): Promise<void> {
  const ways: LabeledWay[] = JSON.parse(
    await readFile(join(HERE, 'labeled-ways.json'), 'utf8'),
  );

  const matched: Matched[] = [];
  const unmatched: string[] = [];

  for (const label of LABELS) {
    const hits = ways.filter(
      (w) =>
        baseName(w.name) === baseName(label.name) &&
        haversineMeters([w.lon, w.lat], label.near) <= MATCH_RADIUS_M,
    );
    if (hits.length === 0) {
      unmatched.push(`${label.name} (${label.note})`);
      continue;
    }
    matched.push({
      name: label.name,
      ordinal: label.ordinal,
      klass: label.klass,
      c2: lwMean(hits, (w) => w.c2),
      c7: lwMean(hits, (w) => w.c7),
      ways: hits.length,
      km: hits.reduce((s, w) => s + w.lengthM, 0) / 1000,
    });
  }

  matched.sort((a, b) => b.c7 - a.c7);

  const ordinals = matched.map((m) => m.ordinal);
  const c2 = matched.map((m) => m.c2);
  const c7 = matched.map((m) => m.c7);

  console.log('=== SPK-10 curvature ranking report ===\n');
  console.log(`matched labels: ${matched.length} / ${LABELS.length}`);
  if (unmatched.length) console.log(`unmatched (no OSM name in extract): ${unmatched.length}`);
  console.log('');

  console.log(pad('road', 26) + pad('class', 15) + pad('ord', 5) + pad('C2 deg/km', 12) + pad('C7 1/km', 10) + 'ways/km');
  console.log('-'.repeat(85));
  for (const m of matched) {
    console.log(
      pad(m.name, 26) +
        pad(m.klass, 15) +
        pad(m.ordinal, 5) +
        pad(m.c2.toFixed(1), 12) +
        pad(m.c7.toFixed(2), 10) +
        `${m.ways}/${m.km.toFixed(1)}`,
    );
  }

  // Per-ordinal class means (should increase monotonically with ordinal).
  console.log('\n-- mean by ordinal --');
  for (const ord of [0, 1, 2, 3] as const) {
    const grp = matched.filter((m) => m.ordinal === ord);
    if (!grp.length) continue;
    const mc2 = grp.reduce((s, m) => s + m.c2, 0) / grp.length;
    const mc7 = grp.reduce((s, m) => s + m.c7, 0) / grp.length;
    console.log(`ord ${ord} (n=${grp.length}): C2 ${mc2.toFixed(1)} deg/km  |  C7 ${mc7.toFixed(2)} 1/km`);
  }

  const rhoC2 = spearman(ordinals, c2);
  const rhoC7 = spearman(ordinals, c7);
  console.log('\n-- Spearman ρ (metric vs human ordinal) --');
  console.log(`C2 heading/km : ρ = ${rhoC2.toFixed(3)}`);
  console.log(`C7 circumradius: ρ = ${rhoC7.toFixed(3)}`);

  // THETA_CURVY sweep on C7: trade grid false-positives against twisty recall, and
  // pick the lowest θ whose grid-FP ≤ 10% (maximising recall under the FP cap). A
  // single midpoint is a poor estimator when one label is borderline, so sweep.
  const curvyC7 = matched.filter((m) => m.ordinal >= 2).map((m) => m.c7);
  const recallAt = (t: number): number =>
    curvyC7.length ? curvyC7.filter((v) => v >= t).length / curvyC7.length : 0;

  console.log('\n-- THETA_CURVY sweep on C7 (1/km): grid-FP vs twisty-recall --');
  console.log(pad('θ', 8) + pad('grid FP %', 12) + 'twisty recall %');
  let bestTheta = 0;
  for (let t = 0.2; t <= 1.21; t += 0.1) {
    const fpT = gridFalsePositiveRate(ordinals, c7, t);
    const reT = recallAt(t);
    const ok = fpT <= 0.1;
    if (ok && bestTheta === 0) bestTheta = t;
    console.log(pad(t.toFixed(2), 8) + pad((fpT * 100).toFixed(1), 12) + `${(reT * 100).toFixed(1)}${ok ? '   ← FP≤10%' : ''}`);
  }
  const theta = bestTheta || 0.6;
  const fp = gridFalsePositiveRate(ordinals, c7, theta);
  const recall = recallAt(theta);
  console.log(`\nselected THETA_CURVY (candidate, finalised at M4) = ${theta.toFixed(2)} 1/km`);
  console.log(`  grid false-positive rate = ${(fp * 100).toFixed(1)}% ; twisty (ord ≥2) recall = ${(recall * 100).toFixed(1)}%`);

  console.log('\n-- AC check (SPK-10) --');
  const passRho = rhoC7 >= 0.6 || rhoC2 >= 0.6;
  const passFp = fp <= 0.1;
  console.log(`ranks twisty>grid (ρ ≥ 0.6): ${passRho ? 'PASS' : 'FAIL'} (best ρ = ${Math.max(rhoC2, rhoC7).toFixed(3)})`);
  console.log(`grid FP ≤ 10% (tuned θ):     ${passFp ? 'PASS' : 'FAIL'} (${(fp * 100).toFixed(1)}% @ θ=${theta.toFixed(2)})`);

  if (unmatched.length) {
    console.log('\n-- unmatched labels (name not found near point; refine names at M4) --');
    for (const u of unmatched) console.log(`  · ${u}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
