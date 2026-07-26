/**
 * Valhalla /sources_to_targets client (R18-3) — the chain generator's hop-cost
 * oracle. One N×N matrix call prices every span-to-span connector so the
 * orienteering sweep can budget a 4-7-span chain WITHOUT routing candidates
 * speculatively.
 *
 * Probed live on the pinned 3.7.0 (2026-07-16): works with the shortest
 * costing profile; engine cap `max_matrix_location_pairs = 2500`
 * (infra/valhalla/valhalla.json) ⇒ ≤ 50×50 locations per call — the chain
 * pool (origin + 24 spans × 2 endpoints = 49) fits in ONE call by design.
 * Costing MUST match what /route will build (same profile options) or the
 * budget model lies.
 */

import { z } from 'zod';

import { realizeCostingOptions, type AutoCostingOptions } from './route';

const MatrixCellSchema = z.object({
  time: z.number().nonnegative().nullable(),
  distance: z.number().nonnegative().nullable(),
});

const MatrixResponseSchema = z.object({
  sources_to_targets: z.array(z.array(MatrixCellSchema)),
});

export interface MatrixCell {
  /** Seconds; null = unroutable pair (Valhalla could not connect them). */
  timeS: number | null;
  /** Metres; null = unroutable pair. */
  distanceM: number | null;
}

export class ValhallaMatrixError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(`sources_to_targets failed (HTTP ${statusCode}): ${message}`);
    this.name = 'ValhallaMatrixError';
  }
}

export interface MatrixRequest {
  /** [lng, lat] locations — used as BOTH sources and targets (square matrix). */
  locations: ReadonlyArray<readonly [number, number]>;
  costingOptions?: AutoCostingOptions;
  timeoutMs?: number;
}

/** Square travel matrix over the locations (result[i][j] = i → j). */
export async function travelMatrix(baseUrl: string, req: MatrixRequest): Promise<MatrixCell[][]> {
  const locs = req.locations.map(([lon, lat]) => ({ lat, lon }));
  const payload = {
    sources: locs,
    targets: locs,
    costing: 'auto',
    // R25-U2: same avoid-intent translation as /route (matrix budgets must not
    // be costed on roads the drive itself is forbidden from using)
    ...(req.costingOptions
      ? { costing_options: { auto: realizeCostingOptions(req.costingOptions) } }
      : {}),
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/sources_to_targets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(req.timeoutMs ?? 15_000),
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'unexpected error shape';
    throw new ValhallaMatrixError(res.status, msg);
  }
  const parsed = MatrixResponseSchema.parse(body);
  return parsed.sources_to_targets.map((row) =>
    row.map((cell) => ({
      timeS: cell.time,
      // Valhalla matrix distance unit is KILOMETRES (same as /route summaries)
      distanceM: cell.distance === null ? null : cell.distance * 1000,
    })),
  );
}
