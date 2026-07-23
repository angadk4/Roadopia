import { z } from 'zod';

import { LatLngSchema, LineStringSchema } from './route';
import { RouteThroughOutputSchema } from './tools';

/**
 * "Great Drives Near You" — the /discover contract, shared app↔backend so the
 * two can't drift. The backend ranks the region's best driving roads reachable
 * from an origin (blending the auto-ranked corpus with the hand-picked classics)
 * and returns a small CURATED menu of OUT-AND-BACK drives (R24). Every drive is
 * pre-built (`route`) so a tap opens the result instantly with a REAL measured
 * total; a drive whose pre-build failed carries the corpus estimate and the app
 * rebuilds it on tap.
 *
 * Determinism + honesty: every field is derived from the deterministic corpus +
 * REAL Valhalla drive-times (Hard rule A — no LLM geography; the reach/traverse
 * numbers are measured, never invented). No speed/racing framing (Hard rule D):
 * the numbers are logistics (drive-time, length), not velocity.
 */

export const DiscoverRequestSchema = z.object({
  origin: LatLngSchema,
});
export type DiscoverRequest = z.infer<typeof DiscoverRequestSchema>;

export const NearbyDriveSchema = z.object({
  /** Merged whole-road id (mergeRoadPieces). */
  segmentId: z.string().min(1),
  /** OSM road name — the menu label + the 'through' pin text (never ''). */
  name: z.string().min(1),
  /** Nearer traversal endpoint (min drive-time) — the tap's near_point hint. */
  entry: LatLngSchema,
  /** The far traversal endpoint. */
  exit: LatLngSchema,
  /** Length-weighted-mean circum curvature per km. */
  curviness: z.number(),
  length_m: z.number().nonnegative(),
  /** Highway class (tertiary / unclassified / secondary …). */
  class: z.string(),
  /** Fraction of the road inside built-up landuse (0 = country). */
  urbanShare: z.number().min(0).max(1),
  /** REAL matrix drive-time from origin to the entry end (s). */
  driveTimeToStartS: z.number().nonnegative(),
  /** REAL matrix drive-distance to the entry end (m). */
  driveTimeToStartM: z.number().nonnegative(),
  /** The road's own traversal time (s) — geometry length / backroad pace. */
  roadTraverseS: z.number().nonnegative(),
  /** Computed loop budget for the tap (s), clamped to the half-day window.
   *  R24: kept as `measuredDurationS ?? estimate` so existing consumers work. */
  suggestedDurationS: z.number().int().nonnegative(),
  /** Menu-rank score (quality × reach discount × proximity tier × classic bonus). */
  score: z.number(),
  /** The drive's road span polyline — the amber line on the map (R24: required,
   *  every drive carries its geometry). */
  geometry: LineStringSchema,

  // --- R24 (U3): curated · pre-built · classic-aware Discover ------------------
  /** Where the drive came from: an auto-ranked corpus road, or a hand-picked
   *  classic seed drive. Optional ⇒ treat absent as 'auto' (pre-R24 valid). */
  source: z.enum(['auto', 'classic']).optional(),
  /** The PRE-BUILT out-and-back route (U6): origin → entry → exit → origin via
   *  routeThrough. Present ⇒ the tap opens Result instantly with REAL geometry;
   *  absent ⇒ the app falls back to building it on tap. */
  route: RouteThroughOutputSchema.optional(),
  /** The route's REAL measured total duration (s), present when `route` is. */
  measuredDurationS: z.number().int().nonnegative().optional(),
  /** Whether the shown time is a measured route total or a corpus estimate.
   *  Optional ⇒ treat absent as 'estimated' (pre-R24 valid). */
  durationSource: z.enum(['measured', 'estimated']).optional(),
  /** The seed `routes` row id when source==='classic' (for provenance/dedup). */
  classicRouteId: z.string().optional(),
});
export type NearbyDrive = z.infer<typeof NearbyDriveSchema>;

export const DiscoverResultSchema = z.object({
  drives: z.array(NearbyDriveSchema),
  /** The reach contour used, minutes (UX / honest disclosure). */
  reachMinutes: z.number(),
  disclosures: z.array(z.string()),
});
export type DiscoverResult = z.infer<typeof DiscoverResultSchema>;
