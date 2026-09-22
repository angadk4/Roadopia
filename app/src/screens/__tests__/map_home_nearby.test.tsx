/**
 * The merged home's NEAR-YOU mode — what was `discover_home.test.tsx`
 * (redesign — SPEC "Test changes": `screens/__tests__/discover_home.test.tsx`
 * → `map_home_nearby.test.tsx`, "imports `MapHome` (same injectable
 * `locate`/`knownLocation`/`fetchDrives`/`fetchCores`); every copy and honesty
 * assertion verbatim").
 *
 * The Discover tab is gone; its scan is the Map tab's shelf in Near-you mode.
 * So every assertion below is the SAME assertion, made against the screen that
 * now owns the behaviour: the server's own rejection reasons, "One moment",
 * transport-only blame, "Great drives near you", `Let's go — …`, the curve
 * WORD, every disclosure, the amber/grey leg paint and the Hard-rule-D word
 * list are carried over verbatim (IA). Only the two layout cases are re-aimed,
 * because the chrome they measured no longer exists: the floating title card
 * and the horizontal rail are one gesture shelf, so the fit is asserted
 * against the control column and the shelf's COMMITTED detent (IA + T).
 *
 * MapHome also owns the seed map, so each render stubs `loadRoutes` /
 * `loadSpots` (no live Supabase read) — the scan is what these cases are
 * about.
 */

import type {
  DiscoverResult,
  NearbyDrive,
  CoreDrive,
  DiscoverResultV2,
  LatLng,
} from '@shared/types';
import { act, type ReactElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SHELF_PAN_TEST_ID } from '../../components/ui';
import { ApiError, NetworkError } from '../../lib/api';
import { AuthEngine } from '../../lib/auth_state';
import { FULL_DETENT_CLEARANCE } from '../../lib/home_states';
import { TabBarHeightContext } from '../../lib/insets';
import type { LocationResult } from '../../lib/location';
import { EMPTY_DRAFT, PlanDraftContext, type PlanDraft } from '../../lib/plan_draft';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import {
  __clearMountedGestures,
  __fireGesture,
  __mountedGesture,
} from '../../test/gesture-handler-stub';
import { AMBER, spacing } from '../../theme';
import MapHome from '../MapHome';

// --- R29 Unit A: the v2 three-leg menu -------------------------------------

const ORIGIN = { source: 'current' as const, point: { lat: 43.75, lng: -79.76 } };

const drive = (over: Partial<NearbyDrive>): NearbyDrive => ({
  segmentId: 'x',
  name: 'Road',
  entry: { lat: 43.7, lng: -79.8 },
  exit: { lat: 43.71, lng: -79.81 },
  curviness: 1.45,
  length_m: 3500,
  class: 'tertiary',
  urbanShare: 0,
  driveTimeToStartS: 180,
  driveTimeToStartM: 3000,
  roadTraverseS: 330,
  suggestedDurationS: 2700,
  score: 5000,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.8, 43.7],
      [-79.81, 43.71],
    ],
  },
  ...over,
});

const MENU: DiscoverResult = {
  reachMinutes: 60,
  disclosures: [],
  drives: [
    drive({ segmentId: 'a', name: 'Grey 30 Road', curviness: 1.45 }),
    drive({
      segmentId: 'b',
      name: 'Hockley Road',
      curviness: 2.4,
      driveTimeToStartS: 3000,
      suggestedDurationS: 7200,
    }),
  ],
};

const textOf = (t: ReactTestRenderer): string => JSON.stringify(t.toJSON());

/** MapHome reads auth so a signed-in user's OWN pins come back; anonymous is
 *  enough for the scan. The draft provider is MapStack's in the app. */
function wrap(
  node: ReactElement,
  draft: Partial<PlanDraft>,
  setDraft = (): void => {},
): ReactElement {
  return (
    <AuthProvider
      engine={
        new AuthEngine({
          cfg: { url: 'http://sb.local', anonKey: 'anon' },
          store: memorySessionStore(null),
        })
      }
    >
      <PlanDraftContext.Provider value={{ draft: { ...EMPTY_DRAFT, ...draft }, setDraft }}>
        {node}
      </PlanDraftContext.Provider>
    </AuthProvider>
  ) as ReactElement;
}

/** The seed map, stubbed empty: these cases are about the scan. */
const SEED_PROPS = {
  loadRoutes: async () => [],
  loadSpots: async () => [],
  knownLocation: async (): Promise<LocationResult> => ({ status: 'denied' }),
} as const;

afterEach(() => {
  __clearMountedGestures();
});

async function renderWith(draft: Partial<PlanDraft>, fetchDrives: () => Promise<DiscoverResult>) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      wrap(
        <MapHome
          {...SEED_PROPS}
          navigation={{ navigate: vi.fn() }}
          locate={() => new Promise(() => {})}
          fetchDrives={fetchDrives}
          fetchCores={null}
        />,
        draft,
      ),
    );
  });
  return tree;
}

describe('MapHome Near-you failure honesty (review, 2026-09-07)', () => {
  it('a server rejection shows the server’s own reason — never "check your connection"', async () => {
    const text = textOf(
      await renderWith({ origin: ORIGIN }, async () => {
        throw new ApiError({
          status: 400,
          code: 'out_of_region',
          message: 'Roadopia currently covers south-central Ontario; pick points inside it.',
        });
      }),
    );
    expect(text).toContain('Outside the covered region');
    expect(text).toContain('south-central Ontario');
    expect(text).not.toContain('check your connection');
    expect(text).not.toContain('Retry scanning'); // the same pin can never succeed
  });

  it('a rate limit says "One moment" with the server’s wait, and CAN be retried', async () => {
    const text = textOf(
      await renderWith({ origin: ORIGIN }, async () => {
        throw new ApiError({
          status: 429,
          code: 'rate_limited',
          message: 'Too many requests at once — try again in 12s.',
          retryAfterS: 12,
        });
      }),
    );
    expect(text).toContain('One moment');
    expect(text).toContain('12s');
    expect(text).not.toContain('check your connection');
    expect(text).toContain('Retry scanning');
  });

  it('only a transport failure blames the connection', async () => {
    const text = textOf(
      await renderWith({ origin: ORIGIN }, async () => {
        throw new NetworkError('Could not reach the server — check your connection.');
      }),
    );
    expect(text).toContain('check your connection');
    expect(text).toContain('Retry scanning');
  });
});

describe('MapHome Near you (R24 map-first)', () => {
  it('needs an origin before scanning; the map still renders (showpiece)', async () => {
    const text = textOf(await renderWith({}, async () => MENU));
    expect(text).toContain('Great drives near you');
    expect(text).toContain('Set your start point');
    expect(text).toContain('mapbox-mapview'); // map-first: the map is always there
  });

  it('renders the drive cards over the map with honest time/curviness (no speed framing)', async () => {
    const text = textOf(await renderWith({ origin: ORIGIN }, async () => MENU));
    expect(text).toContain('mapbox-mapview');
    expect(text).toContain('Grey 30 Road');
    expect(text).toContain('Hockley Road');
    expect(text).toContain('Winding'); // curviness word, not a number
    expect(text).toContain('to the start');
    expect(text).toContain('go'); // the "Let’s go" CTA
    for (const w of ['mph', 'km/h', 'fastest', 'racing', 'leaderboard', 'velocity']) {
      expect(text.toLowerCase()).not.toContain(w);
    }
  });

  it('a pre-built drive opens Result instantly (no /plan round-trip)', async () => {
    const navigate = vi.fn();
    const built: NearbyDrive = drive({
      segmentId: 'p',
      name: 'Prebuilt Ridge',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-79.8, 43.7],
          [-79.82, 43.72],
        ],
      },
      source: 'classic',
      durationSource: 'measured',
      measuredDurationS: 1800,
      route: {
        geometry: {
          type: 'LineString',
          coordinates: [
            [-79.8, 43.7],
            [-79.82, 43.72],
            [-79.8, 43.7],
          ],
        },
        distance_m: 12000,
        duration_s: 1800,
        legs: [],
        maneuvers: [],
        has_highway: false,
        has_toll: false,
        has_ferry: false,
        has_unpaved: false,
      },
    });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        wrap(
          <MapHome
            {...SEED_PROPS}
            navigation={{ navigate }}
            locate={() => new Promise(() => {})}
            fetchCores={null}
            fetchDrives={async () => ({ reachMinutes: 60, disclosures: [], drives: [built] })}
          />,
          { origin: ORIGIN },
        ),
      );
    });
    // tap the card
    const card = tree.root.findAll(
      (n) => n.props.accessibilityLabel === "Let's go — Prebuilt Ridge",
    )[0]!;
    act(() => {
      card.props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith(
      'Result',
      expect.objectContaining({ route: expect.any(Object) }),
    );
    expect(navigate).not.toHaveBeenCalledWith('Progress', expect.anything());
  });

  it('states an empty menu honestly, never padded', async () => {
    const text = textOf(
      await renderWith({ origin: ORIGIN }, async () => ({
        reachMinutes: 60,
        drives: [],
        disclosures: ['The good roads near here are a fair drive out.'],
      })),
    );
    expect(text).toContain('fair drive out');
  });
});

function coreDrive(over: Partial<CoreDrive> = {}): CoreDrive {
  const seg = (x0: number): { type: 'LineString'; coordinates: [number, number][] } => ({
    type: 'LineString',
    coordinates: [
      [x0, 43.8],
      [x0 + 0.05, 43.85],
    ],
  });
  return {
    id: 'c-80_43:ribbon:1',
    kind: 'ribbon',
    name: 'Forks of the Credit',
    barProfile: 'strict',
    core: {
      geometry: seg(-80.0),
      distance_m: 12_000,
      duration_s: 2520, // 42 min
      entry: { lat: 43.8, lng: -80.0 },
      exit: { lat: 43.85, lng: -79.95 },
      curviness: 1.4,
      backroadShare: 0.92,
      mainShare: 0.06,
      hoodShare: 0.01,
      turnsPer10min: 3,
      loopiness: null,
    },
    connectorOut: { geometry: seg(-80.1), distance_m: 9000, duration_s: 1080 }, // 18
    connectorHome: { geometry: seg(-79.9), distance_m: 10_000, duration_s: 1260 }, // 21
    sameWayHome: false,
    ...over,
  };
}

const V2_OK: DiscoverResultV2 = {
  v: 2,
  reachMinutes: 60,
  disclosures: [],
  drives: [coreDrive()],
};

async function renderV2(
  fetchCores: (o: LatLng) => Promise<DiscoverResultV2>,
  fetchDrives?: () => Promise<DiscoverResult>,
  navigate = vi.fn(),
) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      wrap(
        <MapHome
          {...SEED_PROPS}
          navigation={{ navigate }}
          locate={() => new Promise(() => {})}
          fetchCores={fetchCores}
          fetchDrives={
            fetchDrives ?? (async () => ({ reachMinutes: 60, disclosures: [], drives: [] }))
          }
        />,
        { origin: ORIGIN },
      ),
    );
  });
  return tree;
}

describe('MapHome Near you v2 (R29 Unit A — the drive + get-there + get-home)', () => {
  it('renders the three-part label and the different-way-home honesty line', async () => {
    const text = textOf(await renderV2(async () => V2_OK));
    expect(text).toContain('Forks of the Credit');
    expect(text).toContain('the drive 42 min · getting there 18 · home 21');
    expect(text).toContain('different way home');
  });

  it('a tap opens Result with ONE route whose legs carry the measured split', async () => {
    const navigate = vi.fn();
    const tree = await renderV2(async () => V2_OK, undefined, navigate);
    const card = tree.root
      .findAllByProps({ accessibilityRole: 'button' })
      .filter((n) => String(n.props.accessibilityLabel ?? '').includes('Forks of the Credit'))[0]!;
    act(() => {
      card.props.onPress();
    });
    const arg = navigate.mock.calls.find((c) => c[0] === 'Result')?.[1] as
      | { route: { legs?: { drive_backroad_pct: number | null } | null; duration_s: number } }
      | undefined;
    expect(arg).toBeDefined();
    // the drive's own measured road class, not a blob average
    expect(arg!.route.legs?.drive_backroad_pct).toBe(92);
    // total = 42 + 18 + 21 minutes
    expect(Math.round(arg!.route.duration_s / 60)).toBe(81);
  });

  it('U12c/BD-180: an EMPTY v2 menu shows the HONEST state, never a v1 downgrade', async () => {
    // Recovery §15: a lower-quality out-and-back lookalike wearing the same UI
    // is worse than the truth. Measured before flipping (rq40): 0 of 27
    // gold+holdout origins return an empty v2 menu, so nothing loses a menu.
    const v1 = vi.fn(
      async (): Promise<DiscoverResult> => ({
        reachMinutes: 60,
        disclosures: ['nothing nearby'],
        drives: [],
      }),
    );
    const screen = await renderV2(
      async () => ({
        v: 2,
        reachMinutes: 60,
        disclosures: ['No measured drives near here yet — try a different start point.'],
        drives: [],
      }),
      v1,
    );
    expect(v1).not.toHaveBeenCalled();
    expect(textOf(screen)).toContain('No measured drives near here yet');
  });

  it('honesty line changes for same-way-home and best-around-here drives', async () => {
    const text = textOf(
      await renderV2(async () => ({
        ...V2_OK,
        drives: [coreDrive({ sameWayHome: true, barProfile: 'cell_relaxed' })],
      })),
    );
    expect(text).toContain('best around here');
  });

  it('BD-203: same-way-back says what was measured, never that no second road exists', async () => {
    const text = textOf(
      await renderV2(async () => ({ ...V2_OK, drives: [coreDrive({ sameWayHome: true })] })),
    );
    expect(text).toContain('same way there and back (fastest route)');
    expect(text).not.toContain('second road');
  });

  it('BD-203: EVERY disclosure of a non-empty menu is rendered under the list', async () => {
    const disclosures = [
      '2 more were mostly getting-there from here — not shown.',
      "on some of these you'll take the same fastest road there and back.",
    ];
    const text = textOf(await renderV2(async () => ({ ...V2_OK, disclosures })));
    expect(text).toContain('Forks of the Credit'); // the menu is there …
    for (const line of disclosures) expect(text).toContain(line); // … and so are its notes
  });

  it('BD-203: an empty menu shows ALL its disclosures, the empty-state line first', async () => {
    const disclosures = [
      'No measured drives fit from here — try a different start point.',
      '1 would be more than 3 hours door to door — not shown.',
    ];
    const text = textOf(
      await renderV2(async () => ({ v: 2, reachMinutes: 60, disclosures, drives: [] })),
    );
    for (const line of disclosures) expect(text).toContain(line);
    expect(text.indexOf(disclosures[0]!)).toBeLessThan(text.indexOf(disclosures[1]!));
  });

  // The card said "the drive 42 min · getting there 18 · home 21" while the map
  // drew all three legs in the same amber — the prop existed, was passed, and
  // was ignored by the layer. The map must say what the card says.
  it('draws the DRIVE amber and the commute legs grey', async () => {
    const tree = await renderV2(async () => V2_OK);
    const line = tree.root
      .findAll((n) => String(n.type) === 'mapbox-linelayer')
      .find((n) => String(n.props.id).endsWith('-line'))!;
    const color = line.props.style.lineColor as unknown[];
    expect(color.slice(0, 4)).toEqual(['match', ['get', 'leg'], 'core', AMBER]);
    expect(color[4]).not.toBe(AMBER); // connectors are a DIFFERENT colour
  });

  it('v1 menus keep one amber line (their features carry no leg)', async () => {
    const tree = await renderWith({ origin: ORIGIN }, async () => MENU);
    const line = tree.root
      .findAll((n) => String(n.type) === 'mapbox-linelayer')
      .find((n) => String(n.props.id).endsWith('-line'))!;
    expect(line.props.style.lineColor).toBe(AMBER);
  });
});

/**
 * The camera and the chrome (BD-204 follow-up), re-aimed (IA + T).
 *
 * WAS: a floating title card and a horizontal card rail, each reporting its own
 * height through `onLayout`, with the fit asserted to clear whichever was
 * measured. Neither exists — the card and the rail are one gesture Shelf, and
 * the control column is a fixed 44 pt pill stack. So the same RELATIONSHIP is
 * asserted against the chrome that is actually there: the fit clears the
 * control column above and the shelf's COMMITTED detent below, and a detent
 * COMMIT re-pads the same fit without a flight while a free drag never re-fits
 * at all (SPEC MapHome item 1: "committed on `onDetent` (never per frame)").
 */
describe('MapHome camera fit vs. the shelf', () => {
  /** The translucent bar the shelf sits on (52 + a Face ID home indicator). */
  const TAB_BAR_H = 86;

  function cameraProps(tree: ReactTestRenderer): Record<string, unknown> {
    return tree.root.findAll((n) => String(n.type) === 'mapbox-camera')[0]!.props;
  }
  function fitPadding(tree: ReactTestRenderer): Record<string, number> {
    return cameraProps(tree)['bounds'] as Record<string, number>;
  }
  /** The sheet is laid out at its TOP detent and translated down by what is
   *  not visible: `height − translateY` is the committed detent. */
  function visibleShelf(tree: ReactTestRenderer): number {
    const sheet = tree.root.find(
      (n) => n.props['testID'] === 'home-shelf' && Array.isArray(n.props['style']),
    );
    const style = Object.assign(
      {},
      ...(sheet.props['style'] as unknown[]).filter((s) => s !== null && typeof s === 'object'),
    ) as { height?: number; transform?: Array<{ translateY?: number }> };
    return (style.height ?? 0) - (style.transform?.[0]?.translateY ?? 0);
  }

  /** A scan held open, so the chrome is on screen before there is a fit —
   *  which is the real order too (the shelf is up while the request is in
   *  flight). Mounted under a real tab-bar height, because the shelf sits ON
   *  the bar and the camera has to clear both. */
  async function renderGatedScan(): Promise<{
    tree: ReactTestRenderer;
    land: () => Promise<void>;
  }> {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        wrap(
          <TabBarHeightContext.Provider value={TAB_BAR_H}>
            <MapHome
              {...SEED_PROPS}
              navigation={{ navigate: vi.fn() }}
              locate={() => new Promise(() => {})}
              fetchCores={async () => {
                await gate;
                return V2_OK;
              }}
              fetchDrives={async () => ({ reachMinutes: 60, disclosures: [], drives: [] })}
            />
          </TabBarHeightContext.Provider>,
          { origin: ORIGIN },
        ),
      );
    });
    return {
      tree,
      land: async () => {
        await act(async () => {
          release();
          await gate;
        });
        await act(async () => {});
      },
    };
  }

  it('the fit clears the control column and the committed detent', async () => {
    const { tree, land } = await renderGatedScan();
    await land();

    const p = fitPadding(tree);
    // the two 44 pt pills live at topInset + spacing.md; the camera reserves
    // the column's clearance above the lines it fits (the top inset is 0 in
    // node, so the clearance IS the reserve here; on device it adds to it)
    expect(p['paddingTop']!).toBeGreaterThanOrEqual(FULL_DETENT_CLEARANCE);
    // …and the tab bar plus the shelf's committed detent, plus the gutter,
    // below them — the lines land in the map that is actually visible
    expect(p['paddingBottom']!).toBeGreaterThanOrEqual(TAB_BAR_H + visibleShelf(tree) + spacing.md);
    expect(visibleShelf(tree)).toBeGreaterThan(0);
  });

  it('a detent commit re-pads the same fit without a flight; a free drag never re-fits', async () => {
    const { tree, land } = await renderGatedScan();
    await land();

    const before = fitPadding(tree)['paddingBottom']!;
    const pan = __mountedGesture(SHELF_PAN_TEST_ID);

    // A FINGER ON THE SHEET, mid-drag: the sheet moves, the camera does not.
    // The detent is committed in `onEnd`, never per frame (expo-animation §6).
    act(() => {
      __fireGesture(pan, 'start');
      __fireGesture(pan, 'update', { translationY: 160 });
    });
    expect(fitPadding(tree)['paddingBottom']).toBe(before);

    // Let go: it catches at `collapsed`, and THAT is what re-pads the fit.
    await act(async () => {
      __fireGesture(pan, 'end', { translationY: 160, velocityY: 600 });
      __fireGesture(pan, 'finalize', { translationY: 160, velocityY: 600 });
    });
    const after = fitPadding(tree)['paddingBottom']!;
    expect(after).toBeLessThan(before); // a smaller shelf hides less map
    expect(after).toBeGreaterThanOrEqual(TAB_BAR_H + visibleShelf(tree) + spacing.md);
    // the padding changed, not the view — correcting it is not a journey
    expect(cameraProps(tree)['animationDuration']).toBe(0);
  });
});

/**
 * The opening camera (2026-09-12).
 *
 * This is the tab the app launches into, and until a menu loaded there was no
 * camera at all — so opening Roadopia showed the whole world above a button
 * asking the user where they are. The fix positions the camera from a location
 * the OS ALREADY has; it never asks for permission, and it never chooses an
 * origin on the user's behalf, because every drive we suggest is built from
 * that choice.
 */
describe('MapHome Near-you opening camera', () => {
  const HERE = { lat: 43.65, lng: -79.38 };

  async function renderOpening(
    knownLocation: () => Promise<LocationResult>,
    draft: Partial<PlanDraft> = {},
  ): Promise<ReactTestRenderer> {
    let tree!: ReactTestRenderer;
    const setDraft = vi.fn();
    await act(async () => {
      tree = create(
        wrap(
          <MapHome
            loadRoutes={async () => []}
            loadSpots={async () => []}
            navigation={{ navigate: vi.fn() }}
            locate={() => new Promise(() => {})}
            knownLocation={knownLocation}
            fetchDrives={() => new Promise(() => {})}
            fetchCores={null}
          />,
          draft,
          setDraft,
        ),
      );
    });
    await act(async () => {});
    (tree as ReactTestRenderer & { __setDraft?: unknown }).__setDraft = setDraft;
    return tree;
  }

  function cam(tree: ReactTestRenderer): Record<string, unknown> | null {
    return tree.root.findAll((n) => String(n.type) === 'mapbox-camera')[0]?.props ?? null;
  }

  it('opens on the user before any menu exists', async () => {
    const tree = await renderOpening(async () => ({ status: 'ok', point: HERE }));
    const settings = cam(tree)!['defaultSettings'] as { centerCoordinate: [number, number] };
    expect(settings.centerCoordinate).toEqual([HERE.lng, HERE.lat]);
  });

  it('positions the camera WITHOUT choosing an origin — the menu still waits', async () => {
    const tree = await renderOpening(async () => ({ status: 'ok', point: HERE }));
    const setDraft = (tree as ReactTestRenderer & { __setDraft?: ReturnType<typeof vi.fn> })
      .__setDraft!;
    // the origin is the user's to pick: "Use my location" / "Pick on map"
    expect(setDraft).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Use my location');
  });

  it('an origin the user CHOSE outranks the OS fix', async () => {
    const PINNED = { lat: 44.5, lng: -80.2 };
    const tree = await renderOpening(async () => ({ status: 'ok', point: HERE }), {
      origin: { source: 'pin', point: PINNED },
    });
    const settings = cam(tree)!['defaultSettings'] as { centerCoordinate: [number, number] };
    expect(settings.centerCoordinate).toEqual([PINNED.lng, PINNED.lat]);
  });

  it('location off is not a failure — no camera, no notice, exactly as before', async () => {
    const tree = await renderOpening(async () => ({ status: 'denied' }));
    expect(cam(tree)).toBeNull();
    // §18: the denied NOTE belongs to the button the user pressed, not to a
    // silent check they never asked for
    expect(JSON.stringify(tree.toJSON())).not.toContain('Location is off');
  });
});
