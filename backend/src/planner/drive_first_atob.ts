/**
 * R31 (BD-151) — A→B DRIVE-FIRST: route THROUGH a measured ribbon on the way.
 *
 * A→B was the one surface nothing ever moved (33 % backroad through every
 * refused lever — BD-99/111/139). The loop fix (BD-147) points the way: don't
 * blob-search, SERVE measured material. A ribbon is an open arc of measured
 * backroad — exactly the shape an A→B wants along its corridor. So: pick the
 * best ribbon that lies roughly ON THE WAY, route the WHOLE trip as ONE
 * request (A → 'through' samples along the oriented ribbon → B), judge it
 * as driven, fall back to the legacy corridor planner when nothing passes.
 *
 * Judged by the same discipline as trips: fidelity to the measured arc,
 * no spurs/microloops, doubling capped outside the endpoint grace, and the
 * corridor DETOUR CAP the A→B planner has always enforced.
 */
import type { LatLng, LineString, RouteThroughOutput } from '@shared/types';
import type { Client } from 'pg';

import { routeThrough, type AutoCostingOptions } from '../valhalla/route';

import { DETOUR_MAX_DEFAULT } from './atob';
import { DRIVE_CORES_VERSION, readDriveCores, type CoreRowRead } from './discover_cores';
import { ARC_FIDELITY_MIN } from './drive_first_trip';
import { edgeOverlapRatio } from './overlap';
import { TRIP_OAB_ORIGIN_GRACE_M, TRIP_SPUR_GRACE_M, tripShapeMetrics } from './trip_gates';

/**
 * REFUSED TWICE — the verdict is now solid (BD-151 + BD-153, 2026-08-09,
 * both on the audit's 10 corridors through the REAL runPlanner):
 *   · single ribbon: 27.4 % (vanilla fill) / 30.0 % (profile fill) backroad;
 *   · MULTI-RIBBON CHAIN (axis-ordered 1–3 ribbons, greedy orientation,
 *     per-member fidelity, 10/10 served): 41.0 %;
 *   · legacy corridor planner: 43.1 % — bar was +8 pp, best arm measured −2.
 * Chains win where legacy is weak (Cobourg→Uxbridge 29→71 %) and lose where
 * it is strong (Southfields→Hockley 68→53 %), with no live signal to pick
 * per-corridor. The legacy A→B corridor machinery is genuinely competitive;
 * it keeps the surface. Off stays off. (BD-151's clock bug — performance.now
 * t0 vs Date.now deadline — was found and fixed BEFORE either judgment.)
 */
export const ATOB_DRIVE_FIRST_ON = (process.env['ATOB_DRIVE_FIRST'] ?? 'off') !== 'off';
/** Corridor padding around the A→B bbox when reading ribbons (degrees-ish). */
const CORRIDOR_PAD_M = 12_000;
/** Through-point spacing along the CHAIN (≤ 15 samples total across all
 *  ribbons — origin×2 + 15 ≤ the 20-location /route cap, with headroom). */
const RIBBON_SAMPLE_MIN_M = 1_500;
const RIBBON_SAMPLE_MAX_POINTS = 15;
/** Chains of up to this many DISTINCT ribbons are tried (BD-153). */
const CHAIN_MAX_RIBBONS = 3;
/** Combos actually built per request (deterministic order, bounded cost). */
const CHAIN_BUILD_MAX = 4;

export interface AtobDriveFirst {
  /** The chained ribbons in driving order (1–3; U2/BD-153: one ribbon cannot
   *  carry an hour-long corridor — measured 27–30 % vs legacy 43 %). */
  ribbons: CoreRowRead[];
  route: RouteThroughOutput;
  detourRatio: number;
  metrics: {
    /** WORST per-ribbon fidelity — every link must actually be driven. */
    fidelity: number;
    spurs: number;
    microloops: number;
    oabLongestM: number;
  };
}

export interface AtobOutcome {
  trip: AtobDriveFirst | null;
  rejected: Array<{ id: string; failures: string[] }>;
}

function hav(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Evenly-spaced samples along an open line, endpoints included. */
function lineSamples(
  geo: LineString,
  reversed: boolean,
  maxPoints: number = RIBBON_SAMPLE_MAX_POINTS,
): Array<[number, number]> {
  const raw = geo.coordinates as Array<[number, number]>;
  const c = reversed ? [...raw].reverse() : raw;
  const latM = 111_320;
  let total = 0;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1]!;
    const b = c[i]!;
    total += Math.hypot(
      (b[1] - a[1]) * latM,
      (b[0] - a[0]) * latM * Math.cos((a[1] * Math.PI) / 180),
    );
  }
  const spacing = Math.max(RIBBON_SAMPLE_MIN_M, total / Math.max(2, maxPoints));
  const out: Array<[number, number]> = [c[0]!];
  let acc = 0;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1]!;
    const b = c[i]!;
    acc += Math.hypot(
      (b[1] - a[1]) * latM,
      (b[0] - a[0]) * latM * Math.cos((a[1] * Math.PI) / 180),
    );
    if (acc >= spacing) {
      out.push(b);
      acc = 0;
    }
  }
  const last = c[c.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Best measured ribbon ON THE WAY from A to B, served as one routed request.
 * Null (with reasons) when nothing passes — the legacy corridor planner runs.
 */
export async function atobDriveFirst(
  db: Client,
  valhallaUrl: string,
  origin: LatLng,
  destination: LatLng,
  opts: {
    avoidHighways?: boolean;
    deadlineMs?: number;
    /** The REQUEST's profile costing — the stretches between ribbon samples
     *  must ride the same treatment the corridor planner would give them
     *  (measured: vanilla-fastest between samples scored 27 % backroad vs
     *  the legacy corridor's 43 % — the ribbon alone cannot carry an hour). */
    costingOptions?: AutoCostingOptions;
  } = {},
): Promise<AtobOutcome> {
  const none: AtobOutcome = { trip: null, rejected: [] };
  const directM = hav(origin, destination);
  if (directM < 8_000) return none; // too short to detour through anything
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;

  const pad = CORRIDOR_PAD_M / 111_320;
  let rows: CoreRowRead[];
  try {
    rows = await readDriveCores(
      db,
      [
        Math.min(origin.lng, destination.lng) - pad,
        Math.min(origin.lat, destination.lat) - pad,
        Math.max(origin.lng, destination.lng) + pad,
        Math.max(origin.lat, destination.lat) + pad,
      ],
      DRIVE_CORES_VERSION,
      50,
      'ribbon',
    );
  } catch {
    return none;
  }

  // ---- corridor geometry: project ribbon centroids onto the A→B axis so a
  // chain is always driven FORWARD along the corridor (no backtracking).
  const axLat = destination.lat - origin.lat;
  const axLng = (destination.lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180);
  const axLen2 = axLat * axLat + axLng * axLng || 1;
  const along = (p: LatLng): number => {
    const dLat = p.lat - origin.lat;
    const dLng = (p.lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180);
    return (dLat * axLat + dLng * axLng) / axLen2; // 0 at A, 1 at B
  };

  interface Cand {
    row: CoreRowRead;
    /** centroid position along the corridor (0..1). */
    t: number;
    value: number;
  }
  const cands: Cand[] = [];
  for (const r of rows) {
    // single-ribbon feasibility screen (a chain member must at least fit alone)
    const fwd = hav(origin, r.entry) + r.distance_m + hav(r.exit, destination);
    const rev = hav(origin, r.exit) + r.distance_m + hav(r.entry, destination);
    if (Math.min(fwd, rev) / directM > DETOUR_MAX_DEFAULT) continue;
    const mid: LatLng = {
      lat: (r.entry.lat + r.exit.lat) / 2,
      lng: (r.entry.lng + r.exit.lng) / 2,
    };
    cands.push({ row: r, t: along(mid), value: r.backroad_share * r.curviness * r.distance_m });
  }
  cands.sort((a, b) => b.value - a.value || a.row.id.localeCompare(b.row.id));
  // geometric dedup (BD-150): the same physical road is stored many times
  const distinct: Cand[] = [];
  for (const c of cands) {
    const dup = distinct.some(
      (k) => edgeOverlapRatio(c.row.geom_simplified, k.row.geom_simplified) > 0.5,
    );
    if (!dup) distinct.push(c);
    if (distinct.length >= 6) break;
  }

  // ---- enumerate forward-ordered chains (singles, pairs, triples) of the top
  // distinct ribbons; predict each chain's detour with greedy per-ribbon
  // orientation from the previous point; keep those under the standing cap.
  interface Chain {
    members: Cand[]; // corridor order
    reversedFlags: boolean[];
    predRatio: number;
    value: number;
  }
  const predictChain = (members: Cand[]): { predM: number; reversedFlags: boolean[] } => {
    let at: LatLng = origin;
    let acc = 0;
    const flags: boolean[] = [];
    for (const m of members) {
      const viaEntry = hav(at, m.row.entry);
      const viaExit = hav(at, m.row.exit);
      const reversed = viaExit < viaEntry;
      flags.push(reversed);
      acc += Math.min(viaEntry, viaExit) + m.row.distance_m;
      at = reversed ? m.row.entry : m.row.exit;
    }
    acc += hav(at, destination);
    return { predM: acc, reversedFlags: flags };
  };
  const chains: Chain[] = [];
  const idxs = distinct.map((_, i) => i);
  const combos: number[][] = [];
  for (const a of idxs) combos.push([a]);
  for (const a of idxs) for (const b of idxs) if (a < b) combos.push([a, b]);
  if (CHAIN_MAX_RIBBONS >= 3) {
    for (const a of idxs)
      for (const b of idxs) for (const c of idxs) if (a < b && b < c) combos.push([a, b, c]);
  }
  for (const combo of combos) {
    const members = combo.map((k) => distinct[k]!).sort((x, y) => x.t - y.t); // corridor order
    const { predM, reversedFlags } = predictChain(members);
    const predRatio = predM / directM;
    if (predRatio > DETOUR_MAX_DEFAULT) continue;
    chains.push({
      members,
      reversedFlags,
      predRatio,
      value: members.reduce((v, m) => v + m.value, 0),
    });
  }
  // rank: total measured value inside 0.2-wide detour bands, MORE ribbons
  // preferred on ties (coverage of the corridor is the point), then id.
  chains.sort((a, b) => {
    const da = Math.floor(a.predRatio * 5);
    const dbd = Math.floor(b.predRatio * 5);
    if (da !== dbd) return da - dbd;
    return (
      b.value - a.value ||
      b.members.length - a.members.length ||
      a.members[0]!.row.id.localeCompare(b.members[0]!.row.id)
    );
  });

  const costingOptions = {
    ...(opts.costingOptions ?? {}),
    ...(opts.avoidHighways === true ? { exclude_highways: true } : {}),
  };

  const rejected: Array<{ id: string; failures: string[] }> = [];
  for (const chain of chains.slice(0, CHAIN_BUILD_MAX)) {
    const chainId = chain.members.map((m) => m.row.id).join('>');
    if (Date.now() > deadline) {
      rejected.push({ id: chainId, failures: ['time_budget'] });
      continue;
    }
    try {
      // sample budget split across members proportional to length, ≥ 2 each
      const totalLen = chain.members.reduce((v, m) => v + m.row.distance_m, 0);
      const samples: Array<[number, number]> = [];
      for (let k = 0; k < chain.members.length; k++) {
        const m = chain.members[k]!;
        const budget = Math.max(
          2,
          Math.round((RIBBON_SAMPLE_MAX_POINTS * m.row.distance_m) / Math.max(1, totalLen)),
        );
        samples.push(...lineSamples(m.row.geom_simplified, chain.reversedFlags[k]!, budget));
      }
      const route = await routeThrough(valhallaUrl, {
        waypoints: [
          [origin.lng, origin.lat],
          ...samples.slice(0, 18), // hard cap safety under 20 locations
          [destination.lng, destination.lat],
        ],
        costingOptions,
        middleType: 'through',
      });
      const failures: string[] = [];
      const detourRatio = route.distance_m / Math.max(1, directM);
      if (detourRatio > DETOUR_MAX_DEFAULT) failures.push('detour_cap');
      const shape = tripShapeMetrics(route.geometry, origin);
      if (shape.spurs > 0) failures.push('spurs');
      if (shape.microloops > 0) failures.push('microloops');
      if (shape.oabLongestM > 1_200) failures.push('doubling');
      // EVERY ribbon must actually be driven (worst per-member fidelity)
      const fidelity = Math.min(
        ...chain.members.map((m) => edgeOverlapRatio(m.row.geom_simplified, route.geometry)),
      );
      if (fidelity < ARC_FIDELITY_MIN) failures.push('ribbon_deviation');
      if (failures.length > 0) {
        rejected.push({ id: chainId, failures });
        continue;
      }
      return {
        trip: {
          ribbons: chain.members.map((m) => m.row),
          route,
          detourRatio,
          metrics: {
            fidelity,
            spurs: shape.spurs,
            microloops: shape.microloops,
            oabLongestM: shape.oabLongestM,
          },
        },
        rejected,
      };
    } catch {
      rejected.push({ id: chainId, failures: ['build_error'] });
    }
  }
  return { trip: null, rejected };
}

// re-exported for the audit and probes
export { TRIP_OAB_ORIGIN_GRACE_M, TRIP_SPUR_GRACE_M };
