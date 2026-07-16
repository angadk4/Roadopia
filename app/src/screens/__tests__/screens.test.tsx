/**
 * Component smoke (M7-T01) — renders OUR screens in node via react-test-renderer
 * over the rn-stub alias. Catches wiring failures (broken imports, hook misuse,
 * render crashes); native behaviour is verified on device (M7-T09).
 */
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFT, PlanDraftContext, type PlanDraft } from '../../lib/plan_draft';
import MapHome from '../MapHome';
import { CreateScreen, SavedScreen } from '../placeholders';
import PlanScreen from '../PlanScreen';

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
    // R16-5 sections replace the chip row; still presets-only under the hood
    // (BD-30 / Hard rule L — buildPlanRequest composes onto the preset slot)
    expect(text).toContain('optional');
    expect(text).toContain('Drive style');
    expect(text).toContain('Twisty');
    expect(text).toContain('Simple');
    expect(text).toContain('Scenery');
    expect(text).toContain('Prefer views');
    expect(text).toContain('On the route');
    expect(text).toContain('Avoid highways');
    expect(text).toContain('Mostly backroads');
    expect(text).toContain('Paved roads only');
    expect(text).toContain('Add a stop');
    expect(text.toLowerCase()).not.toContain('slider');
    // Chill is gone from the UI ('Simple' replaced it, owner ask R16)
    expect(text).not.toContain('Chill');
    // CTA blocked with friendly reasons
    expect(text).toContain('Describe the drive you want.');
    expect(text).toContain('Add a start point.');
  });

  it('PlanScreen with a complete draft shows the set origin and no blockers', () => {
    const text = textOf(
      planScreenWith({
        brief: 'twisty 90 minute loop',
        origin: { source: 'current', point: { lat: 43.26, lng: -79.87 } },
      }),
    );
    expect(text).toContain('Current location');
    expect(text).not.toContain('Add a start point.');
  });

  it('PlanScreen marks the active drive-style chip selected; stops builder rows render', () => {
    const text = textOf(
      planScreenWith({
        style: 'twisty',
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

  it('Create/Saved placeholders render honest milestone copy', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<CreateScreen />);
    });
    expect(textOf(tree)).toContain('Create');
    act(() => {
      tree = create(<SavedScreen />);
    });
    expect(textOf(tree)).toContain('Saved');
  });

  it('MapHome shows the loading banner over the map while routes fetch', () => {
    let tree!: ReactTestRenderer;
    const pendingRoutes = () => new Promise<never>(() => {});
    act(() => {
      tree = create(<MapHome loadRoutes={pendingRoutes} />);
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
        <MapHome
          loadRoutes={() => Promise.resolve([row])}
          loadSpots={() => Promise.resolve([spot])}
        />,
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
      tree = create(<MapHome loadRoutes={() => Promise.reject(new Error('down'))} />);
    });
    const text = textOf(tree);
    expect(text).toContain('mapbox-mapview');
    expect(text).toContain("Couldn't load routes");
    expect(text).toContain('Retry');
    expect(text).not.toContain('down'); // never the raw error
  });
});
