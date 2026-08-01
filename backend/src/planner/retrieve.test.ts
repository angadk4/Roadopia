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
    // R26-A2: pin the CURVY tier explicitly (countryTier: false). Before this,
    // the θ assertion below passed only because country rows happen to be
    // appended last — an undeclared ordering dependency, not a check.
    const out = await retrieveCandidates(db, scope, { countryTier: false });
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

// --- R26-A2: the country tier ------------------------------------------------

describe('retrieveCandidates — country tier (R26-A2)', () => {
  it('OFF by default: every segment still clears the curvy floor', async (ctx) => {
    if (!db) return ctx.skip();
    const out = await retrieveCandidates(db, scope, { countryTier: false });
    expect(out.segments.every((s) => s.curviness >= 0.6)).toBe(true);
  });

  it('ON: admits country-class material BELOW the curvy floor, and only country class', async (ctx) => {
    if (!db) return ctx.skip();
    const off = await retrieveCandidates(db, scope, { countryTier: false });
    const on = await retrieveCandidates(db, scope, { countryTier: true });
    expect(on.segments.length).toBeGreaterThan(off.segments.length);
    const admitted = on.segments.filter((s) => s.curviness < 0.6);
    expect(admitted.length).toBeGreaterThan(0); // the whole point of the tier
    // every newly-admitted row is a COUNTRY road — never residential/main
    for (const s of admitted) expect(['tertiary', 'unclassified']).toContain(s.highway);
    // the curvy tier is preserved intact, never crowded out
    const offIds = new Set(off.segments.map((s) => s.id));
    const onIds = new Set(on.segments.map((s) => s.id));
    for (const id of offIds) expect(onIds.has(id)).toBe(true);
  });

  it('never re-admits closed rings — the 0013 guarantee holds through BOTH doors', async (ctx) => {
    if (!db) return ctx.skip();
    // the pre-A/B review caught 0017 missing `not st_isclosed`; this is the pin.
    const on = await retrieveCandidates(db, scope, { countryTier: true });
    const closed = on.segments.filter((s) => {
      const c = s.geometry.coordinates as Array<[number, number]>;
      const a = c[0]!;
      const b = c[c.length - 1]!;
      return c.length > 2 && a[0] === b[0] && a[1] === b[1];
    });
    expect(closed).toEqual([]);
  });

  it('is deterministic: identical calls return identical ids in identical order', async (ctx) => {
    if (!db) return ctx.skip();
    const a = await retrieveCandidates(db, scope, { countryTier: true });
    const b = await retrieveCandidates(db, scope, { countryTier: true });
    expect(a.segments.map((s) => s.id)).toEqual(b.segments.map((s) => s.id));
  });
});
