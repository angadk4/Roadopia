import { describe, expect, it } from 'vitest';

import { MAX_BRIEF_CHARS } from '../api';
import { buildPlanRequest, EMPTY_DRAFT, type PlanDraft } from '../plan_draft';

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

  it('carries the preset chip as the additive preset field (BD-30 transport)', () => {
    const out = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, preset: 'twisty' }));
    expect(out.ok && out.request.preset).toBe('twisty');
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
    const out = buildPlanRequest(draft({ brief: 'b', origin: ORIGIN, preset: 'chill' }));
    expect(out.ok && 'weights' in out.request).toBe(false);
  });
});
