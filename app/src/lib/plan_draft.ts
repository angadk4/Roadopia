/**
 * Plan-screen draft state + request builder (M7-T03, restructured R16-5;
 * FR-040, §27.4).
 *
 * The draft lives in a React context scoped to the Plan stack so the map-pick
 * screen can write the chosen point without non-serializable navigation params.
 * `buildPlanRequest` is the PURE, fully-tested seam: draft → a valid POST /plan
 * body, or the friendly problems that block submission (Hard rule K mirrors —
 * the server re-validates everything).
 *
 * R16-5 sections replace the single preset chip ([GATE-W]/BD-30 still holds:
 * presets only, no sliders — the sections COMPOSE onto the one preset slot +
 * the frozen server-side vectors):
 *   - Drive style (Twisty | Simple)   → preset twisty/simple + twistiness_pref
 *   - Scenery (Prefer views)          → viewpoint stop + scenic tag, NEVER the
 *     preset slot ([GATE-S]: no numeric scenic scoring — the stop is the lever)
 *   - On the route: avoid-highways / mostly-backroads / paved-only toggles +
 *     the stops builder (Coffee | Food | Gas × Anytime | Early | Midway | Late)
 *
 * Preset-slot rules (single slot, deterministic):
 *   backroads-ON takes the slot over Twisty (the 0.9 pref rides along);
 *   with Simple it keeps `simple` and adds the `backroad` tag (weak combo,
 *   honest); Scenery never touches the slot.
 */

import type { CharacterTag, LatLng, Preset, StopFraction, StopRequest } from '@shared/types';
import { createContext, useContext } from 'react';

import { MAX_BRIEF_CHARS, type PlanRequest } from './api';

/** Where the origin point came from — drives the §18 permission states. */
export type OriginSource = 'current' | 'pin';

export type DriveStyle = 'twisty' | 'simple';

/** Builder stop types — the request domain the corpus actually covers
 *  (viewpoint arrives via the Scenery toggle; rest/great_road via the brief). */
export type StopRowType = 'coffee' | 'food' | 'fuel';

export type StopWhen = 'anytime' | 'early' | 'midway' | 'late';

export interface StopRow {
  type: StopRowType;
  when: StopWhen;
}

/** Builder row cap: 4 rows + the possible Scenery viewpoint stays under the
 *  server's MAX_STOP_ROWS (6). */
export const MAX_STOP_ROWS_CLIENT = 4;

export interface RouteOptions {
  avoidHighways: boolean;
  mostlyBackroads: boolean;
  pavedOnly: boolean;
}

export interface PlanDraft {
  brief: string;
  origin: { source: OriginSource; point: LatLng } | null;
  destination: LatLng | null;
  shape: 'loop' | 'a_to_b';
  style: DriveStyle | null;
  preferViews: boolean;
  routeOptions: RouteOptions;
  stops: StopRow[];
}

export const EMPTY_DRAFT: PlanDraft = {
  brief: '',
  origin: null,
  destination: null,
  shape: 'loop',
  style: null,
  preferViews: false,
  routeOptions: { avoidHighways: false, mostlyBackroads: false, pavedOnly: false },
  stops: [],
};

/** Early/Midway/Late chips → drive fractions (anytime = no aim). */
export const WHEN_TO_FRACTION: Record<StopWhen, StopFraction | null> = {
  anytime: null,
  early: 0.25,
  midway: 0.5,
  late: 0.75,
};

export type BuildResult = { ok: true; request: PlanRequest } | { ok: false; problems: string[] };

/** Aggregate identical (type, when) rows into one request with count n. */
function stopRequestsOf(rows: readonly StopRow[]): StopRequest[] {
  const byKey = new Map<string, StopRequest>();
  for (const row of rows) {
    const key = `${row.type}|${row.when}`;
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else
      byKey.set(key, {
        type: row.type,
        count: 1,
        importance: 'nice_to_have',
        at_fraction: WHEN_TO_FRACTION[row.when],
      });
  }
  return [...byKey.values()];
}

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

  // --- preset-slot composition (see module header for the rules) ---
  let preset: Preset | null = null;
  let twistiness: number | undefined;
  const character: CharacterTag[] = [];
  if (draft.style === 'twisty') {
    preset = 'twisty';
    twistiness = 0.9;
  } else if (draft.style === 'simple') {
    preset = 'simple';
    twistiness = 0.15;
  }
  if (draft.routeOptions.mostlyBackroads) {
    if (draft.style === 'simple') {
      character.push('backroad'); // weak combo: simple keeps the slot, honest tag
    } else {
      preset = 'backroads'; // takes the slot; a twisty pref rides along
    }
  }
  if (draft.preferViews) character.push('scenic');

  // --- stops: builder rows only ---
  // NOTE (R16-fix): scenery no longer injects a viewpoint STOP. A sparse
  // viewpoint dragged loops off-corridor and skipped the repair pass. Scenery
  // becomes a country-road ROUTING preference in Thread B; a viewpoint stop is
  // requested only when the brief explicitly says so ("with a viewpoint").
  const stops = stopRequestsOf(draft.stops);

  // --- avoid: send ONLY the toggles that are ON (an untouched toggle must
  // not clear a brief-parsed avoid — the server merges per key) ---
  const avoid = {
    ...(draft.routeOptions.avoidHighways ? { highways: true } : {}),
    ...(draft.routeOptions.pavedOnly ? { unpaved: true } : {}),
  };

  const request: PlanRequest = {
    brief,
    origin: draft.origin.point,
    shape: draft.shape,
    ...(draft.shape === 'a_to_b' && draft.destination ? { destination: draft.destination } : {}),
    ...(preset ? { preset } : {}),
    ...(twistiness !== undefined ? { twistiness_pref: twistiness } : {}),
    ...(stops.length > 0 ? { stops } : {}),
    ...(Object.keys(avoid).length > 0 ? { avoid } : {}),
    ...(character.length > 0 ? { character } : {}),
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
