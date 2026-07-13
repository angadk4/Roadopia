/**
 * Production Anthropic client (M5-T01; Spec §25/§38; Hard rules F, H, I).
 *
 * The ONE path for every runtime LLM call:
 *   CostGuard (kill switch → hard-cap projection) → transport → schema text
 *   back → ledger entry (model + prompt id/version + REAL usage + cost).
 *
 * - Transport is injectable: tests run fully mocked (no network, no key);
 *   the default transport is the official SDK with temperature 0, prompt
 *   caching on the stable system prefix, structured outputs via
 *   output_config, and NO extended thinking — no chain-of-thought exists
 *   anywhere in this pipeline (Hard rule I).
 * - The API key is read from the environment only when the default transport
 *   is actually constructed, and is never logged (Hard rule H).
 * - An AiDisabledError from the guard means: degrade to the deterministic
 *   fallback (FR-261) — callers own that switch.
 */

import Anthropic from '@anthropic-ai/sdk';

import { CostGuard } from './cost_guard';
import type { PromptTemplate } from './prompts/parse';

export interface TransportRequest {
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  schema?: Record<string, unknown>;
}

export interface TransportResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export type Transport = (req: TransportRequest) => Promise<TransportResult>;

export interface AiCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
  costUsd: number;
  promptId: string;
  promptVersion: number;
  model: string;
}

/** Default transport — the real SDK. Constructed lazily so tests never need a key. */
export function anthropicTransport(apiKey?: string): Transport {
  const key = apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set (backend env)');
  const anthropic = new Anthropic({ apiKey: key });
  return async (req) => {
    const response = await anthropic.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: 0,
      system: [
        {
          type: 'text',
          text: req.system,
          // stable prefix — engages prompt caching when over the model's
          // cacheable minimum; harmless below it (Spec §38.1)
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: req.user }],
      ...(req.schema
        ? { output_config: { format: { type: 'json_schema' as const, schema: req.schema } } }
        : {}),
    });
    return {
      text: response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(''),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    };
  };
}

export class AiClient {
  private readonly guard: CostGuard;
  private readonly transport: Transport;

  constructor(opts: { guard: CostGuard; transport?: Transport }) {
    this.guard = opts.guard;
    this.transport = opts.transport ?? anthropicTransport();
  }

  get costGuard(): CostGuard {
    return this.guard;
  }

  /** One guarded call for a REGISTERED prompt; `user` is the variable suffix. */
  async call(prompt: PromptTemplate, user: string): Promise<AiCallResult> {
    this.guard.assertCallAllowed(prompt.model, prompt.maxTokens);
    const t0 = performance.now();
    let result: TransportResult;
    try {
      result = await this.transport({
        model: prompt.model,
        maxTokens: prompt.maxTokens,
        system: prompt.system,
        user,
        ...(prompt.schema ? { schema: prompt.schema } : {}),
      });
    } catch (err) {
      // transport failures still cost nothing recordable (no usage returned) —
      // surface to the caller's fallback path
      throw err instanceof Error ? err : new Error(String(err));
    }
    const latencyMs = performance.now() - t0;
    const costUsd = this.guard.record({
      model: prompt.model,
      promptId: prompt.id,
      promptVersion: prompt.version,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      latencyMs,
      ok: true,
    });
    return {
      text: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      latencyMs,
      costUsd,
      promptId: prompt.id,
      promptVersion: prompt.version,
      model: prompt.model,
    };
  }
}
