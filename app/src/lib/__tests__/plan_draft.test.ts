import { describe, expect, it } from 'vitest';

import { MAX_BRIEF_CHARS } from '../api';
import { buildPlanRequest, DEFAULT_DRAFT, EMPTY_DRAFT, type PlanDraft } from '../plan_draft';

const ORIGIN = { source: 'current' as const, point: { lat: 43.26, lng: -79.87 } };

function draft(overrides: Partial<PlanDraft>): PlanDraft {
  return { ...EMPTY_DRAFT, ...overrides };
}

describe('buildPlanRequest', () => {
  it('builds a valid loop request (brief trimmed, origin coords, shape)', () => {
    const out = buildPlanRequest(draft({ brief: '  a twisty 90 minute loop  ', origin: ORIGIN }));
    expect(out).toEqual({
      ok: true,
      request: {
        brief: 'a twisty 90 minute loop',
        origin: { lat: 43.26, lng: -79.87 },
        shape: 'loop',
      },
    });
  });

  it('includes the destination only for A → B', () => {
    const dest = { lat: 43.5, lng: -80.2 };
    const loop = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, destination: dest }));
    expect(loop.ok && loop.request.destination).toBeUndefined();
    const ab = buildPlanRequest(
      draft({ brief: 'b', origin: ORIGIN, destination: dest, shape: 'a_to_b' }),
    );
    expect(ab.ok && ab.request.destination).toEqual(dest);
    expect(ab.ok && ab.request.shape).toBe('a_to_b');
  });

  it('blocks with friendly problems: empty brief, no origin', () => {
    const out = buildPlanRequest(draft({ brief: '   ' }));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.problems).toContain('Describe the drive you want.');
      expect(out.problems).toContain('Add a start point.');
    }
  });

  it('blocks an over-long brief (Hard rule K mirror of MAX_BRIEF_CHARS)', () => {
    const out = buildPlanRequest(draft({ brief: 'x'.repeat(MAX_BRIEF_CHARS + 1), origin: ORIGIN }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.problems.join(' ')).toContain('500');
  });

  it('blocks A → B without a destination', () => {
    const out = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, shape: 'a_to_b' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.problems).toContain('Pick a destination for an A → B drive.');
  });

  it('never sends weights — sliders are not built ([GATE-W]/BD-30)', () => {
    const out = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, style: 'simple' }));
    expect(out.ok && 'weights' in out.request).toBe(false);
  });
});

describe('buildPlanRequest — R16-5 section composition (the preset-slot rules)', () => {
  it('Twisty → preset twisty + twistiness_pref 0.9; Simple → simple + 0.15', () => {
    const twisty = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, style: 'twisty' }));
    expect(twisty.ok && twisty.request.preset).toBe('twisty');
    expect(twisty.ok && twisty.request.twistiness_pref).toBe(0.9);

    const simple = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, style: 'simple' }));
    expect(simple.ok && simple.request.preset).toBe('simple');
    expect(simple.ok && simple.request.twistiness_pref).toBe(0.15);
  });

  it('no style, no toggles → NO preset/pref/avoid/character/stops fields at all', () => {
    const out = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect('preset' in out.request).toBe(false);
      expect('twistiness_pref' in out.request).toBe(false);
      expect('avoid' in out.request).toBe(false);
      expect('character' in out.request).toBe(false);
      expect('stops' in out.request).toBe(false);
    }
  });

  it('R21-2: the app DEFAULT_DRAFT opens on Backroads (plain generate is fun, not a cruise)', () => {
    const out = buildPlanRequest({ ...DEFAULT_DRAFT, brief: 'b', origin: ORIGIN });
    expect(out.ok && out.request.preset).toBe('backroads');
    // EMPTY_DRAFT stays the true nothing-selected baseline (composes no preset)
    const empty = buildPlanRequest({ ...EMPTY_DRAFT, brief: 'b', origin: ORIGIN });
    expect(empty.ok && 'preset' in empty.request).toBe(false);
  });

  it('backroads takes the preset slot over Twisty; the 0.9 pref rides along', () => {
    const out = buildPlanRequest(
      draft({
        brief: 'b',
        origin: ORIGIN,
        style: 'twisty',
        routeOptions: { avoidHighways: false, mostlyBackroads: true, pavedOnly: false },
      }),
    );
    expect(out.ok && out.request.preset).toBe('backroads');
    expect(out.ok && out.request.twistiness_pref).toBe(0.9);
  });

  it('backroads + Simple keeps simple and adds the backroad tag (weak combo, honest)', () => {
    const out = buildPlanRequest(
      draft({
        brief: 'b',
        origin: ORIGIN,
        style: 'simple',
        routeOptions: { avoidHighways: false, mostlyBackroads: true, pavedOnly: false },
      }),
    );
    expect(out.ok && out.request.preset).toBe('simple');
    expect(out.ok && out.request.character).toEqual(['backroad']);
  });

  it('backroads alone (no style) takes the slot with no pref', () => {
    const out = buildPlanRequest(
      draft({
        brief: 'b',
        origin: ORIGIN,
        routeOptions: { avoidHighways: false, mostlyBackroads: true, pavedOnly: false },
      }),
    );
    expect(out.ok && out.request.preset).toBe('backroads');
    expect(out.ok && 'twistiness_pref' in out.request).toBe(false);
  });

  it('Scenery adds the scenic tag but NO viewpoint stop (R16-fix) and never the preset slot', () => {
    const out = buildPlanRequest(
      draft({ brief: 'b', origin: ORIGIN, style: 'twisty', preferViews: true }),
    );
    expect(out.ok && out.request.preset).toBe('twisty'); // untouched
    expect(out.ok && out.request.character).toEqual(['scenic']);
    // scenery no longer injects a viewpoint STOP (it dragged loops + skipped
    // repair); it becomes a routing preference in Thread B
    expect(out.ok && 'stops' in out.request).toBe(false);
  });

  it('avoid sends ONLY the toggles that are ON (per-key server merge)', () => {
    const out = buildPlanRequest(
      draft({
        brief: 'b',
        origin: ORIGIN,
        routeOptions: { avoidHighways: true, mostlyBackroads: false, pavedOnly: true },
      }),
    );
    expect(out.ok && out.request.avoid).toEqual({ highways: true, unpaved: true });

    const one = buildPlanRequest(
      draft({
        brief: 'b',
        origin: ORIGIN,
        routeOptions: { avoidHighways: true, mostlyBackroads: false, pavedOnly: false },
      }),
    );
    // an untouched toggle must NOT appear as false (it would clear a
    // brief-parsed avoid server-side)
    expect(one.ok && one.request.avoid).toEqual({ highways: true });
  });

  it('stops rows map when → fraction (Anytime null · Early .25 · Midway .5 · Late .75)', () => {
    const out = buildPlanRequest(
      draft({
        brief: 'b',
        origin: ORIGIN,
        stops: [
          { type: 'coffee', when: 'midway' },
          { type: 'food', when: 'anytime' },
          { type: 'fuel', when: 'late' },
        ],
      }),
    );
    expect(out.ok && out.request.stops).toEqual([
      { type: 'coffee', count: 1, importance: 'nice_to_have', at_fraction: 0.5 },
      { type: 'food', count: 1, importance: 'nice_to_have', at_fraction: null },
      { type: 'fuel', count: 1, importance: 'nice_to_have', at_fraction: 0.75 },
    ]);
  });

  it('duplicate (type, when) rows aggregate into one request with count n', () => {
    const out = buildPlanRequest(
      draft({
        brief: 'b',
        origin: ORIGIN,
        stops: [
          { type: 'coffee', when: 'anytime' },
          { type: 'coffee', when: 'anytime' },
          { type: 'coffee', when: 'midway' }, // different when = separate unit
        ],
      }),
    );
    expect(out.ok && out.request.stops).toEqual([
      { type: 'coffee', count: 2, importance: 'nice_to_have', at_fraction: null },
      { type: 'coffee', count: 1, importance: 'nice_to_have', at_fraction: 0.5 },
    ]);
  });

  it('full house: every section set composes without collisions', () => {
    const out = buildPlanRequest(
      draft({
        brief: 'sunday drive',
        origin: ORIGIN,
        style: 'twisty',
        preferViews: true,
        routeOptions: { avoidHighways: true, mostlyBackroads: true, pavedOnly: true },
        stops: [{ type: 'food', when: 'midway' }],
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.request.preset).toBe('backroads');
      expect(out.request.twistiness_pref).toBe(0.9);
      expect(out.request.avoid).toEqual({ highways: true, unpaved: true });
      expect(out.request.character).toEqual(['scenic']);
      // scenery contributes the scenic tag but no longer a viewpoint stop (R16-fix)
      expect(out.request.stops).toEqual([
        { type: 'food', count: 1, importance: 'nice_to_have', at_fraction: 0.5 },
      ]);
    }
  });
});
