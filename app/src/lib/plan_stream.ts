/**
 * The /plan SSE transport (M7-T01; SPK-03 code half).
 *
 * React Native's built-in fetch cannot stream response bodies, so this uses
 * `expo/fetch` (the WinterCG-compliant fetch shipped inside the `expo` package
 * — streaming bodies, zero extra dependency; Dependency Verification §14 calls
 * for exactly such a fetch-stream shim, confirmed on device at SPK-03). The
 * fetch implementation is injectable, so the full transport — guard-rejection
 * branching, incremental frames, cancel — is unit-tested in node with a fake
 * stream; only the one-line default touches Expo.
 *
 * Contract with backend/src/routes/plan.ts:
 *   - Guard rejections (429 rate limit / 503 kill-or-cap / 400 out-of-region)
 *     are plain JSON with the standard error shape → thrown as ApiError BEFORE
 *     any stream handling (the client must branch on ok/content-type).
 *   - Success is `text/event-stream`, ending with a `done` frame.
 *   - Cancel = AbortController → the socket closes → the server halts the
 *     planner loop AND model spend (verified server-side in plan-sse tests).
 */

import type { GenerationEvent } from '@shared/types';

import { ApiError, NetworkError, toApiError, type PlanRequest } from './api';
import { createSseParser, decodeGenerationEvent } from './sse';

/** Structural response type satisfied by expo/fetch and node's undici alike. */
export interface StreamingResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: { getReader(): StreamReaderLike } | null;
  text(): Promise<string>;
}

export interface StreamReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel?(reason?: unknown): Promise<unknown> | void;
}

export type StreamingFetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<StreamingResponseLike>;

export type DoneStatus = 'ok' | 'relaxed' | 'best_so_far' | 'unavailable';

export interface PlanStreamResult {
  /** The final `done` status, or null when the stream ended without one
   *  (connection lost / cancelled) — the UI must treat null honestly. */
  done: DoneStatus | null;
  /** True when the caller's AbortSignal cancelled the stream. */
  aborted: boolean;
  /** Frames that failed JSON/schema validation (rejected, never rendered). */
  malformedFrames: number;
}

export interface PlanStreamOptions {
  baseUrl: string;
  /** Rate-limit session key (x-session-id). */
  sessionId?: string;
  /** Cancel the generation: closing the connection halts backend spend. */
  signal?: AbortSignal;
  /** Injectable for tests; defaults to expo/fetch (streaming-capable). */
  fetchImpl?: StreamingFetchLike;
  /** Fires once per schema-valid GenerationEvent, in wire order. */
  onEvent: (event: GenerationEvent) => void;
}

async function defaultFetch(): Promise<StreamingFetchLike> {
  // Deferred import: node unit tests always inject fetchImpl, so the Expo
  // runtime module is only ever loaded on-device.
  const mod = await import('expo/fetch');
  return mod.fetch as unknown as StreamingFetchLike;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * POST the plan request and stream GenerationEvents until `done`, cancel, or
 * connection loss. Throws ApiError for pre-stream guard rejections (429/503/
 * 400) and NetworkError when the server is unreachable.
 */
export async function streamPlan(
  req: PlanRequest,
  opts: PlanStreamOptions,
): Promise<PlanStreamResult> {
  const fetchImpl = opts.fetchImpl ?? (await defaultFetch());

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
  if (opts.sessionId) headers['x-session-id'] = opts.sessionId;

  let res: StreamingResponseLike;
  try {
    res = await fetchImpl(`${opts.baseUrl}/plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (isAbort(err)) return { done: null, aborted: true, malformedFrames: 0 };
    throw new NetworkError(`Could not reach the server at ${opts.baseUrl}.`, { cause: err });
  }

  // Guard rejections arrive as plain JSON before any stream exists.
  if (!res.ok) {
    const text = await res.text();
    throw toApiError(res.status, text, res.headers);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream') || res.body === null) {
    throw new ApiError({
      status: res.status,
      code: 'bad_stream',
      message: 'The server did not start a plan stream. Please try again.',
    });
  }

  let done: DoneStatus | null = null;
  let malformedFrames = 0;
  const parser = createSseParser((frame) => {
    const decoded = decodeGenerationEvent(frame);
    if (!decoded.ok) {
      malformedFrames += 1;
      return;
    }
    if (decoded.event.type === 'done') done = decoded.event.status;
    opts.onEvent(decoded.event);
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  try {
    for (;;) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      if (value) parser.push(decoder.decode(value, { stream: true }));
    }
    // Flush any bytes the decoder buffered at EOF (the server ends frames with
    // a blank line, so a trailing partial frame is discarded per SSE spec).
    parser.push(decoder.decode());
    parser.end();
  } catch (err) {
    if (isAbort(err) || opts.signal?.aborted) {
      return { done, aborted: true, malformedFrames };
    }
    // Mid-stream connection loss: report what we have — done stays null unless
    // the done frame already arrived.
    return { done, aborted: false, malformedFrames };
  }

  return { done, aborted: false, malformedFrames };
}
