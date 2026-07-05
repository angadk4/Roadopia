/**
 * Typed Valhalla `/isochrone` client — the `get_isochrone` tool backend (M2-T05).
 * The isochrone bounds the planner's search scope Ω (Protocol §3.3). Response is
 * external input → zod-validated; output maps to the shared §50 shape.
 */

import {
  GetIsochroneOutputSchema,
  type GetIsochroneInput,
  type GetIsochroneOutput,
} from '@shared/types';
import { z } from 'zod';

const IsochroneResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal('Polygon'),
          // rings of [lon, lat]
          coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
        }),
      }),
    )
    .min(1),
});

/**
 * Fetch the drive-time isochrone around an origin. `time_s` is converted to
 * Valhalla's contour minutes. Returns the outer ring as §50 `{ polygon: LatLng[] }`.
 */
export async function getIsochrone(
  baseUrl: string,
  input: GetIsochroneInput,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<GetIsochroneOutput> {
  const payload = {
    locations: [{ lat: input.origin.lat, lon: input.origin.lng }],
    costing: input.costing,
    contours: [{ time: input.time_s / 60 }],
    polygons: true,
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/isochrone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await res.json();
  if (!res.ok) throw new Error(`Valhalla /isochrone failed (HTTP ${res.status})`);
  return mapIsochroneResponse(body);
}

/** Map a raw isochrone response body → §50 output (exported for fixture tests). */
export function mapIsochroneResponse(body: unknown): GetIsochroneOutput {
  const parsed = IsochroneResponseSchema.parse(body);
  const ring = parsed.features[0]!.geometry.coordinates[0]!;
  return GetIsochroneOutputSchema.parse({
    polygon: ring.map(([lon, lat]) => ({ lat, lng: lon })),
  });
}
