/**
 * Diversity dedup (M3-T09; Protocol §9 "diversity enforcement", Spec §29).
 *
 * Greedy: walk candidates in score order; keep one only if its pairwise
 * `edge_overlap` with EVERY kept candidate ≤ TAU_OVERLAP; stop at K_PRESENT.
 * Guarantees the presented set is genuinely different — near-duplicates and
 * mirror routes collapse to the best-scoring representative.
 */

import type { LineString } from '@shared/types';

import { pairOverlap } from './overlap';

/** Pairwise overlap ceiling for presented candidates (§3.6 default; M4 tunes). */
export const TAU_OVERLAP_DEFAULT = 0.6;
/** Presented-set size (§3.6 default; M4 tunes). */
export const K_PRESENT_DEFAULT = 4;

export interface Diversifiable {
  /** Routed geometry used for the overlap comparison. */
  geometry: LineString;
  /** Higher = better; the caller supplies the deterministic score (M3-T10). */
  score: number;
  id: string;
}

export interface DiversifyResult<T extends Diversifiable> {
  kept: T[];
  dropped: Array<{ candidate: T; overlapWith: string; overlap: number }>;
}

/**
 * Greedy overlap dedup. Input order does not matter — candidates are sorted by
 * score (desc) then id (deterministic ties) before the greedy walk.
 */
export function diversify<T extends Diversifiable>(
  candidates: T[],
  {
    tauOverlap = TAU_OVERLAP_DEFAULT,
    kPresent = K_PRESENT_DEFAULT,
  }: { tauOverlap?: number; kPresent?: number } = {},
): DiversifyResult<T> {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const kept: T[] = [];
  const dropped: Array<{ candidate: T; overlapWith: string; overlap: number }> = [];

  for (const candidate of sorted) {
    if (kept.length >= kPresent) break;
    let clash: { id: string; overlap: number } | null = null;
    for (const k of kept) {
      const overlap = pairOverlap(candidate.geometry, k.geometry);
      if (overlap > tauOverlap) {
        clash = { id: k.id, overlap };
        break;
      }
    }
    if (clash) {
      dropped.push({ candidate, overlapWith: clash.id, overlap: clash.overlap });
    } else {
      kept.push(candidate);
    }
  }
  return { kept, dropped };
}
