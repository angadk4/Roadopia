import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { ParsedConstraintsSchema, type ParsedConstraints } from './constraints';
import { GenerationEventSchema, type GenerationEvent } from './events';
import { cleanLegManeuvers, RouteSchema, type Maneuver, type Route } from './route';
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

describe('cleanLegManeuvers (device pass, 2026-09-07)', () => {
  // Two legs as the engine returns a hand-built drive with one waypoint on
  // Kennedy Road: leg 1 "arrives" at the waypoint, leg 2 "starts" again there.
  const TWO_LEGS: Maneuver[] = [
    {
      type: 'start',
      instruction: 'Drive east on Main Street.',
      distance_m: 400,
      street_names: ['Main Street'],
    },
    {
      type: 'right',
      instruction: 'Turn right onto Kennedy Road.',
      distance_m: 64,
      street_names: ['Kennedy Road'],
    },
    { type: 'destination_left', instruction: 'Your destination is on the left.', distance_m: 0 },
    {
      type: 'start',
      instruction: 'Drive northwest on Kennedy Road.',
      distance_m: 1578,
      street_names: ['Kennedy Road'],
    },
    {
      type: 'left',
      instruction: 'Turn left onto Old School Road.',
      distance_m: 5300,
      street_names: ['Old School Road'],
    },
    { type: 'destination', instruction: 'You have arrived at your destination.', distance_m: 0 },
  ];

  it('drops the mid-drive arrival and folds a same-road departure into the turn before it', () => {
    const out = cleanLegManeuvers(TWO_LEGS);
    expect(out.map((m) => m.instruction)).toEqual([
      'Drive east on Main Street.',
      'Turn right onto Kennedy Road.',
      'Turn left onto Old School Road.',
      'You have arrived at your destination.',
    ]);
    // the turn onto Kennedy now spans its own 64 m plus the folded leg: the
    // running sum still reaches the end of the drive
    expect(out[1]!.distance_m).toBe(64 + 1578);
    expect(out.reduce((s, m) => s + (m.distance_m ?? 0), 0)).toBe(
      TWO_LEGS.reduce((s, m) => s + (m.distance_m ?? 0), 0),
    );
    expect(out.some((m) => m.type.startsWith('destination') && m !== out[out.length - 1])).toBe(
      false,
    );
  });

  it('a departure onto a DIFFERENT road at the waypoint stays as a continuation cue', () => {
    const out = cleanLegManeuvers([
      TWO_LEGS[0]!,
      TWO_LEGS[1]!,
      TWO_LEGS[2]!,
      {
        type: 'start_right',
        instruction: 'Drive north on Side Road 5.',
        distance_m: 900,
        street_names: ['Side Road 5'],
      },
      TWO_LEGS[5]!,
    ]);
    expect(out.map((m) => [m.type, m.instruction])).toEqual([
      ['start', 'Drive east on Main Street.'],
      ['right', 'Turn right onto Kennedy Road.'],
      ['continue', 'Drive north on Side Road 5.'],
      ['destination', 'You have arrived at your destination.'],
    ]);
    expect(out[2]!.distance_m).toBe(900);
  });

  it('a single-leg list is returned as-is (copied), and the input is never mutated', () => {
    const single = TWO_LEGS.slice(0, 2).concat(TWO_LEGS[5]!);
    const before = JSON.stringify(single);
    const out = cleanLegManeuvers(single);
    expect(out).toEqual(single);
    expect(out[0]).not.toBe(single[0]);
    cleanLegManeuvers(TWO_LEGS);
    expect(JSON.stringify(single)).toBe(before);
    expect(TWO_LEGS[1]!.distance_m).toBe(64);
  });

  it('an empty list and a lone arrival are left alone', () => {
    expect(cleanLegManeuvers([])).toEqual([]);
    const lone: Maneuver[] = [
      { type: 'destination', instruction: 'You have arrived.', distance_m: 0 },
    ];
    expect(cleanLegManeuvers(lone)).toEqual(lone);
  });
});

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
      stops: [],
    };
    expectRoundTrip(RouteSchema, route);
  });

  it('Route accepts the "Link only" visibility the DB stores (review, 2026-09-07)', () => {
    const base = {
      geometry,
      is_loop: true,
      waypoints: [],
      distance_m: 1000,
      duration_s: 60,
      curviness: 0,
      elevation_profile: null,
      climb_m: null,
      highway_flag: false,
      toll_flag: false,
      ferry_flag: false,
      unpaved_flag: false,
      character_tags: [],
      intensity: 'chill',
      free_tags: [],
      owner_id: null,
      origin_type: 'manual',
      forked_from: null,
    };
    expect(RouteSchema.safeParse({ ...base, visibility: 'unlisted' }).success).toBe(true);
    expect(RouteSchema.safeParse({ ...base, visibility: 'secret' }).success).toBe(false);
  });

  it('Route carries the R28 three-leg split, and stays valid WITHOUT it', () => {
    // The app zod-validates strictly and installed builds cannot be force-updated,
    // so `legs` must be additive: an older payload with no legs must still parse.
    const base: Route = {
      geometry,
      is_loop: true,
      waypoints: [origin],
      distance_m: 42000,
      duration_s: 5400,
      curviness: 0.42,
      elevation_profile: null,
      climb_m: null,
      highway_flag: false,
      toll_flag: false,
      ferry_flag: false,
      unpaved_flag: false,
      character_tags: [],
      intensity: 'spirited',
      free_tags: [],
      visibility: 'public',
      owner_id: null,
      origin_type: 'ai',
      forked_from: null,
      stops: [],
    };
    expectRoundTrip(RouteSchema, base); // no legs — the pre-R28 shape
    expectRoundTrip(RouteSchema, {
      ...base,
      legs: {
        there_pct: 28,
        drive_pct: 49,
        home_pct: 23,
        there_m: 11760,
        drive_m: 20580,
        home_m: 9660,
        drive_backroad_pct: 46,
        drive_main_pct: 51,
      },
    });
    // an A→B route has no drive span to report
    expectRoundTrip(RouteSchema, { ...base, is_loop: false, legs: null });
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

  it('ParsedConstraints (§3.4 shape)', () => {
    const pc: ParsedConstraints = {
      origin,
      destination: null,
      shape: 'loop',
      duration_target_s: 5400,
      distance_target_m: null,
      stops: [{ type: 'coffee', count: 1, importance: 'nice_to_have', at_fraction: null }],
      avoid: { highways: true, tolls: false, ferries: false, unpaved: true },
      surface_pref: 'paved',
      character: ['twisty', 'flowing'],
      scenic_pref: 0.6,
      twistiness_pref: 0.8,
      intensity: 'moderate',
      preset: null,
      weights: { curviness: 0.6, scenic: 0.3, duration: 0.1 },
      location_constraints: [],
      ambiguous_terms: [],
      missing: [],
      contradictions: [],
      confidence: { overall: 0.9, fields: {} },
      clarification: { needed: false, question: null },
      unsafe_flag: false,
      out_of_region_flag: false,
      prompt_injection_flag: false,
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
      legs: [],
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
