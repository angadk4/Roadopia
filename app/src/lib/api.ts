/**
 * Typed API client for the agent backend (M7-T01).
 *
 * The backend exposes exactly three client-facing custom endpoints (Spec §49.2):
 * `/plan` (SSE — see plan_stream.ts), `/route`, `/match`, plus `/health`. All
 * other data access is direct Supabase (RLS) — NOT this file.
 *
 * This module is PURE (no Expo/React Native imports) so the whole request/error
 * path is unit-testable in node. The Expo-side base-URL wiring lives in
 * runtime.ts. Every non-2xx response carries the backend's consistent error
 * shape `{error: {code, message, trace_id}}` (backend/src/lib/errors.ts) — it is
 * parsed here into ApiError so screens can render friendly, honest states (§18)
 * without ever touching a raw error.
 */

import type {
  CharacterTag,
  DiscoverRequest,
  LatLng,
  Preset,
  RouteThroughOutput,
  StopRequest,
} from '@shared/types';

/** Backend dev port (backend/src/start.ts default). */
export const BACKEND_PORT = 8080;

/**
 * Client-side mirror of the brief cap (Hard rule K). The wire authority is
 * backend/src/routes/plan.ts MAX_BRIEF_CHARS = 500; keep in sync.
 */
export const MAX_BRIEF_CHARS = 500;

/** POST /plan request body (backend/src/routes/plan.ts PlanBody). */
export interface PlanRequest {
  brief: string;
  /** Device-resolved coordinates. ALWAYS send when known — the planner cannot
   *  resolve "current location" or bare place-names to coordinates itself. */
  origin?: LatLng;
  destination?: LatLng;
  shape?: 'loop' | 'a_to_b';
  /** Preset chip — resolved to the frozen weight vectors server-side (BD-30). */
  preset?: Preset;
  weights?: Record<string, number>;
  /** Refinement round-trip (M7-T07): the running ParsedConstraints from the
   *  previous run (server re-validates) + the follow-up to merge. Both or
   *  neither. */
  constraints?: unknown;
  followUp?: string;
  /** R16-5 structured overrides (the Plan screen's sections; the server
   *  re-validates and merges: stops per-TYPE replace, avoid per-key only for
   *  the keys sent, character unioned). */
  stops?: StopRequest[];
  avoid?: { highways?: boolean; tolls?: boolean; ferries?: boolean; unpaved?: boolean };
  character?: CharacterTag[];
  twistiness_pref?: number;
  /** R23 discovery tap (near drive): a 'through <road>' pin (with a near_point
   *  disambiguation hint) + the computed loop budget. */
  location_constraints?: Array<{ kind: 'through'; text: string; near_point?: LatLng }>;
  duration_target_s?: number;
  /** R23 discovery tap (far drive): build a direct out-and-back to the road. */
  out_and_back?: { entry: LatLng; exit: LatLng; name: string };
}

/** POST /route request body (manual building — backend/src/routes/route.ts). */
export interface RouteThroughRequest {
  waypoints: LatLng[];
  avoid?: { highways?: boolean; tolls?: boolean; ferries?: boolean };
}

/** POST /match request body (recorded-trace snap — backend/src/routes/match.ts). */
export interface MatchRequest {
  trace: LatLng[];
  shape_match?: 'map_snap' | 'edge_walk' | 'walk_or_snap';
}

/** A backend-reported failure, carrying the consistent error shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string | null;
  /** Seconds until retry (from the 429 `retry-after` header), when present. */
  readonly retryAfterS: number | null;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    traceId?: string | null;
    retryAfterS?: number | null;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.traceId = opts.traceId ?? null;
    this.retryAfterS = opts.retryAfterS ?? null;
  }
}

/** Network-level failure (no HTTP response at all — offline, DNS, refused). */
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

/** The minimal structural Response we rely on (fits RN, expo/fetch and node). */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/**
 * Resolve the backend base URL, in priority order:
 *  1. an explicit URL (EXPO_PUBLIC_API_URL → app.config `extra.apiUrl`) — used
 *     by EAS preview/production builds pointed at a deployed backend;
 *  2. the Metro dev-server host (`Constants.expoConfig.hostUri`, e.g.
 *     "192.168.2.34:8081") with the backend port swapped in — so a phone on the
 *     same LAN reaches `pnpm -C backend dev` (which binds 0.0.0.0) with ZERO
 *     configuration during development;
 *  3. localhost (simulators / tests).
 */
export function resolveApiBaseUrl(opts: {
  explicit?: string | null;
  hostUri?: string | null;
}): string {
  const explicit = opts.explicit?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const hostUri = opts.hostUri?.trim();
  if (hostUri) {
    // hostUri looks like "192.168.2.34:8081" or "localhost:8081/extra?query".
    const host = hostUri.replace(/^[a-z]+:\/\//i, '').split(/[:/?#]/)[0];
    if (host) return `http://${host}:${BACKEND_PORT}`;
  }

  return `http://localhost:${BACKEND_PORT}`;
}

/** Parse a non-2xx body into ApiError; tolerate non-JSON bodies defensively. */
export function toApiError(
  status: number,
  bodyText: string,
  headers: { get(name: string): string | null },
): ApiError {
  let code = 'unknown';
  let message = 'Something went wrong talking to the server.';
  let traceId: string | null = null;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const e = (parsed as { error: Record<string, unknown> }).error;
      if (typeof e['code'] === 'string') code = e['code'];
      if (typeof e['message'] === 'string') message = e['message'];
      if (typeof e['trace_id'] === 'string') traceId = e['trace_id'];
    }
  } catch {
    // Non-JSON error body (proxy, crash) — keep the generic friendly message.
  }
  const retryHeader = headers.get('retry-after');
  const retryAfterS = retryHeader ? Number.parseInt(retryHeader, 10) : Number.NaN;
  return new ApiError({
    status,
    code,
    message,
    traceId,
    retryAfterS: Number.isFinite(retryAfterS) ? retryAfterS : null,
  });
}

export interface ApiClientOptions {
  baseUrl: string;
  sessionId?: string;
  /** M8-T01: attached as `Authorization: Bearer …` when present. The backend
   *  verifies any presented token (bad ≠ anonymous — jwt.ts registerAuth), so
   *  callers pass a FRESH token from useAuth().freshAccessToken() or nothing. */
  accessToken?: string;
  fetchImpl?: FetchLike;
}

/** Every request gives up after this unless the caller says otherwise. Before
 *  the device pass (2026-09-04) there was NO ceiling: "Snapping to roads…" and
 *  "Routing…" could sit forever with their only buttons disabled. */
export const DEFAULT_TIMEOUT_MS = 20_000;
/** Map-matching a long trace / routing 25 waypoints legitimately takes longer. */
export const LONG_TIMEOUT_MS = 45_000;
export const TIMEOUT_MESSAGE = 'That took too long — check your connection and try again.';

/**
 * An AbortSignal that fires after `ms` OR when `outer` aborts. Built on
 * AbortController + setTimeout rather than AbortSignal.timeout(), which the
 * app's Hermes runtime does not guarantee. Call `clear()` when the request
 * settles so the timer never outlives it.
 */
export function withTimeout(
  ms: number,
  outer?: AbortSignal,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onOuter = (): void => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuter);
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    },
  };
}

/**
 * The global fetch with a ceiling on reaching the server (headers in). Every
 * direct Supabase/data call (library, saves, profile, spots, reports, auth)
 * uses this as its default, so a stalled socket becomes an error a screen
 * can act on — the same rule request() applies to the backend. Our timeout
 * surfaces as NetworkError(TIMEOUT_MESSAGE); a caller's own abort is rethrown.
 */
export function boundedFetch(timeoutMs: number = DEFAULT_TIMEOUT_MS): FetchLike {
  return async (url, init) => {
    const raw = globalThis.fetch as unknown as FetchLike;
    const guard = withTimeout(timeoutMs, init?.signal);
    try {
      return await raw(url, { ...init, signal: guard.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError' && !init?.signal?.aborted) {
        throw new NetworkError(TIMEOUT_MESSAGE, { cause: err });
      }
      throw err;
    } finally {
      guard.clear();
    }
  };
}

/** The friendly line for a transport failure: our timeout's own words when
 *  that is what happened, else the caller's generic "could not reach". */
export function transportMessage(err: unknown, fallback: string): string {
  return err instanceof NetworkError ? err.message : fallback;
}

async function request<T>(
  opts: ApiClientOptions,
  path: string,
  init: { method: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number },
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.sessionId) headers['x-session-id'] = opts.sessionId;
  if (opts.accessToken) headers['authorization'] = `Bearer ${opts.accessToken}`;
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  const guard = withTimeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS, init.signal);
  let res: FetchResponseLike;
  let text: string;
  try {
    res = await fetchImpl(`${opts.baseUrl}${path}`, {
      method: init.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: guard.signal,
    });
    text = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // The CALLER walked away (screen left, request superseded): rethrow so
      // ProgressScreen-style code can ignore it. OUR timeout is a network
      // problem the user must hear about, in words they can act on.
      if (init.signal?.aborted) throw err;
      throw new NetworkError(TIMEOUT_MESSAGE, { cause: err });
    }
    // Plain words, no host: the base URL used to be baked into this line and
    // showed up on the Builder panel and the Record HUD (review finding). It
    // stays on `cause` for logs.
    throw new NetworkError('Could not reach the server — check your connection.', {
      cause: err,
    });
  } finally {
    guard.clear();
  }

  if (!res.ok) throw toApiError(res.status, text, res.headers);
  return JSON.parse(text) as T;
}

/** GET /health → {status:'ok'} (M7-T01 AC: the API client reaches /health). */
export async function getHealth(opts: ApiClientOptions): Promise<{ status: string }> {
  return request<{ status: string }>(opts, '/health', { method: 'GET' });
}

/** POST /discover — origin → the ranked menu (R23). Returns the RAW body; the
 *  caller (lib/discover.ts) zod-validates it (Hard rule K). Throws ApiError
 *  (incl. 404 when the endpoint is not registered) / NetworkError. */
export async function postDiscover(
  opts: ApiClientOptions,
  body: DiscoverRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  return request<unknown>(opts, '/discover', {
    method: 'POST',
    body,
    ...(signal ? { signal } : {}),
  });
}

/** POST /parse — the browse-class RULES parse (R25-U16c): the quick-fill Plan
 *  screen calls this while the user types so the chips light up from the SAME
 *  deterministic parser the server falls back to. No LLM, no cost. Returns the
 *  RAW body; the caller zod-validates the constraints (Hard rule K). */
export async function postParse(
  opts: ApiClientOptions,
  body: { brief: string },
  signal?: AbortSignal,
): Promise<unknown> {
  return request<unknown>(opts, '/parse', {
    method: 'POST',
    body,
    ...(signal ? { signal } : {}),
  });
}

/** POST /route — waypoints → drivable geometry (M9 manual building; typed now). */
export async function postRouteThrough(
  opts: ApiClientOptions,
  body: RouteThroughRequest,
  signal?: AbortSignal,
): Promise<RouteThroughOutput> {
  return request<RouteThroughOutput>(opts, '/route', {
    method: 'POST',
    body,
    timeoutMs: LONG_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
  });
}

/** POST /match — recorded trace → snapped geometry (M9 recording; typed now). */
export async function postMatch(
  opts: ApiClientOptions,
  body: MatchRequest,
  signal?: AbortSignal,
): Promise<RouteThroughOutput> {
  return request<RouteThroughOutput>(opts, '/match', {
    method: 'POST',
    body,
    timeoutMs: LONG_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
  });
}
