/**
 * LLM brief parser — the [GATE-A] variant (Protocol §18-A: "Haiku
 * structured-output parse into the §3.4 schema").
 *
 * SINGLE SOURCE (M5-T09): the prompt, schema and model pin now COME FROM the
 * production registry `backend/src/ai/prompts/parse.ts` (where the [GATE-A]
 * winner was canonicalized as parse v1) and are re-exported here under the
 * original eval names. Eval therefore regression-tests the EXACT prompt that
 * ships; a bad edit to the production prompt turns the eval smoke red.
 *
 * Same contract as the rules parser: brief text → ParsedConstraints. The LLM
 * EMITS NO GEOGRAPHY (Hard rule A): origins/destinations come back as place-
 * name STRINGS ('current'/null allowed) and the same deterministic gazetteer
 * the rules parser uses resolves them afterwards. Output is schema-forced
 * (structured outputs) and then zod-validated against the REAL
 * ParsedConstraintsSchema incl. the §3.5 cross-field rules; a failure gets
 * ONE retry with the validation error, then counts as an invalid output
 * (parsed = null → scores 0 on its gold fields, per §19).
 */

import { validateParsedConstraints, type ParsedConstraints } from '@shared/types';

import { PARSE_PROMPT } from '../../../backend/src/ai/prompts/parse';
import { isKnownOutOfRegion, lookupInRegion } from '../../../backend/src/planner/gazetteer';

import type { GuardedLlmClient } from './client';

/** Production pin (dated Haiku snapshot) — was the alias before single-sourcing. */
export const PARSE_MODEL = PARSE_PROMPT.model;
export const PARSE_SYSTEM_PROMPT = PARSE_PROMPT.system;
export const PARSE_JSON_SCHEMA = PARSE_PROMPT.schema as Record<string, unknown>;

export interface LlmParseResult {
  parsed: ParsedConstraints | null;
  invalidOutputs: number;
  llmCalls: number;
  latencyMs: number;
}

/** Deterministic post-step shared with the rules parser: resolve place names. */
function resolveGeography(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  // confidence: LLM emits a single overall number; expand to the schema shape
  out['confidence'] = { overall: out['confidence_overall'], fields: {} };
  delete out['confidence_overall'];
  out['weights'] = null; // §3.4 weights come from UI sliders, never the brief
  for (const key of ['origin', 'destination'] as const) {
    const v = out[key];
    if (typeof v === 'string' && v !== 'current') {
      if (isKnownOutOfRegion(v)) {
        out['out_of_region_flag'] = true; // enforce even if the model missed it
      } else {
        const hit = lookupInRegion(v);
        if (hit) out[key] = { lat: hit.lat, lng: hit.lng };
        // unresolved names stay strings for the geocode step (M6) — same as rules
      }
    }
  }
  return out;
}

export async function llmParse(client: GuardedLlmClient, brief: string): Promise<LlmParseResult> {
  let invalidOutputs = 0;
  let llmCalls = 0;
  let latencyMs = 0;
  let lastError = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const user =
      attempt === 1
        ? `Brief: ${brief}`
        : `Brief: ${brief}\n\nYour previous output failed validation: ${lastError.slice(0, 400)}\nEmit a corrected JSON object.`;
    const result = await client.complete({
      model: PARSE_MODEL,
      system: PARSE_SYSTEM_PROMPT,
      user,
      jsonSchema: PARSE_JSON_SCHEMA,
    });
    llmCalls++;
    latencyMs += result.latencyMs;
    try {
      const raw = JSON.parse(result.text) as Record<string, unknown>;
      const parsed = validateParsedConstraints(resolveGeography(raw));
      return { parsed, invalidOutputs, llmCalls, latencyMs };
    } catch (err) {
      invalidOutputs++;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { parsed: null, invalidOutputs, llmCalls, latencyMs };
}
