import type { RouteThroughOutput } from '@shared/types';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import { MOCK_MAP } from '../../test/rnmapbox-stub';
import BuilderScreen from '../BuilderScreen';

/**
 * Device pass (2026-09-04) — "the dots don't stay where I put them and don't
 * snap to the road". The point is asked of the MAP at press time; the dots
 * draw the engine's snapped locations once routed; a no-op tap says why; a
 * dot can be tapped away; a failed route has a Retry.
 */

const SNAPPED: RouteThroughOutput = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.5, 43.9],
      [-79.49, 43.91],
    ],
  },
  distance_m: 42_000,
  duration_s: 51 * 60,
  legs: [],
  maneuvers: [],
  has_highway: false,
  has_toll: false,
  has_ferry: false,
  has_unpaved: false,
  // where the engine put the two taps: on the road, not where the finger was
  locations: [
    { lat: 43.9004, lng: -79.5003 },
    { lat: 43.9102, lng: -79.4898 },
  ],
};

function withAuth(el: ReactElement): ReactElement {
  const engine = new AuthEngine({
    cfg: { url: 'http://sb.local', anonKey: 'anon' },
    store: memorySessionStore(null),
  });
  return <AuthProvider engine={engine}>{el}</AuthProvider>;
}

async function render(routeFn: ReturnType<typeof vi.fn>): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      withAuth(
        <BuilderScreen navigation={{ goBack: () => undefined }} routeFn={routeFn as never} />,
      ),
    );
  });
  // the map container reports its size (onLayout never fires in node)
  const wrap = tree.root.findAll((n) => typeof n.props['onLayout'] === 'function')[0]!;
  await act(async () => {
    (wrap.props['onLayout'] as (e: unknown) => void)({
      nativeEvent: { layout: { width: 390, height: 600 } },
    });
  });
  return tree;
}

async function press(tree: ReactTestRenderer, label: string): Promise<void> {
  const node = tree.root.findAll(
    (n) => n.props['accessibilityLabel'] === label && !!n.props['onPress'],
  )[0]!;
  await act(async () => {
    (node.props['onPress'] as () => void)();
  });
}

function dotCoords(tree: ReactTestRenderer): Array<[number, number]> {
  const src = tree.root
    .findAll((n) => String(n.type) === 'mapbox-shapesource')
    .find((n) => n.props['id'] === 'builder-points');
  if (!src) return [];
  const fc = src.props['shape'] as {
    features: Array<{ geometry: { coordinates: [number, number] } }>;
  };
  return fc.features.map((f) => f.geometry.coordinates);
}

const textOf = (t: ReactTestRenderer): string => JSON.stringify(t.toJSON());

describe('BuilderScreen (device pass, 2026-09-04)', () => {
  const originalResolver = MOCK_MAP.coordinateFromView;
  beforeEach(() => {
    vi.useFakeTimers();
    MOCK_MAP.center = [-79.5, 43.9];
    MOCK_MAP.coordinateFromView = () => MOCK_MAP.center;
  });
  afterEach(() => {
    vi.useRealTimers();
    MOCK_MAP.center = [-79.8, 43.6];
    MOCK_MAP.coordinateFromView = originalResolver;
  });

  it('Add point asks the MAP for the point under the crosshair at press time', async () => {
    const asked: Array<[number, number]> = [];
    MOCK_MAP.coordinateFromView = (p) => {
      asked.push(p);
      return MOCK_MAP.center;
    };
    const tree = await render(vi.fn(async () => SNAPPED));
    await press(tree, 'Add point');
    expect(asked).toEqual([[195, 300]]); // the map container's centre, in dp
    expect(dotCoords(tree)).toEqual([[-79.5, 43.9]]);
  });

  it('once routed, the dots draw where the engine put the points — on the road', async () => {
    const routeFn = vi.fn(async () => SNAPPED);
    const tree = await render(routeFn);
    await press(tree, 'Add point');
    MOCK_MAP.center = [-79.49, 43.91];
    await press(tree, 'Add point');
    expect(dotCoords(tree)).toEqual([
      [-79.5, 43.9],
      [-79.49, 43.91],
    ]); // raw taps while routing
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500); // past the 400 ms debounce
    });
    expect(routeFn).toHaveBeenCalledTimes(1);
    expect(dotCoords(tree)).toEqual([
      [-79.5003, 43.9004],
      [-79.4898, 43.9102],
    ]);
    expect(textOf(tree)).toContain('2 points · 42 km · 51 min');
  });

  it('a duplicate tap says so instead of silently doing nothing', async () => {
    const tree = await render(vi.fn(async () => SNAPPED));
    await press(tree, 'Add point');
    await press(tree, 'Add point');
    expect(dotCoords(tree)).toHaveLength(1);
    expect(textOf(tree)).toContain('already the last one');
  });

  it('closing the loop below two points says so', async () => {
    const tree = await render(vi.fn(async () => SNAPPED));
    await press(tree, 'Close loop');
    expect(textOf(tree)).toContain('at least two points');
  });

  it('tapping a dot removes that point', async () => {
    const tree = await render(vi.fn(async () => SNAPPED));
    await press(tree, 'Add point');
    MOCK_MAP.center = [-79.49, 43.91];
    await press(tree, 'Add point');
    const src = tree.root
      .findAll((n) => String(n.type) === 'mapbox-shapesource')
      .find((n) => n.props['id'] === 'builder-points')!;
    await act(async () => {
      (src.props['onPress'] as (e: unknown) => void)({ features: [{ properties: { idx: 0 } }] });
    });
    expect(dotCoords(tree)).toEqual([[-79.49, 43.91]]);
    expect(textOf(tree)).toContain('Removed point 1');
  });

  it('a failed route says so with a Retry that re-requests the same points', async () => {
    let calls = 0;
    const routeFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return SNAPPED;
    });
    const tree = await render(routeFn);
    await press(tree, 'Add point');
    MOCK_MAP.center = [-79.49, 43.91];
    await press(tree, 'Add point');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    let text = textOf(tree);
    expect(text).toContain('Could not route those points');
    expect(text).not.toContain('down');
    await press(tree, 'Retry routing');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(routeFn).toHaveBeenCalledTimes(2);
    text = textOf(tree);
    expect(text).toContain('42 km');
    expect(text).not.toContain('Could not route');
  });
});

describe('BuilderScreen follow-in-place (device pass, 2026-09-07)', () => {
  const originalResolver = MOCK_MAP.coordinateFromView;
  beforeEach(() => {
    vi.useFakeTimers();
    MOCK_MAP.center = [-79.5, 43.9];
    MOCK_MAP.coordinateFromView = () => MOCK_MAP.center;
  });
  afterEach(() => {
    vi.useRealTimers();
    MOCK_MAP.center = [-79.8, 43.6];
    MOCK_MAP.coordinateFromView = originalResolver;
  });

  it('a routed drive can be followed right away, carrying the engine turns', async () => {
    const navigate = vi.fn();
    const routeFn = vi.fn(async () => ({
      ...SNAPPED,
      maneuvers: [
        { type: 'start', instruction: 'Drive north.', distance_m: 21_000 },
        { type: 'left', instruction: 'Turn left.', distance_m: 21_000 },
      ],
    }));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        withAuth(
          <BuilderScreen
            navigation={{ goBack: () => undefined, navigate }}
            routeFn={routeFn as never}
          />,
        ),
      );
    });
    const wrap = tree.root.findAll((n) => typeof n.props['onLayout'] === 'function')[0]!;
    await act(async () => {
      (wrap.props['onLayout'] as (e: unknown) => void)({
        nativeEvent: { layout: { width: 390, height: 600 } },
      });
    });
    expect(textOf(tree)).not.toContain('Follow this drive'); // nothing to follow yet
    await press(tree, 'Add point');
    MOCK_MAP.center = [-79.49, 43.91];
    await press(tree, 'Add point');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(textOf(tree)).toContain('Follow this drive');
    await press(tree, 'Follow this drive');
    expect(navigate).toHaveBeenCalledTimes(1);
    const [screen, params] = navigate.mock.calls[0] as [string, { route: Record<string, unknown> }];
    expect(screen).toBe('Follow');
    expect(params.route['origin_type']).toBe('manual');
    expect(params.route['distance_m']).toBe(42_000);
    expect(params.route['maneuvers']).toHaveLength(2); // guidance travels with the drive
  });

  it('without a navigate adapter (bare render) the button is simply absent', async () => {
    const tree = await render(vi.fn(async () => SNAPPED));
    await press(tree, 'Add point');
    MOCK_MAP.center = [-79.49, 43.91];
    await press(tree, 'Add point');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(textOf(tree)).toContain('42 km');
    expect(textOf(tree)).not.toContain('Follow this drive');
  });
});

describe('BuilderScreen superseded requests (review, 2026-09-04)', () => {
  const originalResolver = MOCK_MAP.coordinateFromView;
  beforeEach(() => {
    vi.useFakeTimers();
    MOCK_MAP.center = [-79.5, 43.9];
    MOCK_MAP.coordinateFromView = () => MOCK_MAP.center;
  });
  afterEach(() => {
    vi.useRealTimers();
    MOCK_MAP.center = [-79.8, 43.6];
    MOCK_MAP.coordinateFromView = originalResolver;
  });

  it('a newer point list aborts the older request, and a late old answer is ignored', async () => {
    const calls: Array<{ resolve: (r: RouteThroughOutput) => void; signal: AbortSignal }> = [];
    const routeFn = vi.fn(
      (_o: unknown, _b: unknown, signal: AbortSignal) =>
        new Promise<RouteThroughOutput>((resolve) => {
          calls.push({ resolve, signal });
        }),
    );
    const tree = await render(routeFn);
    await press(tree, 'Add point');
    MOCK_MAP.center = [-79.49, 43.91];
    await press(tree, 'Add point');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(calls).toHaveLength(1);
    MOCK_MAP.center = [-79.48, 43.92];
    await press(tree, 'Add point'); // a third point while the first request is out
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    const three: RouteThroughOutput = {
      ...SNAPPED,
      distance_m: 63_000,
      locations: [
        { lat: 43.9004, lng: -79.5003 },
        { lat: 43.9102, lng: -79.4898 },
        { lat: 43.9201, lng: -79.4799 },
      ],
    };
    await act(async () => {
      calls[1]!.resolve(three);
    });
    await act(async () => {
      calls[0]!.resolve(SNAPPED); // the stale two-point answer arrives late
    });
    const text = textOf(tree);
    expect(text).toContain('3 points');
    expect(text).not.toContain('2 points');
    expect(dotCoords(tree)).toEqual([
      [-79.5003, 43.9004],
      [-79.4898, 43.9102],
      [-79.4799, 43.9201],
    ]);
    expect(routeFn).toHaveBeenCalledTimes(2);
  });
});
