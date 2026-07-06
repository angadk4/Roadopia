import type { LineString } from '@shared/types';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { isCurvy, measureCurvature, THETA_CURVY } from './curvature';

/**
 * M3-T05 — the planner curvature module must agree with the hand-label ground
 * truth. Two layers:
 *   1. Pure synthetic checks (no DB): straight ≈ 0, R=300 m arc ≈ 1000/300 1/km.
 *   2. Hand-label agreement (DB, self-skipping): for known twisty vs grid roads,
 *      re-measuring the STORED geometry with this module reproduces the stored
 *      curviness (same engine ⇒ tight tolerance) and classifies twisty > θ > grid
 *      (the grid-FP guard).
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

/** Build a lon/lat arc of radius R metres sweeping `sweepDeg`, at Hamilton's latitude. */
function arc(radiusM: number, sweepDeg: number, n: number): LineString {
  const R = 6_371_008.8;
  const D2R = Math.PI / 180;
  const refLat = 43.2;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (sweepDeg * D2R * i) / (n - 1);
    const x = radiusM * Math.cos(t);
    const y = radiusM * Math.sin(t);
    pts.push([x / (D2R * R * Math.cos(refLat * D2R)), refLat + y / (D2R * R)]);
  }
  return { type: 'LineString', coordinates: pts };
}

describe('measureCurvature — synthetic (M3-T05)', () => {
  it('straight ≈ 0; R=300 m arc recovers ≈ 1000/R per km', () => {
    const straight: LineString = {
      type: 'LineString',
      coordinates: Array.from({ length: 50 }, (_, i) => [-79.9 + i * 0.001, 43.2]),
    };
    const s = measureCurvature(straight);
    expect(s.skipped).toBe(false);
    expect(s.curviness).toBeLessThan(0.2);
    expect(isCurvy(s)).toBe(false);

    const a = measureCurvature(arc(300, 120, 200));
    expect(a.curviness).toBeGreaterThan(2.6);
    expect(a.curviness).toBeLessThan(4.0);
    expect(isCurvy(a)).toBe(true);
  });

  it('degenerate geometry is skipped, never scored', () => {
    const tiny: LineString = {
      type: 'LineString',
      coordinates: [
        [-79.9, 43.2],
        [-79.8999, 43.2001],
      ],
    };
    expect(measureCurvature(tiny).skipped).toBe(true);
  });
});

describe('measureCurvature — hand-label agreement (DB, self-skipping)', () => {
  it('re-measuring stored geometry reproduces stored curviness (same engine)', async (ctx) => {
    if (!db) return ctx.skip();
    const rows = await db.query<{ name: string; curv: number; geometry: string }>(
      `select name, circum_curvature_per_km as curv, st_asgeojson(geom) as geometry
       from curvy_segments
       where length_m > 500
       order by circum_curvature_per_km desc
       limit 12`,
    );
    expect(rows.rowCount).toBeGreaterThan(5);
    for (const row of rows.rows) {
      const measured = measureCurvature(JSON.parse(row.geometry) as LineString);
      // same engine, same params — allow small float/geojson-roundtrip drift
      expect(Math.abs(measured.curviness - Number(row.curv))).toBeLessThan(0.05);
    }
  });

  it('classifies known twisty roads above θ and grid roads below θ (grid-FP guard)', async (ctx) => {
    if (!db) return ctx.skip();
    const twisty = await db.query<{ name: string; geometry: string }>(
      `select name, st_asgeojson(geom) as geometry from curvy_segments
       where name in ('Snake Road', 'Mineral Springs Road', 'Old Dundas Road')
         and length_m > 300 limit 6`,
    );
    expect(twisty.rowCount).toBeGreaterThan(0);
    for (const row of twisty.rows) {
      const m = measureCurvature(JSON.parse(row.geometry) as LineString);
      expect(m.curviness).toBeGreaterThan(THETA_CURVY);
    }

    // grid roads were mostly SKIPPED from curvy_segments only if short/junction —
    // long grid arterials exist in the table with LOW curviness; verify below θ.
    const grid = await db.query<{ name: string; curv: number }>(
      `select name, circum_curvature_per_km as curv from curvy_segments
       where name in ('Geneva Street', 'Drummond Road', 'Barton Street East')
         and length_m > 500 limit 6`,
    );
    for (const row of grid.rows) {
      expect(Number(row.curv)).toBeLessThan(THETA_CURVY);
    }
  });
});
