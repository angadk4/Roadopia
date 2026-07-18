/**
 * Connector costing profiles (R18-1; reopens BD-21 by owner directive).
 *
 * THE R18 audit's core finding: ~90-97 % of every route's meters are Valhalla
 * fastest-path connectors, and `use_highways` — the only class lever — is a
 * motorway/trunk-only step function, so primary/secondary arterials won every
 * connector by speed. The product was boring-by-construction, and no scoring
 * weight could fix material that was never generated (BD-39: "the pool, not
 * the ranking, was the blind spot").
 *
 * The lever (probed live on the pinned 3.7.0, 2026-07-16): `shortest: true`
 * removes the speed advantage — connector arterial share collapsed 99 %→5 %
 * and 81 %→34 % on real pairs for ~+5 min per 23 km hop. Under `shortest`
 * Valhalla bypasses the soft use_* factors entirely (hard exclude_* still
 * applies), so a shortest profile deliberately carries no use_* knobs — dead
 * knobs must not pretend to be levers. Residential bleed under shortest is
 * policed by the existing four-layer defense (hard 20 % share reject,
 * presentation demotes, repair, mid-waypoint search_filter).
 *
 * Sizing speeds: distance-optimal connectors are slower per km than
 * fastest-path, so each profile carries its own cluster-sizing speeds
 * (measured by eval/experiments/rq18_shortest_speed.ts — the probe, not a
 * guess; legacy keeps the frozen 55/42).
 *
 * Adoption discipline (§21): profiles ship per the pre-registered 48-brief
 * A/B vs the R18-0 baseline (arterial ↓ ≥ 15 pp, curv not ↓ > 5 %, AC not
 * down, no-route not up, durErr ≤ +2 pp, ms ≤ 5 s). `legacy` is the
 * byte-identical rollback (config `costing_profiles: "off"`).
 */

import type { ParsedConstraints } from '@shared/types';

import type { AutoCostingOptions } from '../valhalla/route';

export type CostingProfileId = 'fun' | 'backroads' | 'simple' | 'legacy';

export interface CostingProfile {
  id: CostingProfileId;
  /** Merged over the loop.ts biasedCosting base (caller options win). */
  options: AutoCostingOptions;
  /** Cluster-sizing speed (replaces the frozen 55 km/h when this profile is on). */
  sizingSpeedKmh: number;
  /** No-highway sizing speed (replaces the frozen 42 km/h). */
  sizingSpeedNoHighwayKmh: number;
}

/** Today's behavior, exactly — the rollback path (BD-21 numbers). */
const LEGACY: CostingProfile = {
  id: 'legacy',
  options: { use_highways: 0.2, use_living_streets: 0 },
  sizingSpeedKmh: 55,
  sizingSpeedNoHighwayKmh: 42,
};

/**
 * Sizing speeds for shortest-costing profiles — MEASURED by the rq18 probe
 * (2026-07-16, 12 origin×duration pairs × 8 candidates = 96 paired
 * assemblies; global median shortest/legacy duration ratio 1.098):
 * 55/1.098 → 50, 42/1.098 → 38. Not hand-picked.
 */
export const SHORTEST_SIZING_SPEED_KMH = 50;
export const SHORTEST_SIZING_SPEED_NO_HIGHWAY_KMH = 38;

const SHORTEST_OPTIONS: AutoCostingOptions = { shortest: true, use_living_streets: 0 };

const FUN: CostingProfile = {
  id: 'fun',
  options: SHORTEST_OPTIONS,
  sizingSpeedKmh: SHORTEST_SIZING_SPEED_KMH,
  sizingSpeedNoHighwayKmh: SHORTEST_SIZING_SPEED_NO_HIGHWAY_KMH,
};

const BACKROADS: CostingProfile = {
  id: 'backroads',
  options: SHORTEST_OPTIONS,
  sizingSpeedKmh: SHORTEST_SIZING_SPEED_KMH,
  sizingSpeedNoHighwayKmh: SHORTEST_SIZING_SPEED_NO_HIGHWAY_KMH,
};

/** Simple asked for FEWER turns — shortest ADDS turns; keep fastest-path. */
const SIMPLE: CostingProfile = { ...LEGACY, id: 'simple' };

export type CostingMode = 'on' | 'legacy';

/**
 * A/B OUTCOME (2026-07-16, 48-brief fixed suite vs the R18-0 baseline, per the
 * pre-registered per-profile rules):
 *   - `backroads` (twisty/backroads asks, 17 briefs): arterial 70 %→58 %,
 *     curviness 1.10→1.55 (+41 %), AC held 4/17 → **ADOPTED**.
 *   - `fun` as the characterless default (31 briefs): arterial 80 %→64 % and
 *     curv +45 %, BUT AC 7→4 with one new no-route (residential bleed 20 % on
 *     Fonthill, new u-turn/overlap offences) → **REFUSED for now** per the
 *     pre-registered mitigation (scope shortest to backroads; never tighten
 *     gates). The failures are repair-class offences — revisit the fun default
 *     after R18-2 lands repair v2 + graded dirtiness + never-empty
 *     (FUN_DEFAULT_ADOPTED below is the single flip point).
 */
/**
 * RE-JUDGED after R18-2 (repair v2 + graded dirtiness + never-empty): fun-on
 * vs fun-off, both with R18-2 — AC 19→13 with 1 no-route returning; arterial
 * 72→61 % was real but the quality cost stands. REFUSED a second time.
 * Next re-judgment: after R18-3 (chained multi-span candidates) — chains put
 * shortest connectors between NEARBY spans (2-5 km hops), a different regime
 * than 17 km cross-country shortest connectors.
 */
export const FUN_DEFAULT_ADOPTED = false;

/**
 * Resolve the request's connector costing profile. Deterministic:
 *   - mode 'legacy' (kill switch) → legacy, always;
 *   - preset simple/chill → simple (fastest-path is what "minimal turns" means);
 *   - preset backroads/twisty OR twistiness_pref ≥ 0.7 → backroads (shortest);
 *   - everything else → fun (shortest) once adopted; legacy until then.
 */
export function profileForRequest(c: ParsedConstraints, mode: CostingMode): CostingProfile {
  if (mode === 'legacy') return LEGACY;
  if (c.preset === 'simple' || c.preset === 'chill') return SIMPLE;
  if (c.preset === 'backroads' || c.preset === 'twisty' || (c.twistiness_pref ?? 0) >= 0.7) {
    return BACKROADS;
  }
  return FUN_DEFAULT_ADOPTED ? FUN : LEGACY;
}
