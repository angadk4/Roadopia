/**
 * Structured logging config (M6-T01; Spec §66 "structured agent logs",
 * §43 service shell). Fastify's built-in pino does the work; this module
 * only pins the safety rails:
 *
 *  - REDACTION of anything that could carry a secret or a raw user
 *    coordinate (Hard rule H: never log secret values or raw user coords —
 *    request bodies are NOT logged at all, only method/path/status/timing).
 *  - trace IDs: every request gets a UUID (`genReqId` in server.ts); pino
 *    stamps it on each line as `reqId`, and the response carries it back as
 *    `x-trace-id` so a user report can be matched to the log line.
 */

import type { FastifyServerOptions } from 'fastify';

/** Header/field paths that must never reach a log line. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.apikey',
  'req.headers.cookie',
  'req.headers["x-supabase-auth"]',
];

/** The non-boolean logger-options branch of Fastify's union. */
type LoggerOpts = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

export function loggerOptions(stream?: NodeJS.WritableStream): LoggerOpts {
  return {
    level: process.env['LOG_LEVEL'] ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(stream ? { stream } : {}),
  } as LoggerOpts;
}
