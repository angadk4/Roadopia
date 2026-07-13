import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { AppError } from './lib/errors';
import { buildServer } from './server';

/** M6-T01 AC: /health 200; errors return the consistent shape; logs carry trace IDs. */

describe('service skeleton (M6-T01)', () => {
  it('GET /health → 200 {status: ok} with an x-trace-id header', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['x-trace-id']).toBeTruthy();
  });

  it('404 uses the consistent error shape with the trace id', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string; trace_id: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.trace_id).toBe(res.headers['x-trace-id']);
  });

  it('AppError surfaces its code/status; unexpected errors leak NOTHING internal', async () => {
    const app = buildServer();
    app.get('/boom-known', () => {
      throw new AppError(422, 'unprocessable', 'brief too long');
    });
    app.get('/boom-unknown', () => {
      throw new Error('secret internal detail: db password xyz');
    });

    const known = await app.inject({ method: 'GET', url: '/boom-known' });
    expect(known.statusCode).toBe(422);
    expect(known.json()).toMatchObject({
      error: { code: 'unprocessable', message: 'brief too long' },
    });

    const unknown = await app.inject({ method: 'GET', url: '/boom-unknown' });
    expect(unknown.statusCode).toBe(500);
    const body = unknown.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal');
    expect(body.error.message).not.toContain('secret internal detail');
    expect(JSON.stringify(body)).not.toContain('at '); // no stack frames
  });

  it('schema validation failures come back 400 in the same shape', async () => {
    const app = buildServer();
    app.post(
      '/echo',
      {
        schema: {
          body: { type: 'object', required: ['x'], properties: { x: { type: 'number' } } },
        },
      },
      async (req) => req.body,
    );
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { y: 1 } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('structured logs carry the request trace id', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    stream.on('data', (chunk: Buffer) => lines.push(chunk.toString()));

    const app = buildServer({ logStream: stream });
    const res = await app.inject({ method: 'GET', url: '/health' });
    const traceId = res.headers['x-trace-id'] as string;

    const joined = lines.join('');
    expect(joined).toContain(traceId); // reqId stamped on the log lines
  });
});
