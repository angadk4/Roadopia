import type { DiscoverResult, NearbyDrive } from '@shared/types';
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_DRAFT, PlanDraftContext, type PlanDraft } from '../../lib/plan_draft';
import DiscoverHome from '../DiscoverHome';

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
