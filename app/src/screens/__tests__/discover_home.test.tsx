import type {
  DiscoverResult,
  NearbyDrive,
  CoreDrive,
  DiscoverResultV2,
  LatLng,
} from '@shared/types';
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_DRAFT, PlanDraftContext, type PlanDraft } from '../../lib/plan_draft';
import { AMBER } from '../../theme';
import DiscoverHome from '../DiscoverHome';

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

async function renderWith(draft: Partial<PlanDraft>, fetchDrives: () => Promise<DiscoverResult>) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <PlanDraftContext.Provider
        value={{ draft: { ...EMPTY_DRAFT, ...draft }, setDraft: () => {} }}
      >
        <DiscoverHome
          navigation={{ navigate: vi.fn() }}
          locate={() => new Promise(() => {})}
          fetchDrives={fetchDrives}
          fetchCores={null}
        />
      </PlanDraftContext.Provider>,
    );
  });
  return tree;
}

describe('DiscoverHome (R24 map-first)', () => {
  it('needs an origin before scanning; the map still renders (showpiece)', async () => {
    const text = textOf(await renderWith({}, async () => MENU));
    expect(text).toContain('Great drives near you');
    expect(text).toContain('Set your start point');
    expect(text).toContain('mapbox-mapview'); // map-first: the map is always there
  });

  it('renders a drive card rail over the map with honest time/curviness (no speed framing)', async () => {
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
        <PlanDraftContext.Provider
          value={{ draft: { ...EMPTY_DRAFT, origin: ORIGIN }, setDraft: () => {} }}
        >
          <DiscoverHome
            navigation={{ navigate }}
            locate={() => new Promise(() => {})}
            fetchCores={null}
            fetchDrives={async () => ({ reachMinutes: 60, disclosures: [], drives: [built] })}
          />
        </PlanDraftContext.Provider>,
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
      <PlanDraftContext.Provider
        value={{ draft: { ...EMPTY_DRAFT, origin: ORIGIN }, setDraft: () => {} }}
      >
        <DiscoverHome
          navigation={{ navigate }}
          locate={() => new Promise(() => {})}
          fetchCores={fetchCores}
          fetchDrives={
            fetchDrives ?? (async () => ({ reachMinutes: 60, disclosures: [], drives: [] }))
          }
        />
      </PlanDraftContext.Provider>,
    );
  });
  return tree;
}

describe('DiscoverHome v2 (R29 Unit A — the drive + get-there + get-home)', () => {
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

  it('an EMPTY v2 menu falls back to v1 so no origin loses its menu', async () => {
    const v1 = vi.fn(
      async (): Promise<DiscoverResult> => ({
        reachMinutes: 60,
        disclosures: ['nothing nearby'],
        drives: [],
      }),
    );
    await renderV2(async () => ({ v: 2, reachMinutes: 60, disclosures: [], drives: [] }), v1);
    expect(v1).toHaveBeenCalledTimes(1);
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
