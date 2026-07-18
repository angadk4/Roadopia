/**
 * SSE test utilities for the /plan endpoint tests (M6-T04/T05/T06).
 * Real sockets (listen on port 0 + fetch streaming) — cancellation and
 * disconnect semantics can't be exercised through inject().
 */

import {
  GenerationEventSchema,
  type GenerationEvent,
  type RouteThroughOutput,
} from '@shared/types';
import type { FastifyInstance } from 'fastify';

import type { PlannerResult } from '../planner/run';

export interface SseRun {
  status: number;
  headers: Headers;
  /** Parsed + SCHEMA-VALIDATED events (Hard rule I: only GenerationEvents
   *  may travel the stream — an off-schema frame fails the test). */
  events: GenerationEvent[];
  rawText: string;
}

export function parseSseFrames(text: string): GenerationEvent[] {
  const events: GenerationEvent[] = [];
  for (const frame of text.split('\n\n')) {
    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
    if (!dataLine) continue; // heartbeats/comments
    events.push(GenerationEventSchema.parse(JSON.parse(dataLine.slice('data: '.length))));
  }
  return events;
}

export async function listen(
  app: FastifyInstance,
): Promise<{ port: number; close: () => Promise<void> }> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { port: address.port, close: () => app.close() };
}

export async function postPlan(
  port: number,
  body: unknown,
  opts: { headers?: Record<string, string>; abortAfterEvents?: number } = {},
): Promise<SseRun> {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...opts.headers },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    // guard rejections are plain JSON — return them un-streamed
    const rawText = await res.text();
    return { status: res.status, headers: res.headers, events: [], rawText };
  }

  let rawText = '';
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rawText += decoder.decode(value, { stream: true });
      if (
        opts.abortAfterEvents !== undefined &&
        parseSseFrames(rawText).length >= opts.abortAfterEvents
      ) {
        controller.abort(); // simulate the client walking away mid-stream
        break;
      }
    }
  } catch {
    // aborted mid-read — expected in cancellation tests
  }
  return { status: res.status, headers: res.headers, events: parseSseFrames(rawText), rawText };
}

export const ROUTE_FIXTURE: RouteThroughOutput = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.9, 43.2],
      [-79.87, 43.22],
      [-79.85, 43.21],
    ],
  },
  distance_m: 82_000,
  duration_s: 5_100,
  maneuvers: [
    { type: 'start', instruction: 'Drive northeast on Wilson Street East.' },
    { type: 'left', instruction: 'Turn left onto Sulphur Springs Road.' },
    { type: 'right', instruction: 'Turn right onto Mineral Springs Road.' },
  ],
  legs: [],
  has_highway: false,
  has_toll: false,
  has_ferry: false,
  has_unpaved: false,
};

export function okPlannerResult(events: GenerationEvent[] = []): PlannerResult {
  return {
    status: 'ok',
    route: ROUTE_FIXTURE,
    curviness: 1.8,
    score: null,
    validation: {
      feasible: true,
      results: [
        { constraint: 'duration', tier: 2, status: 'satisfied', detail: 'within 10%' },
        { constraint: 'avoid_highways', tier: 2, status: 'satisfied', detail: 'no highway edges' },
      ],
    },
    disclosures: [],
    clarificationQuestion: null,
    events,
    elevation: { climb_m: 410 },
    iterations: 1,
    alternates: [],
    stops: [],
    waypoints: [],
    countryScore: null,
    arterialShare: null,
    urbanShare: null,
  };
}
