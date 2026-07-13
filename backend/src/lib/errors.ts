/**
 * Consistent error model (M6-T01; Spec §49.3 "consistent error shapes;
 * `/plan` failures route into the graceful fallback (§40), never a raw
 * error"; §18 "never a raw error").
 *
 * Every non-2xx response body is exactly:
 *   { error: { code, message, trace_id } }
 * `message` is always safe for the client — for unexpected (non-AppError)
 * failures the client gets a generic line and the real error goes to the
 * structured log only (never a stack, never internals, never secrets —
 * Hard rule H).
 */

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    trace_id: string;
  };
}

/** An intentional, client-safe error thrown by route handlers. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorBody(code: string, message: string, traceId: string): ErrorBody {
  return { error: { code, message, trace_id: traceId } };
}

/** The client-facing line for unexpected failures — deliberately generic. */
export const INTERNAL_ERROR_MESSAGE = 'Something went wrong on our side. Please try again.';
