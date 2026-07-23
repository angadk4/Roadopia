import { describe, expect, it } from 'vitest';

import { MAX_BRIEF_CHARS } from '../api';
import { buildPlanRequest, DEFAULT_DRAFT, EMPTY_DRAFT, type PlanDraft } from '../plan_draft';

const ORIGIN = { source: 'current' as const, point: { lat: 43.26, lng: -79.87 } };

function draft(overrides: Partial<PlanDraft>): PlanDraft {
  return { ...EMPTY_DRAFT, ...overrides };
}

describe('buildPlanRequest', () => {
  it('builds a valid loop request (brief trimmed, origin coords, shape)', () => {
    const out = buildPlanRequest(draft({ brief: '  a 90 minute loop  ', origin: ORIGIN }));
    expect(out).toEqual({
      ok: true,
      request: {
        brief: 'a 90 minute loop',
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

  it('U12: an empty brief is allowed; a missing origin still blocks', () => {
    const out = buildPlanRequest(draft({ brief: '   ' })); // no origin
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.problems).not.toContain('Describe the drive you want.');
      expect(out.problems).toContain('Add a start point.');
    }
  });

  it('U12: a buttons-only plan (empty brief + origin) is valid', () => {
    const out = buildPlanRequest(draft({ brief: '', origin: ORIGIN, style: 'backroads' }));
    expect(out.ok).toBe(true);
    expect(out.ok && out.request.preset).toBe('backroads');
    expect(out.ok && out.request.brief).toBe('');
  });

  it('U12: the time control composes duration_target_s; "Any" (null) omits it', () => {
    const timed = buildPlanRequest(draft({ brief: '', origin: ORIGIN, durationTargetS: 5400 }));
    expect(timed.ok && timed.request.duration_target_s).toBe(5400);
    const any = buildPlanRequest(draft({ brief: '', origin: ORIGIN, durationTargetS: null }));
    expect(any.ok && 'duration_target_s' in any.request).toBe(false);
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

describe('buildPlanRequest — R23 2-stop drive-style composition', () => {
  it('Direct → preset simple + twistiness_pref 0.15; Fun & Explorative → backroads, no pref', () => {
    const direct = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, style: 'simple' }));
    expect(direct.ok && direct.request.preset).toBe('simple');
    expect(direct.ok && direct.request.twistiness_pref).toBe(0.15);

    const backroads = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, style: 'backroads' }));
    expect(backroads.ok && backroads.request.preset).toBe('backroads');
    // re-homed from the old "backroads alone takes the slot with no pref"
    expect(backroads.ok && 'twistiness_pref' in backroads.request).toBe(false);
  });

  it('never emits the retired twisty preset / 0.9 pref (R23 rollback)', () => {
    for (const style of ['simple', 'backroads'] as const) {
      const out = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, style }));
      expect(out.ok && out.request.preset).not.toBe('twisty');
      expect(out.ok && out.request.twistiness_pref).not.toBe(0.9);
    }
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

  it('the app DEFAULT_DRAFT opens on Fun & Explorative (plain generate is fun, not a cruise)', () => {
    const out = buildPlanRequest({ ...DEFAULT_DRAFT, brief: 'b', origin: ORIGIN });
    expect(out.ok && out.request.preset).toBe('backroads');
    expect(out.ok && 'twistiness_pref' in out.request).toBe(false);
    // EMPTY_DRAFT stays the true nothing-selected baseline (composes no preset)
    const empty = buildPlanRequest({ ...EMPTY_DRAFT, brief: 'b', origin: ORIGIN });
    expect(empty.ok && 'preset' in empty.request).toBe(false);
  });

  it('Scenery adds the scenic tag but NO viewpoint stop (R16-fix) and never the preset slot', () => {
    const out = buildPlanRequest(
      draft({ brief: 'b', origin: ORIGIN, style: 'backroads', preferViews: true }),
    );
    expect(out.ok && out.request.preset).toBe('backroads'); // untouched by scenery
    expect(out.ok && out.request.character).toEqual(['scenic']);
    // scenery is a routing preference (Thread B), not a viewpoint STOP
    expect(out.ok && 'stops' in out.request).toBe(false);
  });

  it('avoid sends ONLY the toggles that are ON (per-key server merge)', () => {
    const out = buildPlanRequest(
      draft({
        brief: 'b',
        origin: ORIGIN,
        routeOptions: { avoidHighways: true, pavedOnly: true },
      }),
    );
    expect(out.ok && out.request.avoid).toEqual({ highways: true, unpaved: true });

    const one = buildPlanRequest(
      draft({
        brief: 'b',
        origin: ORIGIN,
        routeOptions: { avoidHighways: true, pavedOnly: false },
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
        style: 'backroads',
        preferViews: true,
        routeOptions: { avoidHighways: true, pavedOnly: true },
        stops: [{ type: 'food', when: 'midway' }],
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.request.preset).toBe('backroads');
      expect('twistiness_pref' in out.request).toBe(false);
      expect(out.request.avoid).toEqual({ highways: true, unpaved: true });
      expect(out.request.character).toEqual(['scenic']);
      // scenery contributes the scenic tag but no longer a viewpoint stop (R16-fix)
      expect(out.request.stops).toEqual([
        { type: 'food', count: 1, importance: 'nice_to_have', at_fraction: 0.5 },
      ]);
    }
  });
});
