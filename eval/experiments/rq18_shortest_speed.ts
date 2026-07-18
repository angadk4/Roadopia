/**
 * rq18 — sizing-speed recalibration for shortest-costing profiles (R18-1).
 *
 * The cluster-sizing model assumes fastest-path speeds (55 / 42 km/h under
 * BD-21). `shortest: true` connectors are slower per km; sizing must follow or
 * every loop under the new profiles overshoots its duration. Measurement:
 * 12 origin×duration pairs (dense + sparse mix), today's candidates, each
 * assembled TWICE — legacy costing vs shortest — median per-candidate duration
 * ratio decides the new speeds: v_short = round(v_legacy / median_ratio).
 *
 * Deterministic; one-time probe feeding costing.ts + the frozen config.
 * Run: npx tsx experiments/rq18_shortest_speed.ts   (from eval/, stack up)
 */

import { Client } from 'pg';

import { generateLoopCandidates } from '../../backend/src/planner/candidates';
import { assembleLoop } from '../../backend/src/planner/loop';
import { parseRules } from '../../backend/src/planner/parse_rules';
import { retrieveAnchorPoints, retrieveCandidates } from '../../backend/src/planner/retrieve';
import { buildScope } from '../../backend/src/planner/scope';

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

/** Dense + sparse origins × short + long budgets (from the fixed corpus). */
const PAIRS: Array<{ brief: string }> = [
  { brief: '90 minute loop from Hamilton' },
  { brief: '1 hour loop from Waterdown' },
  { brief: '2 hour loop from Creemore' },
  { brief: '90 minute loop from Belfountain' },
  { brief: '90 minute loop from Orangeville' },
  { brief: '2 hour loop from Goderich' },
  { brief: '1 hour loop from Uxbridge' },
  { brief: '2 hour loop from Barrie' },
  { brief: '90 minute loop from Guelph' },
  { brief: '1 hour loop from Brantford' },
  { brief: '2 hour loop from Peterborough' },
  { brief: '90 minute loop from Stratford' },
];

const LEGACY = { use_highways: 0.2, use_living_streets: 0 };
const SHORTEST = { shortest: true, use_living_streets: 0 };

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const allRatios: number[] = [];
  for (const { brief } of PAIRS) {
    const constraints = parseRules(brief);
    const origin = constraints.origin;
    if (origin === null || typeof origin === 'string') throw new Error(`origin: ${brief}`);
    const durationS = constraints.duration_target_s ?? 5400;

    const scope = await buildScope(VALHALLA, { origin, shape: 'loop', durationS });
    const retrieved = await retrieveCandidates(db, scope, { stopTypes: [] });
    const anchorPoints = await retrieveAnchorPoints(db, scope);
    const candidates = generateLoopCandidates(origin, retrieved.segments, retrieved.spots, {
      durationS,
      anchorPoints,
      avgSpeedKmh: 55,
    }).slice(0, 8);

    const ratios: number[] = [];
    for (const c of candidates) {
      try {
        const legacy = await assembleLoop(VALHALLA, origin, c, LEGACY);
        const short = await assembleLoop(VALHALLA, origin, c, SHORTEST);
        if (legacy.route.duration_s > 0) {
          ratios.push(short.route.duration_s / legacy.route.duration_s);
        }
      } catch {
        // unroutable candidate under either costing — skip (reported via count)
      }
    }
    const m = median(ratios);
    allRatios.push(...ratios);
    console.log(
      `${brief.padEnd(36)} candidates=${candidates.length} measured=${ratios.length} median r=${
        m === null ? '—' : m.toFixed(3)
      }`,
    );
  }
  await db.end();

  const m = median(allRatios);
  console.log(
    `\nglobal median ratio (shortest/legacy duration): ${m?.toFixed(3)} (n=${allRatios.length})`,
  );
  if (m !== null) {
    console.log(
      `recommended SHORTEST_SIZING_SPEED_KMH            = ${Math.round(55 / m)} (from 55)`,
    );
    console.log(
      `recommended SHORTEST_SIZING_SPEED_NO_HIGHWAY_KMH = ${Math.round(42 / m)} (from 42)`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
