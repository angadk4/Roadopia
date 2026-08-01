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
/**
 * Duration prefilter (SPK-15 owner finding: "timings seem off"): candidates whose
 * routed duration misses the target by more than this fraction are dropped BEFORE
 * dedup — they crowd the presented set with wrong-length loops. Applied only when
 * at least one candidate survives it (never empties the set). 0.5→0.35 (owner
 * round 6, "increase time accuracy"): with the resize retry recentring pools,
 * the presented set can afford the tighter band. M4 tunes.
 */
export const DURATION_PREFILTER = Number(process.env['DURATION_PREFILTER'] ?? 0.35);

/**
 * Drop wrong-duration candidates ahead of dedup. `duration` extracts seconds from
 * a candidate; no target (null) ⇒ pass-through unchanged.
 *
 * Fallback (owner round 3): when NOTHING lands inside the band, keep only the
 * single closest candidate — best-so-far honesty without presenting a pool of
 * wrong-length loops (a 173 %-off "90 minute" loop shipped under the old
 * keep-everything fallback). Deterministic: strict-lt keeps the first minimum.
 */
export function prefilterByDuration<T>(
  candidates: T[],
  targetS: number | null,
  duration: (c: T) => number,
  maxErr: number = DURATION_PREFILTER,
): T[] {
  if (targetS === null || targetS <= 0) return candidates;
  const within = candidates.filter((c) => Math.abs(duration(c) - targetS) / targetS <= maxErr);
  if (within.length > 0) return within;
  let best: T | null = null;
  let bestErr = Infinity;
  for (const c of candidates) {
    const err = Math.abs(duration(c) - targetS) / targetS;
    if (err < bestErr) {
      best = c;
      bestErr = err;
    }
  }
  return best === null ? [] : [best];
}

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
 * R26-C3 (BD-103) — exact max-dispersion selection when greedy under-delivers.
 * OFF = byte-identical (greedy alone).
 */
export const DIVERSIFY_MAXSET_ON = (process.env['DIVERSIFY_MAXSET'] ?? 'off') !== 'off';
/**
 * Candidates considered by the exact search, top-scored first. Bounds the
 * pairwise-overlap matrix at C(24,2)=276 comparisons on the ONLY briefs that
 * run it. Measured mean accepted-per-brief is 25.0, so this covers a typical
 * pool whole; when it truncates, `truncated` is reported rather than hidden
 * (a silent cap reads as "considered everything" when it did not).
 */
export const DIVERSIFY_MAXSET_POOL = 24;

/**
 * Largest mutually-compatible subset containing the top-scored candidate.
 *
 * WHY exact rather than another heuristic: greedy is already MAXIMAL — it
 * admits every candidate compatible with everything it has kept — so no
 * add-only pass can improve it. The only route to a bigger presented set is to
 * change WHICH candidates fill slots 2..k, which is a max-clique problem on the
 * compatibility graph. At k=4 that is a search over triples, and the graph is
 * built once from a memoized overlap matrix, so exactness is affordable here
 * and needs no tuning constant to defend later.
 *
 * Rank-1 is PINNED: the best-scoring route is always presented, unchanged.
 * Deterministic throughout — candidates enter in (score desc, id asc) order and
 * ties break on size, then summed score, then that same index order.
 */
function maxCompatibleSet<T extends Diversifiable>(
  sorted: T[],
  tauOverlap: number,
  kPresent: number,
): { kept: T[]; truncated: number } {
  const pool = sorted.slice(0, DIVERSIFY_MAXSET_POOL);
  const truncated = sorted.length - pool.length;
  const n = pool.length;
  if (n === 0 || kPresent <= 0) return { kept: [], truncated };

  // Compatibility adjacency, computed once. compat[i][j] ⇔ overlap ≤ τ.
  const compat: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ok = pairOverlap(pool[i]!.geometry, pool[j]!.geometry) <= tauOverlap;
      compat[i]![j] = ok;
      compat[j]![i] = ok;
    }
  }

  let bestSet: number[] = [0];
  let bestScore = pool[0]!.score;
  const current: number[] = [0];

  const extend = (from: number, score: number): void => {
    if (
      current.length > bestSet.length ||
      (current.length === bestSet.length && score > bestScore)
    ) {
      bestSet = [...current];
      bestScore = score;
    }
    if (current.length >= kPresent) return;
    for (let i = from; i < n; i++) {
      if (!current.every((c) => compat[c]![i])) continue;
      current.push(i);
      extend(i + 1, score + pool[i]!.score);
      current.pop();
    }
  };
  extend(1, pool[0]!.score);

  return { kept: bestSet.map((i) => pool[i]!), truncated };
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
    maxSet = DIVERSIFY_MAXSET_ON,
  }: { tauOverlap?: number; kPresent?: number; maxSet?: boolean } = {},
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

  // Only pay for the exact search where greedy actually under-delivered; a
  // brief that already reaches kPresent is untouched, which is what keeps the
  // OFF/ON diff confined to the failing population.
  if (maxSet && kept.length < kPresent && sorted.length > kept.length) {
    const { kept: maxKept } = maxCompatibleSet(sorted, tauOverlap, kPresent);
    if (maxKept.length > kept.length) {
      const keptIds = new Set(maxKept.map((c) => c.id));
      return {
        kept: maxKept,
        dropped: sorted
          .filter((c) => !keptIds.has(c.id))
          .map((c) => {
            let worst = { id: maxKept[0]!.id, overlap: 0 };
            for (const k of maxKept) {
              const o = pairOverlap(c.geometry, k.geometry);
              if (o > worst.overlap) worst = { id: k.id, overlap: o };
            }
            return { candidate: c, overlapWith: worst.id, overlap: worst.overlap };
          }),
      };
    }
  }
  return { kept, dropped };
}
