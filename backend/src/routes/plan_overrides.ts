/**
 * R25-U16a — ONE disclosed merge instead of five silent overwrites.
 *
 * Audit-v11 issue #9: the Plan screen's structured fields (shape, preset,
 * twistiness, place pins, duration) each silently overwrote whatever the
 * free-text brief parsed — typing "twisty" while the Road-character chip said
 * Direct produced a Direct drive with no trace of the disagreement, and the
 * narration then explained a route as if the text had been honoured.
 *
 * Under quick-fill (U16) the semantics INVERT: the chips are pre-filled FROM
 * the parse, so the client value IS the truth and should win. The defect was
 * never "client wins" — it was "client wins INVISIBLY". This module keeps the
 * exact win-order byte-for-byte and adds the missing part: a human-readable
 * `overrides[]` naming every place a control genuinely contradicted the text.
 * The `constraints` SSE event carries it (additive optional field — old apps'
 * non-strict zod strips it) and the explain facts consume it, so the
 * narration physically cannot claim a treatment that was overridden away.
 *
 * PURE function — no I/O, no flags; plan.ts is the only caller. Wording obeys
 * Hard rule D (character/engagement framing, never speed).
 */

import type {
  CharacterTag,
  LocationConstraint,
  ParsedConstraints,
  Preset,
  StopRequest,
  Weights,
} from '@shared/types';

export interface ClientOverrideInputs {
  shape: ParsedConstraints['shape'] | undefined;
  preset: Preset | undefined;
  weights: Weights | undefined;
  stopOverrides: StopRequest[] | null;
  avoidOverrides: Partial<ParsedConstraints['avoid']> | undefined;
  characterOverrides: readonly CharacterTag[] | undefined;
  twistinessOverride: number | null | undefined;
  locationOverrides: LocationConstraint[] | null;
  durationTargetOverride: number | undefined;
}

export interface ClientOverrideResult {
  constraints: ParsedConstraints;
  /** Disclosed contradictions: control values that replaced a DIFFERENT
   *  text-parsed value. Empty when text and controls agree (the common case —
   *  no noise for requests where nothing was contradicted). */
  overrides: string[];
}

export function applyClientOverrides(
  parsed: ParsedConstraints,
  o: ClientOverrideInputs,
): ClientOverrideResult {
  let constraints = parsed;
  const overrides: string[] = [];

  if (o.shape) {
    if (parsed.shape !== o.shape) {
      overrides.push(`shape: the ${o.shape} control replaced the text's ${parsed.shape}`);
    }
    constraints = { ...constraints, shape: o.shape };
  }
  // preset override (M7-T03): the planner resolves it via weightsForPreset at
  // run.ts; explicit client weights still win key-by-key (mergeWeights).
  if (o.preset) {
    if (parsed.preset !== null && parsed.preset !== o.preset) {
      overrides.push(
        `road character: the ${o.preset} chip replaced the text's ${parsed.preset} ask`,
      );
    }
    constraints = { ...constraints, preset: o.preset };
  }
  if (o.weights) constraints = { ...constraints, weights: o.weights };
  // stops — per-TYPE override: a builder row replaces the brief's ask for that
  // type (no accidental doubling when both name coffee); brief-only types ride
  // along. Composition, not contradiction — no disclosure.
  if (o.stopOverrides !== null) {
    const overrideTypes = new Set(o.stopOverrides.map((s) => s.type));
    constraints = {
      ...constraints,
      stops: [...o.stopOverrides, ...constraints.stops.filter((s) => !overrideTypes.has(s.type))],
    };
  }
  // avoid — only the keys the client sent override (a toggle the user never
  // touched must not clear a brief-parsed avoid). Additive — no disclosure.
  if (o.avoidOverrides) {
    constraints = { ...constraints, avoid: { ...constraints.avoid, ...o.avoidOverrides } };
    if (o.avoidOverrides.unpaved === true) {
      constraints = { ...constraints, surface_pref: 'paved' };
    }
  }
  // character — union (the Scenery toggle adds 'scenic' without clobbering
  // brief-derived tags). Additive — no disclosure.
  if (o.characterOverrides && o.characterOverrides.length > 0) {
    constraints = {
      ...constraints,
      character: [...new Set([...constraints.character, ...o.characterOverrides])],
    };
  }
  if (o.twistinessOverride !== undefined) {
    if (parsed.twistiness_pref !== null && parsed.twistiness_pref !== o.twistinessOverride) {
      overrides.push(
        `twistiness: the control (${o.twistinessOverride ?? 'no preference'}) replaced the text's ${parsed.twistiness_pref}`,
      );
    }
    constraints = { ...constraints, twistiness_pref: o.twistinessOverride };
  }
  // R23 discovery tap: the structured 'through' pin REPLACES parsed location
  // constraints (the tap knows the exact road + near_point).
  if (o.locationOverrides !== null) {
    if (
      parsed.location_constraints.length > 0 &&
      JSON.stringify(parsed.location_constraints) !== JSON.stringify(o.locationOverrides)
    ) {
      overrides.push(
        `places: the pinned point replaced ${parsed.location_constraints.length} place mention${
          parsed.location_constraints.length > 1 ? 's' : ''
        } from the text`,
      );
    }
    constraints = { ...constraints, location_constraints: o.locationOverrides };
  }
  if (o.durationTargetOverride !== undefined) {
    if (
      parsed.duration_target_s !== null &&
      parsed.duration_target_s !== o.durationTargetOverride
    ) {
      overrides.push(
        `time: the ${Math.round(o.durationTargetOverride / 60)} min control replaced the text's ${Math.round(
          parsed.duration_target_s / 60,
        )} min`,
      );
    }
    constraints = { ...constraints, duration_target_s: o.durationTargetOverride };
  }

  return { constraints, overrides };
}
