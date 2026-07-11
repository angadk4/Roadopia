import { describe, expect, it } from 'vitest';

import { buildManifest, RunManifestSchema } from './manifest';

/** M4-T13 — a run produces a §22-complete manifest from canonical sources. */
describe('reproducibility manifest (M4-T13)', () => {
  it('builds a schema-valid manifest with real provenance', () => {
    const m = buildManifest({
      experimentId: 'baselines-dev-smoke',
      scoringConfigId: 'default-weights-v1',
      weights: { dur: 0.3, cur: 0.35 },
      datasetSplit: 'dev',
      datasetVersion: 'reqset-v1',
      seed: 42,
    });
    expect(() => RunManifestSchema.parse(m)).not.toThrow();
    expect(m.code_commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(m.region.id).toBe('south-central-ontario');
    expect(m.region.poly_md5).toMatch(/^[0-9a-f]{32}$/);
    expect(m.routing_data.filtered_ways).toBeGreaterThan(100_000);
    expect(m.model).toBeNull();
    expect(m.cost_ledger.total_usd).toBe(0);
  });

  it('rejects a manifest missing §22 fields', () => {
    expect(() => RunManifestSchema.parse({ experiment_id: 'x' })).toThrow();
  });
});
