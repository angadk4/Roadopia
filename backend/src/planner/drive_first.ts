/**
 * R29 — DRIVE-FIRST planning (BD-135, owner-approved architecture change).
 *
 * The ask ("90 minutes") now means THE DRIVE. This module picks a measured
 * drive from the offline index whose OWN duration fits the ask, and the
 * planner wraps it with connectors that are sized, shown and judged as what
 * they are — getting there and getting home — instead of being averaged into
 * the product.
 *
 * WHY (BD-134, three audits): the door-to-door planner is stuck at ~34 %
 * backroad (Southfields drive-portion: 22 %) after eleven measured levers,
 * while Discover — same corpus, drive-first by construction — measures 82 %
 * with 0/180 doubling. The unit of the product was wrong, not the tuning.
 *
 * V1 SCOPE, deliberate:
 *   - RIBBONS ONLY. A ribbon's two ends give different-way-home by
 *     construction; a loop core from a door is a lollipop whose stick doubles
 *     (measured: loop cores 1/15 accepted at assembly vs ribbons 12/24).
 *   - The FULL trip still passes every assembly gate (doubling, revisits,
 *     residential, self-overlap). Ribbons pass them naturally — that is the
 *     mechanism, not a hope.
 *   - Fail-open: no fitting reachable ribbon → null, and the caller falls
 *     through to the legacy planner with a disclosure.
 */
import type { LatLng } from '@shared/types';
import type { Client } from 'pg';

import type { WaypointCandidate } from './candidates';
import { coreVias } from './core_seed';
import { DRIVE_CORES_VERSION, readDriveCores, type CoreRowRead } from './discover_cores';

/** R29 master flag. OFF = byte-identical (the path is never consulted). */
export const DRIVE_FIRST_ON = (process.env['DRIVE_FIRST'] ?? 'on') !== 'off'; // BD-142: owner adopted 2026-08-07
/** Index version served — the single source of truth lives in discover_cores. */
export const DRIVE_FIRST_CORES_VERSION = DRIVE_CORES_VERSION;
/** How far the DRIVE may miss the ask, fractionally, before it is not the ask. */
export const DRIVE_FIT_TOLERANCE = Number(process.env['DRIVE_FIT_TOLERANCE'] ?? 0.35);
/** Commute budget: how far away a drive may start, as a fraction of the ask. */
export const DRIVE_REACH_FRAC = Number(process.env['DRIVE_REACH_FRAC'] ?? 0.35);
/** Straight-line km/h used to turn the commute budget into a search radius. */
const REACH_KMH = 55;
/** Ribbon candidates assembled per request (each costs one route call). */
export const DRIVE_FIRST_MAX = Number(process.env['DRIVE_FIRST_MAX'] ?? 4);

export interface DriveFirstPick {
  candidate: WaypointCandidate;
  core: CoreRowRead;
}

function hav(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Rank reachable ribbons by how well THE DRIVE fits the ask, then by measured
 * road class. Deterministic (fit band → backroad → curviness → id).
 *
 * Duration fit is primary because under drive-first the ask IS the drive:
 * a gorgeous 30-minute ribbon is the wrong answer to "2 hours" no matter how
 * it scores — the user asked for two hours of driving, not a taste.
 */
export function pickDriveFirst(
  cores: readonly CoreRowRead[],
  durationTargetS: number | null,
  origin: LatLng,
): DriveFirstPick[] {
  const reachM =
    durationTargetS !== null && durationTargetS > 0
      ? Math.max(8_000, (durationTargetS * DRIVE_REACH_FRAC * REACH_KMH * 1000) / 3600)
      : 25_000;
  const fit = (c: CoreRowRead): number =>
    durationTargetS === null || durationTargetS <= 0
      ? 0
      : Math.abs(c.duration_s - durationTargetS) / durationTargetS;

  return cores
    .filter((c) => c.kind === 'ribbon')
    .filter((c) => hav([origin.lng, origin.lat], [c.entry.lng, c.entry.lat]) <= reachM)
    .filter((c) => fit(c) <= DRIVE_FIT_TOLERANCE)
    .slice()
    .sort((a, b) => {
      const fa = fit(a);
      const fb = fit(b);
      if (Math.abs(fa - fb) > 0.1) return fa - fb; // fit bands, then quality
      return (
        b.backroad_share - a.backroad_share || b.curviness - a.curviness || a.id.localeCompare(b.id)
      );
    })
    .slice(0, DRIVE_FIRST_MAX)
    .map((core, i) => ({
      core,
      candidate: {
        id: `drive-${core.id}`,
        kind: 'loop',
        waypoints: coreVias(core.geom_simplified),
        sector: i,
        returnSector: null,
        clusterId: null,
        stops: [],
        spans: [],
        clusterWeight: core.backroad_share,
      } as WaypointCandidate,
    }));
}

/** Reach-sized index read for the drive-first path (fail-open on DB errors). */
export async function readDriveFirstCores(
  db: Client,
  origin: LatLng,
  durationTargetS: number | null,
): Promise<CoreRowRead[]> {
  const reachM =
    durationTargetS !== null && durationTargetS > 0
      ? Math.max(8_000, (durationTargetS * DRIVE_REACH_FRAC * REACH_KMH * 1000) / 3600)
      : 25_000;
  const half = reachM / 111_320;
  try {
    return await readDriveCores(
      db,
      [origin.lng - half, origin.lat - half, origin.lng + half, origin.lat + half],
      DRIVE_FIRST_CORES_VERSION,
      40,
      'ribbon',
    );
  } catch {
    return []; // the legacy planner must never be hostage to the index
  }
}
