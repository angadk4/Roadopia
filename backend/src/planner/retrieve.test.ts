import type { LatLng } from '@shared/types';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { retrieveCandidates } from './retrieve';
import type { Scope } from './scope';

/**
 * M3-T04 integration tests — retrieval over the REAL seeded data tier (Supabase
 * local + M2-T06 curvy_segments + M2-T09 spots). Self-skips when the stack is
 * down; `pnpm -C backend test retrieve` locally is the Verify gate.
 */

const DB_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client | null = null;

beforeAll(async () => {
  const candidate = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await candidate.connect();
    db = candidate;
  } catch {
    db = null;
  }
  return async () => {
    await db?.end();
  };
});

/** A ~±0.14° square around Hamilton — a stand-in Ω ring (escarpment inside). */
function hamiltonRing(halfDeg = 0.14): LatLng[] {
  const { lat, lng } = { lat: 43.2557, lng: -79.8711 };
  return [
    { lat: lat - halfDeg, lng: lng - halfDeg },
    { lat: lat - halfDeg, lng: lng + halfDeg },
    { lat: lat + halfDeg, lng: lng + halfDeg },
    { lat: lat + halfDeg, lng: lng - halfDeg },
  ];
}

const scope: Scope = { rings: [hamiltonRing()], tauOutS: 2970, shape: 'loop' };

describe('retrieveCandidates (M3-T04)', () => {
  it('returns curvy segments inside Ω, all ≥ θ, with parsed geometry', async (ctx) => {
    if (!db) return ctx.skip();
    const out = await retrieveCandidates(db, scope);
    expect(out.segments.length).toBeGreaterThan(10);
    for (const s of out.segments.slice(0, 25)) {
      expect(s.curviness).toBeGreaterThanOrEqual(0.6);
      expect(s.geometry.type).toBe('LineString');
      const [lng, lat] = s.geometry.coordinates[0]!;
      expect(lat).toBeGreaterThan(43.2557 - 0.2);
      expect(lat).toBeLessThan(43.2557 + 0.2);
      expect(lng).toBeGreaterThan(-79.8711 - 0.2);
      expect(lng).toBeLessThan(-79.8711 + 0.2);
    }
  });

  it('respects requested stop types (coffee only ⇒ only coffee spots)', async (ctx) => {
    if (!db) return ctx.skip();
    const out = await retrieveCandidates(db, scope, { stopTypes: ['coffee'] });
    expect(out.spots.length).toBeGreaterThan(0);
    expect(out.spots.every((s) => s.type === 'coffee')).toBe(true);
    expect(out.unavailableStopTypes).toEqual([]);
  });

  it("'food' is retrievable since R16-1 (restaurants + fast food seeded)", async (ctx) => {
    if (!db) return ctx.skip();
    const out = await retrieveCandidates(db, scope, { stopTypes: ['food', 'viewpoint'] });
    expect(out.unavailableStopTypes).toEqual([]);
    expect(out.spots.some((s) => s.type === 'food')).toBe(true);
    expect(out.spots.every((s) => s.type === 'food' || s.type === 'viewpoint')).toBe(true);
  });

  it('no stop types requested ⇒ no spot query, empty spots', async (ctx) => {
    if (!db) return ctx.skip();
    const out = await retrieveCandidates(db, scope, { stopTypes: [] });
    expect(out.spots).toEqual([]);
  });

  it('a tighter θ returns a subset (θ monotonicity)', async (ctx) => {
    if (!db) return ctx.skip();
    // lift the per-ring limit so truncation cannot mask the θ effect
    const loose = await retrieveCandidates(db, scope, { thetaCurvy: 0.6, segmentLimit: 10_000 });
    const tight = await retrieveCandidates(db, scope, { thetaCurvy: 2.0, segmentLimit: 10_000 });
    expect(tight.segments.length).toBeLessThan(loose.segments.length);
    const looseIds = new Set(loose.segments.map((s) => s.id));
    expect(tight.segments.every((s) => looseIds.has(s.id))).toBe(true);
  });
});
