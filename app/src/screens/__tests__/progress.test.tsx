/**
 * Progress-screen smoke (M7-T04) — injected stream, no network. Verifies the
 * streamed timeline renders incrementally-ordered rows, success auto-advances
 * to Result via replace, and guard/no-route failures render friendly panels.
 */
import type { GenerationEvent } from '@shared/types';
import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../lib/api';
import type { PlanStreamResult } from '../../lib/plan_stream';
import ProgressScreen from '../ProgressScreen';

const REQUEST = { brief: 'twisty loop', origin: { lat: 43.26, lng: -79.87 } };

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function makeNav(): {
  nav: { replace: (s: string, p?: Record<string, unknown>) => void; goBack: () => void };
  calls: Array<{ screen: string; params?: Record<string, unknown> }>;
} {
  const calls: Array<{ screen: string; params?: Record<string, unknown> }> = [];
  return {
    calls,
    nav: {
      replace: (screen, params) => calls.push({ screen, ...(params ? { params } : {}) }),
      goBack: () => {},
    },
  };
}

describe('ProgressScreen', () => {
  it('renders streamed steps + grounded tool rows while streaming, with cancel', async () => {
    let tree!: ReactTestRenderer;
    const { nav } = makeNav();
    const events: GenerationEvent[] = [
      { type: 'step', step: 'parse', status: 'started' },
      { type: 'step', step: 'parse', status: 'completed', detail: 'parser=llm' },
      { type: 'tool_call', tool: 'find_curvy_roads' },
      { type: 'tool_result', tool: 'find_curvy_roads', ok: true, count: 212 },
      { type: 'step', step: 'route_candidates', status: 'started' },
    ];
    // stream that emits events then never resolves (still in flight)
    const streamFn = (_r: unknown, opts: { onEvent: (e: GenerationEvent) => void }) => {
      for (const e of events) opts.onEvent(e);
      return new Promise<PlanStreamResult>(() => {});
    };
    await act(async () => {
      tree = create(
        <ProgressScreen
          navigation={nav}
          route={{ params: { request: REQUEST } }}
          streamFn={streamFn as never}
        />,
      );
    });
    const text = textOf(tree);
    expect(text).toContain('Understanding your brief');
    expect(text).toContain('parser=llm');
    expect(text).toContain('Curvy roads');
    expect(text).toContain('212');
    expect(text).toContain('Routing on real roads');
    expect(text).toContain('Cancel');
  });

  it('success auto-advances to Result with the validated payload (replace)', async () => {
    const { nav, calls } = makeNav();
    const route = { distance_m: 68000, duration_s: 5300, is_loop: true } as never;
    const streamFn = (_r: unknown, opts: { onEvent: (e: GenerationEvent) => void }) => {
      opts.onEvent({ type: 'route', route });
      opts.onEvent({
        type: 'explanation',
        explanation: { text: 'A quiet 90-minute loop.', satisfied: ['duration'], relaxed: [] },
      });
      opts.onEvent({ type: 'done', status: 'ok' });
      return Promise.resolve<PlanStreamResult>({ done: 'ok', aborted: false, malformedFrames: 0 });
    };
    await act(async () => {
      create(
        <ProgressScreen
          navigation={nav}
          route={{ params: { request: REQUEST } }}
          streamFn={streamFn as never}
        />,
      );
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.screen).toBe('Result');
    const params = calls[0]!.params as { route: unknown; done: string };
    expect(params.route).toBe(route);
    expect(params.done).toBe('ok');
  });

  it('guard rejection (rate limit) renders the server message + retry', async () => {
    let tree!: ReactTestRenderer;
    const { nav } = makeNav();
    const streamFn = () =>
      Promise.reject(
        new ApiError({
          status: 429,
          code: 'rate_limited',
          message: 'Too many plans at once — try again in 9s.',
          retryAfterS: 9,
        }),
      );
    await act(async () => {
      tree = create(
        <ProgressScreen
          navigation={nav}
          route={{ params: { request: REQUEST } }}
          streamFn={streamFn as never}
        />,
      );
    });
    const text = textOf(tree);
    expect(text).toContain('Too many plans at once');
    expect(text).toContain('Try again');
    expect(text).toContain('Adjust the plan');
  });

  it('done:unavailable renders the friendly error text (clarify lands here too)', async () => {
    let tree!: ReactTestRenderer;
    const { nav } = makeNav();
    const streamFn = (_r: unknown, opts: { onEvent: (e: GenerationEvent) => void }) => {
      opts.onEvent({
        type: 'error',
        message: 'One thing to clear up before planning — where should the drive start?',
      });
      opts.onEvent({ type: 'done', status: 'unavailable' });
      return Promise.resolve<PlanStreamResult>({
        done: 'unavailable',
        aborted: false,
        malformedFrames: 0,
      });
    };
    await act(async () => {
      tree = create(
        <ProgressScreen
          navigation={nav}
          route={{ params: { request: REQUEST } }}
          streamFn={streamFn as never}
        />,
      );
    });
    const text = textOf(tree);
    expect(text).toContain('No route this time');
    expect(text).toContain('where should the drive start');
    expect(text).not.toContain('undefined');
  });

  it('retry after a failure resets the run and can SUCCEED (review 2026-07-16 regression)', async () => {
    let tree!: ReactTestRenderer;
    const { nav, calls } = makeNav();
    let attemptNo = 0;
    const route = { distance_m: 1000, duration_s: 600, is_loop: true } as never;
    const streamFn = (_r: unknown, opts: { onEvent: (e: GenerationEvent) => void }) => {
      attemptNo += 1;
      if (attemptNo === 1) return Promise.reject(new TypeError('offline'));
      opts.onEvent({ type: 'route', route });
      opts.onEvent({ type: 'done', status: 'ok' });
      return Promise.resolve<PlanStreamResult>({ done: 'ok', aborted: false, malformedFrames: 0 });
    };
    await act(async () => {
      tree = create(
        <ProgressScreen
          navigation={nav}
          route={{ params: { request: REQUEST } }}
          streamFn={streamFn as never}
        />,
      );
    });
    expect(textOf(tree)).toContain('No connection');
    // tap "Try again": find the label text node, climb to the pressable parent
    const label = tree.root.findAll(
      (n) =>
        (n.type as unknown as string) === 'rn-text' &&
        (n.children as unknown[]).join('') === 'Try again',
    )[0]!;
    let pressable = label.parent;
    while (pressable && typeof pressable.props['onPress'] !== 'function') {
      pressable = pressable.parent;
    }
    await act(async () => {
      (pressable!.props['onPress'] as () => void)();
    });
    expect(attemptNo).toBe(2);
    expect(calls.some((c) => c.screen === 'Result')).toBe(true); // retry SUCCEEDED
  });

  it('mid-run connection loss (done:null after events) renders the honest lost panel', async () => {
    let tree!: ReactTestRenderer;
    const { nav } = makeNav();
    const streamFn = (_r: unknown, opts: { onEvent: (e: GenerationEvent) => void }) => {
      opts.onEvent({ type: 'step', step: 'parse', status: 'started' });
      return Promise.resolve<PlanStreamResult>({ done: null, aborted: false, malformedFrames: 0 });
    };
    await act(async () => {
      tree = create(
        <ProgressScreen
          navigation={nav}
          route={{ params: { request: REQUEST } }}
          streamFn={streamFn as never}
        />,
      );
    });
    expect(textOf(tree)).toContain('Connection lost');
  });
});
