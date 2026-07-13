import { describe, expect, it } from 'vitest';

import { AiClient, type Transport } from './client';
import { CostGuard } from './cost_guard';
import { MemoryLedger } from './ledger';
import { parseBrief } from './parse_llm';

/** M5-T03 — parser interface: LLM primary (mocked), rules fallback, no coords from the model. */

function clientWith(transport: Transport): AiClient {
  return new AiClient({
    guard: new CostGuard({
      ledger: new MemoryLedger(),
      now: () => new Date('2026-07-13T12:00:00Z'),
    }),
    transport,
  });
}

/** A minimal VALID §3.4 object as the model would emit it (strings, no coords). */
const GOOD = {
  origin: 'Guelph',
  destination: null,
  shape: 'loop',
  duration_target_s: 5400,
  distance_target_m: null,
  stops: [],
  avoid: { highways: false, tolls: false, ferries: false, unpaved: false },
  surface_pref: 'any',
  character: ['twisty'],
  scenic_pref: null,
  twistiness_pref: 0.7,
  intensity: null,
  preset: null,
  location_constraints: [],
  ambiguous_terms: [],
  missing: [],
  contradictions: [],
  confidence_overall: 0.9,
  clarification: { needed: false, question: null },
  unsafe_flag: false,
  out_of_region_flag: false,
  prompt_injection_flag: false,
};

describe('parseBrief (M5-T03, mocked)', () => {
  it('LLM path: place-name string resolves to gazetteer coords; parser=llm', async () => {
    const client = clientWith(async () => ({
      text: JSON.stringify(GOOD),
      inputTokens: 500,
      outputTokens: 150,
      cacheReadTokens: 0,
    }));
    const out = await parseBrief('90 minute twisty loop from Guelph', { client });
    expect(out.parser).toBe('llm');
    expect(out.constraints.origin).toEqual({ lat: 43.5448, lng: -80.2482 });
    expect(out.constraints.twistiness_pref).toBe(0.7);
    expect(out.llmInvalidOutputs).toBe(0);
  });

  it('invalid LLM output twice → rules fallback, honestly labelled', async () => {
    const client = clientWith(async () => ({
      text: '{"garbage": true}',
      inputTokens: 500,
      outputTokens: 20,
      cacheReadTokens: 0,
    }));
    const out = await parseBrief('1 hour loop from Hamilton', { client });
    expect(out.parser).toBe('rules');
    expect(out.llmInvalidOutputs).toBe(2);
    expect(out.constraints.origin).toEqual({ lat: 43.2557, lng: -79.8711 }); // rules parser resolved
  });

  it('kill switch → immediate rules fallback with zero transport calls (FR-261)', async () => {
    let calls = 0;
    const client = new AiClient({
      guard: new CostGuard({
        ledger: new MemoryLedger(),
        killSwitch: () => true,
        now: () => new Date('2026-07-13T12:00:00Z'),
      }),
      transport: async () => {
        calls++;
        return { text: '', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
      },
    });
    const out = await parseBrief('1 hour loop from Hamilton', { client });
    expect(out.parser).toBe('rules');
    expect(calls).toBe(0);
  });

  it("config flag parser:'rules' short-circuits (the T03 rollback path)", async () => {
    const out = await parseBrief('1 hour loop from Hamilton', { client: null, parser: 'rules' });
    expect(out.parser).toBe('rules');
  });

  it('out-of-region strings force the redirect flag even if the model missed it', async () => {
    const client = clientWith(async () => ({
      text: JSON.stringify({ ...GOOD, origin: 'Sarnia', out_of_region_flag: false }),
      inputTokens: 500,
      outputTokens: 150,
      cacheReadTokens: 0,
    }));
    const out = await parseBrief('loop from Sarnia', { client });
    expect(out.parser).toBe('llm');
    expect(out.constraints.out_of_region_flag).toBe(true);
  });
});
