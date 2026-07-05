/**
 * Typed Valhalla `/height` client — the `get_elevation_profile` tool backend (M2-T05).
 *
 * Returns the §50 `ElevationProfile` ({ series, climb_m }) for a route geometry, or
 * **null when the engine has no elevation dataset loaded** (Valhalla serves `/height`
 * with null heights unless elevation tiles were built — recorded 2026-07-05; the
 * shared `Route.elevation_profile` is nullable for exactly this case). Honest-null
 * beats fabricated zeros (Build Contract §4).
 */

import {
  GetElevationProfileOutputSchema,
  type GetElevationProfileOutput,
  type LineString,
} from '@shared/types';
import { z } from 'zod';

const HeightResponseSchema = z.object({
  // [distance_m, elevation_m | null] pairs when range=true
  range_height: z.array(z.tuple([z.number(), z.number().nullable()])).min(1),
});

/** Compute climb (Σ positive elevation deltas) over a non-null series. */
export function computeClimb(series: ReadonlyArray<{ dist_m: number; elev_m: number }>): number {
  let climb = 0;
  for (let i = 1; i < series.length; i++) {
    const d = series[i]!.elev_m - series[i - 1]!.elev_m;
    if (d > 0) climb += d;
  }
  return climb;
}

/** Map a raw /height response → ElevationProfile, or null if heights are absent. */
export function mapHeightResponse(body: unknown): GetElevationProfileOutput | null {
  const parsed = HeightResponseSchema.parse(body);
  const series = parsed.range_height
    .filter((pair): pair is [number, number] => pair[1] !== null)
    .map(([dist_m, elev_m]) => ({ dist_m, elev_m }));
  if (series.length === 0) return null; // no elevation dataset loaded — honest null
  return GetElevationProfileOutputSchema.parse({ series, climb_m: computeClimb(series) });
}

/** Fetch the elevation profile along a LineString (null = no elevation data). */
export async function getElevationProfile(
  baseUrl: string,
  geometry: LineString,
  { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
): Promise<GetElevationProfileOutput | null> {
  const payload = {
    shape: geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    range: true,
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/height`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await res.json();
  if (!res.ok) throw new Error(`Valhalla /height failed (HTTP ${res.status})`);
  return mapHeightResponse(body);
}
