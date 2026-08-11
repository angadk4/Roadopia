/**
 * R35-U11 (BD-166) — the UNAVOIDABLE ORIGIN STEM (Recovery §8).
 *
 * The fixed 1 km doubling grace approximated a network-topology fact with a
 * radius: a funnel subdivision may force 2.5 km of shared arterial before any
 * independent escape exists; a well-connected corner needs ~200 m. The stem
 * is MEASURED per request: route engine-fastest from the origin toward 8
 * compass targets and find how far the paths stay together — that shared
 * prefix is the "only way out", exempt from the doubling gate (the owner's
 * own "unless absolutely necessary"), disclosed when it is long. Repetition
 * beyond it remains a defect.
 */
import type { LatLng, RouteThroughOutput } from '@shared/types';

import { routeThrough, type AutoCostingOptions } from '../valhalla/route';

export const STEM_ON = (process.env['UNAVOIDABLE_STEM'] ?? 'on') !== 'off';
/** Fallback when the stem cannot be measured (engine errors): the old radius. */
export const STEM_FALLBACK_M = 1_000;
export const STEM_FLOOR_M = 300;
export const STEM_CAP_M = 4_000;
const TARGET_RADIUS_M = 7_000;
const STEP_M = 60;
/** Paths "together" = within this of the reference path at the same step. */
const TOGETHER_M = 100;
/** The stem needs this share of routed targets still together. */
const QUORUM = 0.75;

export type StemRouteFn = (
  url: string,
  req: {
    waypoints: ReadonlyArray<readonly [number, number]>;
    costingOptions?: AutoCostingOptions;
  },
) => Promise<RouteThroughOutput>;

function resample(coords: Array<[number, number]>, stepM: number): Array<[number, number]> {
  const latM = 111_320;
  const out: Array<[number, number]> = [coords[0]!];
  let carried = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const lngM = latM * Math.cos((a[1] * Math.PI) / 180);
    const segLen = Math.hypot((b[1] - a[1]) * latM, (b[0] - a[0]) * lngM);
    let d = stepM - carried;
    while (d <= segLen) {
      const t = d / segLen;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += stepM;
    }
    carried = segLen - (d - stepM);
  }
  return out;
}

/**
 * Measure the unavoidable stem length (metres) for an origin. Deterministic:
 * fixed bearings, fixed radius, quorum rule. Errors degrade gracefully to
 * the old fixed radius — never a throw in the serving path.
 */
export async function computeOriginStem(
  valhallaUrl: string,
  origin: LatLng,
  costingOptions: AutoCostingOptions,
  routeFn: StemRouteFn = routeThrough,
): Promise<number> {
  if (!STEM_ON) return STEM_FALLBACK_M;
  const latM = 111_320;
  const lngM = latM * Math.cos((origin.lat * Math.PI) / 180);
  const targets: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) {
    const b = (k * Math.PI) / 4;
    targets.push([
      origin.lng + (Math.sin(b) * TARGET_RADIUS_M) / lngM,
      origin.lat + (Math.cos(b) * TARGET_RADIUS_M) / latM,
    ]);
  }
  const paths: Array<Array<[number, number]>> = [];
  for (const t of targets) {
    try {
      const r = await routeFn(valhallaUrl, {
        waypoints: [
          [origin.lng, origin.lat],
          [t[0], t[1]],
        ],
        costingOptions,
      });
      const coords = r.geometry.coordinates as Array<[number, number]>;
      if (coords.length >= 2) paths.push(resample(coords, STEP_M));
    } catch {
      /* unroutable bearing (lake, boundary) — the quorum absorbs it */
    }
  }
  if (paths.length < 4) return STEM_FALLBACK_M;

  const ref = paths[0]!;
  const need = Math.ceil(paths.length * QUORUM);
  let stemSteps = 0;
  const maxSteps = Math.floor(STEM_CAP_M / STEP_M);
  for (let step = 1; step < Math.min(ref.length, maxSteps); step++) {
    const rp = ref[step]!;
    let together = 0;
    for (const p of paths) {
      const q = p[Math.min(step, p.length - 1)]!;
      const d = Math.hypot((q[1] - rp[1]) * latM, (q[0] - rp[0]) * lngM);
      if (d <= TOGETHER_M) together++;
    }
    if (together >= need) stemSteps = step;
    else break;
  }
  const stemM = stemSteps * STEP_M;
  return Math.min(STEM_CAP_M, Math.max(STEM_FLOOR_M, stemM));
}
