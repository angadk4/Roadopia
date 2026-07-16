/**
 * Roadopia typed environment config (M0-T02).
 *
 * One zod-validated source of truth for every runtime/build env key. Two scopes:
 *   - `loadServerConfig()` — the FULL config (VPS/backend): includes the secrets
 *     (`ANTHROPIC_API_KEY`, Supabase service-role key, Mapbox secret token).
 *   - `loadClientConfig()` — the CLIENT-SAFE subset only: Supabase URL + anon key
 *     and the restricted Mapbox public token. The app build NEVER receives secrets
 *     (Master Spec §57; Build Contract Hard rule H).
 *
 * Rules honored here:
 *   - Validate env at boot; missing/invalid required keys fail fast with a clear,
 *     actionable error that lists the offending KEY NAMES only.
 *   - NEVER include secret VALUES in errors or logs (Hard rule H). The error
 *     formatter reports `key: message` and never touches the input values.
 *
 * Keys + starting defaults are documented in `/.env.example`. Tunable defaults
 * come from Master Spec §91 ("measure-and-set"; defaults are starting points).
 */

import { z } from 'zod';

/** Raw, unvalidated environment (e.g. `process.env`). */
export type RawEnv = Record<string, string | undefined>;

/** Thrown when env validation fails. Message lists key names + reasons, no values. */
export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/** Coerce common truthy/falsy env strings to a boolean. */
const zBool = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '') return false;
  }
  return v;
}, z.boolean());

/**
 * The full server-side schema. Required keys (no default) fail fast when absent.
 * Tunables carry their Spec §91 starting defaults.
 */
export const serverEnvSchema = z.object({
  // --- Region (config-driven portability — Spec §57/§519) ---
  REGION_ID: z.string().min(1),
  REGION_POLY_PATH: z.string().min(1),

  // --- Supabase ---
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1), // CLIENT-SAFE (public)
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1), // SERVER-ONLY secret

  // --- Mapbox ---
  MAPBOX_PUBLIC_TOKEN: z.string().startsWith('pk.'), // CLIENT-SAFE (restricted public)
  MAPBOX_SECRET_TOKEN: z.string().startsWith('sk.').optional(), // SERVER-ONLY (downloads/uploads)

  // --- Anthropic runtime AI (SERVER-ONLY; pay-as-you-go API, not the Max plan — Spec §25/§57) ---
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  ANTHROPIC_MODEL_HAIKU: z.string().min(1).default('claude-haiku-4-5-20251001'), // parse/correct/title/amplifiers
  ANTHROPIC_MODEL_SONNET: z.string().min(1).default('claude-sonnet-4-6'), // select/explain

  // --- Routing ---
  VALHALLA_URL: z.string().url().default('http://localhost:8002'),

  // --- Runtime-AI spend controls (Spec §65; USD/month) ---
  SPEND_SOFT_USD: z.coerce.number().positive().default(20),
  SPEND_HARD_USD: z.coerce.number().positive().default(30),
  SPEND_OVERRIDE_USD: z.coerce.number().positive().default(40), // testing/demo override only
  KILL_SWITCH: zBool.default(false),

  // --- Planner tunables (Spec §91 — starting defaults, set during the build) ---
  MAX_BRIEF_CHARS: z.coerce.number().int().positive().default(500),
  WALL_CLOCK_BUDGET_MS: z.coerce.number().int().positive().default(25_000),
  ITERATION_CAP: z.coerce.number().int().positive().default(3),
  N_CANDIDATES: z.coerce.number().int().positive().default(10),
  K_PRESENT: z.coerce.number().int().positive().default(4),
  TAU_OVERLAP: z.coerce.number().min(0).max(1).default(0.6),
  SELF_OVERLAP_CAP: z.coerce.number().min(0).max(1).default(0.15),
  DURATION_TOLERANCE: z.coerce.number().min(0).max(1).default(0.1),
});

export type ServerConfig = z.infer<typeof serverEnvSchema>;

/** The client-safe subset — the ONLY keys the app build may hold (Spec §57). */
export const clientEnvSchema = serverEnvSchema
  .pick({
    SUPABASE_URL: true,
    SUPABASE_ANON_KEY: true,
    MAPBOX_PUBLIC_TOKEN: true,
  })
  .extend({
    // Agent-backend base URL for the app (M7-T01). NOT a secret; optional —
    // dev builds derive it from the Metro host when absent (app/src/lib/api.ts).
    EXPO_PUBLIC_API_URL: z.string().url().optional(),
  });

export type ClientConfig = z.infer<typeof clientEnvSchema>;

/** Validate `env` against `schema`; throw a secret-safe EnvValidationError on failure. */
function parseOrThrow<T extends z.ZodTypeAny>(schema: T, env: RawEnv, scope: string): z.infer<T> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;

  // SECRET-SAFE: report only `key: message`. Never read or echo the input values.
  const lines = result.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  - ${key}: ${issue.message}`;
  });
  throw new EnvValidationError(
    `Invalid ${scope} environment configuration — ${lines.length} problem(s):\n` +
      `${lines.join('\n')}\n` +
      `Fix the keys above; see /.env.example for the full list. (Values are hidden for safety.)`,
  );
}

/** Load + validate the FULL server config (secrets included). Throws on any problem. */
export function loadServerConfig(env: RawEnv = process.env): ServerConfig {
  return parseOrThrow(serverEnvSchema, env, 'server');
}

/** Load + validate ONLY the client-safe keys (no secrets ever). Throws on any problem. */
export function loadClientConfig(env: RawEnv = process.env): ClientConfig {
  return parseOrThrow(clientEnvSchema, env, 'client');
}

/** The active region, resolved from config (M2-T01; Spec §46 config-driven portability). */
export interface Region {
  /** Region identifier (e.g. "wgh-niagara") — used in names/manifests, never hard-coded. */
  id: string;
  /** Repo-relative (or absolute) path to the region's `.poly` boundary polygon. */
  polyPath: string;
}

/**
 * Resolve the region from a loaded config. Every pipeline consumer goes through
 * this (or reads the same env keys, for shell scripts) — swapping `REGION_ID` +
 * `REGION_POLY_PATH` in the environment retargets the entire pipeline; no script
 * may hard-code a region or bbox (M2-T01 AC).
 */
export function getRegion(config: Pick<ServerConfig, 'REGION_ID' | 'REGION_POLY_PATH'>): Region {
  return { id: config.REGION_ID, polyPath: config.REGION_POLY_PATH };
}
