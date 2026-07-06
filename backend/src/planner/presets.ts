/**
 * Preset weight vectors (M3-T10; Protocol §15, Spec §30/§35).
 *
 * Each §3.4 preset maps to a deterministic WeightVector "character". Values are
 * candidates (frozen at M4 [GATE-W]); the SCENIC weight stays 0 in every preset
 * until [GATE-S] passes (Hard rule C) — the 'scenic' preset expresses itself
 * through character tags + (post-gate) the scenic term.
 */

import type { Preset } from '@shared/types';

import { DEFAULT_WEIGHTS, type WeightVector } from './score';

export const PRESET_WEIGHTS: Record<Preset, WeightVector> = {
  // Scenic: duration flexible, curviness moderate; scenic term arms at [GATE-S].
  scenic: { dur: 0.2, cur: 0.25, stop: 0.2, scenic: 0, overlap: 0.25, uturn: 0.1 },
  // Twisty: curviness dominates; duration is a loose envelope.
  twisty: { dur: 0.15, cur: 0.55, stop: 0.1, scenic: 0, overlap: 0.15, uturn: 0.05 },
  // Chill: hit the time budget, gentle roads, minimal fuss.
  chill: { dur: 0.5, cur: 0.15, stop: 0.15, scenic: 0, overlap: 0.15, uturn: 0.05 },
  // Backroads: character over efficiency; overlap matters (no boring doubling).
  backroads: { dur: 0.2, cur: 0.4, stop: 0.1, scenic: 0, overlap: 0.2, uturn: 0.1 },
  // Coffee-stop: the stop is the point.
  coffee_stop: { dur: 0.25, cur: 0.15, stop: 0.45, scenic: 0, overlap: 0.1, uturn: 0.05 },
  // Avoid-highways: the avoidance itself is a hard constraint at parse; weights
  // stay balanced with a duration lean (backroad detours cost time).
  avoid_highways: { dur: 0.4, cur: 0.25, stop: 0.15, scenic: 0, overlap: 0.15, uturn: 0.05 },
};

/** Resolve a preset (null → the default vector). */
export function weightsForPreset(preset: Preset | null): WeightVector {
  return preset ? PRESET_WEIGHTS[preset] : DEFAULT_WEIGHTS;
}
