/**
 * Plan-screen draft state + request builder (M7-T03; FR-040, §27.4).
 *
 * The draft lives in a React context scoped to the Plan stack so the map-pick
 * screen can write the chosen point without non-serializable navigation params.
 * `buildPlanRequest` is the PURE, fully-tested seam: draft → a valid POST /plan
 * body, or the friendly problems that block submission (Hard rule K mirrors —
 * the server re-validates everything).
 *
 * Presets ONLY — no weight sliders ([GATE-W]/BD-30: W1 presets-only shipped;
 * sliders deferred, not built; Hard rule L). The chip travels as the additive
 * `preset` body field and resolves to the FROZEN vectors server-side.
 */

import type { LatLng, Preset } from '@shared/types';
import { createContext, useContext } from 'react';

import { MAX_BRIEF_CHARS, type PlanRequest } from './api';

/** Where the origin point came from — drives the §18 permission states. */
export type OriginSource = 'current' | 'pin';

export interface PlanDraft {
  brief: string;
  origin: { source: OriginSource; point: LatLng } | null;
  destination: LatLng | null;
  shape: 'loop' | 'a_to_b';
  preset: Preset | null;
}

export const EMPTY_DRAFT: PlanDraft = {
  brief: '',
  origin: null,
  destination: null,
  shape: 'loop',
  preset: null,
};

export type BuildResult = { ok: true; request: PlanRequest } | { ok: false; problems: string[] };

/** Draft → POST /plan body. Origin is REQUIRED here by design: the planner
 *  cannot resolve "current location" itself (BD-27 — the app always sends
 *  device-resolved coordinates). */
export function buildPlanRequest(draft: PlanDraft): BuildResult {
  const problems: string[] = [];
  const brief = draft.brief.trim();

  if (brief.length === 0) problems.push('Describe the drive you want.');
  if (brief.length > MAX_BRIEF_CHARS)
    problems.push(`Keep the brief under ${MAX_BRIEF_CHARS} characters.`);
  if (!draft.origin) problems.push('Add a start point.');
  if (draft.shape === 'a_to_b' && !draft.destination)
    problems.push('Pick a destination for an A → B drive.');

  if (problems.length > 0 || !draft.origin) return { ok: false, problems };

  const request: PlanRequest = {
    brief,
    origin: draft.origin.point,
    shape: draft.shape,
    ...(draft.shape === 'a_to_b' && draft.destination ? { destination: draft.destination } : {}),
    ...(draft.preset ? { preset: draft.preset } : {}),
  };
  return { ok: true, request };
}

export interface PlanDraftStore {
  draft: PlanDraft;
  setDraft: (update: Partial<PlanDraft>) => void;
}

export const PlanDraftContext = createContext<PlanDraftStore | null>(null);

export function usePlanDraft(): PlanDraftStore {
  const store = useContext(PlanDraftContext);
  if (!store) throw new Error('usePlanDraft must be used inside the Plan stack provider');
  return store;
}
