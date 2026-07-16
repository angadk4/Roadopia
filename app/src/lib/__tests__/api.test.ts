import { describe, expect, it } from 'vitest';

import {
  ApiError,
  getHealth,
  NetworkError,
  postRouteThrough,
  resolveApiBaseUrl,
  toApiError,
  type FetchLike,
  type FetchResponseLike,
} from '../api';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => lower[n.toLowerCase()] ?? null },
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('resolveApiBaseUrl', () => {
  it('prefers the explicit URL and strips trailing slashes', () => {
    expect(
      resolveApiBaseUrl({ explicit: 'https://api.example.com/', hostUri: '10.0.0.5:8081' }),
    ).toBe('https://api.example.com');
  });

  it('derives host from the Metro hostUri with the backend port', () => {
    expect(resolveApiBaseUrl({ hostUri: '192.168.2.34:8081' })).toBe('http://192.168.2.34:8080');
    expect(resolveApiBaseUrl({ hostUri: 'localhost:8081/path?query' })).toBe(
      'http://localhost:8080',
    );
    expect(resolveApiBaseUrl({ hostUri: 'exp://192.168.2.34:8081' })).toBe(
      'http://192.168.2.34:8080',
    );
  });

  it('falls back to localhost when nothing is known', () => {
    expect(resolveApiBaseUrl({})).toBe('http://localhost:8080');
    expect(resolveApiBaseUrl({ explicit: '  ', hostUri: '' })).toBe('http://localhost:8080');
  });
});

describe('toApiError', () => {
  it('parses the backend error shape incl. trace id and retry-after', () => {
    const err = toApiError(
      429,
      JSON.stringify({
        error: {
          code: 'rate_limited',
          message: 'Too many plans at once — try again in 12s.',
          trace_id: 'abc',
        },
      }),
      { get: (n) => (n === 'retry-after' ? '12' : null) },
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.traceId).toBe('abc');
    expect(err.retryAfterS).toBe(12);
    expect(err.message).toContain('Too many plans');
  });

  it('keeps a friendly generic message for non-JSON bodies', () => {
    const err = toApiError(502, '<html>bad gateway</html>', { get: () => null });
    expect(err.code).toBe('unknown');
    expect(err.message).not.toContain('<html>');
  });
});

describe('request path', () => {
  it('getHealth returns the parsed body and sends x-session-id', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const fetchImpl: FetchLike = (url, init) => {
      seenUrl = url;
      seenHeaders = init?.headers ?? {};
      return Promise.resolve(jsonResponse(200, { status: 'ok' }));
    };
    const out = await getHealth({ baseUrl: 'http://x:8080', sessionId: 'sess-1', fetchImpl });
    expect(out).toEqual({ status: 'ok' });
    expect(seenUrl).toBe('http://x:8080/health');
    expect(seenHeaders['x-session-id']).toBe('sess-1');
  });

  it('non-2xx responses throw a typed ApiError (out_of_region)', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        jsonResponse(400, {
          error: {
            code: 'out_of_region',
            message: 'Roadopia currently covers south-central Ontario.',
            trace_id: 't1',
          },
        }),
      );
    await expect(
      postRouteThrough(
        { baseUrl: 'http://x', fetchImpl },
        {
          waypoints: [
            { lat: 0, lng: 0 },
            { lat: 1, lng: 1 },
          ],
        },
      ),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'out_of_region', status: 400 });
  });

  it('transport failures throw NetworkError (offline / refused)', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new TypeError('Network request failed'));
    await expect(getHealth({ baseUrl: 'http://down:1', fetchImpl })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
