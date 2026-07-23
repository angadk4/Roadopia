/**
 * "Here's what I understood" — a deterministic, ZERO-LLM echo of the parsed
 * constraints that drove the route (R24-U13, Tier-1). Rendered as a chip row on
 * the Result screen so the buttons-win parse is visible and editable (via the
 * existing RefinePanel). Pure + node-testable; emits no geography (Hard rule A —
 * it only reads back what the deterministic pipeline already decided).
 */

import type { ParsedConstraints, Preset } from '@shared/types';

/** Whole minutes → "~45 min" / "~1 hr" / "~1.5 hr" / "~2 hr". */
function fmtMin(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `~${m} min`;
  const h = m / 60;
  return Number.isInteger(h) ? `~${h} hr` : `~${h.toFixed(1)} hr`;
}

/** Preset → the owner-facing label (Hard rule D: engagement, never speed). */
const PRESET_LABEL: Record<Preset, string> = {
  scenic: 'Scenic',
  twisty: 'Twisty',
  chill: 'Relaxed',
  simple: 'Direct',
  backroads: 'Fun & Explorative',
  coffee_stop: 'Coffee stop',
  avoid_highways: 'No highways',
};

/** Readable chips summarizing what the pipeline understood — places first
 *  (the drive's spine), then time, style, avoids, character. */
export function parseChips(c: ParsedConstraints): string[] {
  const chips: string[] = [];
  // defensive against partially-populated constraints (real ones are validated)
  for (const lc of c.location_constraints ?? []) {
    const verb = lc.kind === 'through' ? 'Through' : lc.kind === 'near' ? 'Near' : 'Avoid';
    chips.push(`${verb} ${lc.text}`);
  }
  if (c.duration_target_s) chips.push(fmtMin(c.duration_target_s));
  if (c.preset) chips.push(PRESET_LABEL[c.preset]);
  if (c.avoid?.highways) chips.push('No highways');
  if (c.avoid?.unpaved) chips.push('Paved only');
  if (c.avoid?.tolls) chips.push('No tolls');
  if (c.avoid?.ferries) chips.push('No ferries');
  for (const ch of c.character ?? []) chips.push(ch.charAt(0).toUpperCase() + ch.slice(1));
  // de-dupe (preset 'avoid_highways' + an avoid.highways flag shouldn't repeat)
  return [...new Set(chips)];
}
