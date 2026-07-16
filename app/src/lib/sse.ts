/**
 * Incremental SSE parsing + GenerationEvent decoding (M7-T01; SPK-03 code half).
 *
 * PURE module — no network, no Expo imports — so the exact byte-boundary
 * behaviour is unit-tested in node (chunks split mid-line, CRLF, multi-`data:`
 * frames, `: ping` heartbeats). The transport that feeds it lives in
 * plan_stream.ts.
 *
 * Wire contract (backend/src/routes/plan.ts):
 *   frame = `event: <type>\ndata: <json>\n\n`, heartbeat = `: ping\n\n` every
 *   15 s. Every `data` payload is a GenerationEvent (schema-validated server
 *   side in CI); the client re-validates with the SAME shared zod schema —
 *   anything off-schema is counted, never rendered (Hard rules I/K: tool/LLM
 *   content is data, and only validated shapes reach the UI).
 */

import { GenerationEventSchema, type GenerationEvent } from '@shared/types';

/** One parsed SSE frame (comments already filtered out). */
export interface SseFrame {
  /** The `event:` field, or null when the frame had none. */
  event: string | null;
  /** All `data:` lines joined with '\n' (WHATWG EventSource semantics). */
  data: string;
}

export interface SseParser {
  /** Feed a decoded text chunk (any split — even mid-character lines are fine). */
  push(chunk: string): void;
  /**
   * Signal end-of-stream. Per the SSE spec an unterminated trailing frame is
   * DISCARDED (the server always closes frames with a blank line).
   */
  end(): void;
}

/**
 * Create an incremental parser over the SSE subset the backend emits.
 * `onFrame` fires once per complete frame that contained at least one `data:`.
 */
export function createSseParser(onFrame: (frame: SseFrame) => void): SseParser {
  let buffer = '';
  let eventName: string | null = null;
  let dataLines: string[] = [];

  function dispatch(): void {
    if (dataLines.length > 0) {
      onFrame({ event: eventName, data: dataLines.join('\n') });
    }
    eventName = null;
    dataLines = [];
  }

  function handleLine(rawLine: string): void {
    // Strip a trailing \r so \r\n line endings behave identically to \n.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comment (heartbeat `: ping`)

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // Per spec: a single leading space after the colon is not part of the value.
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
    // 'id' / 'retry' / unknown fields: ignored (not used by this stream).
  }

  return {
    push(chunk: string): void {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    },
    end(): void {
      buffer = '';
      eventName = null;
      dataLines = [];
    },
  };
}

/** The result of decoding one frame's data payload. */
export type DecodedFrame =
  | { ok: true; event: GenerationEvent }
  | { ok: false; reason: 'bad_json' | 'off_schema' };

/**
 * Decode + validate a frame payload into a GenerationEvent. Off-schema frames
 * are rejected (never rendered) — the caller counts them and carries on; the
 * stream's `done`/`error` events remain the only honest terminal states.
 */
export function decodeGenerationEvent(frame: SseFrame): DecodedFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  const result = GenerationEventSchema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: 'off_schema' };
  return { ok: true, event: result.data };
}
