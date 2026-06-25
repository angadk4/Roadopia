/**
 * Small statistics helpers for the SPK-10 ranking report (Protocol §12 evaluation):
 * Spearman rank correlation (metric vs human ordinal) and the urban-grid false-positive
 * rate (fraction of known-grid roads scored above a candidate THETA_CURVY). Pure +
 * unit-tested — no I/O.
 */

/** Convert raw values to ranks, averaging ties (standard competition→fractional ranks). */
export function ranks(values: readonly number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    // ranks are 1-based; average rank for the tie group [i..j]
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]![1]] = avg;
    i = j + 1;
  }
  return out;
}

/** Pearson correlation of two equal-length vectors; 0 if a vector has no variance. */
export function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n === 0 || n !== y.length) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i]!;
    my += y[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** Spearman ρ = Pearson correlation of the ranks. */
export function spearman(x: readonly number[], y: readonly number[]): number {
  return pearson(ranks(x), ranks(y));
}

/**
 * Grid false-positive rate: among items the human labelled as urban-grid (ordinal 0),
 * the fraction whose metric value is at or above `theta` (i.e. wrongly "twisty").
 */
export function gridFalsePositiveRate(
  ordinals: readonly number[],
  metric: readonly number[],
  theta: number,
): number {
  let grid = 0;
  let fp = 0;
  for (let i = 0; i < ordinals.length; i++) {
    if (ordinals[i] === 0) {
      grid++;
      if (metric[i]! >= theta) fp++;
    }
  }
  return grid === 0 ? 0 : fp / grid;
}

/** A percentile (linear interpolation) of a numeric sample, p in [0,1]. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}
