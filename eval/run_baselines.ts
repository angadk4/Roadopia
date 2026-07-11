/**
 * M4-T04 — run baselines B0–B5 on the DEV split through the §19 harness.
 *
 * Run: pnpm -C eval run baselines     (Supabase local + Valhalla must be up)
 * Outputs: eval/reports/baselines.md (committed) + eval/runs/<id>/manifest.json
 * per baseline (§22). B5 is a one-shot probe (Valhalla has no round-trip mode).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { DEFAULT_WEIGHTS } from '../backend/src/planner/score';

import { BASELINE_IDS, mulberry32, probeB5, runBaseline } from './src/baselines/baselines';
import { loadReqset } from './src/datasets/load';
import { buildManifest, writeManifest } from './src/harness/manifest';
import type { AttemptRecord } from './src/harness/types';
import { computeAllMetrics, formatMetricTable, goldIndexOf } from './src/metrics/calculators';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
const SEED = 42;

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const reqset = loadReqset();
  const dev = reqset.dev;
  const gold = goldIndexOf(dev);
  const sections: string[] = [
    '# Baselines B0–B5 on DEV (M4-T04)',
    '',
    `Dataset: ${reqset.manifest.version} · split dev (${dev.length} examples) · seed ${SEED}.`,
    '',
    'Baselines bypass parsing (`parsed` = gold), so their parse metrics are trivially',
    'perfect and carry no comparison weight. Origins that are not coordinates',
    "(place-name / 'current' / none) cannot route before M6 geocoding — counted as",
    'errors over A for EVERY variant, so denominators stay comparable. B6 (the real',
    'deterministic planner) runs through this same harness in the gate experiments.',
    '',
  ];

  for (const id of BASELINE_IDS) {
    const rng = mulberry32(SEED);
    const records: AttemptRecord[] = [];
    for (const example of dev) {
      records.push(await runBaseline(id, example, { valhallaUrl: VALHALLA, db, rng }));
    }
    const metrics = computeAllMetrics(records, gold);
    const errors = records.filter((r) => r.outcome === 'error').length;
    const manifest = buildManifest({
      experimentId: `baseline-${id}-dev`,
      scoringConfigId: 'default-weights-v1',
      weights: DEFAULT_WEIGHTS as unknown as Record<string, number>,
      datasetSplit: 'dev',
      datasetVersion: reqset.manifest.version,
      seed: SEED,
    });
    const manifestPath = writeManifest(manifest);
    console.log(`\n=== ${id} (errors ${errors}/${records.length}) ===`);
    console.log(formatMetricTable(metrics));
    console.log(`manifest: ${manifestPath}`);
    sections.push(
      `## ${id}`,
      '',
      `Errors (unroutable origin / no route): ${errors}/${records.length}.`,
      '',
      '```',
      formatMetricTable(metrics),
      '```',
      '',
    );
  }

  // B5 — router-native round trip: one-shot capability probe
  const hamilton = { lat: 43.2557, lng: -79.8711 };
  const b5 = await probeB5(VALHALLA, hamilton);
  console.log(`\nB5 (router-native round trip): ${b5}`);
  sections.push('## B5 — router-native round trip', '', `N/A — ${b5}.`, '');

  const reportsDir = fileURLToPath(new URL('./reports', import.meta.url));
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'baselines.md'), sections.join('\n'), 'utf8');
  console.log('\nwrote eval/reports/baselines.md');
  await db.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
