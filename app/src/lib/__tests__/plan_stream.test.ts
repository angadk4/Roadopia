import type { GenerationEvent } from '@shared/types';
import { describe, expect, it } from 'vitest';

import { streamPlan, type StreamingFetchLike, type StreamingResponseLike } from '../plan_stream';

const encoder = new TextEncoder();

/** Build a streaming response emitting `chunks` (strings) as Uint8Array reads. */
function sseResponse(
  chunks: string[],
  opts: { failAfter?: number; abortError?: boolean } = {},
): StreamingResponseLike {
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (n) => (n === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => ({
        read: () => {
          if (opts.failAfter !== undefined && i >= opts.failAfter) {
            const err = new Error(opts.abortError ? 'aborted' : 'connection reset');
            if (opts.abortError) err.name = 'AbortError';
            return Promise.reject(err);
          }
          if (i >= chunks.length) return Promise.resolve({ done: true as const });
          const value = encoder.encode(chunks[i]);
          i += 1;
          return Promise.resolve({ done: false as const, value });
        },
      }),
    },
    text: () => Promise.resolve(''),
  };
}

function frame(e: Record<string, unknown>): string {
  return `event: ${String(e['type'])}\ndata: ${JSON.stringify(e)}\n\n`;
}

const STEP = { type: 'step', step: 'parse', status: 'started' };
const EXPLANATION = {
  type: 'explanation',
  explanation: {
    text: 'A calm 90-minute loop on quiet backroads.',
    satisfied: ['duration'],
    relaxed: [],
  },
};
const DONE_OK = { type: 'done', status: 'ok' };

describe('streamPlan', () => {
  it('dispatches schema-valid events in order and resolves with the done status', async () => {
    const events: GenerationEvent[] = [];
    const fetchImpl: StreamingFetchLike = () =>
      Promise.resolve(sseResponse([frame(STEP), ': ping\n\n', frame(EXPLANATION), frame(DONE_OK)]));
    const result = await streamPlan(
      { brief: 'a scenic loop' },
      { baseUrl: 'http://x', fetchImpl, onEvent: (e) => events.push(e) },
    );
    expect(events.map((e) => e.type)).toEqual(['step', 'explanation', 'done']);
    expect(result).toEqual({ done: 'ok', aborted: false, malformedFrames: 0 });
  });

  it('reassembles frames split across chunk boundaries (multi-byte safe)', async () => {
    const wire =
      frame(STEP) +
      frame({
        ...EXPLANATION,
        explanation: { text: 'café détour — élan', satisfied: [], relaxed: [] },
      }) +
      frame(DONE_OK);
    // Split the UTF-8 BYTES at awkward positions, including inside 'é'.
    const bytes = encoder.encode(wire);
    const cut1 = 13;
    const cut2 = bytes.findIndex((b) => b > 0x7f) + 1; // mid multi-byte char
    const parts = [bytes.slice(0, cut1), bytes.slice(cut1, cut2), bytes.slice(cut2)];
    let i = 0;
    const res: StreamingResponseLike = {
      ok: true,
      status: 200,
      headers: { get: (n) => (n === 'content-type' ? 'text/event-stream' : null) },
      body: {
        getReader: () => ({
          read: () =>
            i < parts.length
              ? Promise.resolve({ done: false as const, value: parts[i++] })
              : Promise.resolve({ done: true as const }),
        }),
      },
      text: () => Promise.resolve(''),
    };
    const events: GenerationEvent[] = [];
    const result = await streamPlan(
      { brief: 'b' },
      {
        baseUrl: 'http://x',
        fetchImpl: () => Promise.resolve(res),
        onEvent: (e) => events.push(e),
      },
    );
    expect(events).toHaveLength(3);
    const explanation = events[1];
    expect(explanation?.type === 'explanation' && explanation.explanation.text).toContain('café');
    expect(result.done).toBe('ok');
  });

  it('throws a typed ApiError for pre-stream guard rejections (429 JSON)', async () => {
    const body = JSON.stringify({
      error: {
        code: 'rate_limited',
        message: 'Too many plans at once — try again in 9s.',
        trace_id: 't',
      },
    });
    const res: StreamingResponseLike = {
      ok: false,
      status: 429,
      headers: {
        get: (n) => (n === 'retry-after' ? '9' : n === 'content-type' ? 'application/json' : null),
      },
      body: null,
      text: () => Promise.resolve(body),
    };
    await expect(
      streamPlan(
        { brief: 'x' },
        { baseUrl: 'http://x', fetchImpl: () => Promise.resolve(res), onEvent: () => {} },
      ),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'rate_limited', retryAfterS: 9 });
  });

  it('throws bad_stream when 200 arrives without an event-stream body', async () => {
    const res: StreamingResponseLike = {
      ok: true,
      status: 200,
      headers: { get: (n) => (n === 'content-type' ? 'application/json' : null) },
      body: null,
      text: () => Promise.resolve('{}'),
    };
    await expect(
      streamPlan(
        { brief: 'x' },
        { baseUrl: 'http://x', fetchImpl: () => Promise.resolve(res), onEvent: () => {} },
      ),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'bad_stream' });
  });

  it('reports aborted=true when the reader aborts mid-stream, keeping prior events', async () => {
    const events: GenerationEvent[] = [];
    const fetchImpl: StreamingFetchLike = () =>
      Promise.resolve(sseResponse([frame(STEP)], { failAfter: 1, abortError: true }));
    const result = await streamPlan(
      { brief: 'x' },
      { baseUrl: 'http://x', fetchImpl, onEvent: (e) => events.push(e) },
    );
    expect(events.map((e) => e.type)).toEqual(['step']);
    expect(result).toEqual({ done: null, aborted: true, malformedFrames: 0 });
  });

  it('returns aborted=true when the fetch itself is aborted', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const result = await streamPlan(
      { brief: 'x' },
      { baseUrl: 'http://x', fetchImpl: () => Promise.reject(abortErr), onEvent: () => {} },
    );
    expect(result).toEqual({ done: null, aborted: true, malformedFrames: 0 });
  });

  it('counts malformed frames without rendering them and carries on', async () => {
    const events: GenerationEvent[] = [];
    const fetchImpl: StreamingFetchLike = () =>
      Promise.resolve(
        sseResponse([
          'event: step\ndata: {broken json\n\n',
          frame({ type: 'step', step: 'NOT_A_STEP', status: 'started' }),
          frame(DONE_OK),
        ]),
      );
    const result = await streamPlan(
      { brief: 'x' },
      { baseUrl: 'http://x', fetchImpl, onEvent: (e) => events.push(e) },
    );
    expect(events.map((e) => e.type)).toEqual(['done']);
    expect(result.malformedFrames).toBe(2);
    expect(result.done).toBe('ok');
  });

  it('resolves done:null on connection loss without a done frame (honest state)', async () => {
    const events: GenerationEvent[] = [];
    const fetchImpl: StreamingFetchLike = () =>
      Promise.resolve(sseResponse([frame(STEP)], { failAfter: 1 }));
    const result = await streamPlan(
      { brief: 'x' },
      { baseUrl: 'http://x', fetchImpl, onEvent: (e) => events.push(e) },
    );
    expect(result).toEqual({ done: null, aborted: false, malformedFrames: 0 });
  });

  it('EOF without done resolves done:null (server vanished after headers)', async () => {
    const fetchImpl: StreamingFetchLike = () => Promise.resolve(sseResponse([frame(STEP)]));
    const result = await streamPlan(
      { brief: 'x' },
      { baseUrl: 'http://x', fetchImpl, onEvent: () => {} },
    );
    expect(result.done).toBeNull();
    expect(result.aborted).toBe(false);
  });
});
