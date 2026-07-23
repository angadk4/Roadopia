/**
 * R23 — direct out-and-back builder for FAR discovered drives.
 *
 * A far great road's LOOP balloons unpredictably (U6: the loop generator won't
 * retrace, so a 45-min-out road can yield a 5 h loop). An out-and-back is the
 * honest, predictable shape: route origin → road entry → road exit → origin via
 * the backroads (shortest) profile — ~2·driveOut + road. Deterministic; no LLM
 * (Hard rule A/F). Wrapped as a minimal PlannerResult so the /plan SSE flow +
 * ResultScreen consume it unchanged.
 */

import type { LatLng } from '@shared/types';

import { routeThrough, ValhallaRouteError } from '../valhalla/route';

import { BACKROADS } from './costing';
import type { PlannerResult } from './run';

export interface OutAndBackSpec {
  entry: LatLng;
  exit: LatLng;
  /** The road's name (corpus-derived) — the disclosure label. */
  name: string;
  /** The road's curviness (from /discover) — surfaced honestly on the result. */
  curviness?: number;
}

/** A minimal PlannerResult skeleton (out-and-back has no scoring/validation). */
function skeleton(): Omit<
  PlannerResult,
  'status' | 'route' | 'curviness' | 'disclosures' | 'waypoints'
> {
  return {
    score: null,
    validation: null,
    clarificationQuestion: null,
    events: [],
    elevation: null,
    iterations: 0,
    alternates: [],
    stops: [],
    countryScore: null,
    arterialShare: null,
    urbanShare: null,
  };
}

export async function buildOutAndBack(
  origin: LatLng,
  spec: OutAndBackSpec,
  deps: { valhallaUrl: string },
): Promise<PlannerResult> {
  try {
    const route = await routeThrough(deps.valhallaUrl, {
      waypoints: [
        [origin.lng, origin.lat],
        [spec.entry.lng, spec.entry.lat],
        [spec.exit.lng, spec.exit.lat],
        [origin.lng, origin.lat],
      ],
      costingOptions: BACKROADS.options,
      middleType: 'through',
    });
    const min = Math.round(route.duration_s / 60);
    return {
      ...skeleton(),
      status: 'ok',
      route,
      curviness: spec.curviness ?? null,
      disclosures: [`An out-and-back — out to ${spec.name} and back, about ${min} min.`],
      waypoints: [spec.entry, spec.exit],
    };
  } catch (err) {
    // no-route / engine error → a null-route result (the /plan handler already
    // renders this as a friendly "couldn't build" line, never a stack).
    const why =
      err instanceof ValhallaRouteError && err.noRoute
        ? `We couldn't find drivable roads out to ${spec.name} and back.`
        : `Couldn't build a drive out to ${spec.name} right now.`;
    return {
      ...skeleton(),
      status: 'unavailable',
      route: null,
      curviness: null,
      disclosures: [why],
      waypoints: [],
    };
  }
}
