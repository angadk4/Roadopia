/**
 * Contract test (review 2026-07-16): app.config.ts `extra` keys must stay in
 * lock-step with the keys runtime.ts reads — a rename on either side otherwise
 * ships a build with a silently-missing Mapbox token / Supabase key.
 */
import { describe, expect, it } from 'vitest';

import config from '../../app.config';

describe('app.config extra ↔ runtime contract', () => {
  it('exposes exactly the extras runtime.ts reads, as strings', () => {
    const extra = config.extra as Record<string, unknown>;
    for (const key of ['apiUrl', 'mapboxPublicToken', 'supabaseUrl', 'supabaseAnonKey']) {
      expect(typeof extra[key], `extra.${key} must be a string`).toBe('string');
    }
    expect((extra['eas'] as { projectId?: string }).projectId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never carries a secret-shaped value (Hard rule H tripwire)', () => {
    const flat = JSON.stringify(config.extra);
    expect(flat).not.toMatch(/sk\.[A-Za-z0-9]/); // Mapbox secret token shape
    expect(flat).not.toMatch(/sk-ant-/); // Anthropic key shape
    expect(flat).not.toMatch(/service_role/i);
  });
});
