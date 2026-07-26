/**
 * POST /parse (R25-U16c) — the browse-class RULES parse. The quick-fill Plan
 * screen calls this while the user types so the chips light up from the SAME
 * deterministic parser the server falls back to — porting the 381-line
 * parse_rules into the app would guarantee drift, and shipping the LLM parse
 * here would put an unauthenticated uncapped text path on a browse endpoint.
 *
 * Deliberately structured like /discover: plain JSON, NO LLM, NO cost guard
 * (Hard rule F has nothing to guard — a bounded regex call), its own looser
 * rate limiter, registered only when deps are present (absent ⇒ 404, the
 * honest off state). The brief is validated to MAX_BRIEF_CHARS (Hard rule K).
 * The LLM parse stays where it was — on submit, inside /plan — and can only
 * ADD through the U16a disclosure path, never silently contradict what the
 * user watched light up.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { errorBody } from '../lib/errors';
import type { RateLimiter } from '../lib/rate_limit';
import { parseRules } from '../planner/parse_rules';

import { MAX_BRIEF_CHARS } from './plan';

export interface ParseEndpointDeps {
  rateLimiter?: RateLimiter;
  /** DI seam for tests. */
  parseFn?: typeof parseRules;
}

interface ParseBody {
  brief: string;
}

export function registerParseEndpoint(app: FastifyInstance, deps: ParseEndpointDeps): void {
  const parse = deps.parseFn ?? parseRules;

  app.post<{ Body: ParseBody }>(
    '/parse',
    {
      schema: {
        body: {
          type: 'object',
          required: ['brief'],
          additionalProperties: false,
          properties: {
            brief: { type: 'string', minLength: 0, maxLength: MAX_BRIEF_CHARS },
          },
        },
      },
    },
    (request: FastifyRequest<{ Body: ParseBody }>, reply: FastifyReply): void => {
      if (deps.rateLimiter) {
        const session = request.headers['x-session-id'];
        const decision = deps.rateLimiter.check(
          request.ip,
          typeof session === 'string' ? session : null,
        );
        if (!decision.allowed) {
          void reply
            .status(429)
            .header('retry-after', String(decision.retryAfterS))
            .send(
              errorBody(
                'rate_limited',
                `Too many requests at once — try again in ${decision.retryAfterS}s.`,
                request.id,
              ),
            );
          return;
        }
      }
      // deterministic, engine-free, LLM-free — parse failures are impossible
      // by construction (parse_rules always returns a ParsedConstraints)
      void reply.status(200).send({ constraints: parse(request.body.brief), parser: 'rules' });
    },
  );
}
