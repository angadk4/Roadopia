/**
 * R28-2 — seed the LIVE loop planner from measured-clean drive cores.
 *
 * THE ONE FACT THIS EXISTS FOR (docs/R28_plan.md, measured in audit-v14/v15):
 * same corpus, same region, same engine —
 *
 *     live loop planner (the drive portion)   43 % backroad · 44/60 double back
 *     offline drive cores                     86 % backroad ·  1/179 double back
 *
 * The difference is method, not material. Cores are generated in bulk offline
 * and HARD-REJECTED on measured road class, loopiness, turns, hood share and
 * u-turns; the live planner generates ~16 candidates inside a 25 s budget and
 * keeps whatever survives. Five ranking levers and three costing levers have
 * now been built and refused against this gap (BD-39/62/103/123/125 and
 * BD-93/100/123) — selection cannot fix what generation did not produce.
 *
 * SO: stop asking the live planner to invent a good drive in 25 seconds. Give
 * it drives that were already proven good, and let it do the one thing it is
 * genuinely good at — connecting the user's door to them.
 *
 * DESIGN CHOICE THAT MATTERS: cores enter as ordinary WaypointCandidates in the
 * SAME pool as generated ones. They are not a parallel path and they get no
 * privileges — every assembly reject, every score, diversify and the
 * never-empty fallback apply unchanged. A core-seeded loop wins only if it
 * actually measures better. That keeps the blast radius at "one more candidate
 * source" instead of "a second planner", and it means the A/B is honest.
 */
import type { LatLng, LineString } from '@shared/types';

import type { WaypointCandidate } from './candidates';
import type { CoreRowRead } from './discover_cores';

/** R28-2 core seeding. OFF = byte-identical (no candidates added). */
export const CORE_SEED_ON = (process.env['CORE_SEED'] ?? 'off') !== 'off';
/** How many cores to seed per request (each costs one assembly). */
export const CORE_SEED_MAX = Number(process.env['CORE_SEED_MAX'] ?? 4);
/**
 * Spacing for sampling a core's geometry into via points, metres.
 *
 * The vias are what FORCE the route to follow the core rather than merely visit
 * its endpoints — R25's probe 7 measured what happens without dense vias: two
 * far-apart waypoints produced a 3.8x longer route whose connectors rode
 * arterials, which is the failure mode four refused attempts all shared.
 */
export const CORE_VIA_SPACING_M = Number(process.env['CORE_VIA_SPACING_M'] ?? 2_500);
/**
 * What fraction of the ASK a seeded core should occupy.
 *
 * MEASURED CORRECTION to R28-2's first cut, which allowed a core up to 1.15x
 * the ask. Cores are median 60 min, so a 90-minute request admitted 90-minute
 * cores — and then the connectors needed to REACH one pushed the assembled loop
 * to ~120 min, tripping the duration tier (PRESENT_TIER_DUROFF = 100) and
 * burying every core candidate below the generated pool. That is why the first
 * A/B was inert: the cores were seeded, assembled, and then thrown away for
 * being the wrong length, which was my sizing bug, not their quality.
 *
 * audit-v15 measured the real split: getting there 28 % · drive 49 % · home
 * 23 %. So a core should target roughly HALF the ask and leave the rest for the
 * connectors that have to exist.
 */
export const CORE_DURATION_TARGET_FRAC = Number(process.env['CORE_DURATION_FRAC'] ?? 0.55);
/** Hard ceiling — above this no connector allowance can save the duration. */
export const CORE_DURATION_MAX_FRAC = Number(process.env['CORE_DURATION_MAX_FRAC'] ?? 0.75);
/**
 * Valhalla refuses a /route with more than 20 locations ("Exceeded max
 * locations: 20"). Origin + vias + the closing origin must fit under it, so the
 * via list is capped and re-spaced rather than truncated — truncating would
 * drop the core's tail and let Valhalla choose its own way home from the middle
 * of it, which is the 3.8x failure the dense-via design exists to prevent.
 */
export const CORE_VIA_MAX = 17;
/**
 * How far from the door a core may sit, as a fraction of the ask spent getting
 * there. MEASURED: with the 45 km Discover browse radius, a Belfountain request
 * seeded a core 30 km away — a 50-minute core assembled into a 149-MINUTE route
 * that was rejected for `self_overlap 0.63` and `out_and_back 34 405 m`. The
 * stem out to a distant core and back IS the doubling defect the owner reports;
 * Discover gets away with a far core only because it SHOWS the commute as its
 * own leg, which a loop-from-your-door cannot.
 */
export const CORE_REACH_FRAC = Number(process.env['CORE_REACH_FRAC'] ?? 0.2);
/** Straight-line km/h used to turn the reach budget into a radius. */
const REACH_KMH = 55;

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
 * Sample a core's geometry into ordered via points at ~`spacingM`.
 * Always keeps the first and last vertex so the core is entered and left where
 * it was measured, not at an arbitrary interior point.
 */
export function coreVias(geometry: LineString, spacingM = CORE_VIA_SPACING_M): LatLng[] {
  const c = geometry.coordinates as Array<[number, number]>;
  if (c.length < 2) return [];
  let total = 0;
  for (let i = 1; i < c.length; i++) total += hav(c[i - 1]!, c[i]!);
  // Re-space (never truncate) so a long core still fits Valhalla's location cap
  // AND is followed end to end.
  const spacing = Math.max(spacingM, total / Math.max(1, CORE_VIA_MAX - 1));
  const out: LatLng[] = [{ lat: c[0]![1], lng: c[0]![0] }];
  let acc = 0;
  for (let i = 1; i < c.length - 1; i++) {
    acc += hav(c[i - 1]!, c[i]!);
    if (acc >= spacing && out.length < CORE_VIA_MAX - 1) {
      out.push({ lat: c[i]![1], lng: c[i]![0] });
      acc = 0;
    }
  }
  const last = c[c.length - 1]!;
  out.push({ lat: last[1], lng: last[0] });
  return out;
}

/**
 * Turn nearby cores into loop candidates.
 *
 * Ordering is deterministic: cores are ranked by measured backroad share, then
 * curviness, then id — no RNG, no distance-from-origin term (the connector cost
 * is what the assembly measures, and letting distance in here would re-create
 * the capped-distance-penalty mis-ranking BD-91 already found in Discover).
 *
 * A core whose own duration already exceeds the ask is dropped: no connector
 * can make it shorter, so assembling it would spend an engine call to produce a
 * guaranteed duration failure.
 */
export function coreSeedCandidates(
  cores: readonly CoreRowRead[],
  durationTargetS: number | null,
  max = CORE_SEED_MAX,
  origin?: LatLng,
): WaypointCandidate[] {
  // A core you cannot reach cheaply is not a drive, it is a commute with a
  // drive attached — and the stem out and back is itself the doubling defect.
  const reachM =
    origin && durationTargetS !== null && durationTargetS > 0
      ? (durationTargetS * CORE_REACH_FRAC * REACH_KMH * 1000) / 3600
      : Infinity;
  const usable = cores
    .filter((c) => c.kind === 'loop' || c.kind === 'ribbon')
    .filter(
      (c) =>
        origin === undefined ||
        reachM === Infinity ||
        hav([origin.lng, origin.lat], [c.entry.lng, c.entry.lat]) <= reachM,
    )
    .filter(
      (c) =>
        durationTargetS === null ||
        durationTargetS <= 0 ||
        c.duration_s <= durationTargetS * CORE_DURATION_MAX_FRAC,
    )
    .slice()
    .sort((a, b) => {
      // Prefer cores that LEAVE ROOM for connectors: rank on how close the core
      // sits to its target share of the ask, and only then on road class. A
      // gorgeous core that eats the whole budget is worthless — it gets
      // assembled and then discarded for being the wrong length.
      if (durationTargetS !== null && durationTargetS > 0) {
        const want = durationTargetS * CORE_DURATION_TARGET_FRAC;
        const da = Math.abs(a.duration_s - want) / want;
        const db = Math.abs(b.duration_s - want) / want;
        // treat fits within 20 % as equivalent, then let road class decide
        if (Math.abs(da - db) > 0.2) return da - db;
      }
      return (
        b.backroad_share - a.backroad_share || b.curviness - a.curviness || a.id.localeCompare(b.id)
      );
    })
    .slice(0, max);

  return usable.map(
    (c, i): WaypointCandidate => ({
      id: `core-${c.id}`,
      kind: 'loop',
      waypoints: coreVias(c.geom_simplified),
      // Cores are not sector-generated; these fields exist for the generated
      // pool's diversity bookkeeping and must not pretend otherwise. Each core
      // takes its own `sector` so the diversity pass treats them as distinct
      // rather than collapsing them into one.
      sector: i,
      returnSector: null,
      clusterId: null,
      stops: [],
      spans: [],
      // A core's worth is its MEASURED road class, not a cluster mass it never
      // had. Backroad share is the axis the owner's rule is written in.
      clusterWeight: c.backroad_share,
    }),
  );
}
