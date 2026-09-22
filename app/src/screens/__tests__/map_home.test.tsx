/**
 * Component smoke (M7-T01) — renders OUR screens in node via react-test-renderer
 * over the rn-stub alias. Catches wiring failures (broken imports, hook misuse,
 * render crashes); native behaviour is verified on device (M7-T09).
 */
/**
 * Split verbatim out of screens.test.tsx (redesign shell — SPEC "Test
 * changes"): the MapHome + DriveLinesMap + spot sheet + follow-from-map +
 * opens-near-user cases. No assertion changed.
 */
import { act, type ReactElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import DriveLinesMap, { DEFAULT_CAMERA_INSETS, NEARBY_ZOOM } from '../../components/DriveLinesMap';
import { AuthEngine } from '../../lib/auth_state';
import type { Bounds } from '../../lib/data';
import { EMPTY_DRAFT, PlanDraftContext } from '../../lib/plan_draft';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import { HIT_TARGET, spacing } from '../../theme';
import MapHome from '../MapHome';

/** MapHome reads auth so it can show the signed-in user's OWN spots (their
 *  pins are invisible under the anon key). Anonymous context is enough here.
 *  The draft provider is the shell's pre-wrap (SPEC "Test changes"): the
 *  merged MapHome owns the Plan draft, as DiscoverHome did. */
const DRAFT = { draft: EMPTY_DRAFT, setDraft: () => {} };

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
      <PlanDraftContext.Provider value={DRAFT}>{node}</PlanDraftContext.Provider>
    </AuthProvider>
  ) as ReactElement;
}

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

/**
 * How much of the map the shelf is covering right now, in pt: the sheet is
 * laid out at its TOP detent's height and translated down by what is not
 * visible, so `height − translateY` is the COMMITTED detent (the Shelf writes
 * both only on a commit, never per frame).
 */
function visibleShelf(tree: ReactTestRenderer): number {
  // the HOST view, not the components above it that carry the same testID
  const sheet = tree.root.find(
    (n) => n.props['testID'] === 'home-shelf' && Array.isArray(n.props['style']),
  );
  const style = Object.assign(
    {},
    ...(sheet.props['style'] as unknown[]).filter((s) => s !== null && typeof s === 'object'),
  ) as { height?: number; transform?: Array<{ translateY?: number }> };
  const translateY = style.transform?.[0]?.translateY ?? 0;
  return (style.height ?? 0) - translateY;
}

describe('screen smoke', () => {
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
        <PlanDraftContext.Provider value={DRAFT}>{node}</PlanDraftContext.Provider>
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

/**
 * BD-204 follow-up — the shared map surface's camera and tap target.
 *
 * These pin RELATIONSHIPS, not pixels, because the pixels are per-device: a fit
 * clears the chrome measured above it; a caller that passes nothing gets exactly
 * the documented default; the drive-line tap target is the app's HIT_TARGET
 * floor rather than a number someone typed.
 */
describe('DriveLinesMap camera fit + tap target', () => {
  const B1: Bounds = { ne: [-79.9, 43.3], sw: [-80.1, 43.1] };
  /** A DIFFERENT drive, somewhere else — a fit the camera has to travel to. */
  const B2: Bounds = { ne: [-79.5, 43.9], sw: [-79.7, 43.7] };

  const LINES = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: { id: 'a' },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [-80.0, 43.2],
            [-79.95, 43.25],
          ],
        },
      },
    ],
  };

  function cameraProps(tree: ReactTestRenderer): Record<string, unknown> {
    return tree.root.findAll((n) => String(n.type) === 'mapbox-camera')[0]!.props;
  }
  function padding(tree: ReactTestRenderer): Record<string, number> {
    return cameraProps(tree)['bounds'] as Record<string, number>;
  }
  function hitbox(tree: ReactTestRenderer): unknown {
    return tree.root.findAll((n) => String(n.type) === 'mapbox-shapesource')[0]!.props['hitbox'];
  }

  it('a caller that passes no insets fits with the documented default padding', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<DriveLinesMap featureCollection={null} bounds={B1} />);
    });
    const p = padding(tree);
    expect(p['paddingTop']).toBe(DEFAULT_CAMERA_INSETS.top);
    expect(p['paddingBottom']).toBe(DEFAULT_CAMERA_INSETS.bottom);
    expect(p['paddingLeft']).toBe(DEFAULT_CAMERA_INSETS.left);
    expect(p['paddingRight']).toBe(DEFAULT_CAMERA_INSETS.right);
  });

  it('measured chrome taller than the default wins, and only on the edge it names', () => {
    const CHROME = DEFAULT_CAMERA_INSETS.top * 3; // a Dynamic Island title card
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <DriveLinesMap featureCollection={null} bounds={B1} cameraInsets={{ top: CHROME }} />,
      );
    });
    const p = padding(tree);
    expect(p['paddingTop']).toBe(CHROME);
    expect(p['paddingTop']!).toBeGreaterThan(DEFAULT_CAMERA_INSETS.top);
    expect(p['paddingBottom']).toBe(DEFAULT_CAMERA_INSETS.bottom);
    expect(p['paddingLeft']).toBe(DEFAULT_CAMERA_INSETS.left);
  });

  it('the first fit lands; a fit to NEW geometry travels, eased', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<DriveLinesMap featureCollection={null} bounds={B1} />);
    });
    // arriving at the data: there is no previous view to move from
    expect(cameraProps(tree)['animationDuration']).toBe(0);
    // the portable instant mode — iOS has no native 'none' (see the component)
    expect(cameraProps(tree)['animationMode']).toBe('moveTo');

    act(() => {
      tree.update(<DriveLinesMap featureCollection={null} bounds={B2} />);
    });
    expect(cameraProps(tree)['animationDuration'] as number).toBeGreaterThan(0);
    expect(cameraProps(tree)['animationMode']).toBe('easeTo');
  });

  it('a measurement correction re-pads the SAME fit without a flight', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<DriveLinesMap featureCollection={null} bounds={B1} />);
    });
    act(() => {
      tree.update(
        <DriveLinesMap featureCollection={null} bounds={B1} cameraInsets={{ top: 210 }} />,
      );
    });
    expect(padding(tree)['paddingTop']).toBe(210);
    // the padding was wrong, not the view — correcting it is not a journey
    expect(cameraProps(tree)['animationDuration']).toBe(0);
  });

  it('the drive-line tap target is the app HIT_TARGET floor, and one stable object', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<DriveLinesMap featureCollection={LINES} bounds={B1} />);
    });
    expect(hitbox(tree)).toEqual({ width: HIT_TARGET, height: HIT_TARGET });

    // same identity across renders: a fresh object makes ShapeSource
    // re-register its press handler (the reason it is hoisted and frozen)
    const first = hitbox(tree);
    act(() => {
      tree.update(<DriveLinesMap featureCollection={LINES} bounds={B1} banner={null} />);
    });
    expect(hitbox(tree)).toBe(first);
  });

  /**
   * The whole point of the prop: the screen's chrome is accounted for, and the
   * camera fits the routes into the map the user can actually SEE.
   *
   * IA + T (SPEC "Test changes": "`'MapHome fits the seed routes clear of its
   * measured Add-spot row'` → fits clear of the **committed shelf detent**").
   * The measured Add-spot row is gone — the FAB became a 44 pt pill in the
   * control column and the bottom of the screen is now the shelf. So the fit
   * is asserted against the shelf's COMMITTED detent, read off the sheet
   * itself (its laid-out height minus how far it is translated down = what is
   * visible), which is a stronger statement than the old one: not merely
   * "bigger than something measured", but "clear of exactly the chrome that is
   * on screen, plus the gutter the screen promises".
   */
  it('MapHome fits the seed routes clear of the committed shelf detent', async () => {
    const ROW = {
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

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        withAuth(
          <MapHome
            loadRoutes={async () => {
              await gate;
              return [ROW];
            }}
            loadSpots={() => Promise.resolve([])}
            navigation={{ navigate: () => {} }}
          />,
        ),
      );
    });

    await act(async () => {
      release();
      await gate;
    });
    await act(async () => {});

    expect(padding(tree)['paddingBottom']!).toBeGreaterThanOrEqual(visibleShelf(tree) + spacing.md);
    // …and the shelf is really covering something: this is not a vacuous floor.
    expect(visibleShelf(tree)).toBeGreaterThan(0);
  });

  /** N (SPEC MapHome item 2: "Mapbox compass under the column"): the two
   *  control circles live in the map's top-right corner, which is where the
   *  SDK puts its compass — so the compass is pushed below them. */
  it('MapHome drops the SDK compass below its control column', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        withAuth(
          <MapHome
            loadRoutes={async () => []}
            loadSpots={async () => []}
            navigation={{ navigate: () => {} }}
          />,
        ),
      );
    });
    const map = tree.root.findAll((n) => String(n.type) === 'mapbox-mapview')[0]!;
    const compass = map.props['compassPosition'] as { top: number; right: number };
    // two 44 pt circles and the gaps around them, clear of the top inset
    expect(compass.top).toBeGreaterThanOrEqual(44 * 2);
    expect(compass.right).toBeGreaterThan(0);
  });

  /**
   * The opening camera. `bounds: null` used to mount NO camera at all, so a map
   * with nothing to fit yet opened on Mapbox's own default view — the world —
   * and stayed there until data arrived. On the tab the app launches into, that
   * was the first thing anyone saw.
   */
  describe('opening position', () => {
    const HERE = { lat: 43.65, lng: -79.38 };

    it('opens where the screen says when there is nothing to fit', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <DriveLinesMap featureCollection={null} bounds={null} center={{ point: HERE }} />,
        );
      });
      const settings = cameraProps(tree)['defaultSettings'] as {
        centerCoordinate: [number, number];
        zoomLevel: number;
      };
      // [lng, lat] — the GeoJSON order, not the LatLng field order
      expect(settings.centerCoordinate).toEqual([HERE.lng, HERE.lat]);
      expect(settings.zoomLevel).toBe(NEARBY_ZOOM);
      // `defaultSettings`, never a controlled `centerCoordinate`: this positions
      // the map once and lets go, so the user can pan away from themselves.
      expect(cameraProps(tree)['centerCoordinate']).toBeUndefined();
    });

    it('a fit outranks the opening position — the data is what you came for', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <DriveLinesMap featureCollection={null} bounds={B1} center={{ point: HERE }} />,
        );
      });
      expect(cameraProps(tree)['bounds']).toBeDefined();
      expect(cameraProps(tree)['defaultSettings']).toBeUndefined();
    });

    it('no fit and no place is still the old behaviour: no camera, no crash', () => {
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(<DriveLinesMap featureCollection={null} bounds={null} />);
      });
      expect(tree.root.findAll((n) => String(n.type) === 'mapbox-camera')).toHaveLength(0);
    });
  });
});

/**
 * MapHome's opening camera (2026-09-12).
 *
 * The region fit is every seeded route at once — the whole served area. It is
 * the right never-empty anonymous view and the wrong place to start looking for
 * a road to drive, so a known location replaces it rather than competing with
 * it. The permission is CHECKED, never requested: arriving on a tab must not
 * raise a dialog, and iOS only ever asks once.
 */
describe('MapHome opens near the user', () => {
  const HERE = { lat: 43.65, lng: -79.38 };
  const ROWS = [
    {
      id: 'r1',
      name: 'Seed',
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-80.5, 43.1],
          [-79.1, 44.2],
        ] as Array<[number, number]>,
      },
      distance_m: 1000,
      duration_s: 600,
      is_loop: false,
      character_tags: [],
    },
  ];

  async function renderMap(
    knownLocation: () => Promise<
      { status: 'ok'; point: typeof HERE } | { status: 'denied' } | { status: 'error' }
    >,
  ): Promise<ReactTestRenderer> {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        withAuth(
          <MapHome
            loadRoutes={async () => ROWS as never}
            loadSpots={async () => []}
            knownLocation={knownLocation}
          />,
        ),
      );
    });
    await act(async () => {});
    return tree;
  }

  function cam(tree: ReactTestRenderer): Record<string, unknown> {
    return tree.root.findAll((n) => String(n.type) === 'mapbox-camera')[0]!.props;
  }

  it('opens on the user, not on the whole region, when the OS already knows', async () => {
    const tree = await renderMap(async () => ({ status: 'ok', point: HERE }));
    const settings = cam(tree)['defaultSettings'] as { centerCoordinate: [number, number] };
    expect(settings.centerCoordinate).toEqual([HERE.lng, HERE.lat]);
    // the region fit is SUPPRESSED, not merely outranked
    expect(cam(tree)['bounds']).toBeUndefined();
  });

  it('falls back to the region fit when location is off — never an empty map', async () => {
    const tree = await renderMap(async () => ({ status: 'denied' }));
    expect(cam(tree)['bounds']).toBeDefined();
    expect(cam(tree)['defaultSettings']).toBeUndefined();
  });

  it('a location error is not a failure state — the map still opens on the region', async () => {
    const tree = await renderMap(async () => ({ status: 'error' }));
    expect(cam(tree)['bounds']).toBeDefined();
    // §18: nothing about the map's own position is worth telling the user. T
    // (SPEC "Test changes"): the assertion now names the honest failure copy
    // instead of the bare substring `location` — the merged home always draws
    // the "Use my location" control, so the substring is legitimately in the
    // tree and only the NOTICES can say this check failed.
    const text = JSON.stringify(tree.toJSON());
    expect(text).not.toContain('Location is off');
    expect(text).not.toContain('get your location'); // "Couldn’t get your location — …"
  });
});
