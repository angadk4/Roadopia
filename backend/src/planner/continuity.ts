/**
 * R33-U6 — ROAD CONTINUITY (Recovery §13.5): how long the driver stays on a
 * coherent named road before being hopped to another one.
 *
 * The recovery review's point: a great driving road is not just curvy — it is
 * SUSTAINED. Short disconnected curvy fragments with constant name-hopping
 * feel like navigation, not driving. This metric feeds the R33 profile
 * bake-off (distance-only `shortest` is expected to score badly here — it
 * happily hops roads to save metres), the ranking, and a new audit column.
 *
 * Input is the engine's own `street_names` per maneuver (never parsed from
 * instruction prose). A "run" = consecutive driven metres whose maneuver
 * street name is unchanged; unnamed stretches (no street_names) EXTEND the
 * current run rather than break it (rural roads drop names at boundaries —
 * measured; breaking on blanks over-counts hops ~2×).
 */
import type { Maneuver } from '@shared/types';

export interface ContinuityMetrics {
  /** Mean named-run length, metres (higher = more sustained driving). */
  meanRunM: number;
  /** The single longest named run, metres. */
  maxRunM: number;
  /** Name CHANGES per 10 minutes of driving (lower = calmer). */
  nameHopsPer10min: number;
  /** Distinct road names across the route (diversity, informational). */
  distinctNames: number;
}

function primaryName(m: Maneuver): string | null {
  const n = m.street_names?.[0]?.trim();
  return n !== undefined && n !== '' ? n.toLowerCase() : null;
}

export function continuityOf(
  maneuvers: readonly Maneuver[],
  durationS: number,
): ContinuityMetrics | null {
  const named = maneuvers.filter((m) => (m.distance_m ?? 0) > 0);
  if (named.length === 0 || durationS <= 0) return null;

  const runs: number[] = [];
  const names = new Set<string>();
  let currentName: string | null = null;
  let currentRunM = 0;
  let hops = 0;

  for (const m of named) {
    const name = primaryName(m);
    const dist = m.distance_m ?? 0;
    if (name !== null) names.add(name);
    if (name === null || name === currentName) {
      // unnamed stretches extend the run (see header) — as does the same road
      currentRunM += dist;
    } else {
      if (currentName !== null) {
        runs.push(currentRunM);
        hops++;
      }
      currentName = name;
      currentRunM = dist;
    }
    if (currentName === null && name === null) currentRunM += 0; // leading unnamed: no run yet
    if (currentName === null && name !== null) currentName = name;
  }
  if (currentRunM > 0 && currentName !== null) runs.push(currentRunM);
  if (runs.length === 0) return null;

  const total = runs.reduce((a, b) => a + b, 0);
  return {
    meanRunM: Math.round(total / runs.length),
    maxRunM: Math.round(Math.max(...runs)),
    nameHopsPer10min: +(hops / (durationS / 600)).toFixed(2),
    distinctNames: names.size,
  };
}
