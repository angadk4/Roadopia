/**
 * RQ25 — the falsifiable diagnostic that decides whether the R25-U10 mix/
 * continuity ranking tier gets BUILT at all (pre-registered in the R25 plan).
 *
 * BD-39 killed the scalar country weight because within-pool countryScore
 * variance was ~0.007 — every candidate rode the same arterials, so ranking
 * had nothing to separate. If backroadShare has the same non-variance, a
 * threshold tier is inert too, and the honest move is to skip U10 and put the
 * effort into the connector rebuild (U19).
 *
 * PRE-REGISTERED RULE (fixed before running):
 *   BUILD U10  iff on ≥ 2/3 of briefs: SD(backroadShare) ≥ 0.05 AND ≥ 2 pool
 *              candidates straddle the backroad>main line.
 *   CONTINUITY-ONLY if backroadShare SD is thin but SD(backroadLongestM)
 *              ≥ 1,000 m on ≥ 2/3 of briefs.
 *   REFUSE U10 otherwise — record as a BD, budget moves to U19.
 *
 * Run: TSX_TSCONFIG_PATH=../backend/tsconfig.json npx tsx experiments/rq25_mix_variance.ts
 * (from eval/; a 12-brief subsample keeps it ~3 min — variance is a pool
 * property, not a suite property, so a spread subsample is representative.)
 */
import { Client } from 'pg';

import { generateLoopCandidates, resizedSpeed } from '../../backend/src/planner/candidates';
import { profileForRequest } from '../../backend/src/planner/costing';
import { assembleLoopWithRepair } from '../../backend/src/planner/loop';
import { parseRules } from '../../backend/src/planner/parse_rules';
import { retrieveAnchorPoints, retrieveCandidates } from '../../backend/src/planner/retrieve';
import { buildScope } from '../../backend/src/planner/scope';

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VALHALLA = 'http://127.0.0.1:8002';

// A spread subsample of the 48: urban, rural, escarpment, flat, west, east.
const BRIEFS = [
  '90 minute twisty loop from Hamilton, no highways',
  '2 hour scenic loop from Grimsby',
  '90 minute twisty loop from Georgetown',
  '2 hour loop from Caledon',
  '90 minute backroads loop from Bolton',
  '1 hour twisty loop from Uxbridge',
  '90 minute loop from Kitchener',
  '90 minute twisty loop from Belfountain',
  '2 hour twisty loop from Collingwood',
  '90 minute loop from Mississauga',
  '2 hour loop from London',
  '90 minute loop from Goderich',
] as const;

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  let buildVotes = 0;
  let contVotes = 0;
  let judged = 0;
  for (const brief of BRIEFS) {
    const constraints = parseRules(brief);
    const origin = constraints.origin as { lat: number; lng: number };
    const durationS = constraints.duration_target_s ?? 5400;
    const profile = profileForRequest(constraints, 'on');
    try {
      const scope = await buildScope(VALHALLA, { origin, shape: 'loop', durationS, alpha: 0.45 });
      const retrieved = await retrieveCandidates(db, scope, {});
      const anchorPoints = await retrieveAnchorPoints(db, scope);
      const speed = resizedSpeed(profile.sizingSpeedKmh, 1);
      const candidates = generateLoopCandidates(origin, retrieved.segments, retrieved.spots, {
        durationS,
        anchorPoints,
        avgSpeedKmh: speed,
      });
      const assembled = (
        await Promise.all(
          candidates.map(async (c) => {
            try {
              return await assembleLoopWithRepair(VALHALLA, origin, c, profile.options, {
                repairSegments: retrieved.segments,
              });
            } catch {
              return null;
            }
          }),
        )
      ).filter((a): a is NonNullable<typeof a> => a !== null && a.accepted);

      const mixes = assembled
        .map((a) => a.classMix)
        .filter((m): m is NonNullable<typeof m> => m !== null);
      const backs = mixes.map((m) => m.backroadShare);
      const longs = assembled.map((a) => a.backroadLongestM).filter((v): v is number => v !== null);
      const straddleUp = mixes.filter((m) => m.backroadShare > m.mainShare).length;
      const straddleDn = mixes.filter((m) => m.backroadShare <= m.mainShare).length;
      const straddles = Math.min(straddleUp, straddleDn) >= 1 && straddleUp + straddleDn >= 2;
      const sdBack = sd(backs);
      const sdLong = sd(longs);
      const buildVote = sdBack >= 0.05 && straddles && straddleUp >= 2;
      const contVote = sdLong >= 1000;
      if (mixes.length >= 2) {
        judged++;
        if (buildVote) buildVotes++;
        if (contVote) contVotes++;
      }
      console.log(
        `${brief.slice(0, 42).padEnd(44)} pool ${String(assembled.length).padStart(2)} · ` +
          `SD(backroad) ${sdBack.toFixed(3)} · backroad>main ${straddleUp}/${mixes.length} · ` +
          `SD(longestM) ${Math.round(sdLong)} · ${buildVote ? 'BUILD' : contVote ? 'CONT-ONLY' : 'inert'}`,
      );
    } catch (err) {
      console.log(
        `${brief.slice(0, 42).padEnd(44)} ERROR ${err instanceof Error ? err.message.slice(0, 50) : ''}`,
      );
    }
  }
  await db.end();

  console.log('\n-- RQ25 verdict (pre-registered) --');
  console.log(`briefs judged: ${judged}/${BRIEFS.length}`);
  console.log(`BUILD votes:      ${buildVotes}/${judged} (bar: ≥ 2/3)`);
  console.log(`CONTINUITY votes: ${contVotes}/${judged} (bar: ≥ 2/3)`);
  const twoThirds = Math.ceil((judged * 2) / 3);
  if (buildVotes >= twoThirds) console.log('VERDICT: BUILD U10 (mix + continuity grade)');
  else if (contVotes >= twoThirds) console.log('VERDICT: BUILD CONTINUITY HALF ONLY');
  else
    console.log('VERDICT: REFUSE U10 — ranking is inert on this pool (rq11 redux); budget → U19');
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
