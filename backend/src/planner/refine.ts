/**
 * Deterministic refinement merge — RF6 rules (M5-T06; Protocol §17.1; [GATE-D]
 * default deterministic per BD-29 disposition).
 *
 * A follow-up turn ("make it longer", "add a viewpoint", "avoid Erin") maps to a
 * constraint delta Δc via keyword rules — the same style as the rules parser —
 * then `c' = merge(c, Δc)` under the §17.1 fixed rules:
 *   - HARD CONSTRAINTS PERSIST unless the user explicitly removes one
 *     ("actually highways are fine" → clear avoid.highways);
 *   - longer/shorter → duration step (or a stated value); tolerance unchanged;
 *   - add stop → appended hard-relaxable (nice_to_have: include or disclose);
 *   - avoid X → `location_constraints` avoid entry (geometry penalty at M6);
 *   - more/less twisty|scenic → soft-target nudge, clamped 0..1;
 *   - conflicts: THE NEW TURN WINS for the changed field, with disclosure
 *     (every applied change is named in `changes`).
 * Memory is session-scoped: the caller holds the running `c` (Spec §34).
 */

import type { ParsedConstraints, StopRequest } from '@shared/types';

import { STOP_KEYWORDS } from './parse_rules';

/** Duration step for a bare "longer/shorter" (no stated value): 20% of the
 *  current target, floored at 10 min. Base when no target exists: 60 min. */
export const REFINE_DURATION_STEP_FRAC = 0.2;
export const REFINE_DURATION_STEP_MIN_S = 600;
export const REFINE_DEFAULT_BASE_S = 3600;
/** Soft-preference nudge for "more/less twisty|scenic". */
export const REFINE_PREF_STEP = 0.2;

/** Δc — what one follow-up turn asks to change. Everything optional; empty
 *  delta = nothing recognized (caller discloses, does NOT re-run). */
export interface ConstraintDelta {
  duration?: { kind: 'longer' | 'shorter' } | { kind: 'set'; targetS: number };
  addStops: StopRequest[];
  avoidLocations: string[];
  /** R18-4: "actually go through Hockley" — through-intents merge in too. */
  throughLocations: string[];
  /** Explicit hard-avoid changes only — true = add, false = the user lifted it. */
  setAvoid: Partial<ParsedConstraints['avoid']>;
  twistinessDelta?: number;
  scenicDelta?: number;
  /** Preset the follow-up asks for (FROZEN BD-30 vectors — the real scoring
   *  lever a soft-pref nudge alone lacks). 'explicit' presets ('more
   *  backroads') always apply; 'if_unset' ('more twisty') never clobbers a
   *  chip the user chose. */
  setPreset?: { preset: ParsedConstraints['preset']; mode: 'explicit' | 'if_unset' };
  /** Nothing matched at all (honest "I couldn't apply that" path). */
  recognized: boolean;
}

export interface MergeResult {
  merged: ParsedConstraints;
  /** Human-readable labels of every field the turn changed (disclosure). */
  changes: string[];
}

const AVOID_KEYS: Array<{ key: keyof ParsedConstraints['avoid']; re: RegExp }> = [
  { key: 'highways', re: /\bhighways?\b|\bmotorways?\b|\b\d{3}-style\b/i },
  { key: 'tolls', re: /\btolls?\b/i },
  { key: 'ferries', re: /\bferr(?:y|ies)\b/i },
  { key: 'unpaved', re: /\bunpaved\b|\bgravel\b|\bdirt\b/i },
];

/** "actually highways are fine" / "ok with tolls" / "don't mind gravel". */
const LIFT_RE = /\b(?:are|is)\s+(?:fine|ok(?:ay)?)\b|\bdon'?t\s+mind\b|\bok\s+with\b|\ballow\b/i;
const ADD_AVOID_RE = /\bavoid\b|\bno\b|\bwithout\b|\bskip\b|\bstay\s+off\b|\bless\b/i;

/** Map a follow-up sentence to Δc — pure keyword/grammar rules, no model. */
export function parseFollowUp(text: string): ConstraintDelta {
  const delta: ConstraintDelta = {
    addStops: [],
    avoidLocations: [],
    throughLocations: [],
    setAvoid: {},
    recognized: false,
  };

  // duration: a stated value wins over a bare step
  const stated =
    /(?:make\s+it|more\s+like|closer\s+to|to)\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i.exec(
      text,
    );
  if (stated) {
    const n = Number(stated[1]);
    const secs = /^h/i.test(stated[2]!) ? n * 3600 : n * 60;
    delta.duration = { kind: 'set', targetS: Math.round(secs) };
    delta.recognized = true;
  } else if (/\blonger\b|\bextend\b|\bmore\s+time\b/i.test(text)) {
    delta.duration = { kind: 'longer' };
    delta.recognized = true;
  } else if (/\bshorter\b|\bquicker\b|\bless\s+time\b|\btrim\b/i.test(text)) {
    delta.duration = { kind: 'shorter' };
    delta.recognized = true;
  }

  // add a stop ("add a viewpoint", "throw in a coffee stop")
  if (/\badd\b|\bthrow\s+in\b|\binclude\b|\bwith\s+a\b|\bstop\s+for\b/i.test(text)) {
    for (const { re, type } of STOP_KEYWORDS) {
      if (re.test(text)) {
        delta.addStops.push({ type, count: 1, importance: 'nice_to_have', at_fraction: null });
        delta.recognized = true;
      }
    }
  }

  // hard-avoid flags: explicit lift beats add (the new turn wins for the field)
  for (const { key, re } of AVOID_KEYS) {
    if (!re.test(text)) continue;
    if (LIFT_RE.test(text)) {
      delta.setAvoid[key] = false;
      delta.recognized = true;
    } else if (ADD_AVOID_RE.test(text)) {
      delta.setAvoid[key] = true;
      delta.recognized = true;
    }
  }

  // "avoid <place>" — anything after avoid/skip that is NOT a hard-avoid keyword
  const avoidPlace =
    /\b(?:avoid|skip|stay\s+(?:away\s+from|out\s+of))\s+(?:that\s+|the\s+)?([A-Za-z][A-Za-z' .-]{1,40}?)(?:[,.!]|$)/i.exec(
      text,
    );
  if (avoidPlace) {
    const place = avoidPlace[1]!.trim();
    const isHardKeyword = AVOID_KEYS.some(({ re }) => re.test(place));
    const isGeneric = /^(?:it|this|them|that)$/i.test(place);
    if (!isHardKeyword && !isGeneric) {
      delta.avoidLocations.push(place);
      delta.recognized = true;
    }
  }

  // "go through X" / "route it via X" (R18-4 location intents)
  const throughRe = /\b(?:go\s+)?(?:through|via)\s+(?:the\s+)?([A-Za-z][\w.'\- ]+)/i.exec(text);
  if (throughRe?.[1]) {
    const place = throughRe[1]
      .split(/[,!?;.]|\b(?:with|and|then|instead|please|for)\b/i)[0]!
      .trim();
    if (place.length > 1) {
      delta.throughLocations.push(place);
      delta.recognized = true;
    }
  }

  // soft-preference nudges
  if (/\b(?:more\s+twisty|twistier|more\s+curves)\b/i.test(text)) {
    delta.twistinessDelta = REFINE_PREF_STEP;
    // pref alone only re-ranks the pool weakly (M7-T09 finding) — also steer
    // the FROZEN twisty preset vector, but never clobber an explicit chip
    delta.setPreset = { preset: 'twisty', mode: 'if_unset' };
    delta.recognized = true;
  } else if (/\b(?:less\s+twisty|straighter|fewer\s+curves|more\s+relaxed)\b/i.test(text)) {
    delta.twistinessDelta = -REFINE_PREF_STEP;
    delta.recognized = true;
  }

  // "more backroads" / "country roads" / "rural" — an explicit ask for the
  // FROZEN backroads preset (M7-T09: this phrase was silently dropped before)
  if (/\bback\s*roads?\b|\bcountry\s+roads?\b|\brural\b/i.test(text)) {
    delta.setPreset = { preset: 'backroads', mode: 'explicit' };
    delta.recognized = true;
  }
  if (/\bmore\s+scenic\b/i.test(text)) {
    delta.scenicDelta = REFINE_PREF_STEP;
    delta.recognized = true;
  } else if (/\bless\s+scenic\b/i.test(text)) {
    delta.scenicDelta = -REFINE_PREF_STEP;
    delta.recognized = true;
  }

  return delta;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** `c' = merge(c, Δc)` — §17.1 rules; returns the new constraints + what changed. */
export function mergeConstraints(c: ParsedConstraints, delta: ConstraintDelta): MergeResult {
  // structuredClone keeps `c` untouched (session memory holds the running copy)
  const merged: ParsedConstraints = structuredClone(c);
  const changes: string[] = [];

  if (delta.duration) {
    const base = merged.duration_target_s ?? REFINE_DEFAULT_BASE_S;
    if (delta.duration.kind === 'set') {
      merged.duration_target_s = delta.duration.targetS;
      changes.push(`duration → ${Math.round(delta.duration.targetS / 60)} min`);
    } else {
      const step = Math.max(
        REFINE_DURATION_STEP_MIN_S,
        Math.round(base * REFINE_DURATION_STEP_FRAC),
      );
      const next =
        delta.duration.kind === 'longer'
          ? base + step
          : Math.max(REFINE_DURATION_STEP_MIN_S, base - step);
      merged.duration_target_s = next;
      changes.push(`duration ${delta.duration.kind} → ${Math.round(next / 60)} min`);
    }
  }

  for (const stop of delta.addStops) {
    const existing = merged.stops.find((s) => s.type === stop.type);
    if (existing) {
      existing.count += stop.count;
      changes.push(`stop ${stop.type} count → ${existing.count}`);
    } else {
      merged.stops.push({ ...stop });
      changes.push(`+ stop ${stop.type}`);
    }
  }

  for (const place of delta.avoidLocations) {
    if (!merged.location_constraints.some((lc) => lc.kind === 'avoid' && lc.text === place)) {
      merged.location_constraints.push({ kind: 'avoid', text: place });
      changes.push(`avoid location "${place}"`);
    }
  }

  for (const place of delta.throughLocations) {
    if (!merged.location_constraints.some((lc) => lc.kind === 'through' && lc.text === place)) {
      merged.location_constraints.push({ kind: 'through', text: place });
      changes.push(`through "${place}"`);
    }
  }

  for (const [key, val] of Object.entries(delta.setAvoid) as Array<
    [keyof ParsedConstraints['avoid'], boolean]
  >) {
    if (merged.avoid[key] !== val) {
      merged.avoid[key] = val;
      changes.push(val ? `avoid ${key}` : `avoid ${key} lifted`);
    }
  }

  if (delta.setPreset !== undefined) {
    const apply = delta.setPreset.mode === 'explicit' || merged.preset === null;
    if (apply && merged.preset !== delta.setPreset.preset) {
      merged.preset = delta.setPreset.preset;
      changes.push(`preset → ${String(delta.setPreset.preset)}`);
    }
  }

  if (delta.twistinessDelta !== undefined) {
    merged.twistiness_pref = clamp01((merged.twistiness_pref ?? 0.5) + delta.twistinessDelta);
    changes.push(`twistiness_pref → ${merged.twistiness_pref.toFixed(1)}`);
  }
  if (delta.scenicDelta !== undefined) {
    merged.scenic_pref = clamp01((merged.scenic_pref ?? 0.5) + delta.scenicDelta);
    changes.push(`scenic_pref → ${merged.scenic_pref.toFixed(1)}`);
  }

  return { merged, changes };
}

/** One-call convenience: follow-up text → `c'` + disclosure. */
export function refineConstraints(
  c: ParsedConstraints,
  followUp: string,
): MergeResult & {
  recognized: boolean;
} {
  const delta = parseFollowUp(followUp);
  if (!delta.recognized) return { merged: structuredClone(c), changes: [], recognized: false };
  return { ...mergeConstraints(c, delta), recognized: true };
}
