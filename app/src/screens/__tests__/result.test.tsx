/**
 * RouteDetail / Result smoke (M7-T05) — the shared detail component renders
 * honest stats (≈ routed time), the ACTUAL constraint verdicts (FR-044),
 * relaxed/best-so-far banners (§18 copy), the grounded explanation, and the
 * FR-400 disclaimer — with no dead action buttons before M8.
 */
import type { Route } from '@shared/types';
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import RouteDetail from '../../components/RouteDetail';
import ResultScreen from '../ResultScreen';

const ROUTE: Route = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.98, 43.22],
      [-79.9, 43.26],
      [-79.88, 43.2],
      [-79.98, 43.22],
    ] as Array<[number, number]>,
  },
  geometry_simplified: null,
  bbox: null,
  is_loop: true,
  waypoints: [],
  distance_m: 67800,
  duration_s: 4500,
  curviness: 1.4,
  elevation_profile: null,
  climb_m: 312,
  highway_flag: false,
  toll_flag: false,
  ferry_flag: false,
  unpaved_flag: true,
  character_tags: ['twisty', 'rural'],
  intensity: 'moderate',
  free_tags: [],
  visibility: 'private',
  owner_id: null,
  origin_type: 'ai',
  forked_from: null,
  generation_request_id: null,
  satisfied_constraints: [
    {
      constraint: 'duration_target',
      tier: 3,
      status: 'satisfied',
      detail: '75 min vs 90 min asked',
    },
    {
      constraint: 'avoid_highways',
      tier: 2,
      status: 'relaxed',
      detail: 'about 3 km of highway was unavoidable from this start',
    },
    {
      constraint: 'coffee_stop',
      tier: 2,
      status: 'violated',
      detail: 'no coffee spot lies on the route',
    },
    { constraint: 'avoid_ferries', tier: 2, status: 'not_applicable', detail: '' },
  ],
  agent_explanation: null,
  stops: [],
};

const EXPLANATION = {
  text: 'This 68 km loop follows six named backroads with sustained curves along the escarpment.',
  satisfied: ['duration'],
  relaxed: ['no-highways could not be fully honoured'],
};

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

describe('RouteDetail', () => {
  it('renders map, honest stats, tags, flags, constraint verdicts, explanation, disclaimer', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<RouteDetail route={ROUTE} explanation={EXPLANATION} done="ok" />);
    });
    const text = textOf(tree);
    expect(text).toContain('mapbox-mapview');
    expect(text).toContain('mapbox-linelayer');
    expect(text).toContain('67.8 km');
    expect(text).toContain('≈75 min'); // honest routed time (BD-42)
    expect(text).toContain('loop');
    expect(text).toContain('312 m');
    expect(text).toContain('twisty');
    expect(text).toContain('includes unpaved'); // result-scanned flag
    expect(text).not.toContain('includes highway'); // false flags stay silent
    // constraint verdicts — actual, all three states, NA hidden
    expect(text).toContain('duration target');
    expect(text).toContain('about 3 km of highway');
    expect(text).toContain('no coffee spot lies on the route');
    expect(text).not.toContain('avoid ferries');
    // explanation + relaxed disclosure
    expect(text).toContain('sustained curves along the escarpment');
    expect(text).toContain('no-highways could not be fully honoured');
    // FR-400 disclaimer, no dead M8 actions
    expect(text).toContain('Drive to conditions');
    expect(text).not.toMatch(/"Save"|"Share"|"Navigate"/);
    // attribution on the detail map too (FR-014)
    expect(text).toContain('OpenStreetMap contributors');
  });

  it('shows the relaxed banner for done=relaxed and the §18 timeout copy for best_so_far', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<RouteDetail route={ROUTE} explanation={null} done="relaxed" />);
    });
    expect(textOf(tree)).toContain('Some preferences were relaxed');
    act(() => {
      tree = create(<RouteDetail route={ROUTE} explanation={null} done="best_so_far" />);
    });
    expect(textOf(tree)).toContain("I ran out of time; here's the best I found.");
  });

  it('R16-5: real stops render as drive-order rows with measured arrivals (null = no time shown)', () => {
    const withStops: Route = {
      ...ROUTE,
      stops: [
        {
          name: 'Transit Fuel',
          type: 'fuel',
          requested_type: 'fuel',
          arrival_s: 3120,
          at_fraction: 0.75,
          location: { lat: 43.31, lng: -79.92 },
          waypoint_index: 2,
        },
        {
          name: 'Ridge Café',
          type: 'coffee',
          requested_type: 'coffee',
          arrival_s: 2400,
          at_fraction: 0.5,
          location: { lat: 43.3, lng: -79.9 },
          waypoint_index: 1,
        },
        {
          name: 'Lookout Point',
          type: 'viewpoint',
          requested_type: 'viewpoint',
          arrival_s: null, // honest unmeasured — no fabricated time
          at_fraction: null,
          location: { lat: 43.32, lng: -79.94 },
          waypoint_index: 3,
        },
      ],
    };
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<RouteDetail route={withStops} explanation={null} done="ok" />);
    });
    const text = textOf(tree);
    expect(text).toContain('Stops');
    expect(text).toContain('Ridge Café · coffee · ≈40 min in');
    expect(text).toContain('Transit Fuel · fuel · ≈52 min in');
    expect(text).toContain('Lookout Point · viewpoint'); // no "min in" when unmeasured
    expect(text).not.toContain('Lookout Point · viewpoint ·');
    // drive order (arrival asc): café before fuel despite fixture order
    expect(text.indexOf('Ridge Café')).toBeLessThan(text.indexOf('Transit Fuel'));
  });

  it('R16-5: no stops → no Stops panel', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<RouteDetail route={ROUTE} explanation={null} done="ok" />);
    });
    expect(textOf(tree)).not.toContain('"Stops"');
  });
});

describe('ResultScreen', () => {
  it('hosts RouteDetail + a plan-another action', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <ResultScreen
          navigation={{ goBack: () => {}, navigate: () => {} }}
          route={{ params: { route: ROUTE, explanation: EXPLANATION, done: 'ok' } }}
        />,
      );
    });
    const text = textOf(tree);
    expect(text).toContain('67.8 km');
    expect(text).toContain('Plan another drive');
  });

  it('handles a missing route defensively', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <ResultScreen navigation={{ goBack: () => {}, navigate: () => {} }} route={{}} />,
      );
    });
    expect(textOf(tree)).toContain('No route arrived');
  });

  it('with held constraints: refine panel present; with previous: comparison rows (M7-T07)', () => {
    let tree!: ReactTestRenderer;
    const constraints = { shape: 'loop' } as never; // opaque to the screen
    act(() => {
      tree = create(
        <ResultScreen
          navigation={{ goBack: () => {}, navigate: () => {} }}
          route={{
            params: {
              route: ROUTE,
              explanation: null,
              done: 'ok',
              constraints,
              previous: { distance_m: 60000, duration_s: 3600, curviness: 1.1, climb_m: 250 },
            },
          }}
        />,
      );
    });
    const text = textOf(tree);
    expect(text).toContain('Tweak this drive');
    expect(text).toContain('hard'); // "hard constraints carry over" hint
    expect(text).toContain('Compared with the previous drive');
    expect(text).toContain('+15 min'); // 60→75 real computed delta
    expect(text).toContain('+7.8 km'); // 60.0→67.8
  });

  it('alternates render a switcher; picking one swaps the route + hides best-only sections (FB-4)', () => {
    let tree!: ReactTestRenderer;
    const alt = { ...ROUTE, distance_m: 82500, duration_s: 5580, climb_m: null };
    act(() => {
      tree = create(
        <ResultScreen
          navigation={{ goBack: () => {}, navigate: () => {} }}
          route={{
            params: { route: ROUTE, alternates: [alt], explanation: EXPLANATION, done: 'ok' },
          }}
        />,
      );
    });
    let text = textOf(tree);
    expect(text).toContain('Recommended');
    expect(text).toContain('Option 2');
    expect(text).toContain('67.8 km'); // best shown by default
    expect(text).toContain('sustained curves along the escarpment'); // explanation on best

    // switch to Option 2
    const chip = tree.root.findAll(
      (n) =>
        typeof n.props['onPress'] === 'function' &&
        JSON.stringify(n.props['accessibilityState'] ?? {}).includes('false') &&
        n.props['accessibilityRole'] === 'button',
    )[0]!;
    act(() => {
      (chip.props['onPress'] as () => void)();
    });
    text = textOf(tree);
    expect(text).toContain('82.5 km'); // the alternate's stats
    expect(text).not.toContain('sustained curves along the escarpment'); // explanation is best-only
    expect(text).toContain('runner-up from the same generation'); // honest note
  });

  it('without alternates: no switcher appears', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <ResultScreen
          navigation={{ goBack: () => {}, navigate: () => {} }}
          route={{ params: { route: ROUTE, explanation: null, done: 'ok' } }}
        />,
      );
    });
    expect(textOf(tree)).not.toContain('Recommended');
  });

  it('an unchanged refined result gets the honest quality-first banner (FB-3)', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <ResultScreen
          navigation={{ goBack: () => {}, navigate: () => {} }}
          route={{
            params: {
              route: ROUTE,
              explanation: null,
              done: 'ok',
              previous: {
                distance_m: ROUTE.distance_m,
                duration_s: ROUTE.duration_s,
                curviness: ROUTE.curviness,
                climb_m: ROUTE.climb_m,
              },
            },
          }}
        />,
      );
    });
    const text = textOf(tree);
    expect(text).toContain("couldn't improve on the previous drive");
    // and a MOVED result never shows it
    act(() => {
      tree = create(
        <ResultScreen
          navigation={{ goBack: () => {}, navigate: () => {} }}
          route={{
            params: {
              route: ROUTE,
              explanation: null,
              done: 'ok',
              previous: { distance_m: 60000, duration_s: 3600, curviness: 1.1, climb_m: 250 },
            },
          }}
        />,
      );
    });
    expect(textOf(tree)).not.toContain("couldn't improve on the previous drive");
  });

  it('without constraints (older payloads): no refine affordance appears', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <ResultScreen
          navigation={{ goBack: () => {}, navigate: () => {} }}
          route={{ params: { route: ROUTE, explanation: null, done: 'ok' } }}
        />,
      );
    });
    expect(textOf(tree)).not.toContain('Tweak this drive');
  });
});
