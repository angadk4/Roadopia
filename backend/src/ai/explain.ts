/**
 * Grounded explanation + auto-title/summary/tags (M5-T04 + M5-T05; FR-250..255,
 * Spec §25; BD-31: LLM explanation is the R6 role the gates DID keep).
 *
 * Flow per output: guarded LLM call → schema parse → GROUNDING CHECK against
 * the run's real facts (validate_output.ts) → one retry naming the novel
 * entities → deterministic template fallback. The template composes the same
 * facts, so the user always gets an honest result even with AI off
 * (kill switch / cap — FR-261).
 */

import type { AiClient } from './client';
import { AiDisabledError } from './cost_guard';
import { EXPLAIN_PROMPT, TST_PROMPT } from './prompts/explain';
import { checkGrounded, type GroundingFacts } from './validate_output';

/** The grounded facts an explanation may draw from — all computed/tool data. */
export interface RouteFacts {
  originName: string | null;
  durationMin: number;
  distanceKm: number;
  targetMin: number | null;
  curviness: number;
  /** Named roads actually on the route (from maneuvers), deduped. */
  roadNames: string[];
  /** Real stops included (name + type from the spots table). */
  stops: Array<{ name: string; type: string }>;
  satisfied: string[];
  relaxed: string[];
  viewpointCount: number;
}

export interface Explanation {
  text: string;
  satisfied: string[];
  relaxed: string[];
  source: 'llm' | 'template';
}

export interface TitleSummaryTags {
  title: string;
  summary: string;
  tags: string[];
  source: 'llm' | 'template';
}

function groundingFactsOf(facts: RouteFacts): GroundingFacts {
  return {
    allowedNames: [
      ...(facts.originName ? [facts.originName] : []),
      ...facts.roadNames,
      ...facts.stops.map((s) => s.name),
    ],
    allowedNumbers: [
      facts.durationMin,
      facts.distanceKm,
      ...(facts.targetMin !== null ? [facts.targetMin] : []),
      facts.curviness,
    ],
  };
}

/** Deterministic fallback — same facts, no model (FR-261 degrade path). */
export function templateExplanation(facts: RouteFacts): Explanation {
  const roads = facts.roadNames.slice(0, 3).join(', ');
  const stops = facts.stops.map((s) => `${s.name} (${s.type})`).join(', ');
  const bits = [
    `A ${Math.round(facts.durationMin)} minute, ${Math.round(facts.distanceKm)} km loop` +
      (facts.originName ? ` from ${facts.originName}` : '') +
      (roads ? `, running ${roads}` : '') +
      '.',
  ];
  if (stops) bits.push(`Stops: ${stops}.`);
  if (facts.viewpointCount > 0) bits.push(`Passes ${facts.viewpointCount} viewpoint spots.`);
  if (facts.relaxed.length > 0) bits.push(`Relaxed to make it work: ${facts.relaxed.join(', ')}.`);
  return {
    text: bits.join(' '),
    satisfied: facts.satisfied,
    relaxed: facts.relaxed,
    source: 'template',
  };
}

export function templateTitleSummaryTags(facts: RouteFacts): TitleSummaryTags {
  const road = facts.roadNames[0];
  const title = (
    (facts.originName ? `${facts.originName} ` : '') +
    (road ? `via ${road}` : `${Math.round(facts.durationMin)} min loop`)
  ).slice(0, 60);
  return {
    title,
    summary: templateExplanation(facts).text,
    tags: facts.curviness >= 1.5 ? ['twisty'] : ['rural'],
    source: 'template',
  };
}

async function groundedCall<T>(
  client: AiClient | null,
  prompt: typeof EXPLAIN_PROMPT,
  facts: RouteFacts,
  extract: (raw: Record<string, unknown>) => { value: T; proseToCheck: string } | null,
  fallback: () => T,
): Promise<T> {
  if (client === null) return fallback();
  const grounding = groundingFactsOf(facts);
  let note = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await client.call(prompt, `ROUTE FACTS: ${JSON.stringify(facts)}${note}`);
      const raw = JSON.parse(res.text) as Record<string, unknown>;
      const got = extract(raw);
      if (got === null) throw new Error('malformed output shape');
      const verdict = checkGrounded(got.proseToCheck, grounding);
      if (verdict.ok) return got.value;
      note = `\n\nYour previous output mentioned entities/numbers NOT in the facts (${[
        ...verdict.novelEntities,
        ...verdict.novelNumbers,
      ]
        .join(', ')
        .slice(0, 200)}). Use only the facts.`;
    } catch (err) {
      if (err instanceof AiDisabledError) break; // cap/kill — degrade now
      note = '\n\nYour previous output was malformed. Output only the JSON object.';
    }
  }
  return fallback();
}

/** The honest "why this route" (Sonnet, grounded; template on any failure). */
export async function explainRoute(
  facts: RouteFacts,
  opts: { client: AiClient | null },
): Promise<Explanation> {
  return groundedCall(
    opts.client,
    EXPLAIN_PROMPT,
    facts,
    (raw) => {
      if (typeof raw['text'] !== 'string' || !Array.isArray(raw['satisfied'])) return null;
      const value: Explanation = {
        text: raw['text'],
        satisfied: (raw['satisfied'] as string[]).map(String),
        relaxed: Array.isArray(raw['relaxed']) ? (raw['relaxed'] as string[]).map(String) : [],
        source: 'llm',
      };
      return { value, proseToCheck: value.text };
    },
    () => templateExplanation(facts),
  );
}

/** Auto title/summary/tags (Haiku, grounded, enum-checked tags). */
export async function titleSummaryTags(
  facts: RouteFacts,
  opts: { client: AiClient | null },
): Promise<TitleSummaryTags> {
  const TAG_ENUM = new Set([
    'twisty',
    'flowing',
    'scenic',
    'backroad',
    'coastal',
    'forest',
    'mountain',
    'rural',
    'historic',
  ]);
  return groundedCall(
    opts.client,
    TST_PROMPT,
    facts,
    (raw) => {
      if (typeof raw['title'] !== 'string' || typeof raw['summary'] !== 'string') return null;
      const tags = Array.isArray(raw['tags']) ? (raw['tags'] as string[]).map(String) : [];
      if (raw['title'].length > 60 || !tags.every((t) => TAG_ENUM.has(t))) return null;
      const value: TitleSummaryTags = {
        title: raw['title'],
        summary: raw['summary'],
        tags,
        source: 'llm',
      };
      return { value, proseToCheck: `${value.title}. ${value.summary}` };
    },
    () => templateTitleSummaryTags(facts),
  );
}
