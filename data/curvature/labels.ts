/**
 * Hand-labeled known-roads set for the SPK-10 curvature evaluation (Protocol §12.2).
 *
 * Each entry is a road the curvature metric must rank correctly, with an ordinal
 * twistiness rating the metric is scored against (Spearman ρ) plus a class so we can
 * measure the urban-grid false-positive rate. Roads are in the SPK-08 extract region
 * (Western Golden Horseshoe / Niagara) and disambiguated by a `near` point because
 * many names (Ridge Road, Mountain Road…) recur across municipalities.
 *
 * Ordinal scale:
 *   0 — straight: rural survey-grid concessions + urban street grids (near-zero curvature)
 *   1 — gentle: mostly straight with occasional easy bends
 *   2 — curvy: sustained winding, escarpment-edge / valley roads
 *   3 — very twisty: serpentine / switchback / hairpin roads
 *
 * PROVENANCE & LIMITATION (honest disclosure): these labels are derived from
 * cartographic + geographic knowledge of the Niagara Escarpment and Ontario's township
 * survey grid (concession/​sideroad lines are surveyed dead-straight; downtown cores are
 * rectilinear grids; named escarpment/valley roads wind), NOT from the developer having
 * personally driven each one. They are good enough to validate that the metric ranks
 * twisty-above-grid for SPK-10. The M4 [GATE-C] freeze must re-build this set with
 * verified ground truth before the formula + THETA_CURVY are finalised.
 */

export type Ordinal = 0 | 1 | 2 | 3;
export type RoadClass = 'rural-straight' | 'urban-grid' | 'gentle' | 'curvy' | 'twisty';

export interface CurvatureLabel {
  /** OSM `name` to match (case-insensitive, whitespace-normalised). */
  name: string;
  /** Approx [lon, lat] to disambiguate same-named roads in other municipalities. */
  near: readonly [number, number];
  ordinal: Ordinal;
  klass: RoadClass;
  note: string;
}

export const LABELS: readonly CurvatureLabel[] = [
  // --- 3: very twisty / serpentine / switchback ---
  { name: 'Snake Road', near: [-79.865, 43.305], ordinal: 3, klass: 'twisty', note: 'Aldershot/Burlington — serpentine escarpment road (named for its shape)' },
  { name: 'Sydenham Road', near: [-79.955, 43.272], ordinal: 3, klass: 'twisty', note: 'Dundas — escarpment switchback climb' },
  { name: 'Effingham Street', near: [-79.30, 43.07], ordinal: 3, klass: 'twisty', note: 'Pelham/Short Hills — twisty wooded road' },
  { name: 'Mineral Springs Road', near: [-80.00, 43.235], ordinal: 3, klass: 'twisty', note: 'Ancaster/Dundas valley — winding' },
  { name: 'Old Dundas Road', near: [-79.97, 43.255], ordinal: 3, klass: 'twisty', note: 'Dundas — escarpment descent, tight bends' },

  // --- 2: curvy escarpment-edge / valley ---
  { name: 'Mountain Brow Boulevard', near: [-79.83, 43.235], ordinal: 2, klass: 'curvy', note: 'Hamilton — follows the escarpment edge' },
  { name: 'Ridge Road', near: [-79.69, 43.185], ordinal: 2, klass: 'curvy', note: 'Stoney Creek — winding atop the escarpment' },
  { name: 'DeCew Road', near: [-79.27, 43.12], ordinal: 2, klass: 'curvy', note: 'Thorold/St. Catharines — around the reservoir/escarpment' },
  { name: 'Pelham Road', near: [-79.27, 43.135], ordinal: 2, klass: 'curvy', note: 'St. Catharines — along the escarpment base' },
  { name: 'Lions Club Road', near: [-80.02, 43.225], ordinal: 2, klass: 'curvy', note: 'Ancaster — curving rural road' },
  { name: 'Roland Road', near: [-79.31, 43.055], ordinal: 2, klass: 'curvy', note: 'Pelham/Short Hills — rolling and curvy' },
  { name: 'Brock Road', near: [-80.02, 43.30], ordinal: 2, klass: 'curvy', note: 'Dundas valley (Flamborough) — winding' },

  // --- 1: gentle ---
  { name: 'Niagara Parkway', near: [-79.055, 43.13], ordinal: 1, klass: 'gentle', note: 'follows the Niagara River — long easy curves' },
  { name: 'Creek Road', near: [-79.13, 43.135], ordinal: 1, klass: 'gentle', note: 'Niagara-on-the-Lake — gentle creek-following bends' },
  { name: 'York Road', near: [-79.15, 43.16], ordinal: 1, klass: 'gentle', note: 'Niagara-on-the-Lake — mostly straight, some bends' },
  { name: 'Mountain Road', near: [-79.10, 43.12], ordinal: 1, klass: 'gentle', note: 'Niagara Falls — gentle grade road' },
  { name: 'Glendale Avenue', near: [-79.20, 43.14], ordinal: 1, klass: 'gentle', note: 'St. Catharines — gentle arterial' },

  // --- 0: rural survey-grid concessions (dead straight) ---
  { name: 'Book Road', near: [-79.95, 43.165], ordinal: 0, klass: 'rural-straight', note: 'Ancaster/Glanbrook — survey-grid concession' },
  { name: 'Trinity Church Road', near: [-79.85, 43.135], ordinal: 0, klass: 'rural-straight', note: 'Glanbrook — straight concession' },
  { name: 'White Church Road', near: [-79.87, 43.155], ordinal: 0, klass: 'rural-straight', note: 'Glanbrook — straight concession' },
  { name: 'Westbrook Road', near: [-80.05, 43.32], ordinal: 0, klass: 'rural-straight', note: 'Flamborough — straight concession' },
  { name: 'Twenty Road', near: [-79.85, 43.185], ordinal: 0, klass: 'rural-straight', note: 'Hamilton Mountain — straight grid line' },
  { name: 'Airport Road', near: [-79.92, 43.165], ordinal: 0, klass: 'rural-straight', note: 'Mount Hope — straight' },
  { name: 'Canborough Road', near: [-79.60, 43.00], ordinal: 0, klass: 'rural-straight', note: 'West Lincoln — straight concession' },
  { name: 'Tremaine Road', near: [-79.83, 43.48], ordinal: 0, klass: 'rural-straight', note: 'Milton — straight concession line' },
  { name: 'Guelph Line', near: [-79.88, 43.50], ordinal: 0, klass: 'rural-straight', note: 'Milton (north of escarpment) — straight grid line' },
  { name: 'Walkers Line', near: [-79.83, 43.40], ordinal: 0, klass: 'rural-straight', note: 'Burlington (north grid) — straight' },

  // --- 0: urban street grids ---
  { name: 'King Street East', near: [-79.855, 43.255], ordinal: 0, klass: 'urban-grid', note: 'downtown Hamilton — straight grid' },
  { name: 'Main Street East', near: [-79.855, 43.250], ordinal: 0, klass: 'urban-grid', note: 'downtown Hamilton — straight grid' },
  { name: 'Cannon Street East', near: [-79.845, 43.260], ordinal: 0, klass: 'urban-grid', note: 'Hamilton — straight grid' },
  { name: 'Barton Street East', near: [-79.82, 43.258], ordinal: 0, klass: 'urban-grid', note: 'Hamilton — straight grid' },
  { name: "Lundy's Lane", near: [-79.12, 43.09], ordinal: 0, klass: 'urban-grid', note: 'Niagara Falls — straight arterial' },
  { name: 'Drummond Road', near: [-79.10, 43.10], ordinal: 0, klass: 'urban-grid', note: 'Niagara Falls — straight grid' },
  { name: 'Ontario Street', near: [-79.24, 43.165], ordinal: 0, klass: 'urban-grid', note: 'St. Catharines — straight arterial' },
  { name: 'Geneva Street', near: [-79.23, 43.175], ordinal: 0, klass: 'urban-grid', note: 'St. Catharines — straight grid' },
];

/** Normalise a road name for matching (lowercase, collapse internal whitespace). */
export function normName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Base name = normalised name with a trailing cardinal direction stripped, so a label
 * like "Book Road" matches OSM's "Book Road West" and "King Street East" matches
 * "King Street East". Same-base roads in different municipalities are disambiguated by
 * the `near` proximity check at match time.
 */
export function baseName(name: string): string {
  return normName(name).replace(/ (east|west|north|south)$/, '');
}

/** Set of label base names (for fast filtering during table build). */
export const LABEL_BASENAME_SET: ReadonlySet<string> = new Set(LABELS.map((l) => baseName(l.name)));
