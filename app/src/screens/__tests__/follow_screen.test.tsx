import type { LineString, Maneuver, Route, RouteThroughOutput } from '@shared/types';
import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LocationFix } from '../../lib/location';
import { __haptics, __resetHaptics } from '../../test/expo-haptics-stub';
import FollowScreen from '../FollowScreen';

/**
 * Device pass (2026-09-04) — follow-mode's guidance contract and lifecycle.
 * A route that CARRIES its maneuvers is guided at once with no re-match; a
 * legacy row is re-matched and anchored by position; a hopeless match is
 * said plainly; leaving during the permission dialog never leaks the GPS
 * watcher (the guard RecordScreen had and this screen did not).
 */

/** Straight east–west line at lat 43: ~8.1 km in 0.01° lng steps (~810 m each). */
const LINE: LineString = {
  type: 'LineString',
  coordinates: Array.from({ length: 11 }, (_, i) => [-80 + i * 0.01, 43]),
};

const MANEUVERS: Maneuver[] = [
  { type: 'start', instruction: 'Drive east.', distance_m: 4000 },
  { type: 'turn', instruction: 'Turn left onto Forks Rd.', distance_m: 3000 },
  { type: 'end', instruction: 'Arrive.', distance_m: 0 },
];

function routeWith(over: Partial<Route>): Route {
  return {
    geometry: LINE,
    is_loop: false,
    waypoints: [],
    distance_m: 8100,
    duration_s: 900,
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
    ...over,
  } as Route;
}

const MATCHED: RouteThroughOutput = {
  geometry: LINE,
  distance_m: 8100,
  duration_s: 900,
  legs: [],
  maneuvers: MANEUVERS,
  has_highway: false,
  has_toll: false,
  has_ferry: false,
  has_unpaved: false,
};

/** A watcher the test drives: it hands out the fix callback and counts stops. */
function fixWatcher() {
  let emit: ((f: LocationFix) => void) | null = null;
  const stops: number[] = [];
  const watchFn = async (onFix: (f: LocationFix) => void) => {
    emit = onFix;
    return {
      status: 'ok' as const,
      stop: () => {
        stops.push(1);
      },
    };
  };
  return {
    watchFn,
    fix: (lat: number, lng: number): void =>
      emit?.({ lat, lng, accuracyM: 5, headingDeg: 90, speedMps: 15 }),
    stops,
  };
}

async function render(props: Record<string, unknown>): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      (
        <FollowScreen
          navigation={{ goBack: () => undefined }}
          route={{ params: { route: routeWith({ maneuvers: MANEUVERS }) } }}
          matchFn={vi.fn()}
          {...props}
        />
      ) as ReactElement,
    );
  });
  await act(async () => {});
  return tree;
}

const textOf = (t: ReactTestRenderer): string => JSON.stringify(t.toJSON());

describe('FollowScreen guidance (device pass, 2026-09-04)', () => {
  it('a route that carries its maneuvers is guided at once — no /match call', async () => {
    const w = fixWatcher();
    const matchFn = vi.fn();
    const tree = await render({ watchFn: w.watchFn, matchFn });
    expect(matchFn).not.toHaveBeenCalled();
    expect(textOf(tree)).not.toContain('Loading turn guidance');
    act(() => {
      w.fix(43, -79.99); // ~810 m along
    });
    const text = textOf(tree);
    expect(text).toContain('Turn left onto Forks Rd.');
    expect(text).toContain('then Arrive.');
    expect(text).toContain('to go');
    expect(text).toContain('left'); // "about N min left"
    act(() => {
      tree.unmount();
    });
    expect(w.stops).toHaveLength(1);
  });

  it('a legacy row is re-matched and its turns anchored by position', async () => {
    const w = fixWatcher();
    const matchFn = vi.fn(async () => MATCHED);
    const tree = await render({
      watchFn: w.watchFn,
      matchFn,
      route: { params: { route: routeWith({ maneuvers: null }) } },
    });
    expect(matchFn).toHaveBeenCalledTimes(1);
    act(() => {
      w.fix(43, -79.99);
    });
    expect(textOf(tree)).toContain('Turn left onto Forks Rd.');
    act(() => {
      tree.unmount();
    });
  });

  it('a legacy row whose match lands nowhere near the line says so, plainly', async () => {
    const w = fixWatcher();
    const elsewhere: LineString = {
      type: 'LineString',
      coordinates: LINE.coordinates.map(([lng, lat]) => [lng!, lat! + 0.05]),
    };
    const matchFn = vi.fn(async () => ({ ...MATCHED, geometry: elsewhere }));
    const tree = await render({
      watchFn: w.watchFn,
      matchFn,
      route: { params: { route: routeWith({ maneuvers: null }) } },
    });
    act(() => {
      w.fix(43, -79.99);
    });
    const text = textOf(tree);
    // one neutral line — the app cannot know WHY there are no turns, so it
    // claims nothing about provenance (a seed drive was never "saved")
    expect(text).toContain('No turn guidance for this drive');
    expect(text).not.toContain('saved before');
    expect(text).not.toContain('Turn left onto Forks Rd.');
    act(() => {
      tree.unmount();
    });
  });

  it('a failed re-match is said as unavailable, never as a raw error', async () => {
    const w = fixWatcher();
    const matchFn = vi.fn(async () => {
      throw new Error('boom');
    });
    const tree = await render({
      watchFn: w.watchFn,
      matchFn,
      route: { params: { route: routeWith({ maneuvers: null }) } },
    });
    act(() => {
      w.fix(43, -79.99);
    });
    const text = textOf(tree);
    expect(text).toContain('following the line');
    expect(text).not.toContain('boom');
    act(() => {
      tree.unmount();
    });
  });
});

describe('FollowScreen lifecycle + camera (device pass, 2026-09-04)', () => {
  it('leaving while the permission dialog is open STOPS the watcher it was granted', async () => {
    let release!: () => void;
    const opened = new Promise<void>((r) => {
      release = r;
    });
    const stops: number[] = [];
    const watchFn = async () => {
      await opened;
      return {
        status: 'ok' as const,
        stop: () => {
          stops.push(1);
        },
      };
    };
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        (
          <FollowScreen
            navigation={{ goBack: () => undefined }}
            route={{ params: { route: routeWith({ maneuvers: MANEUVERS }) } }}
            watchFn={watchFn}
            matchFn={vi.fn()}
          />
        ) as ReactElement,
      );
    });
    act(() => {
      tree.unmount(); // the user backs out before the OS dialog resolves
    });
    await act(async () => {
      release(); // permission granted — to a screen that no longer exists
    });
    expect(stops).toHaveLength(1);
  });

  it('panning away shows Recenter; tapping it re-enables following', async () => {
    const w = fixWatcher();
    const tree = await render({ watchFn: w.watchFn });
    const camera = () => tree.root.findAll((n) => String(n.type) === 'mapbox-camera')[0]!;
    act(() => {
      w.fix(43, -79.99); // following starts with the first fix
    });
    expect(camera().props['followUserLocation']).toBe(true);
    expect(textOf(tree)).not.toContain('Recenter');
    act(() => {
      (camera().props['onUserTrackingModeChange'] as (e: unknown) => void)({
        nativeEvent: { payload: { followUserLocation: false } },
      });
    });
    expect(camera().props['followUserLocation']).toBe(false);
    const chip = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Recenter on me' && !!n.props['onPress'],
    )[0]!;
    act(() => {
      (chip.props['onPress'] as () => void)();
    });
    expect(camera().props['followUserLocation']).toBe(true);
    act(() => {
      tree.unmount();
    });
  });

  it('the driven part of the line greys out as progress is made', async () => {
    const w = fixWatcher();
    const tree = await render({ watchFn: w.watchFn });
    const sources = () =>
      tree.root.findAll((n) => String(n.type) === 'mapbox-shapesource').map((n) => n.props['id']);
    expect(sources()).not.toContain('follow-behind'); // nothing driven yet
    act(() => {
      w.fix(43, -79.95); // halfway
    });
    expect(sources()).toContain('follow-behind');
    expect(sources()).toContain('follow-ahead');
    expect(sources()).toContain('follow-next-turn');
    act(() => {
      tree.unmount();
    });
  });

  it('no drive → an honest empty state WITH a way out', async () => {
    const tree = await render({ route: { params: undefined } });
    const text = textOf(tree);
    expect(text).toContain('No drive to follow');
    expect(text).toContain('Exit follow mode');
  });
});

describe('FollowScreen retry + honest progress (review, 2026-09-07)', () => {
  it('a denied permission has a Retry that re-asks; a second grant starts the stream', async () => {
    let calls = 0;
    const stops: number[] = [];
    const watchFn = async () => {
      calls += 1;
      if (calls === 1) return { status: 'denied' as const };
      return {
        status: 'ok' as const,
        stop: () => {
          stops.push(1);
        },
      };
    };
    const tree = await render({ watchFn });
    let text = textOf(tree);
    expect(text).toContain('Location permission is off');
    expect(text).toContain('Retry');
    const retry = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Retry location' && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (retry.props['onPress'] as () => void)();
    });
    await act(async () => {});
    expect(calls).toBe(2);
    text = textOf(tree);
    expect(text).not.toContain('Location permission is off');
    expect(text).toContain('Getting a GPS fix'); // acquiring until the first fix lands
    // a third tap while a watcher is installed never starts a second one
    const again = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Retry location' && !!n.props['onPress'],
    );
    expect(again).toHaveLength(0);
    act(() => tree.unmount());
    expect(stops).toHaveLength(1);
  });

  it('an off-route first fix seeds no progress; the banner does not announce the finish', async () => {
    const w = fixWatcher();
    const tree = await render({ watchFn: w.watchFn });
    // 300 m north of the line's far end — off-route, nearest to the END
    act(() => {
      w.fix(43.0027, -79.9);
    });
    let text = textOf(tree);
    expect(text).toContain('off the route');
    expect(text).not.toContain('That’s the drive');
    // now genuinely at the start: progress starts at the start
    act(() => {
      w.fix(43, -80);
    });
    text = textOf(tree);
    expect(text).not.toContain('That’s the drive');
    expect(text).toContain('8.1 km to go');
  });

  it('the turn card carries a composed label for screen readers, and status text has no label', async () => {
    const w = fixWatcher();
    const tree = await render({ watchFn: w.watchFn });
    act(() => {
      w.fix(43, -79.98);
    });
    const labelled = tree.root.findAll(
      (n) =>
        typeof n.props['accessibilityLabel'] === 'string' &&
        (n.props['accessibilityLabel'] as string).startsWith('In '),
    );
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled[0]!.props['accessibilityLabel']).toContain('Turn left onto Forks Rd.');
    const bare = tree.root.findAll(
      (n) =>
        n.props['accessibilityLabel'] === 'Guidance' ||
        n.props['accessibilityLabel'] === 'Remaining',
    );
    expect(bare).toHaveLength(0);
  });
});

describe('FollowScreen camera before a fix (review, 2026-09-04)', () => {
  it('does not follow until a fix exists, so the map opens on the drive, not the world', async () => {
    const w = fixWatcher();
    const tree = await render({ watchFn: w.watchFn });
    const camera = () => tree.root.findAll((n) => String(n.type) === 'mapbox-camera')[0]!;
    // with followUserLocation true at mount the SDK discards defaultSettings
    expect(camera().props['followUserLocation']).toBe(false);
    expect(
      (camera().props['defaultSettings'] as { centerCoordinate: [number, number] })
        .centerCoordinate,
    ).toEqual(LINE.coordinates[0]);
    act(() => {
      w.fix(43, -79.99);
    });
    expect(camera().props['followUserLocation']).toBe(true);
    act(() => {
      tree.unmount();
    });
  });

  it('a denied permission keeps the drive in view (never a follow of nothing)', async () => {
    const tree = await render({ watchFn: async () => ({ status: 'denied' as const }) });
    const camera = tree.root.findAll((n) => String(n.type) === 'mapbox-camera')[0]!;
    expect(camera.props['followUserLocation']).toBe(false);
    expect(textOf(tree)).toContain('Location permission is off');
  });
});

/**
 * Redesign (SPEC "Follow") — additive assertions only (kind N in SPEC "Test
 * changes"); every case above is byte-identical. The structure the owner
 * asked for is asserted, not the paint: the scrim is one gradient, the status
 * band and the bottom panel are materials (a blur under a tint), the turn
 * card is the one OPAQUE surface and animates nothing, Recenter is a material
 * pill, and the only haptic on the screen is the Success at the finish —
 * nothing per fix, nothing while the car is moving.
 */
describe('FollowScreen redesign structure (SPEC "Follow")', () => {
  afterEach(() => {
    __resetHaptics();
  });

  /** HOST elements only (a string type): a composite carries the same testID
   *  prop one level up, and `findAll` would hand that back first. */
  const hostsWithId = (root: ReactTestInstance, id: string): ReactTestInstance[] =>
    root.findAll((n) => typeof n.type === 'string' && n.props['testID'] === id);
  const byTestId = (tree: ReactTestRenderer, id: string): ReactTestInstance =>
    hostsWithId(tree.root, id)[0]!;
  const blursIn = (node: ReactTestInstance): number =>
    node.findAll((n) => String(n.type) === 'expo-blurview').length;

  it('plays ONE Success haptic when the drive is done — nothing in motion, never a second', async () => {
    const w = fixWatcher();
    const tree = await render({ watchFn: w.watchFn });
    act(() => {
      w.fix(43, -80); // the start: progress seeded at 0
    });
    act(() => {
      w.fix(43, -79.915); // ~85% along, guided and moving: the card says "Arrive."
    });
    expect(textOf(tree)).toContain('Arrive.');
    expect(textOf(tree)).not.toContain('That’s the drive');
    expect(__haptics).toEqual([]); // nothing per fix, nothing for a turn
    act(() => {
      w.fix(43, -79.9); // the end
    });
    expect(textOf(tree)).toContain('That’s the drive');
    expect(__haptics).toEqual(['notification:Success']);
    act(() => {
      w.fix(43, -79.9); // still parked at the end: `done` again, no second haptic
    });
    expect(__haptics).toHaveLength(1);
    act(() => {
      tree.unmount();
    });
  });

  it('an off-route fix and a Retry play no haptic', async () => {
    let calls = 0;
    const w = fixWatcher();
    const watchFn = async (onFix: (f: LocationFix) => void) => {
      calls += 1;
      if (calls === 1) return { status: 'denied' as const };
      return w.watchFn(onFix);
    };
    const tree = await render({ watchFn });
    const retry = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Retry location' && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (retry.props['onPress'] as () => void)();
    });
    await act(async () => {});
    act(() => {
      w.fix(43.0027, -79.9); // 300 m off the line
    });
    expect(textOf(tree)).toContain('off the route');
    expect(__haptics).toEqual([]);
    act(() => {
      tree.unmount();
    });
  });

  it('the scrim is one gradient and the status band is a dense material under it', async () => {
    const w = fixWatcher();
    const tree = await render({ watchFn: w.watchFn });
    // one LinearGradient, not four stacked Views
    expect(tree.root.findAll((n) => String(n.type) === 'expo-lineargradient')).toHaveLength(1);
    expect(byTestId(tree, 'follow-scrim').props['pointerEvents']).toBe('none');
    // acquiring: the banner is a Material (a blur under the tint) with the spinner
    const banner = byTestId(tree, 'follow-banner');
    expect(blursIn(banner)).toBe(1);
    expect(banner.findAll((n) => String(n.type) === 'rn-activityindicator')).toHaveLength(1);
    expect(textOf(tree)).toContain('Getting a GPS fix');
    // the bottom panel is a Material too, padded for the home indicator
    expect(blursIn(byTestId(tree, 'follow-panel'))).toBe(1);
    expect(textOf(tree)).not.toContain('down');
    act(() => {
      tree.unmount();
    });
  });

  it('the turn card is OPAQUE — no material, an accent edge, a legend over the distance', async () => {
    const w = fixWatcher();
    const tree = await render({ watchFn: w.watchFn });
    act(() => {
      w.fix(43, -79.98);
    });
    const card = byTestId(tree, 'follow-turn-card');
    expect(blursIn(card)).toBe(0); // legibility over moving tiles beats material
    const style = JSON.stringify(card.props['style']);
    expect(style).toContain('"borderWidth":1');
    // the banner is gone while a turn shows; the card carries the legend
    expect(hostsWithId(tree.root, 'follow-banner')).toHaveLength(0);
    const text = textOf(tree);
    expect(text).toContain('Next');
    expect(text).toContain('Turn left onto Forks Rd.');
    // nothing on the card is a Reanimated entrance: no builder reaches any host
    expect(text).not.toContain('entering');
    expect(text).not.toContain('presetName');
    expect(text).not.toContain('down');
    act(() => {
      tree.unmount();
    });
  });

  it('Recenter is a material pill inside the labelled pressable', async () => {
    const w = fixWatcher();
    const tree = await render({ watchFn: w.watchFn });
    const camera = () => tree.root.findAll((n) => String(n.type) === 'mapbox-camera')[0]!;
    act(() => {
      w.fix(43, -79.99);
    });
    expect(hostsWithId(tree.root, 'follow-recenter')).toHaveLength(0);
    act(() => {
      (camera().props['onUserTrackingModeChange'] as (e: unknown) => void)({
        nativeEvent: { payload: { followUserLocation: false } },
      });
    });
    const pressable = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Recenter on me' && !!n.props['onPress'],
    )[0]!;
    const pill = hostsWithId(pressable, 'follow-recenter');
    expect(pill).toHaveLength(1);
    expect(blursIn(pill[0]!)).toBe(1);
    expect(textOf(tree)).not.toContain('down');
    act(() => {
      (pressable.props['onPress'] as () => void)();
    });
    expect(hostsWithId(tree.root, 'follow-recenter')).toHaveLength(0);
    expect(__haptics).toEqual([]); // a pan and a recenter are not haptic moments
    act(() => {
      tree.unmount();
    });
  });

  it('no drive → the platform empty state, the honest line, and Exit', async () => {
    const tree = await render({ route: { params: undefined } });
    expect(
      tree.root.findAll((n) => String(n.type) === 'expo-ui-contentunavailableview'),
    ).toHaveLength(1);
    const text = textOf(tree);
    expect(text).toContain('No drive to follow — open a route first.');
    expect(text).toContain('Exit follow mode');
    expect(text).not.toContain('down');
  });
});
