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
 * R23 collapse — the Twisty/Backroads/Simple tiers + the Mostly-backroads
 * toggle proved to be at most TWO honest behaviours (twisty≈backroads was a
 * coin-flip, audit-v6 → R22-1 rolled back), so the "Drive style" control is now
 * a 2-STOP axis; "how far the good roads are" lives in Discover, not here.
 * Sections still COMPOSE onto the one preset slot ([GATE-W]/BD-30: presets
 * only, no sliders — discrete chips):
 *   - Drive style (Direct | Fun & Explorative) → preset simple/backroads
 *     (Direct keeps the twistiness_pref 0.15 of the old Simple)
 *   - Scenery (Prefer views)          → the scenic CHARACTER tag. R25-U8a
 *     honesty note: with a preset always present, the server's scenic BUNDLE
 *     branch is unreachable — the tag only acts once the server's
 *     SCENIC_MODIFIER flag is on (tightens the R19 urban bar to scenic's
 *     0.10 + arms one nice-to-have viewpoint). The old claim here of an
 *     "arterial bar 0.35" was stale twice over — R19 replaced arterial bars
 *     with urban-context bars. Never the preset slot; [GATE-S] holds (no
 *     numeric scenic scoring anywhere)
 *   - On the route: avoid-highways / paved-only toggles + the stops builder
 *     (Coffee | Food | Gas × Anytime | Early | Midway | Late)
 *
 * Preset-slot rule (single slot, deterministic): the Drive-style chip IS the
 * preset (Direct→simple, Fun & Explorative→backroads); Scenery never touches it.
 */

import type { CharacterTag, LatLng, Preset, StopFraction, StopRequest } from '@shared/types';
import { createContext, useContext } from 'react';

import { MAX_BRIEF_CHARS, type PlanRequest } from './api';

/** Where the origin point came from — drives the §18 permission states. */
export type OriginSource = 'current' | 'pin';

/** The 2-stop drive-style axis (R23). UI labels: simple→"Direct",
 *  backroads→"Fun & Explorative" (R24-U2). The value IS the preset it composes. */
export type DriveStyle = 'simple' | 'backroads';

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
  /** R24-U12: a time budget in seconds (a control chip), or null for "surprise
   *  me". Composes to duration_target_s. There was no time control before R24. */
  durationTargetS: number | null;
}

export const EMPTY_DRAFT: PlanDraft = {
  brief: '',
  origin: null,
  destination: null,
  shape: 'loop',
  style: null,
  preferViews: false,
  routeOptions: { avoidHighways: false, pavedOnly: false },
  stops: [],
  durationTargetS: null,
};

/** R24-U12 time control — the discrete budgets (BD-30: presets, no slider).
 *  Bounded to the planner's duration_target_s window [2700, 9000]. */
export const DURATION_CHOICES: ReadonlyArray<{ label: string; seconds: number }> = [
  { label: '45 min', seconds: 2700 },
  { label: '1 hr', seconds: 3600 },
  { label: '1.5 hr', seconds: 5400 },
  { label: '2 hr', seconds: 7200 },
  { label: '2.5 hr', seconds: 9000 },
];

/**
 * The INITIAL draft the Plan screen opens with (R21-2 "make the default drive
 * fun", carried into the R23 collapse). The 2-stop control opens on "Scenic
 * backroads" (style:'backroads'), so a plain "generate" composes the backroads
 * preset (the adopted shortest-costing profile) instead of a boring arterial
 * cruise — the audit's "plain default = arterial region-wide". EMPTY_DRAFT
 * stays the true nothing-selected baseline (the composition tests assert it
 * produces no preset); the user can still switch to Direct.
 */
export const DEFAULT_DRAFT: PlanDraft = {
  ...EMPTY_DRAFT,
  style: 'backroads',
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
/**
 * R27 — `autoFilled` names the chips quick-fill set FROM THE TEXT rather than
 * the user tapping them.
 *
 * Why it matters: the chips are filled by the RULES parser (`POST /parse`), but
 * `POST /plan` runs the LLM parse, which this project's own gate measures as
 * strictly better (0.916 vs 0.852). Sending an auto-filled chip made the server
 * treat a regex guess as the user's explicit control and overwrite the better
 * parse with it — so the weaker parser won every request, which is what the
 * owner experienced as "this removed half our AI integration" (2026-07-29).
 *
 * A chip the user actually TAPPED is still authoritative and still sent. Only
 * values quick-fill guessed from the same brief the server is about to parse
 * properly are withheld.
 */
export function buildPlanRequest(
  draft: PlanDraft,
  autoFilled?: ReadonlySet<string>,
  /**
   * R28 — true when the BRIEF itself named a destination the server can resolve.
   *
   * The parser resolves "backroads drive to Erin" to real coordinates, and the
   * server already routes it: `/plan` only overrides `constraints.destination`
   * when the BODY supplies one, so a brief-resolved destination stands. But the
   * client was blocking the request anyway — demanding the user go pick, on a
   * map, the exact place the parser had already found. The owner reported this
   * as part of "the text box isn't filling in the options properly".
   */
  briefHasDestination = false,
): BuildResult {
  const problems: string[] = [];
  const brief = draft.brief.trim();

  // R24-U12: the brief is OPTIONAL — it now carries PLACES + TIME, and the
  // buttons (style/scenery/avoids/stops/time) plan a fine drive on their own.
  if (brief.length > MAX_BRIEF_CHARS)
    problems.push(`Keep the brief under ${MAX_BRIEF_CHARS} characters.`);
  if (!draft.origin) problems.push('Add a start point.');
  if (draft.shape === 'a_to_b' && !draft.destination && !briefHasDestination)
    problems.push('Pick a destination for an A → B drive.');

  if (problems.length > 0 || !draft.origin) return { ok: false, problems };

  // --- preset-slot composition (see module header) — the 2-stop Drive-style
  // chip IS the preset; Direct carries the old Simple's 0.15 twistiness pref ---
  let preset: Preset | null = null;
  let twistiness: number | undefined;
  const character: CharacterTag[] = [];
  if (draft.style === 'simple') {
    preset = 'simple';
    twistiness = 0.15;
  } else if (draft.style === 'backroads') {
    preset = 'backroads';
  }
  if (draft.preferViews) character.push('scenic');

  // --- stops: builder rows only ---
  // NOTE (R16-fix -> R18-4): the app never injects a viewpoint STOP. The
  // scenic tag reaches the server's scenic BUNDLE (anti-urban routing; it may
  // add its own capped nice-to-have viewpoint server-side, guarded by the
  // R17-A detour cap + stop-aware repair that the R16 injection lacked).
  const stops = stopRequestsOf(draft.stops);

  // --- avoid: send ONLY the toggles that are ON (an untouched toggle must
  // not clear a brief-parsed avoid — the server merges per key) ---
  const avoid = {
    ...(draft.routeOptions.avoidHighways ? { highways: true } : {}),
    ...(draft.routeOptions.pavedOnly ? { unpaved: true } : {}),
  };

  // Withhold only what the TEXT filled — never what the user tapped.
  const guessed = (f: string): boolean => autoFilled?.has(f) === true;
  const request: PlanRequest = {
    brief,
    origin: draft.origin.point,
    ...(guessed('shape') ? {} : { shape: draft.shape }),
    ...(draft.shape === 'a_to_b' && draft.destination ? { destination: draft.destination } : {}),
    ...(preset && !guessed('style') ? { preset } : {}),
    ...(twistiness !== undefined && !guessed('style') ? { twistiness_pref: twistiness } : {}),
    ...(stops.length > 0 ? { stops } : {}),
    ...(Object.keys(avoid).length > 0 ? { avoid } : {}),
    ...(character.length > 0 && !guessed('style') ? { character } : {}),
    ...(draft.durationTargetS !== null && !guessed('duration')
      ? { duration_target_s: draft.durationTargetS }
      : {}),
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
