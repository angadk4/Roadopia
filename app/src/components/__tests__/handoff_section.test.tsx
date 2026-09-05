import type { Route } from '@shared/types';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import HandoffSection from '../HandoffSection';

/**
 * Device pass (2026-09-04) — the hand-off panel's honesty on the phone:
 * Apple only where Apple Maps exists, a loop that SAYS why Apple is absent,
 * and an open that fails is shown, not swallowed.
 */

function routeOf(overrides: Partial<Route>): Route {
  return {
    geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: 200 }, (_, i) => [-79.9 + i * 0.001, 43.2]),
    },
    is_loop: false,
    waypoints: [],
    distance_m: 20_000,
    duration_s: 1500,
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
    visibility: 'private',
    owner_id: null,
    origin_type: 'ai',
    forked_from: null,
    generation_request_id: null,
    satisfied_constraints: null,
    stops: [],
    ...overrides,
  } as Route;
}

function render(props: Record<string, unknown>): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create((<HandoffSection route={routeOf({})} {...props} />) as ReactElement);
  });
  return tree;
}

const textOf = (t: ReactTestRenderer): string => JSON.stringify(t.toJSON());

describe('HandoffSection', () => {
  it('A→B on iOS offers Apple and Google; on Android only Google', () => {
    const ios = textOf(render({ platform: 'ios' }));
    expect(ios).toContain('Open This drive (A→B) in Apple Maps');
    expect(ios).toContain('Open This drive (A→B) in Google Maps');
    const android = textOf(render({ platform: 'android' }));
    expect(android).not.toContain('Apple Maps');
    expect(android).toContain('Open This drive (A→B) in Google Maps');
  });

  it('a loop on iOS says plainly that Apple Maps cannot take it, and offers Google only', () => {
    const text = textOf(render({ platform: 'ios', route: routeOf({ is_loop: true }) }));
    expect(text).toContain('Apple Maps can’t take a loop');
    expect(text).toContain('Rough loop (Google only)');
    expect(text).not.toContain('in Apple Maps');
    // Android never mentions Apple at all
    const android = textOf(render({ platform: 'android', route: routeOf({ is_loop: true }) }));
    expect(android).not.toContain('Apple');
  });

  it('an open the phone refuses is said, not swallowed', async () => {
    const openFn = vi.fn(async () => {
      throw new Error('No app can open this URL');
    });
    const tree = render({ platform: 'ios', openFn });
    const google = tree.root.findAll(
      (n) =>
        n.props['accessibilityLabel'] === 'Open This drive (A→B) in Google Maps' &&
        !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (google.props['onPress'] as () => void)();
    });
    expect(openFn).toHaveBeenCalledTimes(1);
    const text = textOf(tree);
    expect(text).toContain('Couldn’t open that app');
    expect(text).not.toContain('No app can open this URL');
  });
});
