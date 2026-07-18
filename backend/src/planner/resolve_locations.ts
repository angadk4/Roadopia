/**
 * Location-intent resolver (R18-4) — makes "through Forks of the Credit",
 * "near Belfountain" and "avoid downtown Hamilton" REAL.
 *
 * The R18 audit: location_constraints were parsed then consumed by NOTHING.
 * This module resolves each constraint's free text with KIND-AWARE
 * precedence (measured live: "near Rockwood" once matched a far-away
 * "Rockwood Road" over the town and dragged the loop +65 %):
 *   - 'through' → ROADS first (planner_find_segments_by_name, migration 0010:
 *     pg_trgm, SECURITY DEFINER, deterministic exact > similarity >
 *     curviness > id; pieces merged into whole-road spans via chain.ts
 *     mergeRoadPieces — OSM chops "Forks of the Credit Road" into ~9 short
 *     ways), then towns: "through X" is a traversal intent.
 *   - 'near' / 'avoid' → TOWNS first (deterministic gazetteer), then roads:
 *     proximity intents are about PLACES.
 *   - UNRESOLVED — surfaced honestly (validate.ts renders the relaxed row;
 *     nothing is silently ignored).
 *
 * FEASIBILITY PRE-CHECK (loops): a pinned road must be reachable inside the
 * time budget — straight-line out-and-back at the sizing speed ≤ 1.3× the
 * target, else the resolution is disclosed as out of reach ("~48 min out")
 * and NOT pinned (an honest no beats a silently mangled loop).
 *
 * Deterministic throughout: DB order is frozen by the RPC contract; merge
 * ties break by id; no RNG. The LLM never touches this path (Hard rule A).
 */

import type { LatLng, LocationConstraint, ParsedConstraints } from '@shared/types';
import type { Client } from 'pg';

import { plannerFindSegmentsByName } from '../db/planner_reads';

import { mergeRoadPieces } from './chain';
import { lookupInRegion } from './gazetteer';
import type { CandidateSegment } from './retrieve';

/** Similarity floor for accepting a road-name match (below = not that road). */
export const ROAD_NAME_MIN_SIMILARITY = 0.35;
/** Straight-line out-and-back budget multiple beyond which a pin is out of reach. */
export const PIN_REACH_BUDGET_FACTOR = 1.3;
/** Keep-away disc radius for "avoid <place>" (m) — town-scale. */
export const AVOID_DISC_RADIUS_M = 3_000;

export type LocationResolution =
  | {
      kind: 'road';
      /** Whole-road merged segment (traversal span source). */
      segment: CandidateSegment;
    }
  | { kind: 'town'; point: LatLng }
  | { kind: 'unresolved' };

export interface ResolvedLocation {
  constraint: LocationConstraint;
  /** Stable row key: via_<slug> / near_<slug> / avoid_area_<slug> (validate.ts). */
  slug: string;
  resolution: LocationResolution;
  /** Honest note when the resolution cannot shape the route (out of reach …). */
  disclosure: string | null;
  /** True when the intent is actively shaping generation (pin/disc/waypoint). */
  applied: boolean;
}

export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Normalize free text for lookup: trim, collapse spaces, strip leading
 *  articles ("the Forks of the Credit" → "Forks of the Credit" keeps inner
 *  "the"). Road-type suffixes stay — trigram handles "Rd" vs "Road". */
export function normalizeLocationText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/i, '');
}

const distM = (a: LatLng, b: LatLng): number =>
  Math.hypot(
    (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)),
    (a.lat - b.lat) * 111_320,
  );

function centroidOfSegment(seg: CandidateSegment): LatLng {
  const coords = seg.geometry.coordinates;
  const mid = coords[Math.floor(coords.length / 2)]!;
  return { lat: mid[1]!, lng: mid[0]! };
}

export interface ResolveContext {
  origin: LatLng;
  /** Lookup bbox — the scope's outer bounds padded (deg). */
  bbox: { west: number; south: number; east: number; north: number };
  /** Loop time budget (s); null for A→B (no reach check — the corridor is the budget). */
  durationS: number | null;
  sizingSpeedKmh: number;
}

/**
 * Resolve every location constraint. One DB round-trip per distinct road-name
 * candidate (≤ a handful per brief); gazetteer and geometry are local.
 */
export async function resolveLocations(
  db: Client,
  constraints: ParsedConstraints,
  ctx: ResolveContext,
): Promise<ResolvedLocation[]> {
  const out: ResolvedLocation[] = [];
  for (const constraint of constraints.location_constraints) {
    const text = normalizeLocationText(constraint.text);
    const slug = slugOf(text);
    const prefix =
      constraint.kind === 'through' ? 'via' : constraint.kind === 'avoid' ? 'avoid_area' : 'near';
    const rowSlug = `${prefix}_${slug}`;

    const lookupRoad = async (): Promise<CandidateSegment | null> => {
      let road: CandidateSegment | null = null;
      try {
        const rows = await plannerFindSegmentsByName(db, {
          name: text,
          west: ctx.bbox.west,
          south: ctx.bbox.south,
          east: ctx.bbox.east,
          north: ctx.bbox.north,
          minSimilarity: ROAD_NAME_MIN_SIMILARITY,
          limit: 40,
        });
        if (rows.length > 0) {
          const pieces: CandidateSegment[] = rows.map((row) => ({
            id: row.id,
            osmWayId: row.osm_way_id,
            name: row.name,
            highway: row.highway,
            lengthM: Number(row.length_m),
            curviness: Number(row.curviness),
            geometry: JSON.parse(row.geometry) as CandidateSegment['geometry'],
          }));
          // merge the best-matched NAME only (rows are ordered; take the top
          // row's name so "Forks of the Credit Rd" pieces merge as one road and
          // a weaker fuzzy neighbour doesn't pollute the span)
          const topName = pieces[0]!.name;
          const merged = mergeRoadPieces(pieces.filter((p) => p.name === topName));
          // longest merged run IS the road (ties by id via merge determinism)
          road = merged.sort((a, b) => b.lengthM - a.lengthM || a.id.localeCompare(b.id))[0]!;
        }
      } catch {
        road = null; // lookup unavailable — fall through to town/unresolved
      }
      return road;
    };

    // kind-aware precedence: proximity intents ask about PLACES first
    const townHit = lookupInRegion(text);
    const road =
      constraint.kind === 'through'
        ? await lookupRoad()
        : townHit !== null
          ? null // town wins for near/avoid — no road lookup needed
          : await lookupRoad();

    if (road !== null) {
      // feasibility: can a loop of this budget reach the road at all?
      if (constraint.kind !== 'avoid' && ctx.durationS !== null) {
        const outAndBackS =
          (2 * distM(ctx.origin, centroidOfSegment(road))) / ((ctx.sizingSpeedKmh / 3.6) * 1);
        if (outAndBackS > PIN_REACH_BUDGET_FACTOR * ctx.durationS) {
          const oneWayMin = Math.round(outAndBackS / 2 / 60);
          out.push({
            constraint,
            slug: rowSlug,
            resolution: { kind: 'road', segment: road },
            disclosure: `${road.name} is ~${oneWayMin} min away — a ${Math.round(
              ctx.durationS / 60,
            )}-minute drive can't reach it; it didn't shape this route`,
            applied: false,
          });
          continue;
        }
      }
      out.push({
        constraint,
        slug: rowSlug,
        resolution: { kind: 'road', segment: road },
        disclosure: null,
        applied: true,
      });
      continue;
    }

    // --- town / gazetteer -----------------------------------------------------
    const town = townHit ?? lookupInRegion(text);
    if (town !== null) {
      const point: LatLng = { lat: town.lat, lng: town.lng };
      if (constraint.kind !== 'avoid' && ctx.durationS !== null) {
        const outAndBackS = (2 * distM(ctx.origin, point)) / ((ctx.sizingSpeedKmh / 3.6) * 1);
        if (outAndBackS > PIN_REACH_BUDGET_FACTOR * ctx.durationS) {
          const oneWayMin = Math.round(outAndBackS / 2 / 60);
          out.push({
            constraint,
            slug: rowSlug,
            resolution: { kind: 'town', point },
            disclosure: `${text} is ~${oneWayMin} min away — a ${Math.round(
              ctx.durationS / 60,
            )}-minute drive can't reach it; it didn't shape this route`,
            applied: false,
          });
          continue;
        }
      }
      out.push({
        constraint,
        slug: rowSlug,
        resolution: { kind: 'town', point },
        disclosure: null,
        applied: true,
      });
      continue;
    }

    // --- 3. honest unresolved ------------------------------------------------
    out.push({
      constraint,
      slug: rowSlug,
      resolution: { kind: 'unresolved' },
      disclosure: `I couldn't place "${constraint.text}" — it didn't shape this route`,
      applied: false,
    });
  }
  return out;
}
