/**
 * SPK-19 — end-to-end generation latency + cost envelope (Dependency
 * Verification §21; gates M7).
 *
 *   Pass: p50 < 15 s AND p90 < 25 s AND cost ~1–3¢ p50 (worst ≤ ~10¢).
 *
 * Measures the REAL /plan path in-process: live local Valhalla + Supabase
 * stack + LIVE Anthropic (Haiku parse, Sonnet explanation — the production
 * models; spend ≈ a dime, owner-approved test spend). Sequential runs = the
 * single-user interactive promise. Caveat recorded with the result: local
 * dev hardware, not the CX23 VPS — re-measure at M12 deploy (SPK-04 showed
 * the VPS beats this laptop on Valhalla latency).
 */

import { readFileSync } from 'node:fs';

import { loadServerConfig } from '@shared/config';
import { Client } from 'pg';

import { AiClient, anthropicTransport } from '../src/ai/client';
import { CostGuard } from '../src/ai/cost_guard';
import { MemoryLedger } from '../src/ai/ledger';
import { loadRegionPoly } from '../src/lib/region';
import { listen } from '../src/routes/sse_test_util';
import { buildServer } from '../src/server';

// prime env from the repo .env (never printed — rule H)
for (const line of readFileSync('../.env', 'utf8').split(/\r?\n/)) {
  const eq = line.indexOf('=');
  if (eq > 0 && !line.startsWith('#')) {
    const k = line.slice(0, eq).trim();
    if (!(k in process.env)) process.env[k] = line.slice(eq + 1).trim();
  }
}

const BRIEFS = [
  '90 minute twisty loop from Hamilton with a coffee stop, no highways',
  '1 hour backroads loop from Guelph',
  '2 hour scenic loop from Barrie',
  '75 minute twisty loop from London, no highways',
  '1 hour chill loop from Kitchener',
  '90 minute backroads loop from Elora with a viewpoint',
  '45 minute twisty loop from St. Jacobs',
  '2 hour loop from Orangeville, gravel is fine',
  '1 hour loop from Stratford, nothing crazy',
  '90 minute loop from Port Dover along the water',
  '1 hour twisty loop from Caledon',
  '80 minute loop from Cobourg with a coffee stop',
];

async function main(): Promise<void> {
  const config = loadServerConfig();
  const region = loadRegionPoly(`../${config.REGION_POLY_PATH}`, config.REGION_ID);
  const db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();

  const ledger = new MemoryLedger();
  const guard = new CostGuard({ ledger });
  const aiClient = new AiClient({
    guard,
    transport: anthropicTransport(config.ANTHROPIC_API_KEY),
  });

  const app = buildServer({
    plan: { db, valhallaUrl: config.VALHALLA_URL, region, aiClient, guard, ledger },
  });
  const { port, close } = await listen(app);

  const runs: Array<{
    brief: string;
    ms: number;
    costUsd: number;
    status: string;
    parser: string;
  }> = [];
  try {
    for (const brief of BRIEFS) {
      const before = ledger.entries().length;
      const t0 = performance.now();
      const res = await fetch(`http://127.0.0.1:${port}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: `SPK19: ${brief}` }),
      });
      const text = await res.text();
      const ms = performance.now() - t0;
      const costUsd = ledger
        .entries()
        .slice(before)
        .reduce((s, e) => s + e.costUsd, 0);
      const doneMatch = /"type":"done","status":"(\w+)"/.exec(text);
      const parserMatch = /parser=(\w+)/.exec(text);
      runs.push({
        brief,
        ms,
        costUsd,
        status: doneMatch?.[1] ?? 'none',
        parser: parserMatch?.[1] ?? '?',
      });
      console.log(
        `${Math.round(ms).toString().padStart(6)} ms  ${(costUsd * 100).toFixed(2)}¢  ` +
          `${(doneMatch?.[1] ?? 'none').padEnd(12)} parser=${parserMatch?.[1] ?? '?'}  ${brief.slice(0, 48)}`,
      );
    }
  } finally {
    await close();
    await db.query(`delete from ai_generation_requests where brief like 'SPK19:%'`);
    await db.end();
  }

  const sorted = [...runs].sort((a, b) => a.ms - b.ms);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!.ms;
  const costs = [...runs].sort((a, b) => a.costUsd - b.costUsd);
  const costP50 = costs[Math.floor(costs.length / 2)]!.costUsd;
  const withRoute = runs.filter((r) => ['ok', 'relaxed', 'best_so_far'].includes(r.status)).length;
  console.log(
    `\nSPK-19: n=${runs.length}  latency p50=${(q(0.5) / 1000).toFixed(1)}s  p90=${(q(0.9) / 1000).toFixed(1)}s  ` +
      `max=${(q(1) / 1000).toFixed(1)}s  cost p50=${(costP50 * 100).toFixed(2)}¢  ` +
      `max=${(Math.max(...runs.map((r) => r.costUsd)) * 100).toFixed(2)}¢  total=$${runs
        .reduce((s, r) => s + r.costUsd, 0)
        .toFixed(3)}  routes=${withRoute}/${runs.length}`,
  );
  const pass = q(0.5) < 15_000 && q(0.9) < 25_000 && costP50 <= 0.03;
  console.log(`SPK-19 ${pass ? 'PASS' : 'FAIL'} (bars: p50<15s, p90<25s, cost p50 ≤ 3¢)`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
