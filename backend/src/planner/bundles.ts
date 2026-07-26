/**
 * Character behavior bundles (R18-4) — the audit's fix for "the character
 * system is theater": presets used to differ ONLY by scoring weight vectors
 * that were mathematically inert (rq11: pool variance ~0.007 vs preset deltas
 * ~0.003 — twisty = backroads = plain briefs, byte-identical routes,
 * distinctness overlap 1.00 on 10/10 origins).
 *
 * A bundle is the SET of levers a character actually moves:
 *   - costing profile (via costing.ts — R18-1's adopted shortest lever);
 *   - the arterial presentation bar (the −2 tier fires earlier for characters
 *     that asked for backroads — threshold tiers work where scalar weights
 *     measurably couldn't, BD-39);
 *   - duration tolerance (simple = strictest: "minimal fuss" includes the
 *     clock);
 *   - an auto NICE-TO-HAVE viewpoint stop for scenic where the corpus has one
 *     (guarded by the R17-A detour cap + stop-aware repair — the ungated
 *     version measurably dragged loops and was removed; nice_to_have means
 *     rung 3 can drop it);
 *   - the frozen preset weight vectors (kept as tie-breakers — they are not
 *     the mechanism, but they are harmless and BD-30-frozen).
 *
 * Aliases (retired presets): chill → simple (frozen relabel, BD-44-class);
 * coffee_stop → default + its stop request (the parser already emits the
 * stop); avoid_highways → default (the parser already sets the hard avoid).
 *
 * [GATE-S] holds: NO scenic scoring anywhere — scenic differs by costing +
 * anti-urban arterial bar + the optional viewpoint stop only.
 */

import type { ParsedConstraints, Preset } from '@shared/types';

import { weightsForPreset } from './presets';
import type { WeightVector } from './score';
import { DURATION_TOLERANCE_DEFAULT } from './validate';

export type BundleId = 'twisty' | 'backroads' | 'scenic' | 'simple' | 'default';

/**
 * R25-U8a — scenic as a MODIFIER, not a competing bundle. Audit-v11 issue #10:
 * the app always ships a preset (DEFAULT_DRAFT seeds 'backroads'), so the
 * `preset !== null` branch below always wins and the scenic tag/pref branch is
 * DEAD in production — yet the result still gets tagged `scenic` and the AI
 * narrates from it. With this ON, a scenic ask COMPOSES onto whatever bundle
 * the preset resolved: tighten the urban bar to scenic's and arm the
 * nice-to-have viewpoint stop. No numeric scenic scoring anywhere — the same
 * threshold-plus-garnish scope scenic was always permitted ([GATE-S] holds).
 */
export const SCENIC_MODIFIER_ON = process.env['SCENIC_MODIFIER'] !== 'off'; // R25-U8a ADOPTED at freeze (suite-inert by construction; unit-proven)

export interface CharacterBundle {
  id: BundleId;
  /** Tie-break scoring vector (frozen BD-30 numbers via weightsForPreset). */
  weights: WeightVector;
  /** R25-U8a: true iff a scenic treatment actually RAN on this request —
   *  either the scenic bundle itself or the scenic modifier composed onto
   *  another bundle. `character_applied` derives from THIS, never the ask. */
  scenicApplied: boolean;
  /** Presentation demotion bar (R19): URBAN share above this → the −2 tier.
   *  Replaces R18-4's arterial bars — the owner's correction: "main roads are
   *  fine when surrounded by fields; neighbourhoods are not" (measured:
   *  Caledon East loop = 90 % arterial but 0.04 urban — a good drive the
   *  arterial bar was demoting). Calibration from measured route
   *  distributions: country loops ≈ 0.04, town-locked ≈ 0.23-0.32. */
  urbanShareSoft: number; // post-GRACE urban share (origin town-exit excluded)
  /** Duration tolerance for validation rows (simple tightens the clock). */
  durationTolerance: number;
  /** Scenic: add ONE nice-to-have viewpoint stop when none was asked for. */
  autoViewpointStop: boolean;
}

/** Alias table (retired presets → their living bundle). */
const PRESET_TO_BUNDLE: Record<Preset, BundleId> = {
  twisty: 'twisty',
  backroads: 'backroads',
  scenic: 'scenic',
  simple: 'simple',
  chill: 'simple',
  coffee_stop: 'default',
  avoid_highways: 'default',
};

const BUNDLES: Record<BundleId, Omit<CharacterBundle, 'weights' | 'scenicApplied'>> = {
  // Twisty: the ask is corners — town-heavy bests demote early.
  twisty: {
    id: 'twisty',
    urbanShareSoft: 0.15,
    durationTolerance: DURATION_TOLERANCE_DEFAULT,
    autoViewpointStop: false,
  },
  // Backroads: the ask is country CONTEXT — strictest bar.
  backroads: {
    id: 'backroads',
    urbanShareSoft: 0.12,
    durationTolerance: DURATION_TOLERANCE_DEFAULT,
    autoViewpointStop: false,
  },
  // Scenic (owner definition, R17): NOT urban — forests, farmland, lakes,
  // country roads. Anti-urban bar between backroads and default; a viewpoint
  // is a nice-to-have garnish, never the mechanism.
  scenic: {
    id: 'scenic',
    urbanShareSoft: 0.1,
    durationTolerance: DURATION_TOLERANCE_DEFAULT,
    autoViewpointStop: true,
  },
  // Simple: fewest turns, tightest clock — fastest-path connectors are the
  // ASK, so no arterial demotion at all.
  simple: {
    id: 'simple',
    urbanShareSoft: 1.0,
    durationTolerance: 0.15,
    autoViewpointStop: false,
  },
  // Default (R19): the plain ask also prefers NOT-town when the pool offers
  // it — the owner's "default is boring/ugly" finding. Demotion only, never a
  // gate: pool-poor urban origins still present their best with disclosure.
  default: {
    id: 'default',
    urbanShareSoft: 0.25,
    durationTolerance: DURATION_TOLERANCE_DEFAULT,
    autoViewpointStop: false,
  },
};

/**
 * Resolve the request's bundle. Deterministic precedence:
 *   1. explicit preset (aliases resolve);
 *   2. character tags / prefs the parser extracted (twisty pref ≥ 0.7 ≡ the
 *      twisty ask; 'backroad'/'rural' tags ≡ backroads; 'scenic' tag ≡ scenic);
 *   3. default.
 * The costing profile is resolved SEPARATELY by costing.ts (profileForRequest
 * keys on the same fields — one lever, one source of truth each).
 */
export function bundleForRequest(
  c: ParsedConstraints,
  opts?: { scenicModifier?: boolean }, // test seam; call sites use the env flag
): CharacterBundle {
  let id: BundleId;
  if (c.preset !== null) {
    id = PRESET_TO_BUNDLE[c.preset];
  } else if ((c.twistiness_pref ?? 0) >= 0.7 || c.character.includes('twisty')) {
    id = 'twisty';
  } else if (c.character.includes('backroad') || c.character.includes('rural')) {
    id = 'backroads';
  } else if (c.character.includes('scenic') || (c.scenic_pref ?? 0) >= 0.7) {
    id = 'scenic';
  } else {
    id = 'default';
  }
  // explicit presets keep their frozen vector (coffee_stop/avoid_highways
  // stay themselves even though their BUNDLE is default); tag-derived bundles
  // use their namesake vector
  const weights = c.preset !== null ? weightsForPreset(c.preset) : weightsForPreset(idAsPreset(id));
  const bundle: CharacterBundle = { ...BUNDLES[id], weights, scenicApplied: id === 'scenic' };
  // R25-U8a — the scenic MODIFIER: a scenic ask alongside a preset-resolved
  // bundle tightens the urban bar and arms the viewpoint garnish instead of
  // being silently discarded. Composes with every preset (incl. simple — the
  // urban bar is presentation-only demotion, never a gate).
  if (
    (opts?.scenicModifier ?? SCENIC_MODIFIER_ON) &&
    !bundle.scenicApplied &&
    (c.character.includes('scenic') || (c.scenic_pref ?? 0) >= 0.7)
  ) {
    bundle.urbanShareSoft = Math.min(bundle.urbanShareSoft, BUNDLES.scenic.urbanShareSoft);
    bundle.autoViewpointStop = true;
    bundle.scenicApplied = true;
  }
  return bundle;
}

function idAsPreset(id: BundleId): Preset | null {
  return id === 'default' ? null : id;
}
