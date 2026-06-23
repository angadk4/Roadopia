import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { ParsedConstraintsSchema, type ParsedConstraints } from './constraints';
import { GenerationEventSchema, type GenerationEvent } from './events';
import { RouteSchema, type Route } from './route';
import { SpotSchema, type Spot } from './spot';
import {
  CandidateSelectionSchema,
  CorrectionMoveSchema,
  EstimateDriveTimeInputSchema,
  EstimateDriveTimeOutputSchema,
  ExplanationSchema,
  FindCurvyRoadsInputSchema,
  FindCurvyRoadsOutputSchema,
  FindSpotsInputSchema,
  FindSpotsOutputSchema,
  GetElevationProfileInputSchema,
  GetElevationProfileOutputSchema,
  GetIsochroneInputSchema,
  GetIsochroneOutputSchema,
  OptimizeWaypointOrderInputSchema,
  OptimizeWaypointOrderOutputSchema,
  RouteThroughInputSchema,
  RouteThroughOutputSchema,
} from './tools';

/** Parse → JSON serialize → re-parse → expect a faithful round-trip. */
function expectRoundTrip<S extends z.ZodTypeAny>(schema: S, value: z.infer<S>): void {
  const parsed = schema.parse(value);
  const reparsed = schema.parse(JSON.parse(JSON.stringify(parsed)));
  expect(reparsed).toEqual(parsed);
}

const origin = { lat: 43.2557, lng: -79.8711 };
const geometry = {
  type: 'LineString' as const,
  coordinates: [
    [-79.8711, 43.2557],
    [-79.86, 43.26],
    [-79.8711, 43.2557],
  ] as [number, number][],
};

describe('domain schemas round-trip parse/serialize', () => {
  it('Route', () => {
    const route: Route = {
      geometry,
      is_loop: true,
      waypoints: [origin, { lat: 43.26, lng: -79.86 }],
      distance_m: 42000,
      duration_s: 5400,
      curviness: 0.42,
      elevation_profile: { series: [{ dist_m: 0, elev_m: 90 }], climb_m: 120 },
      climb_m: 120,
      highway_flag: false,
      toll_flag: false,
      ferry_flag: false,
      unpaved_flag: false,
      character_tags: ['twisty', 'scenic'],
      intensity: 'spirited',
      free_tags: ['niagara'],
      visibility: 'public',
      owner_id: null,
      origin_type: 'ai',
      forked_from: null,
    };
    expectRoundTrip(RouteSchema, route);
  });

  it('Spot', () => {
    const spot: Spot = {
      location: origin,
      type: 'viewpoint',
      name: 'Devil’s Punchbowl',
      owner_id: null,
      source: 'osm',
    };
    expectRoundTrip(SpotSchema, spot);
  });

  it('ParsedConstraints', () => {
    const pc: ParsedConstraints = {
      origin_area: origin,
      duration_target_s: 5400,
      duration_tolerance: 0.1,
      shape: 'loop',
      character_prefs: ['twisty', 'flowing'],
      hard_constraints: { no_highways: true, no_tolls: false, no_ferries: false, no_unpaved: true },
      desired_stops: [{ type: 'coffee', count: 1 }],
      weights: { curviness: 0.6, scenic: 0.3, duration: 0.1 },
    };
    expectRoundTrip(ParsedConstraintsSchema, pc);
  });

  it('tool I/O schemas', () => {
    expectRoundTrip(FindSpotsInputSchema, { origin, types: ['coffee'], limit: 5 });
    expectRoundTrip(FindSpotsOutputSchema, [
      { id: 's1', name: 'Cafe', type: 'coffee', lat: 43.25, lng: -79.87, source: 'user' },
    ]);
    expectRoundTrip(FindCurvyRoadsInputSchema, {
      bbox: [-80, 43, -79, 44],
      min_curviness: 0.3,
    });
    expectRoundTrip(FindCurvyRoadsOutputSchema, [
      { id: 'c1', osm_way_id: '12345678', curviness: 0.7, road_class: 'tertiary', geometry },
    ]);
    expectRoundTrip(RouteThroughInputSchema, {
      waypoints: [origin, { lat: 43.26, lng: -79.86 }],
      costing_profile: 'auto',
    });
    expectRoundTrip(RouteThroughOutputSchema, {
      geometry,
      distance_m: 42000,
      duration_s: 5400,
      maneuvers: [{ type: 'turn', instruction: 'Turn left', distance_m: 300 }],
      has_highway: false,
      has_toll: false,
      has_ferry: false,
      has_unpaved: false,
    });
    expectRoundTrip(GetElevationProfileInputSchema, { geometry });
    expectRoundTrip(GetElevationProfileOutputSchema, {
      series: [{ dist_m: 0, elev_m: 90 }],
      climb_m: 120,
    });
    expectRoundTrip(EstimateDriveTimeInputSchema, { geometry });
    expectRoundTrip(EstimateDriveTimeOutputSchema, { duration_s: 5400 });
    expectRoundTrip(GetIsochroneInputSchema, { origin, time_s: 2700, costing: 'auto' });
    expectRoundTrip(GetIsochroneOutputSchema, {
      polygon: [origin, { lat: 43.3, lng: -79.9 }, { lat: 43.2, lng: -79.8 }],
    });
    expectRoundTrip(OptimizeWaypointOrderInputSchema, {
      waypoints: [origin, { lat: 43.26, lng: -79.86 }],
      costing: 'auto',
    });
    expectRoundTrip(OptimizeWaypointOrderOutputSchema, { ordered_indices: [0, 1] });
  });

  it('LLM decision I/O schemas', () => {
    expectRoundTrip(CandidateSelectionSchema, {
      chosen_candidate_id: 'cand-2',
      rationale_short: 'best fit',
    });
    expectRoundTrip(CorrectionMoveSchema, {
      move: 'relax_soft',
      params: { objective: 'duration' },
    });
    expectRoundTrip(ExplanationSchema, {
      text: 'A twisty loop with one coffee stop.',
      satisfied: ['no_highways', 'coffee'],
      relaxed: [],
    });
  });

  it('GenerationEvent (each variant)', () => {
    const events: GenerationEvent[] = [
      { type: 'step', step: 'parse', status: 'started' },
      { type: 'tool_call', tool: 'find_curvy_roads' },
      { type: 'tool_result', tool: 'find_curvy_roads', ok: true, count: 7 },
      { type: 'explanation', explanation: { text: 'why', satisfied: [], relaxed: [] } },
      { type: 'error', message: 'planner temporarily unavailable' },
      { type: 'done', status: 'ok' },
    ];
    for (const ev of events) expectRoundTrip(GenerationEventSchema, ev);
  });
});
