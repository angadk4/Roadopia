/**
 * Component smoke (M7-T01) — renders OUR screens in node via react-test-renderer
 * over the rn-stub alias. Catches wiring failures (broken imports, hook misuse,
 * render crashes); native behaviour is verified on device (M7-T09).
 */
import { act, type ReactElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { EMPTY_DRAFT, PlanDraftContext, type PlanDraft } from '../../lib/plan_draft';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import MapHome from '../MapHome';
import PlanScreen from '../PlanScreen';

/** MapHome reads auth so it can show the signed-in user's OWN spots (their
 *  pins are invisible under the anon key). Anonymous context is enough here. */
function withAuth(node: ReactElement): ReactElement {
  return (
    <AuthProvider
      engine={
        new AuthEngine({
          cfg: { url: 'http://sb.local', anonKey: 'anon' },
          store: memorySessionStore(null),
        })
      }
    >
      {node}
    </AuthProvider>
  ) as ReactElement;
}

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

const NOOP_NAV = { navigate: () => {}, goBack: () => {} };

function planScreenWith(draft: Partial<PlanDraft>): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <PlanDraftContext.Provider
        value={{ draft: { ...EMPTY_DRAFT, ...draft }, setDraft: () => {} }}
      >
        <PlanScreen navigation={NOOP_NAV} locate={() => new Promise(() => {})} />
      </PlanDraftContext.Provider>,
    );
  });
  return tree;
}

describe('screen smoke', () => {
  it('PlanScreen renders brief input, origin buttons, shape + R16-5 sections (FR-040)', () => {
    const text = textOf(planScreenWith({}));
    expect(text).toContain('Plan a drive');
    expect(text).toContain('Use my location');
    expect(text).toContain('Pick on map');
    expect(text).toContain('Loop');
    expect(text).toContain('A → B');
    // R23: the style control is presets-only under the hood (BD-30 / Hard rule
    // L — buildPlanRequest composes onto the preset slot). R25-U17 relabel:
    // "Road character" (it selects which roads, never pace) + R25-U16b's third
    // chip makes style:null reachable (the duration "Any" precedent).
    expect(text).toContain('optional');
    expect(text).toContain('Drive time'); // R24-U12 time control (loops)
    expect(text).toContain('Road character');
    expect(text).toContain('Direct');
    // R29 Unit D: the chip is named for its mechanism, and the "No preference"
    // third chip is gone (its null value doubled as quick-fill's marker — the
    // twisty-un-fills-the-chip bug).
    expect(text).toContain('Backroads');
    expect(text).not.toContain('No preference');
    expect(text).toContain('not how fast you drive it'); // Hard rule D sub-label
    expect(text).toContain('Scenery');
    expect(text).toContain('Prefer views');
    expect(text).toContain('On the route');
    expect(text).toContain('Avoid highways');
    expect(text).toContain('Paved roads only');
    expect(text).toContain('Add a stop');
    expect(text.toLowerCase()).not.toContain('slider');
    // Chill + the retired Twisty / Mostly-backroads tiers are gone from the UI
    expect(text).not.toContain('Chill');
    expect(text).not.toContain('Twisty');
    expect(text).not.toContain('Mostly backroads');
    // Hard rule D: no speed/racing/timing framing anywhere in the drive copy
    for (const w of ['racing', 'fastest', 'leaderboard', 'mph', 'velocity']) {
      expect(text.toLowerCase()).not.toContain(w);
    }
    // CTA blocked only by the missing origin — the brief is optional now (U12)
    expect(text).not.toContain('Describe the drive you want.');
    expect(text).toContain('Add a start point.');
  });

  it('PlanScreen with a complete draft shows the set origin and no blockers', () => {
    const text = textOf(
      planScreenWith({
        brief: 'a 90 minute loop',
        origin: { source: 'current', point: { lat: 43.26, lng: -79.87 } },
      }),
    );
    expect(text).toContain('current location');
    expect(text).not.toMatch(/43\.26|-79\.87/); // never raw coordinates in copy
    expect(text).not.toContain('Add a start point.');
  });

  it('PlanScreen marks the active drive-style chip selected; stops builder rows render', () => {
    const text = textOf(
      planScreenWith({
        style: 'backroads',
        stops: [
          { type: 'coffee', when: 'midway' },
          { type: 'fuel', when: 'late' },
        ],
      }),
    );
    expect(text).toContain('"selected":true');
    expect(text).toContain('Coffee');
    expect(text).toContain('Gas');
    expect(text).toContain('Midway');
    expect(text).toContain('Late');
    expect(text).toContain('Remove');
  });

  it('MapHome shows the loading banner over the map while routes fetch', () => {
    let tree!: ReactTestRenderer;
    const pendingRoutes = () => new Promise<never>(() => {});
    act(() => {
      tree = create(withAuth(<MapHome loadRoutes={pendingRoutes} />));
    });
    const text = textOf(tree);
    expect(text).toContain('mapbox-mapview'); // the map itself always renders
    expect(text).toContain('Loading routes');
    expect(text).toContain('OpenStreetMap contributors'); // FR-014 attribution
  });

  it('MapHome renders seed routes + spots once loaded (FR-010)', async () => {
    let tree!: ReactTestRenderer;
    const row = {
      id: 'r1',
      name: 'Snake Road Sweep',
      description: '',
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-79.98, 43.22],
          [-79.9, 43.26],
        ] as Array<[number, number]>,
      },
      bbox: null,
      is_loop: true,
      distance_m: 8000,
      duration_s: 540,
      curviness: 1.2,
      climb_m: null,
      character_tags: ['twisty'],
      intensity: 'moderate',
      free_tags: ['seed'],
      origin_type: 'manual',
      visibility: 'public',
    };
    const spot = { id: 's1', name: 'Cafe', type: 'coffee', lat: 43.24, lng: -79.94, source: 'osm' };
    await act(async () => {
      tree = create(
        withAuth(
          <MapHome
            loadRoutes={() => Promise.resolve([row])}
            loadSpots={() => Promise.resolve([spot])}
          />,
        ),
      );
    });
    const text = textOf(tree);
    expect(text).toContain('mapbox-shapesource');
    expect(text).toContain('mapbox-linelayer');
    expect(text).toContain('mapbox-camera'); // bounds-fitted camera present
    expect(text).not.toContain('Loading routes');
  });

  it('MapHome data failure → friendly banner + retry, map still present (§18)', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(withAuth(<MapHome loadRoutes={() => Promise.reject(new Error('down'))} />));
    });
    const text = textOf(tree);
    expect(text).toContain('mapbox-mapview');
    expect(text).toContain("Couldn't load routes");
    expect(text).toContain('Retry');
    expect(text).not.toContain('down'); // never the raw error
  });
});

/** Device pass (2026-09-07): "when someone presses a custom added spot make
 *  the attached images show up in the little pop up". */
describe('MapHome spot sheet photos', () => {
  function signedIn(node: ReactElement): ReactElement {
    return (
      <AuthProvider
        engine={
          new AuthEngine({
            cfg: { url: 'http://sb.local', anonKey: 'anon' },
            store: memorySessionStore({
              accessToken: 'at',
              refreshToken: 'rt',
              expiresAt: 9_999_999_999,
              user: { id: 'u1', email: 'a@b.co' },
            }),
          })
        }
      >
        {node}
      </AuthProvider>
    ) as ReactElement;
  }
  const USER_PIN = {
    id: 's-user',
    name: 'My lookout',
    type: 'viewpoint',
    lat: 43.24,
    lng: -79.94,
    source: 'user',
  };
  const OSM_PIN = {
    id: 's-osm',
    name: 'Cafe',
    type: 'coffee',
    lat: 43.25,
    lng: -79.95,
    source: 'osm',
  };
  const PHOTOS = [
    { id: 'p1', url: 'https://cdn.local/p1.jpg', thumb_url: 'https://cdn.local/p1-thumb.jpg' },
    { id: 'p2', url: 'https://cdn.local/p2.jpg', thumb_url: 'https://cdn.local/p2-thumb.jpg' },
  ];

  async function tapSpot(tree: ReactTestRenderer, pin: typeof USER_PIN): Promise<void> {
    const src = tree.root
      .findAll((n) => String(n.type) === 'mapbox-shapesource')
      .find((n) => n.props['id'] === 'spots')!;
    const fc = src.props['shape'] as { features: Array<{ properties: Record<string, unknown> }> };
    const feature = fc.features.find((f) => f.properties['id'] === pin.id)!;
    await act(async () => {
      (src.props['onPress'] as (e: unknown) => void)({ features: [feature] });
    });
    await act(async () => {});
  }

  async function render(wrap: (n: ReactElement) => ReactElement, listPhotosFn: unknown) {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        wrap(
          <MapHome
            loadRoutes={() => Promise.resolve([])}
            loadSpots={() => Promise.resolve([USER_PIN, OSM_PIN])}
            listPhotosFn={listPhotosFn as never}
          />,
        ),
      );
    });
    return tree;
  }

  it('tapping your own pin shows its photo thumbnails in the sheet', async () => {
    const listPhotosFn = vi.fn(async (_opts: unknown, spotId: string) =>
      spotId === 's-user' ? PHOTOS : [],
    );
    const tree = await render(signedIn, listPhotosFn);
    await tapSpot(tree, USER_PIN);
    expect(listPhotosFn).toHaveBeenCalledTimes(1);
    expect(listPhotosFn.mock.calls[0]?.[1]).toBe('s-user');
    const text = textOf(tree);
    expect(text).toContain('My lookout');
    expect(text).toContain('p1-thumb.jpg'); // the processed thumbnail, never the raw upload
    expect(text).toContain('p2-thumb.jpg');
    expect(text).toContain('2 photos');
  });

  it('an OSM pin never asks for photos, and a switch to it clears the strip', async () => {
    const listPhotosFn = vi.fn(async () => PHOTOS);
    const tree = await render(signedIn, listPhotosFn);
    await tapSpot(tree, USER_PIN);
    expect(textOf(tree)).toContain('p1-thumb.jpg');
    await tapSpot(tree, OSM_PIN);
    expect(listPhotosFn).toHaveBeenCalledTimes(1); // no call for the OSM pin
    const text = textOf(tree);
    expect(text).toContain('Cafe');
    expect(text).not.toContain('p1-thumb.jpg'); // the previous pin's photos do not linger
  });

  it('signed out, the sheet still opens and no photo request is made', async () => {
    const listPhotosFn = vi.fn(async () => PHOTOS);
    const tree = await render(withAuth, listPhotosFn);
    await tapSpot(tree, USER_PIN);
    expect(listPhotosFn).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('My lookout');
  });

  it('a photo failure leaves the sheet intact and says nothing raw', async () => {
    const listPhotosFn = vi.fn(async () => {
      throw new Error('boom');
    });
    const tree = await render(signedIn, listPhotosFn);
    await tapSpot(tree, USER_PIN);
    const text = textOf(tree);
    expect(text).toContain('My lookout');
    expect(text).not.toContain('boom');
  });
});

/** Review (2026-09-07): following a seed drive from the map tracked the
 *  SIMPLIFIED line; the full row is fetched first, with the map line as the
 *  fallback so the button never dead-ends. */
describe('MapHome follow from the map', () => {
  const ROW = {
    id: '9f0403ea-65db-4f11-938c-d567a8033c2b',
    name: 'Snake Road Sweep',
    description: '',
    geometry: {
      type: 'LineString' as const,
      coordinates: [
        [-79.98, 43.22],
        [-79.9, 43.26],
      ] as Array<[number, number]>,
    },
    bbox: null,
    is_loop: false,
    distance_m: 8000,
    duration_s: 540,
    curviness: 1.2,
    climb_m: null,
    character_tags: ['twisty'],
    intensity: 'moderate',
    free_tags: ['seed'],
    origin_type: 'manual',
    visibility: 'public',
  };
  const FULL = {
    geometry: {
      type: 'LineString' as const,
      coordinates: [
        [-79.98, 43.22],
        [-79.95, 43.25],
        [-79.9, 43.26],
      ],
    },
    is_loop: false,
    waypoints: [],
    distance_m: 8000,
    duration_s: 540,
    curviness: 1.2,
    elevation_profile: null,
    climb_m: null,
    highway_flag: false,
    toll_flag: false,
    ferry_flag: false,
    unpaved_flag: false,
    character_tags: ['twisty'],
    intensity: 'moderate',
    free_tags: ['seed'],
    visibility: 'public',
    owner_id: null,
    origin_type: 'manual',
    forked_from: null,
    stops: [],
    maneuvers: [{ type: 'start', instruction: 'Drive northeast.', distance_m: 8000 }],
  };

  async function tapLineAndFollow(fetchRouteFn: unknown) {
    const navigate = vi.fn();
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        withAuth(
          <MapHome
            loadRoutes={() => Promise.resolve([ROW])}
            loadSpots={() => Promise.resolve([])}
            fetchRouteFn={fetchRouteFn as never}
            navigation={{ navigate }}
          />,
        ),
      );
    });
    const src = tree.root
      .findAll((n) => String(n.type) === 'mapbox-shapesource')
      .find((n) => n.props['id'] === 'seed-routes')!;
    await act(async () => {
      (src.props['onPress'] as (e: unknown) => void)({
        features: [{ properties: { id: ROW.id, name: ROW.name, distance_m: 8000 } }],
      });
    });
    const follow = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Follow this drive' && !!n.props['onPress'],
    )[0]!;
    await act(async () => {
      (follow.props['onPress'] as () => void)();
    });
    await act(async () => {});
    return navigate;
  }

  it('follows the FULL row (geometry + turns) when it can be read', async () => {
    const asked: string[] = [];
    const fetchRouteFn = async (_cfg: unknown, id: string) => {
      asked.push(id);
      return FULL;
    };
    const navigate = await tapLineAndFollow(fetchRouteFn);
    expect(asked).toEqual([ROW.id]);
    const [screen, params] = navigate.mock.calls[0] as [
      string,
      { route: typeof FULL & { name?: string } },
    ];
    expect(screen).toBe('Follow');
    expect(params.route.geometry.coordinates).toHaveLength(3);
    expect(params.route.maneuvers).toHaveLength(1);
    expect(params.route.name).toBe('Snake Road Sweep');
  });

  it('falls back to the map line when the row cannot be read — never a dead end', async () => {
    const navigate = await tapLineAndFollow(async () => {
      throw new Error('offline');
    });
    const [screen, params] = navigate.mock.calls[0] as [
      string,
      { route: { geometry: { coordinates: unknown[] } } },
    ];
    expect(screen).toBe('Follow');
    expect(params.route.geometry.coordinates).toHaveLength(2);
  });
});
