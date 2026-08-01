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

/**
 * R26-B2 (BD-99) — the TOP_SPEED connector profile. The B1 probe measured
 * `shortest` OFF + `top_speed: 50` at median **+39 pp backroad, worst case
 * 0 pp** across 8 live pairs, zero highway, zero hood change. `shortest`
 * bypasses every soft factor, so today's fun profile cannot honour any
 * use_* or penalty knob at all; dropping it re-arms them and a speed ceiling
 * prices fast roads out without a hard exclusion. ts70 was inert, ts60 gave
 * +22 pp, ts40 overshot into neighbourhood material (+7 pp hood) — 50 is the
 * measured knee, not a guess.
 *
 * Sizing speeds are DERIVED FROM THE PROBE's own duration ratio (×1.42), not
 * hand-picked: 50→35, 38→27 km/h. The resize ladder absorbs the remainder,
 * and the A/B's durErr bar is what catches it if this is wrong.
 */
/**
 * R27: DEFAULT FLIPPED TO OFF. BD-100 adopted this on eval evidence, but the
 * eval has no wall-clock budget and production has 25 s: with the country tier
 * also on, the planner exceeds it and ships a TRUNCATED `best_so_far`. The
 * owner has been driving truncated routes. Re-registration must measure
 * retrace and wall-clock, not just backroad share.
 */
export const CONNECTOR_TOPSPEED_ON = (process.env['CONNECTOR_TOPSPEED'] ?? 'off') !== 'off'; // R26-B2 ADOPTED (BD-100)
export const TOPSPEED_KMH = Number(process.env['CONNECTOR_TOPSPEED_KMH'] ?? 50);
/**
 * R26-C1 (BD-101) — seconds added at transitions between unlike-named roads.
 * Valhalla's default is 5. This knob has existed all along and has NEVER been
 * usable: under `shortest` every soft factor is bypassed, which R25-U9b
 * recorded explicitly as the reason turn density could not be attacked at the
 * router. BD-100 removed `shortest`, so this is live for the first time.
 * 0 = Valhalla default (knob absent from the payload).
 */
export const CONNECTOR_MANEUVER_PENALTY_S = Number(process.env['CONNECTOR_MANEUVER_PENALTY'] ?? 0);
const TOPSPEED_OPTIONS: AutoCostingOptions = {
  top_speed: TOPSPEED_KMH,
  use_living_streets: 0,
  ...(CONNECTOR_MANEUVER_PENALTY_S > 0 ? { maneuver_penalty: CONNECTOR_MANEUVER_PENALTY_S } : {}),
};
export const TOPSPEED_SIZING_SPEED_KMH = 35;
export const TOPSPEED_SIZING_SPEED_NO_HIGHWAY_KMH = 27;

/**
 * R26 (BD-111, owner decision 2026-07-29) — `top_speed` is a LOOP lever only.
 *
 * BD-99 REFUSED this exact option for A→B on a duration blocker, and BD-100 then
 * adopted it into `FUN_OPTIONS`/`FUN_SIZING`, which back both `FUN` and
 * `BACKROADS` — and `profileForRequest` serves loops AND A→B. So an A→B request
 * silently inherited a change its own suite had rejected, judged on loop
 * evidence. Measuring it afterwards (BD-108) found the roads much better but a
 * 3-of-14 duration tail (Barrie→Collingwood 76→129 min) — good numbers, but
 * gathered AFTER the fact, which is not how anything else in this program was
 * adopted. The owner chose to restore A→B to the state BD-99 actually judged and
 * re-register it on its own bars with a duration guard.
 *
 * Discover is deliberately NOT reverted: it consumes `BACKROADS` directly and its
 * drives ARE loops, and BD-109 measured it as neutral-to-better under the change.
 *
 * `TOPSPEED_ATOB=on` restores the leaked behaviour — it exists so the future A→B
 * A/B has a flag to flip rather than a revert to re-apply.
 */
export const TOPSPEED_ATOB_ON = (process.env['TOPSPEED_ATOB'] ?? 'off') !== 'off';

/** The fun/backroads connector shape under the adopted flag state. */
const FUN_OPTIONS = (): AutoCostingOptions =>
  CONNECTOR_TOPSPEED_ON ? TOPSPEED_OPTIONS : SHORTEST_OPTIONS;
const FUN_SIZING = (): { kmh: number; noHwyKmh: number } =>
  CONNECTOR_TOPSPEED_ON
    ? { kmh: TOPSPEED_SIZING_SPEED_KMH, noHwyKmh: TOPSPEED_SIZING_SPEED_NO_HIGHWAY_KMH }
    : { kmh: SHORTEST_SIZING_SPEED_KMH, noHwyKmh: SHORTEST_SIZING_SPEED_NO_HIGHWAY_KMH };

const FUN: CostingProfile = {
  id: 'fun',
  options: FUN_OPTIONS(),
  sizingSpeedKmh: FUN_SIZING().kmh,
  sizingSpeedNoHighwayKmh: FUN_SIZING().noHwyKmh,
};

/** The backroads (shortest) connector profile. Exported so R23 Discover sizes
 *  its reach matrix with the SAME costing the tap's /route builds (a discovery
 *  drive IS a backroads loop) — matrix.ts:11 warns the budget lies otherwise. */
export const BACKROADS: CostingProfile = {
  id: 'backroads',
  options: FUN_OPTIONS(),
  sizingSpeedKmh: FUN_SIZING().kmh,
  sizingSpeedNoHighwayKmh: FUN_SIZING().noHwyKmh,
};

/**
 * A→B variants — identical to FUN/BACKROADS except they keep the pre-BD-100
 * connector costing, because `top_speed` was never judged on an A→B bar.
 */
const atobVariant = (p: CostingProfile): CostingProfile =>
  TOPSPEED_ATOB_ON || !CONNECTOR_TOPSPEED_ON
    ? p
    : {
        ...p,
        options: SHORTEST_OPTIONS,
        sizingSpeedKmh: SHORTEST_SIZING_SPEED_KMH,
        sizingSpeedNoHighwayKmh: SHORTEST_SIZING_SPEED_NO_HIGHWAY_KMH,
      };
const FUN_ATOB: CostingProfile = atobVariant(FUN);
const BACKROADS_ATOB: CostingProfile = atobVariant(BACKROADS);

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
 *
 * R21-2 (2026-07-20) — 4TH judgment, owner-directed ("make the default drive
 * fun"), REFUSED again (BD-63). A/B (48-brief, OFF=false vs ON=true, with the
 * R21-0(a) corpus cleanup + R19 urban_share live): arterial mean 73→65 % (bar
 * ↓ ≥ 15 pp → MISSED at −8), AC 13→8 (−5), dirty units mean 1.76→3.49 (nearly
 * doubled), urban p80 11→16 % (the same residential/urban bleed that refused it
 * 3× before), durErr p80 17→20 %. Raw `shortest` on CHARACTERLESS briefs (no
 * backroads bundle to gate it) generates dirty cross-country routes — R19 +
 * corpus cleanup did NOT rescue it. The owner's "default drive is fun" ships
 * instead via the APP defaulting its draft to Backroads (R21-2b), which routes
 * plain generates through the ADOPTED backroads profile+bundle (R18-1: curv
 * 1.10→1.55, AC held) rather than raw shortest on the default bundle. So the
 * default USER experience is fun; only a raw characterless API call stays fast.
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
  // BD-111: the connector costing is shape-dependent — see TOPSPEED_ATOB_ON.
  const isLoop = c.shape === 'loop';
  if (c.preset === 'backroads' || c.preset === 'twisty' || (c.twistiness_pref ?? 0) >= 0.7) {
    return isLoop ? BACKROADS : BACKROADS_ATOB;
  }
  if (!FUN_DEFAULT_ADOPTED) return LEGACY;
  return isLoop ? FUN : FUN_ATOB;
}

/**
 * R25-U3 — a Fun & Explorative drive NEVER includes highway (owner decision,
 * 2026-07-26; audit-v11: 33/60 fun loops rode motorway/trunk, worst single run
 * 30.4 km, while the *Direct* button avoided highways 22× better). Imposed as
 * a HARD avoid at ladder init (run.ts) so it gets, for free: the working
 * costing lever (U2 translation), the no-highway sizing speed, rung-4
 * relaxation WITH disclosure where a region genuinely has no non-highway path,
 * and honest validation rows (U4 trace truth). `FUN_EXCLUDE_HIGHWAYS=off`
 * restores today's behaviour byte-identically.
 */
export const FUN_EXCLUDE_HIGHWAYS_ON = process.env['FUN_EXCLUDE_HIGHWAYS'] !== 'off';

/** Does this profile carry the imposed no-highway rule? (fun/backroads only —
 *  'simple' is Direct by request, A→B is exempt by owner decision.) */
export function profileExcludesHighways(p: CostingProfile): boolean {
  return FUN_EXCLUDE_HIGHWAYS_ON && (p.id === 'fun' || p.id === 'backroads');
}
