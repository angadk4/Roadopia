/**
 * R25-U16d — quick-fill: the parse populates the buttons, visibly, and never
 * re-moves a touched one.
 *
 * Model: every fillable control is a pure function of (its default, the
 * latest rules parse) UNTIL the user touches it — the instant a chip is
 * tapped it joins `touched` and the parse stops moving it. That is "nothing
 * is ever overridden invisibly" made mechanical:
 *   - typing "simple loop from Erin" flips the Road-character chip to Direct
 *     while you watch (marked "from your text");
 *   - typing "twisty" CLEARS the chip to No preference — the two-chip presets
 *     can't say twisty, so the text is left to decide (preset:null revives the
 *     tag-driven twisty bundle; pre-U16b the backroads default silently ATE
 *     the twisty ask — audit issue #9's exact mechanism);
 *   - a typed time snaps to the nearest chip only within ±20 %, else the chip
 *     stays "Any" with a note (the text still counts server-side).
 *
 * Pure module — the screen owns debounce (~600 ms) + the /parse fetch; this
 * owns the mapping. The server re-runs the same rules parser on submit, so a
 * missed fetch can never change the drive — only the preview.
 */

import type { ParsedConstraints } from '@shared/types';

import { DURATION_CHOICES, DEFAULT_DRAFT, type DriveStyle, type PlanDraft } from './plan_draft';

/** The controls quick-fill may move (origin/stops are deliberately excluded:
 *  origin is a device input, stop rows are additive server-side already). */
export type QuickFillField =
  | 'shape'
  | 'style'
  | 'duration'
  | 'avoidHighways'
  | 'pavedOnly'
  | 'preferViews';

export interface AutoFill {
  shape: PlanDraft['shape'];
  style: DriveStyle | null;
  durationTargetS: number | null;
  avoidHighways: boolean;
  pavedOnly: boolean;
  preferViews: boolean;
  /** Which fields the PARSE decided (vs default) — drives the "from your
   *  text" markers; a field not listed fell back to its default. */
  fromText: QuickFillField[];
  /** Honest snap note when a typed time doesn't fit a chip. */
  note: string | null;
}

/** ±20 % — beyond this a typed time doesn't "mean" any chip. */
export const DURATION_SNAP_TOLERANCE = 0.2;

function snapDuration(targetS: number): number | null {
  let best: { seconds: number; err: number } | null = null;
  for (const c of DURATION_CHOICES) {
    const err = Math.abs(c.seconds - targetS) / targetS;
    if (best === null || err < best.err) best = { seconds: c.seconds, err };
  }
  return best !== null && best.err <= DURATION_SNAP_TOLERANCE ? best.seconds : null;
}

/** Untouched controls = f(default, parse). Recomputed per parse so deleting
 *  text honestly un-fills what it had filled. */
export function computeAutoFill(c: ParsedConstraints): AutoFill {
  const fromText: QuickFillField[] = [];
  let note: string | null = null;

  const shape: PlanDraft['shape'] = c.shape;
  if (c.shape !== DEFAULT_DRAFT.shape) fromText.push('shape');

  // style: only the presets the chips can SAY fill them; character/twistiness
  // signals CLEAR the chip so the text decides (see module header)
  let style: DriveStyle | null = DEFAULT_DRAFT.style;
  if (c.preset === 'simple' || c.intensity === 'chill') {
    // R27: was `c.preset === 'chill'`, which parse_rules never emits — 'chill'
    // arrives on `intensity`, so this branch was unreachable dead code and
    // typing "chill drive" moved nothing.
    style = 'simple';
    fromText.push('style');
  } else if (
    c.preset === 'backroads' ||
    c.preset === 'twisty' ||
    c.preset === 'scenic' ||
    (c.twistiness_pref ?? 0) >= 0.7 ||
    c.character.some((t) => t === 'twisty' || t === 'backroad' || t === 'rural')
  ) {
    // R27 — THE "text box un-fills my chips" BUG. This used to set `style = null`
    // for twisty/scenic/rural with the comment "No preference — your own words
    // decide". But `null` is not a neutral no-op: it IS the third chip,
    // "No preference". So the screen opened with Fun & Explorative lit, the user
    // typed "twisty", and 600 ms later the app DE-SELECTED it and lit
    // "No preference" instead — the exact opposite of quick-fill's promise.
    // Every one of these asks is a fun/country drive, so they map to the chip
    // that says so; the free text still carries the nuance to the planner.
    style = 'backroads';
    fromText.push('style');
  }

  let durationTargetS: number | null = DEFAULT_DRAFT.durationTargetS;
  if (c.duration_target_s !== null) {
    const snapped = snapDuration(c.duration_target_s);
    if (snapped !== null) {
      durationTargetS = snapped;
      fromText.push('duration');
    } else {
      note = `the ${Math.round(c.duration_target_s / 60)} min you typed isn't one of the chips — leaving "Any" (your text still counts)`;
    }
  }

  const avoidHighways = c.avoid.highways === true;
  if (avoidHighways) fromText.push('avoidHighways');
  const pavedOnly = c.avoid.unpaved === true || c.surface_pref === 'paved';
  if (pavedOnly) fromText.push('pavedOnly');
  const preferViews = c.character.includes('scenic') || (c.scenic_pref ?? 0) >= 0.7;
  if (preferViews) fromText.push('preferViews');

  return { shape, style, durationTargetS, avoidHighways, pavedOnly, preferViews, fromText, note };
}

/**
 * Merge an AutoFill into the draft, honouring `touched`: a touched field is
 * NEVER moved (the user's tap outranks the text — and the server's U16a
 * disclosure names it if they end up contradicting). Returns only the fields
 * that changed, ready for setDraft().
 */
export function applyAutoFill(
  draft: PlanDraft,
  auto: AutoFill,
  touched: ReadonlySet<QuickFillField>,
): Partial<PlanDraft> {
  const updates: Partial<PlanDraft> = {};
  if (!touched.has('shape') && draft.shape !== auto.shape) updates.shape = auto.shape;
  if (!touched.has('style') && draft.style !== auto.style) updates.style = auto.style;
  if (!touched.has('duration') && draft.durationTargetS !== auto.durationTargetS) {
    updates.durationTargetS = auto.durationTargetS;
  }
  const ro = draft.routeOptions;
  const nextRo = {
    avoidHighways: touched.has('avoidHighways') ? ro.avoidHighways : auto.avoidHighways,
    pavedOnly: touched.has('pavedOnly') ? ro.pavedOnly : auto.pavedOnly,
  };
  if (nextRo.avoidHighways !== ro.avoidHighways || nextRo.pavedOnly !== ro.pavedOnly) {
    updates.routeOptions = nextRo;
  }
  if (!touched.has('preferViews') && draft.preferViews !== auto.preferViews) {
    updates.preferViews = auto.preferViews;
  }
  return updates;
}
