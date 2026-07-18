import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  normalizeLocationText,
  PIN_REACH_BUDGET_FACTOR,
  resolveLocations,
  slugOf,
  type ResolveContext,
} from './resolve_locations';

/**
 * R18-4 — location-intent resolver on canned DB rows (the live RPC contract is
 * probed separately; these pin precedence, merging, reach honesty, and the
 * unresolved path).
 */

const ORIGIN = { lat: 43.55, lng: -80.25 }; // Guelph-ish
const CTX: ResolveContext = {
  origin: ORIGIN,
  bbox: { west: -81.25, south: 42.55, east: -79.25, north: 44.55 },
  durationS: 5400,
  sizingSpeedKmh: 50,
};

/** Two adjacent pieces of one road + one far same-name piece (must not merge). */
function roadRows(name: string, lat: number, lng: number) {
  const piece = (id: string, lng0: number, lng1: number) => ({
    id,
    osm_way_id: `w${id}`,
    name,
    highway: 'tertiary',
    length_m: 900,
    curviness: 3.2,
    geometry: JSON.stringify({
      type: 'LineString',
      coordinates: [
        [lng0, lat],
        [lng1, lat],
      ],
    }),
  });
  return [
    piece('1', lng, lng + 0.01),
    piece('2', lng + 0.01, lng + 0.02), // endpoint-adjacent → merges with 1
    piece('9', lng + 0.4, lng + 0.41), // same name, 30+ km away → separate run
  ];
}

function dbWith(rows: unknown[]): { db: Client; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({ rows });
  return { db: { query } as unknown as Client, query };
}

describe('resolveLocations (R18-4)', () => {
  it('"through <road>": merges adjacent pieces, pins the longest run, applied', async () => {
    const { db } = dbWith(roadRows('Forks of the Credit Road', 43.6, -80.1));
    const out = await resolveLocations(
      db,
      {
        location_constraints: [{ kind: 'through', text: 'Forks of the Credit' }],
      } as never,
      CTX,
    );
    expect(out).toHaveLength(1);
    const r = out[0]!;
    expect(r.slug).toBe('via_forks_of_the_credit');
    expect(r.applied).toBe(true);
    expect(r.resolution.kind).toBe('road');
    if (r.resolution.kind === 'road') {
      expect(r.resolution.segment.lengthM).toBe(1800); // two pieces merged, far one dropped
      expect(r.resolution.segment.name).toBe('Forks of the Credit Road');
    }
  });

  it('"near <town>": gazetteer wins WITHOUT a road lookup (kind-aware precedence)', async () => {
    const { db, query } = dbWith(roadRows('Belfountain Road', 43.6, -80.1));
    const out = await resolveLocations(
      db,
      { location_constraints: [{ kind: 'near', text: 'Belfountain' }] } as never,
      CTX,
    );
    expect(out[0]!.resolution.kind).toBe('town');
    expect(out[0]!.applied).toBe(true);
    expect(query).not.toHaveBeenCalled(); // town short-circuits the DB
  });

  it('out-of-reach road: honest disclosure, NOT applied (reach check)', async () => {
    // road ~90 km east: out-and-back ≫ 1.3 × 45 min at 50 km/h
    const { db } = dbWith(roadRows('Far Away Road', 43.55, -79.15));
    const out = await resolveLocations(
      db,
      { location_constraints: [{ kind: 'through', text: 'Far Away Road' }] } as never,
      { ...CTX, durationS: 2700 },
    );
    const r = out[0]!;
    expect(r.applied).toBe(false);
    expect(r.disclosure).toMatch(/can't reach it/);
    expect(PIN_REACH_BUDGET_FACTOR).toBe(1.3); // the frozen bar the test encodes
  });

  it('unknown text: honest unresolved disclosure', async () => {
    const { db } = dbWith([]);
    const out = await resolveLocations(
      db,
      { location_constraints: [{ kind: 'near', text: 'Atlantis' }] } as never,
      CTX,
    );
    expect(out[0]!.resolution.kind).toBe('unresolved');
    expect(out[0]!.applied).toBe(false);
    expect(out[0]!.disclosure).toMatch(/couldn't place "Atlantis"/);
  });

  it('normalize + slug are deterministic and article-stripping', () => {
    expect(normalizeLocationText('  the   Forks of the Credit ')).toBe('Forks of the Credit');
    expect(slugOf("St. John's Sideroad 12")).toBe('st_john_s_sideroad_12');
  });
});
