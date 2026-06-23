import { describe, it, expect } from 'vitest';

import { loadServerConfig, loadClientConfig, EnvValidationError } from './config';

/** A minimal valid server env (only the required keys; defaults fill the rest). */
const validServerEnv = {
  REGION_ID: 'golden-horseshoe',
  REGION_POLY_PATH: './data/regions/golden-horseshoe.poly',
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-123',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-123',
  MAPBOX_PUBLIC_TOKEN: 'pk.test_public_token',
  ANTHROPIC_API_KEY: 'sk-ant-test-key',
} as const;

describe('config loader', () => {
  it('parses a valid server env and applies §91 defaults', () => {
    const cfg = loadServerConfig({ ...validServerEnv });
    expect(cfg.REGION_ID).toBe('golden-horseshoe');
    expect(cfg.ANTHROPIC_MODEL_HAIKU).toBe('claude-haiku-4-5-20251001');
    expect(cfg.ANTHROPIC_MODEL_SONNET).toBe('claude-sonnet-4-6');
    expect(cfg.VALHALLA_URL).toBe('http://localhost:8002');
    expect(cfg.SPEND_SOFT_USD).toBe(20);
    expect(cfg.SPEND_HARD_USD).toBe(30);
    expect(cfg.ITERATION_CAP).toBe(3);
    expect(cfg.KILL_SWITCH).toBe(false);
  });

  it('rejects missing required keys and names them (fail fast)', () => {
    expect(() => loadServerConfig({})).toThrow(EnvValidationError);
    try {
      loadServerConfig({});
      throw new Error('expected loadServerConfig({}) to throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('ANTHROPIC_API_KEY');
      expect(msg).toContain('SUPABASE_URL');
      expect(msg).toContain('REGION_ID');
    }
  });

  it('never echoes secret/invalid VALUES in the error message (Hard rule H)', () => {
    try {
      // A secret token wrongly placed in the public-token slot must be rejected,
      // and the leaked value must NOT appear in the error.
      loadServerConfig({ ...validServerEnv, MAPBOX_PUBLIC_TOKEN: 'sk.LEAKED-SECRET-VALUE' });
      throw new Error('expected a validation error');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('MAPBOX_PUBLIC_TOKEN');
      expect(msg).not.toContain('LEAKED-SECRET-VALUE');
    }
  });

  it('coerces numeric + boolean tunables from env strings', () => {
    const cfg = loadServerConfig({
      ...validServerEnv,
      ITERATION_CAP: '5',
      KILL_SWITCH: 'true',
      TAU_OVERLAP: '0.7',
    });
    expect(cfg.ITERATION_CAP).toBe(5);
    expect(cfg.KILL_SWITCH).toBe(true);
    expect(cfg.TAU_OVERLAP).toBeCloseTo(0.7);
  });

  it('client config exposes ONLY public keys (no secrets — Spec §57)', () => {
    const cfg = loadClientConfig({ ...validServerEnv });
    expect(cfg).toEqual({
      SUPABASE_URL: 'https://abcdefgh.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key-123',
      MAPBOX_PUBLIC_TOKEN: 'pk.test_public_token',
    });
    const leaky = cfg as Record<string, unknown>;
    expect(leaky.ANTHROPIC_API_KEY).toBeUndefined();
    expect(leaky.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(leaky.MAPBOX_SECRET_TOKEN).toBeUndefined();
  });
});
