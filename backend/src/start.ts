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
  // node-postgres emits 'error' when the server closes the connection (restart,
  // idle timeout, network blip). Unhandled, that event takes the whole process
  // down — one dropped connection would take /plan, /discover and the photo
  // routes with it. Log and let the next query surface the failure honestly.
  db.on('error', (err: Error) => {
    console.error(`database connection error: ${err.message}`); // no secrets, no coordinates
  });

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

  // Hosted Supabase signs ES256 and the verifier uses JWKS (no env needed).
  // The LOCAL CLI stack signs HS256 with the documented demo secret — public
  // knowledge (same class as the demo anon key), applied ONLY to loopback
  // URLs so a deployed backend can never fall back to it (Hard rule H).
  const LOCAL_DEMO_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
  const isLocalSupabase = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(config.SUPABASE_URL);
  const hs256Secret =
    process.env['SUPABASE_JWT_SECRET'] ?? (isLocalSupabase ? LOCAL_DEMO_JWT_SECRET : undefined);
  const verifier = new JwtVerifier({
    issuer: `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`,
    ...(hs256Secret ? { hs256Secret } : {}),
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
    // R23: Discover (browse-class — no LLM/cost, its own rate limiter)
    discover: {
      db,
      valhallaUrl: config.VALHALLA_URL,
      region,
      rateLimiter: new RateLimiter(),
    },
    // M10-T05: spot photos (EXIF strip + re-encode; private bucket, service
    // role stays in this process — Hard rule H)
    photos: {
      db,
      storage: {
        url: config.SUPABASE_URL.replace(/\/$/, ''),
        serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
        bucket: 'photos',
      },
      // Storage + egress have no hard cap (Hard rule F), and image processing
      // is the most expensive thing a signed-in user can trigger. Tighter than
      // the browse limiters, looser than the planner's.
      rateLimiter: new RateLimiter({
        perIp: [
          { limit: 20, windowMs: 60_000 },
          { limit: 200, windowMs: 3_600_000 },
        ],
        perSession: [{ limit: 12, windowMs: 60_000 }],
      }),
    },
    // R25-U16c: /parse (browse-class rules parse — no LLM, no engine; fired
    // per debounced keystroke, so its limiter is deliberately looser than the
    // planner's: a bounded regex call costs nothing but CPU)
    parse: {
      rateLimiter: new RateLimiter({
        perIp: [
          { limit: 60, windowMs: 60_000 },
          { limit: 1_000, windowMs: 3_600_000 },
        ],
        perSession: [{ limit: 30, windowMs: 60_000 }],
      }),
    },
  });

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err); // no secrets in exits
  process.exit(1);
});
