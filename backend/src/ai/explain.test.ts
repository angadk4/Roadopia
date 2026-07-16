import { describe, expect, it } from 'vitest';

import { AiClient, type Transport } from './client';
import { CostGuard } from './cost_guard';
import { explainRoute, titleSummaryTags, type RouteFacts } from './explain';
import { MemoryLedger } from './ledger';

/** M5-T04 + M5-T05 — factuality: 0 invented places on the fixture (AC verbatim). */

const FACTS: RouteFacts = {
  originName: 'Belfountain',
  durationMin: 87,
  distanceKm: 94,
  targetMin: 90,
  curviness: 2.1,
  roadNames: ['Forks of the Credit Road', 'Mississauga Road'],
  stops: [{ name: 'Higher Ground Café', type: 'coffee', arrival_min: 40 }],
  satisfied: ['duration', 'coffee stop'],
  relaxed: [],
  viewpointCount: 2,
};

function clientOf(responses: string[]): { client: AiClient; calls: () => number } {
  let i = 0;
  const transport: Transport = async () => ({
    text: responses[Math.min(i++, responses.length - 1)]!,
    inputTokens: 400,
    outputTokens: 120,
    cacheReadTokens: 0,
  });
  return {
    client: new AiClient({
      guard: new CostGuard({
        ledger: new MemoryLedger(),
        now: () => new Date('2026-07-13T12:00:00Z'),
      }),
      transport,
    }),
    calls: () => i,
  };
}

describe('explainRoute (M5-T04)', () => {
  it('grounded LLM explanation passes through with satisfied/relaxed', async () => {
    const { client } = clientOf([
      JSON.stringify({
        text: 'An 87 minute, 94 km loop from Belfountain running the length of Forks of the Credit Road, with a stop at Higher Ground Café. Passes 2 viewpoints.',
        satisfied: ['duration', 'coffee stop'],
        relaxed: [],
      }),
    ]);
    const e = await explainRoute(FACTS, { client });
    expect(e.source).toBe('llm');
    expect(e.satisfied).toContain('duration');
  });

  it('an explanation inventing a place is rejected → retried → template fallback', async () => {
    const invented = JSON.stringify({
      text: 'A gorgeous run down Thunderhawk Pass with a stop at Higher Ground Café.',
      satisfied: [],
      relaxed: [],
    });
    const { client, calls } = clientOf([invented, invented]);
    const e = await explainRoute(FACTS, { client });
    expect(e.source).toBe('template');
    expect(calls()).toBe(2); // one retry, then deterministic
    expect(e.text).toContain('Belfountain'); // template still cites real facts
  });

  it('client null (AI off) → template immediately, relaxations disclosed', async () => {
    const e = await explainRoute({ ...FACTS, relaxed: ['duration +15%'] }, { client: null });
    expect(e.source).toBe('template');
    expect(e.text).toContain('Relaxed');
  });
});

describe('titleSummaryTags (M5-T05)', () => {
  it('valid enum tags + grounded title pass', async () => {
    const { client } = clientOf([
      JSON.stringify({
        title: 'Belfountain via Forks of the Credit Road',
        summary: 'An 87 minute loop on Forks of the Credit Road with a café stop.',
        tags: ['twisty', 'backroad'],
      }),
    ]);
    const t = await titleSummaryTags(FACTS, { client });
    expect(t.source).toBe('llm');
    expect(t.tags).toEqual(['twisty', 'backroad']);
  });

  it('an off-enum tag is rejected → template fallback', async () => {
    const bad = JSON.stringify({
      title: 'Belfountain loop',
      summary: 'A loop from Belfountain.',
      tags: ['adrenaline'],
    });
    const { client } = clientOf([bad, bad]);
    const t = await titleSummaryTags(FACTS, { client });
    expect(t.source).toBe('template');
    expect(t.title.length).toBeLessThanOrEqual(60);
  });
});
