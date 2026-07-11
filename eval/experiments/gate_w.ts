/**
 * [GATE-W] weight responsiveness / stability experiment (M4-T10; Protocol §15
 * / §27) + slider clamp ranges (§21).
 *
 * PRE-REGISTERED DECISION RULE (fixed before any result was computed; §27 row:
 * "sliders are responsive AND non-degenerate at extremes | default: presets +
 * clamped sliders; fall back to presets-only if extremes break"):
 * ship W2 (presets + clamped sliders) IFF ALL of:
 *   1. RESPONSIVENESS: each implemented slider (cur, dur, overlap; stop where
 *      a brief requests stops) moves the presented best in the expected
 *      direction with Spearman |ρ| ≥ 0.5 of the expected sign on ≥ half of
 *      the briefs where it is measurable (ties/zero-variance = not measurable).
 *   2. NON-DEGENERATE EXTREMES: for each slider a clamp range containing its
 *      default exists in which NO archetype brief degenerates (degenerate =
 *      the presented best turns dirty when a clean feasible exists, or its
 *      |duration error| exceeds 50 %, or the kept set collapses below 2 when
 *      the default kept ≥ 2). Sliders with no usable range are DROPPED, not
 *      shipped unclamped.
 *   3. STABILITY AT DEFAULTS: on every selected brief the default vector
 *      yields ≥1 feasible candidate whose best is clean and within ±25 %.
 *   4. PRESETS: each preset moves its dominant axis in the expected direction
 *      (or ties) vs the default vector on ≥ half the briefs
 *      (twisty/backroads → curviness ↑; chill/avoid_highways → |dur err| ↓;
 *      coffee_stop → stops ↑ on stop briefs; scenic → stops ≥ default —
 *      its scenic term stays 0 until [GATE-S], Hard rule C).
 * Otherwise fall back to W1 (presets only). Weight sweeps re-finalize a FIXED
 * pool per brief (weights touch scoring only — §15 "fixed (brief, origin)
 * pairs"), so the sweep is deterministic and free of generation noise.
 *
 * Run: pnpm -C eval run gate-w   (Supabase local + Valhalla; no LLM calls)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ParsedConstraints } from '@shared/types';
import { Client } from 'pg';

import { PRESET_WEIGHTS } from '../../backend/src/planner/presets';
import { DEFAULT_WEIGHTS, type WeightVector } from '../../backend/src/planner/score';
import { loadReqset } from '../src/datasets/load';
import type { RequestExample } from '../src/datasets/schema';
import { buildManifest, writeManifest } from '../src/harness/manifest';
import {
  finalizeKept,
  planKeptSet,
  resolveRunnableConstraints,
  type KeptCandidate,
  type PoolState,
} from '../src/harness/pipeline';
import { spearmanRho } from '../src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const SEED = 42;

type SliderKey = 'cur' | 'dur' | 'overlap' | 'stop';
interface SliderSpec {
  key: SliderKey;
  sweep: number[];
  /** expected Spearman sign of observe() as the weight rises */
  expectSign: 1 | -1;
  observe: (best: KeptCandidate, targetS: number) => number;
  observable: (brief: BriefCase) => boolean;
}

interface BriefCase {
  example: RequestExample;
  constraints: ParsedConstraints;
  targetS: number;
  archetype: string;
  pool: PoolState;
  defaultBest: KeptCandidate;
  defaultKept: number;
  hasStops: boolean;
}

const SLIDERS: SliderSpec[] = [
  {
    key: 'cur',
    sweep: [0, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9],
    expectSign: 1,
    observe: (b) => b.curviness,
    observable: () => true,
  },
  {
    key: 'dur',
    sweep: [0.05, 0.15, 0.3, 0.45, 0.6, 0.8],
    expectSign: -1,
    observe: (b, targetS) => Math.abs(b.durationS - targetS) / targetS,
    observable: () => true,
  },
  {
    key: 'overlap',
    sweep: [0, 0.1, 0.25, 0.4, 0.6],
    expectSign: -1,
    observe: (b) => b.selfOverlap,
    observable: () => true,
  },
  {
    key: 'stop',
    sweep: [0, 0.1, 0.25, 0.45, 0.7],
    expectSign: 1,
    observe: (b) => b.stopsIncluded,
    observable: (brief) => brief.hasStops,
  },
];

/** Preset → dominant axis expectation vs the default vector. */
const PRESET_AXIS: Record<
  keyof typeof PRESET_WEIGHTS,
  {
    axis: string;
    better: (p: KeptCandidate, d: KeptCandidate, targetS: number) => boolean;
    needsStops?: boolean;
  }
> = {
  twisty: { axis: 'curviness ↑', better: (p, d) => p.curviness >= d.curviness },
  backroads: { axis: 'curviness ↑', better: (p, d) => p.curviness >= d.curviness },
  chill: {
    axis: '|dur err| ↓',
    better: (p, d, t) => Math.abs(p.durationS - t) <= Math.abs(d.durationS - t),
  },
  avoid_highways: {
    axis: '|dur err| ↓',
    better: (p, d, t) => Math.abs(p.durationS - t) <= Math.abs(d.durationS - t),
  },
  coffee_stop: {
    axis: 'stops ↑',
    better: (p, d) => p.stopsIncluded >= d.stopsIncluded,
    needsStops: true,
  },
  scenic: { axis: 'stops ≥', better: (p, d) => p.stopsIncluded >= d.stopsIncluded },
};

function presentedBest(kept: KeptCandidate[]): KeptCandidate | null {
  const feasible = kept.filter((k) => k.feasible);
  const pickFrom = feasible.length ? feasible : kept;
  return pickFrom.length ? pickFrom.reduce((b, k) => (k.presentKey > b.presentKey ? k : b)) : null;
}

function isClean(c: KeptCandidate): boolean {
  return c.uturns === 0 && c.spursWide === 0;
}

function degenerate(brief: BriefCase, kept: KeptCandidate[]): boolean {
  const best = presentedBest(kept);
  if (!best) return true;
  const durErr = Math.abs(best.durationS - brief.targetS) / brief.targetS;
  const cleanFeasibleExists = kept.some((k) => k.feasible && isClean(k));
  if (!isClean(best) && cleanFeasibleExists) return true;
  if (durErr > 0.5) return true;
  if (brief.defaultKept >= 2 && kept.length < 2) return true;
  return false;
}

function withWeight(key: SliderKey, value: number): Partial<WeightVector> {
  return { [key]: value };
}

async function main(): Promise<void> {
  const reqset = loadReqset();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // one fixed (brief, origin) pair per archetype (§15) — first runnable DEV
  // brief per archetype whose default run is feasible
  const byArchetype = new Map<string, BriefCase>();
  const failedDefaults: string[] = [];
  for (const e of reqset.dev) {
    const archetype = e.tags.archetype;
    if (byArchetype.has(archetype)) continue;
    const c = resolveRunnableConstraints(e);
    if (!c) continue;
    try {
      const outcome = await planKeptSet(db, VALHALLA, c);
      const best = presentedBest(outcome.kept.filter((k) => k.feasible));
      if (!best) {
        failedDefaults.push(`${e.id} (${archetype}): no feasible at defaults`);
        continue;
      }
      byArchetype.set(archetype, {
        example: e,
        constraints: c,
        targetS: outcome.targetS,
        archetype,
        pool: outcome.pool,
        defaultBest: best,
        defaultKept: outcome.kept.length,
        hasStops: c.stops.length > 0,
      });
      console.log(
        `pool built: ${e.id} [${archetype}] — ${outcome.kept.length} kept, best ${Math.round(best.durationS / 60)} min / curv ${best.curviness.toFixed(2)}`,
      );
    } catch (err) {
      failedDefaults.push(`${e.id} (${archetype}): ${err instanceof Error ? err.message : err}`);
    }
  }
  await db.end();
  const briefs = [...byArchetype.values()];
  if (briefs.length === 0) throw new Error('no runnable archetype briefs');

  // --- 1. responsiveness + 2. clamp ranges (pure CPU on fixed pools) ---
  interface SliderResult {
    key: SliderKey;
    rhos: Array<{ id: string; rho: number | null }>;
    passShare: number | null;
    clamp: [number, number] | null;
  }
  const sliderResults: SliderResult[] = [];
  for (const spec of SLIDERS) {
    const rhos: Array<{ id: string; rho: number | null }> = [];
    const degenerateAt = new Map<number, string[]>();
    const measurableBriefs = briefs.filter((b) => spec.observable(b));
    for (const brief of measurableBriefs) {
      const pairs: Array<[number, number]> = [];
      for (const w of spec.sweep) {
        const { kept } = finalizeKept(brief.pool, brief.constraints, withWeight(spec.key, w));
        const best = presentedBest(kept);
        if (best) pairs.push([w, spec.observe(best, brief.targetS)]);
        if (degenerate(brief, kept)) {
          degenerateAt.set(w, [...(degenerateAt.get(w) ?? []), brief.example.id]);
        }
      }
      rhos.push({ id: brief.example.id, rho: spearmanRho(pairs) });
    }
    const usable = rhos.filter((r) => r.rho !== null);
    const passing = usable.filter((r) => r.rho! * spec.expectSign >= 0.5);
    // clamp: the widest CONTIGUOUS sweep window around the default in which
    // zero briefs degenerate at every point
    const def = DEFAULT_WEIGHTS[spec.key];
    const sweepSorted = [...spec.sweep].sort((a, b) => a - b);
    const okAt = (w: number) => (degenerateAt.get(w) ?? []).length === 0;
    const defIdx = sweepSorted.reduce(
      (bi, w, i) => (Math.abs(w - def) < Math.abs(sweepSorted[bi]! - def) ? i : bi),
      0,
    );
    let clamp: [number, number] | null = null;
    if (okAt(sweepSorted[defIdx]!)) {
      let lo = defIdx;
      let hi = defIdx;
      while (lo > 0 && okAt(sweepSorted[lo - 1]!)) lo--;
      while (hi < sweepSorted.length - 1 && okAt(sweepSorted[hi + 1]!)) hi++;
      clamp = [sweepSorted[lo]!, sweepSorted[hi]!];
    }
    sliderResults.push({
      key: spec.key,
      rhos,
      passShare: usable.length ? passing.length / usable.length : null,
      clamp,
    });
  }

  // --- 3. stability at defaults ---
  const defaultStable = briefs.every((b) => {
    const durErr = Math.abs(b.defaultBest.durationS - b.targetS) / b.targetS;
    return isClean(b.defaultBest) && durErr <= 0.25;
  });

  // --- 4. presets on the same fixed pools ---
  const presetRows: string[] = [];
  const presetPass: boolean[] = [];
  for (const [name, weights] of Object.entries(PRESET_WEIGHTS) as Array<
    [keyof typeof PRESET_WEIGHTS, WeightVector]
  >) {
    const expect = PRESET_AXIS[name];
    const applicable = expect.needsStops ? briefs.filter((b) => b.hasStops) : briefs;
    let better = 0;
    let n = 0;
    for (const brief of applicable) {
      const { kept } = finalizeKept(brief.pool, brief.constraints, weights);
      const best = presentedBest(kept);
      if (!best) continue;
      n++;
      if (expect.better(best, brief.defaultBest, brief.targetS)) better++;
    }
    const ok = n > 0 && better / n >= 0.5;
    presetPass.push(ok);
    presetRows.push(`| ${name} | ${expect.axis} | ${better}/${n} briefs | ${ok ? 'YES' : 'no'} |`);
  }

  // --- decision ---
  const responsivenessOk = sliderResults
    .filter((s) => s.passShare !== null)
    .every((s) => s.passShare! >= 0.5);
  const clampsOk = sliderResults.every((s) => s.clamp !== null);
  const presetsOk = presetPass.every(Boolean);
  const shipW2 = responsivenessOk && clampsOk && defaultStable && presetsOk;

  const fmtRho = (r: number | null) => (r === null ? '—' : r.toFixed(2));
  const lines = [
    '# [GATE-W] Weight responsiveness & stability — sliders vs presets-only (M4-T10)',
    '',
    'Pre-registered rule (fixed before results; see experiments/gate_w.ts header): ship W2',
    '(presets + clamped sliders) iff every implemented slider is direction-correct (expected-',
    'sign Spearman |ρ| ≥ 0.5 on ≥ half of measurable briefs), a clamp range containing the',
    'default exists per slider, defaults are stable on every archetype brief, and every',
    'preset moves its dominant axis correctly on ≥ half the briefs. Else W1 (presets only).',
    'Sweeps re-finalize a FIXED pool per brief — weights touch scoring only (§15).',
    '',
    `## Fixed (brief, origin) pairs — one per archetype (${briefs.length})`,
    '',
    ...briefs.map(
      (b) =>
        `- ${b.example.id} [${b.archetype}] target ${Math.round(b.targetS / 60)} min, ` +
        `default best ${Math.round(b.defaultBest.durationS / 60)} min / curv ${b.defaultBest.curviness.toFixed(2)} / ${b.defaultKept} kept`,
    ),
    ...(failedDefaults.length
      ? ['', `Archetypes without a usable brief: ${failedDefaults.join('; ')}.`]
      : []),
    '',
    '## 1–2. Slider responsiveness + clamp ranges',
    '',
    '| slider | expected | per-brief ρ | pass share | clamp range |',
    '|---|---|---|---|---|',
    ...sliderResults.map((s) => {
      const spec = SLIDERS.find((x) => x.key === s.key)!;
      return (
        `| ${s.key} (default ${DEFAULT_WEIGHTS[s.key]}) | ${spec.expectSign > 0 ? '+' : '−'} | ` +
        `${s.rhos.map((r) => `${r.id.replace('dev-', '')}:${fmtRho(r.rho)}`).join(' ')} | ` +
        `${s.passShare === null ? '— (not measurable)' : (s.passShare * 100).toFixed(0) + '%'} | ` +
        `${s.clamp ? `[${s.clamp[0]}, ${s.clamp[1]}]` : 'NONE'} |`
      );
    }),
    '',
    `## 3. Stability at defaults: ${defaultStable ? 'STABLE (all briefs clean + within ±25 %)' : 'NOT stable'}`,
    '',
    '## 4. Presets (dominant-axis check vs default vector)',
    '',
    '| preset | dominant axis | correct-direction | pass |',
    '|---|---|---|---|',
    ...presetRows,
    '',
    '## DECISION ([GATE-W], per the pre-registered rule)',
    '',
    `| criterion | cleared |`,
    '|---|---|',
    `| slider responsiveness | ${responsivenessOk ? 'YES' : 'no'} |`,
    `| clamp ranges exist | ${clampsOk ? 'YES' : 'no'} |`,
    `| defaults stable | ${defaultStable ? 'YES' : 'no'} |`,
    `| presets in character | ${presetsOk ? 'YES' : 'no'} |`,
    '',
    shipW2
      ? '**SHIP W2 (presets + CLAMPED sliders)** — clamp ranges above go into the M4-T12 frozen params; PRESET_WEIGHTS frozen as-is.'
      : '**FALL BACK TO W1 (presets only)** — a pre-registered criterion was not cleared; sliders are not shipped in the MVP.',
  ];

  const reportsDir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'weights.md'), lines.join('\n') + '\n', 'utf8');

  writeManifest(
    buildManifest({
      experimentId: 'gate-w-weights',
      scoringConfigId: 'default-weights-v1 + sweeps',
      weights: DEFAULT_WEIGHTS as unknown as Record<string, number>,
      datasetSplit: 'dev (one brief per archetype)',
      datasetVersion: reqset.manifest.version,
      seed: SEED,
      costLedger: { total_usd: 0, llm_calls: 0, notes: 'deterministic run — no LLM' },
    }),
  );

  console.log('\nwrote eval/reports/weights.md');
  console.log(
    `DECISION: ${shipW2 ? 'SHIP W2 (presets + clamped sliders)' : 'FALL BACK to W1 (presets only)'}`,
  );
  console.log(
    sliderResults
      .map(
        (s) =>
          `${s.key}: pass ${s.passShare === null ? '—' : (s.passShare * 100).toFixed(0) + '%'} clamp ${s.clamp ? `[${s.clamp[0]},${s.clamp[1]}]` : 'NONE'}`,
      )
      .join(' · '),
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
