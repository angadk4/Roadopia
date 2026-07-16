import { describe, expect, it } from 'vitest';

import { createSseParser, decodeGenerationEvent, type SseFrame } from '../sse';

function collect(): { frames: SseFrame[]; onFrame: (f: SseFrame) => void } {
  const frames: SseFrame[] = [];
  return { frames, onFrame: (f) => frames.push(f) };
}

describe('createSseParser', () => {
  it('parses a single complete frame (event + data)', () => {
    const { frames, onFrame } = collect();
    const p = createSseParser(onFrame);
    p.push('event: step\ndata: {"a":1}\n\n');
    expect(frames).toEqual([{ event: 'step', data: '{"a":1}' }]);
  });

  it('handles frames split across arbitrary chunk boundaries', () => {
    const { frames, onFrame } = collect();
    const p = createSseParser(onFrame);
    const wire = 'event: step\ndata: {"a":1}\n\nevent: done\ndata: {"b":2}\n\n';
    // Feed one character at a time — worst-case fragmentation.
    for (const ch of wire) p.push(ch);
    expect(frames).toEqual([
      { event: 'step', data: '{"a":1}' },
      { event: 'done', data: '{"b":2}' },
    ]);
  });

  it('accepts CRLF line endings', () => {
    const { frames, onFrame } = collect();
    const p = createSseParser(onFrame);
    p.push('event: step\r\ndata: {"a":1}\r\n\r\n');
    expect(frames).toEqual([{ event: 'step', data: '{"a":1}' }]);
  });

  it('ignores heartbeat comment frames (`: ping`)', () => {
    const { frames, onFrame } = collect();
    const p = createSseParser(onFrame);
    p.push(': ping\n\nevent: step\ndata: {}\n\n: ping\n\n');
    expect(frames).toEqual([{ event: 'step', data: '{}' }]);
  });

  it('joins multiple data: lines with newlines (WHATWG semantics)', () => {
    const { frames, onFrame } = collect();
    const p = createSseParser(onFrame);
    p.push('data: line1\ndata: line2\n\n');
    expect(frames).toEqual([{ event: null, data: 'line1\nline2' }]);
  });

  it('strips only a single leading space after the colon', () => {
    const { frames, onFrame } = collect();
    const p = createSseParser(onFrame);
    p.push('data:  two-spaces\n\ndata:none\n\n');
    expect(frames).toEqual([
      { event: null, data: ' two-spaces' },
      { event: null, data: 'none' },
    ]);
  });

  it('discards an unterminated trailing frame at end()', () => {
    const { frames, onFrame } = collect();
    const p = createSseParser(onFrame);
    p.push('event: step\ndata: {"a":1}\n\nevent: done\ndata: {"b":');
    p.end();
    expect(frames).toEqual([{ event: 'step', data: '{"a":1}' }]);
  });

  it('ignores unknown fields (id, retry) without breaking the frame', () => {
    const { frames, onFrame } = collect();
    const p = createSseParser(onFrame);
    p.push('id: 7\nretry: 1000\nevent: step\ndata: {}\n\n');
    expect(frames).toEqual([{ event: 'step', data: '{}' }]);
  });

  it('emits nothing for a frame with event but no data', () => {
    const { frames, onFrame } = collect();
    const p = createSseParser(onFrame);
    p.push('event: lonely\n\n');
    expect(frames).toEqual([]);
  });
});

describe('decodeGenerationEvent', () => {
  it('decodes a valid step event through the shared schema', () => {
    const decoded = decodeGenerationEvent({
      event: 'step',
      data: JSON.stringify({ type: 'step', step: 'parse', status: 'started' }),
    });
    expect(decoded).toEqual({
      ok: true,
      event: { type: 'step', step: 'parse', status: 'started' },
    });
  });

  it('decodes done + error + tool events', () => {
    for (const payload of [
      { type: 'done', status: 'best_so_far' },
      { type: 'error', message: 'friendly note' },
      { type: 'tool_call', tool: 'find_curvy_roads' },
      { type: 'tool_result', tool: 'find_curvy_roads', ok: true, count: 42 },
    ]) {
      const decoded = decodeGenerationEvent({ event: payload.type, data: JSON.stringify(payload) });
      expect(decoded.ok).toBe(true);
    }
  });

  it('rejects invalid JSON as bad_json', () => {
    expect(decodeGenerationEvent({ event: 'step', data: '{nope' })).toEqual({
      ok: false,
      reason: 'bad_json',
    });
  });

  it('rejects off-schema payloads (never rendered — Hard rule I/K)', () => {
    expect(
      decodeGenerationEvent({
        event: 'step',
        data: JSON.stringify({ type: 'step', step: 'NOT_A_STEP', status: 'started' }),
      }),
    ).toEqual({ ok: false, reason: 'off_schema' });
    // A hypothetical raw-reasoning frame is off-schema by construction.
    expect(
      decodeGenerationEvent({
        event: 'thinking',
        data: JSON.stringify({ type: 'thinking', text: 'chain of thought' }),
      }),
    ).toEqual({ ok: false, reason: 'off_schema' });
  });
});
