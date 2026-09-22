/**
 * Component smoke (M7-T01) — renders OUR screens in node via react-test-renderer
 * over the rn-stub alias. Catches wiring failures (broken imports, hook misuse,
 * render crashes); native behaviour is verified on device (M7-T09).
 */
/**
 * Split verbatim out of screens.test.tsx (redesign shell — SPEC "Test
 * changes"): the PickPointScreen cases. No assertion changed.
 */
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFT, PlanDraftContext, type PlanDraft } from '../../lib/plan_draft';
import PickPointScreen from '../PickPointScreen';

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

/**
 * BD-204: the picker's mark had a TRUTH cost, not a cosmetic one — the stem's
 * tip sat ~7pt below the coordinate `confirm()` saves, which at this screen's
 * opening zoom is kilometres. Both numbers now come from one anchor, so this
 * asserts the relationship rather than the pixels.
 */
describe('PickPointScreen crosshair + opening camera', () => {
  function pick(draft: Partial<PlanDraft>): ReactTestRenderer {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <PlanDraftContext.Provider
          value={{ draft: { ...EMPTY_DRAFT, ...draft }, setDraft: () => {} }}
        >
          <PickPointScreen navigation={{ goBack: () => {} }} route={{ params: {} }} />
        </PlanDraftContext.Provider>,
      );
    });
    return tree;
  }

  function flat(style: unknown): Record<string, number | string> {
    const parts = (Array.isArray(style) ? style : [style]).filter(
      (s) => s !== null && s !== undefined && typeof s === 'object',
    );
    return Object.assign({}, ...(parts as object[])) as Record<string, number | string>;
  }

  it("the stem's tip lands exactly on the map centre the pick saves", () => {
    const tree = pick({});
    const stems = tree.root
      .findAll((n) => String(n.type) === 'rn-view')
      .map((n) => flat(n.props['style']))
      .filter((s) => s['top'] === '50%' && s['width'] === 3);
    expect(stems).toHaveLength(1);
    // tip on the centre ⇔ the box ends at 50%: marginTop === -height
    expect(stems[0]!['marginTop']).toBe(-(stems[0]!['height'] as number));
  });

  it('opens at a zoom where the instruction can be followed once a point is set', () => {
    const camZoom = (t: ReactTestRenderer): number =>
      (
        t.root.findAll((n) => String(n.type) === 'mapbox-camera')[0]!.props['defaultSettings'] as {
          zoomLevel: number;
        }
      ).zoomLevel;
    // nothing known → the served area, because orientation is the first problem
    expect(camZoom(pick({}))).toBe(7.5);
    // a point IS set → open where it can actually be adjusted
    expect(camZoom(pick({ origin: { source: 'pin', point: { lat: 43.2, lng: -79.8 } } }))).toBe(14);
  });

  it('states what it is asking for and what the button will save', () => {
    const text = textOf(pick({}));
    expect(text).toContain('Pan the map until the pin sits on your');
    expect(text).toContain('Use this point');
    expect(text).not.toContain('down');
  });
});
