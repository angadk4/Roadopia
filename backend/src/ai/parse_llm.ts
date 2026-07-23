/**
 * Production brief parser behind the parser interface (M5-T03; [GATE-A]/BD-28:
 * "the Haiku parser as PRIMARY with the rules parser as the deterministic
 * fallback" — the fallback also serves cost-kill-switch mode, FR-261).
 *
 * The LLM emits NO geography (Hard rule A): origins/destinations come back as
 * place-name STRINGS and the same deterministic gazetteer used by the rules
 * parser resolves them. Output is schema-forced (structured outputs), then
 * zod-validated against the REAL ParsedConstraintsSchema incl. the §3.5
 * cross-field rules; one retry with the validation error; then rules parser.
 * The brief itself is DATA to the model, never instructions (rule K).
 */

import type { ParsedConstraints } from '@shared/types';
import { validateParsedConstraints } from '@shared/types';

import { isKnownOutOfRegion, lookupInRegion } from '../planner/gazetteer';
import { parseRules } from '../planner/parse_rules';

import type { AiClient } from './client';
import { AiDisabledError } from './cost_guard';
import { PARSE_PROMPT } from './prompts/parse';

export type ParserKind = 'llm' | 'rules';

export interface ParseOutcome {
  constraints: ParsedConstraints;
  /** Which parser actually produced the result (honest provenance). */
  parser: ParserKind;
  /** LLM outputs that failed validation before fallback (0 on clean runs). */
  llmInvalidOutputs: number;
}

/** Deterministic post-step shared with the rules parser: resolve place names.
 *  Identical to the GATE-A eval flow — the LLM never returns coordinates. */
function resolveGeography(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  out['confidence'] = { overall: out['confidence_overall'], fields: {} };
  delete out['confidence_overall'];
  out['weights'] = null; // §3.4: weights come from UI sliders, never the brief
  for (const key of ['origin', 'destination'] as const) {
    const v = out[key];
    if (typeof v === 'string' && v !== 'current') {
      if (isKnownOutOfRegion(v)) {
        out['out_of_region_flag'] = true; // enforce even if the model missed it
      } else {
        const hit = lookupInRegion(v);
        if (hit) out[key] = { lat: hit.lat, lng: hit.lng };
        // unresolved names stay strings for the geocode step (M6)
      }
    }
  }
  return out;
}

/**
 * Parse a brief: LLM primary, rules fallback. `client === null` (AI wholly
 * unavailable) or `parser: 'rules'` (config flag — the M5-T03 rollback path)
 * short-circuits straight to the deterministic parser.
 */
export async function parseBrief(
  brief: string,
  opts: { client: AiClient | null; parser?: ParserKind },
): Promise<ParseOutcome> {
  // R24-U12: a buttons-only plan sends an empty brief — nothing to parse, so
  // never spend a model call on it (Hard rule F); the deterministic rules parser
  // returns the empty constraints and the structured inputs drive the route.
  if (brief.trim().length === 0) {
    return { constraints: parseRules(brief), parser: 'rules', llmInvalidOutputs: 0 };
  }
  const useLlm = (opts.parser ?? 'llm') === 'llm' && opts.client !== null;
  if (!useLlm) {
    return { constraints: parseRules(brief), parser: 'rules', llmInvalidOutputs: 0 };
  }

  let invalid = 0;
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user =
      attempt === 1
        ? `Brief: ${brief}`
        : `Brief: ${brief}\n\nYour previous output failed validation: ${lastError.slice(0, 400)}\nEmit a corrected JSON object.`;
    try {
      const res = await opts.client!.call(PARSE_PROMPT, user);
      const raw = JSON.parse(res.text) as Record<string, unknown>;
      const constraints = validateParsedConstraints(resolveGeography(raw));
      return { constraints, parser: 'llm', llmInvalidOutputs: invalid };
    } catch (err) {
      if (err instanceof AiDisabledError) break; // cap/kill — degrade now (FR-261)
      invalid++;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  // honest degradation: deterministic rules parser (BD-28 fallback role)
  return { constraints: parseRules(brief), parser: 'rules', llmInvalidOutputs: invalid };
}
