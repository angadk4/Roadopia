import type { GenerationEvent } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { INITIAL_RUN, runReducer, STEP_LABELS, toolLabel, type PlanRunState } from '../plan_run';

function feed(events: GenerationEvent[], from: PlanRunState = INITIAL_RUN): PlanRunState {
  return events.reduce((s, event) => runReducer(s, { type: 'event', event }), from);
}

describe('runReducer — timeline assembly', () => {
  it('started → completed collapses into one row with the detail', () => {
    const s = feed([
      { type: 'step', step: 'parse', status: 'started' },
      { type: 'step', step: 'parse', status: 'completed', detail: 'parser=llm' },
    ]);
    expect(s.timeline).toEqual([
      { kind: 'step', step: 'parse', status: 'completed', detail: 'parser=llm' },
    ]);
  });

  it('repeated steps across iterations append distinct rows', () => {
    const s = feed([
      { type: 'step', step: 'scope', status: 'started' },
      { type: 'step', step: 'scope', status: 'completed' },
      { type: 'step', step: 'scope', status: 'started' }, // iteration 2
    ]);
    expect(s.timeline).toHaveLength(2);
    expect(s.timeline[0]).toMatchObject({ status: 'completed' });
    expect(s.timeline[1]).toMatchObject({ status: 'started' });
  });

  it('tool_call opens a pending row; tool_result grounds it (ok + count)', () => {
    const s = feed([
      { type: 'tool_call', tool: 'find_curvy_roads' },
      { type: 'tool_result', tool: 'find_curvy_roads', ok: true, count: 212 },
    ]);
    expect(s.timeline).toEqual([{ kind: 'tool', tool: 'find_curvy_roads', ok: true, count: 212 }]);
  });

  it('alternate frames accumulate best-first (FB-4)', () => {
    const r1 = { distance_m: 1 } as never;
    const r2 = { distance_m: 2 } as never;
    const s = feed([
      { type: 'alternate', route: r1 },
      { type: 'alternate', route: r2 },
    ]);
    expect(s.alternates).toEqual([r1, r2]);
  });

  it('route / explanation / error / done land in their slots', () => {
    const s = feed([
      { type: 'error', message: 'Where should the drive start?' },
      { type: 'done', status: 'unavailable' },
    ]);
    expect(s.errorMessage).toBe('Where should the drive start?');
    expect(s.done).toBe('unavailable');
  });
});

describe('runReducer — terminal phases', () => {
  it('stream_end ok/relaxed/best_so_far with a delivered route → succeeded', () => {
    const withRoute = feed([
      { type: 'route', route: { distance_m: 1, duration_s: 1, is_loop: true } as never },
    ]);
    for (const done of ['ok', 'relaxed', 'best_so_far'] as const) {
      const s = runReducer(withRoute, { type: 'stream_end', done, aborted: false });
      expect(s.phase).toBe('succeeded');
      expect(s.done).toBe(done);
    }
  });

  it('a route-promising done WITHOUT a decoded route fails honestly, never a dead-end succeeded', () => {
    const s = runReducer(INITIAL_RUN, { type: 'stream_end', done: 'ok', aborted: false });
    expect(s.phase).toBe('network_failed'); // schema-skew / dropped frame path
  });

  it('stream_end unavailable → no_route (the honest no-route outcome)', () => {
    const s = runReducer(INITIAL_RUN, { type: 'stream_end', done: 'unavailable', aborted: false });
    expect(s.phase).toBe('no_route');
  });

  it('stream_end with done:null → network_failed (connection lost, said honestly)', () => {
    const s = runReducer(INITIAL_RUN, { type: 'stream_end', done: null, aborted: false });
    expect(s.phase).toBe('network_failed');
  });

  it('aborted stream_end → cancelled; a later stream_end never overrides a settled phase', () => {
    const cancelled = runReducer(INITIAL_RUN, { type: 'cancelled' });
    const after = runReducer(cancelled, { type: 'stream_end', done: 'ok', aborted: false });
    expect(after.phase).toBe('cancelled');
  });

  it('guard_rejected records code/message/retryAfter for the friendly panel', () => {
    const s = runReducer(INITIAL_RUN, {
      type: 'guard_rejected',
      error: {
        code: 'rate_limited',
        message: 'Too many plans at once — try again in 9s.',
        retryAfterS: 9,
      },
    });
    expect(s.phase).toBe('guard_rejected');
    expect(s.guard).toEqual({
      code: 'rate_limited',
      message: 'Too many plans at once — try again in 9s.',
      retryAfterS: 9,
    });
  });

  it('backgrounded → cancelled with the background flag (§14 design)', () => {
    const s = runReducer(INITIAL_RUN, { type: 'backgrounded' });
    expect(s.phase).toBe('cancelled');
    expect(s.wentToBackground).toBe(true);
  });
});

describe('labels', () => {
  it('every pipeline step has an honest, speed-free label (Hard rule D)', () => {
    for (const label of Object.values(STEP_LABELS)) {
      expect(label.toLowerCase()).not.toMatch(/fast|speed|race|racing|quick|lap/);
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it('unknown tools fall back to a readable name', () => {
    expect(toolLabel('estimate_drive_time')).toBe('estimate drive time');
    expect(toolLabel('find_spots')).toBe('Car spots');
  });
});
