/**
 * Process entrypoint (M6): load config → wire the real dependency graph →
 * listen. Kept separate from server.ts so importing the factory (tests,
 * tooling) never opens a port or reads env.
 *
 * Wiring (all M6): region .poly bounds → pg client → DbMonthLedger primed
 * from ai_generation_requests (cap accounting survives restarts, FR-260) →
 * CostGuard (kill switch = KILL_SWITCH env, FR-262) → AiClient over the
 * Anthropic transport → Supabase JWT verifier (JWKS; HS256 via optional
 * SUPABASE_JWT_SECRET) → per-IP/per-session rate limiter → Fastify app.
 */

import { loadServerConfig } from '@shared/config';
import { Client } from 'pg';

import { anthropicTransport, AiClient } from './ai/client';
import { CostGuard } from './ai/cost_guard';
import { JwtVerifier } from './auth/jwt';
import { DbMonthLedger } from './db/generation_log';
import { RateLimiter } from './lib/rate_limit';
import { loadRegionPoly } from './lib/region';
import { buildServer } from './server';

const PORT = Number(process.env['PORT'] ?? 8080);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
  const config = loadServerConfig();
  const region = loadRegionPoly(config.REGION_POLY_PATH, config.REGION_ID);

  const db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();

  const ledger = new DbMonthLedger(db);
  await ledger.prime();
  const guard = new CostGuard({
    ledger,
    killSwitch: () => config.KILL_SWITCH,
    hardCapUsd: config.SPEND_HARD_USD,
  });
  const aiClient = new AiClient({
    guard,
    transport: anthropicTransport(config.ANTHROPIC_API_KEY),
  });

  const verifier = new JwtVerifier({
    issuer: `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`,
    ...(process.env['SUPABASE_JWT_SECRET']
      ? { hs256Secret: process.env['SUPABASE_JWT_SECRET'] }
      : {}),
  });

  const app = buildServer({
    verifier,
    valhallaUrl: config.VALHALLA_URL,
    region,
    plan: {
      db,
      valhallaUrl: config.VALHALLA_URL,
      region,
      aiClient,
      guard,
      ledger,
      killSwitch: () => config.KILL_SWITCH,
      rateLimiter: new RateLimiter(),
    },
  });

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err); // no secrets in exits
  process.exit(1);
});
