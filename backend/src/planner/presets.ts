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

// Owner round 3 ("avoid the same road twice at all costs"): every preset's
// overlap weight got a floor raise — retracing is a cross-character sin.
export const PRESET_WEIGHTS: Record<Preset, WeightVector> = {
  // Scenic: duration flexible, curviness moderate; scenic term arms at [GATE-S].
  scenic: { dur: 0.2, cur: 0.25, stop: 0.2, scenic: 0, overlap: 0.25, uturn: 0.1, country: 0 },
  // Twisty: curviness dominates; duration is a loose envelope.
  twisty: { dur: 0.15, cur: 0.55, stop: 0.1, scenic: 0, overlap: 0.25, uturn: 0.05, country: 0 },
  // Chill: hit the time budget, gentle roads, minimal fuss.
  chill: { dur: 0.5, cur: 0.15, stop: 0.15, scenic: 0, overlap: 0.2, uturn: 0.05, country: 0 },
  // Simple (R16-4): the owner-facing RELABEL of chill — minimal turns, mostly
  // straight. EXACT same frozen numbers by design (BD-44-class product knob;
  // no new science). 'chill' stays a parse alias.
  simple: { dur: 0.5, cur: 0.15, stop: 0.15, scenic: 0, overlap: 0.2, uturn: 0.05, country: 0 },
  // Backroads: character over efficiency; overlap matters (no boring doubling).
  backroads: { dur: 0.2, cur: 0.4, stop: 0.1, scenic: 0, overlap: 0.25, uturn: 0.1, country: 0 },
  // Coffee-stop: the stop is the point.
  coffee_stop: {
    dur: 0.25,
    cur: 0.15,
    stop: 0.45,
    scenic: 0,
    overlap: 0.2,
    uturn: 0.05,
    country: 0,
  },
  // Avoid-highways: the avoidance itself is a hard constraint at parse; weights
  // stay balanced with a duration lean (backroad detours cost time).
  avoid_highways: {
    dur: 0.4,
    cur: 0.25,
    stop: 0.15,
    scenic: 0,
    overlap: 0.2,
    uturn: 0.05,
    country: 0,
  },
};

/** Resolve a preset (null → the default vector). */
export function weightsForPreset(preset: Preset | null): WeightVector {
  return preset ? PRESET_WEIGHTS[preset] : DEFAULT_WEIGHTS;
}
