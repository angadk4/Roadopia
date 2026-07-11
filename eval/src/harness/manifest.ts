/**
 * Reproducibility manifests (M4-T13; Protocol §22).
 *
 * Every experiment run writes a manifest carrying the §22 required fields so
 * the run can be re-executed against the same code, data, config, and prices.
 * "Reproduced" = the same manifest reproduces the same DISTRIBUTION (§24) —
 * for LLM-in-the-loop variants the manifest also records N (repeats).
 *
 * Provenance is READ from the canonical sources, never restated by hand:
 * git SHA from the repo, extract facts from data/extract-manifest.json,
 * dataset version from the reqset manifest.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** Experiment outputs live under eval/runs/<experiment_id>/ (gitignored ok; reports committed). */
export const RUNS_DIR = fileURLToPath(new URL('../../runs', import.meta.url));

export const RunManifestSchema = z.object({
  experiment_id: z.string().min(1),
  code_commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  /** Prompt name → version. Empty for deterministic (no-LLM) runs. */
  prompt_versions: z.record(z.string(), z.string()),
  /** null for deterministic runs; N = repeats for LLM-in-the-loop (§24). */
  model: z
    .object({
      id: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      n_repeats: z.number().int().positive(),
    })
    .nullable(),
  routing_data: z.object({
    extract_date: z.string(),
    filtered_md5: z.string(),
    filtered_ways: z.number().int(),
    source_md5: z.string(),
  }),
  region: z.object({ id: z.string(), poly_md5: z.string() }),
  scoring_config: z.object({
    id: z.string(),
    weights: z.record(z.string(), z.number()),
  }),
  user_weight_config: z.string(),
  seed: z.number().int(),
  dataset: z.object({ split: z.string(), version: z.string() }),
  timestamp: z.string(),
  environment: z.object({ valhalla: z.string(), host: z.string() }),
  cost_ledger: z.object({
    total_usd: z.number().nonnegative(),
    llm_calls: z.number().int().nonnegative(),
    notes: z.string(),
  }),
});
export type RunManifest = z.infer<typeof RunManifestSchema>;

const ExtractManifestSchema = z.object({
  region_id: z.string(),
  region_poly: z.object({ md5: z.string() }),
  source: z.object({ md5: z.string() }),
  extract_date: z.string(),
  outputs: z.object({
    filtered: z.object({ md5: z.string(), ways: z.number().int() }),
  }),
});

export interface ManifestInputs {
  experimentId: string;
  scoringConfigId: string;
  weights: Record<string, number>;
  datasetSplit: string;
  datasetVersion: string;
  seed: number;
  /** 'none (defaults)' | 'presets' | 'presets+sliders' — §22 user-weight config. */
  userWeightConfig?: string;
  promptVersions?: Record<string, string>;
  model?: RunManifest['model'];
  costLedger?: RunManifest['cost_ledger'];
  environment?: RunManifest['environment'];
}

export function buildManifest(inputs: ManifestInputs, repoRoot: string = REPO_ROOT): RunManifest {
  const extract = ExtractManifestSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, 'data', 'extract-manifest.json'), 'utf8')),
  );
  const sha = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
  return RunManifestSchema.parse({
    experiment_id: inputs.experimentId,
    code_commit: sha,
    prompt_versions: inputs.promptVersions ?? {},
    model: inputs.model ?? null,
    routing_data: {
      extract_date: extract.extract_date,
      filtered_md5: extract.outputs.filtered.md5,
      filtered_ways: extract.outputs.filtered.ways,
      source_md5: extract.source.md5,
    },
    region: { id: extract.region_id, poly_md5: extract.region_poly.md5 },
    scoring_config: { id: inputs.scoringConfigId, weights: inputs.weights },
    user_weight_config: inputs.userWeightConfig ?? 'none (defaults)',
    seed: inputs.seed,
    dataset: { split: inputs.datasetSplit, version: inputs.datasetVersion },
    timestamp: new Date().toISOString(),
    environment: inputs.environment ?? { valhalla: 'pinned v3.7.0 (local compose)', host: 'local' },
    cost_ledger: inputs.costLedger ?? { total_usd: 0, llm_calls: 0, notes: 'deterministic run' },
  });
}

/** Write the manifest under eval/runs/<experiment_id>/ and return its path. */
export function writeManifest(manifest: RunManifest, runsDir: string = RUNS_DIR): string {
  const dir = join(runsDir, manifest.experiment_id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8');
  return path;
}
