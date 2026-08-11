/**
 * R32-U1 — GOLD LOOP SUITE v1 (FROZEN 2026-08-09; Recovery §4.2).
 *
 * Stratified by ROAD-NETWORK STRUCTURE, not convenience: every origin class
 * that has produced a distinct failure mode (or could) gets fixtures. Each
 * origin is tested at asks 45/60/90/120 min unless noted.
 *
 * ⚠️ FROZEN: coordinates and classes in THIS file may not be edited to make a
 * result look better. Additions go in a v2 file with a decision-log entry.
 * The HOLDOUT lives in `loops_holdout_v1.ts` and is NEVER used for tuning.
 */
import type { LatLng } from '../../shared/src/types';

export interface LoopFixture {
  id: string;
  label: string;
  /** Network-structure class (Recovery §4.2 taxonomy). */
  cls:
    | 'rural'
    | 'suburban'
    | 'funnel_subdivision'
    | 'city_edge'
    | 'dense_grid'
    | 'sparse_rural'
    | 'lakeshore_flat'
    | 'road_rich_curvy'
    | 'single_arterial_escape'
    | 'near_highway'
    | 'parallel_roads'
    | 'hairpin_terrain'
    | 'measured_core_nearby'
    | 'ribbons_only'
    | 'supply_desert';
  at: LatLng;
  /** Minutes; default full ladder. */
  asks?: number[];
  /** Why this fixture exists (owner complaint, probe finding, structure). */
  note?: string;
}

export const LOOPS_GOLD_V1: LoopFixture[] = [
  // --- the owner's own places + historical complaints (rq28/rq30 coords) ---
  {
    id: 'southfields-funnel',
    label: 'Southfields (Mayfield & Kennedy)',
    cls: 'funnel_subdivision',
    at: { lat: 43.7565, lng: -79.8335 },
    note: 'the owner’s home area; subdivision with shared arterial escape — the origin-stem case',
  },
  {
    id: 'inglewood',
    label: 'Inglewood',
    cls: 'road_rich_curvy',
    at: { lat: 43.7986, lng: -79.9364 },
    note: 'R28 device complaint: “random entries/exits, u-turns, many times”',
  },
  {
    id: 'forks-credit',
    label: 'Forks of the Credit',
    cls: 'hairpin_terrain',
    at: { lat: 43.8033, lng: -79.9906 },
    note: 'R28 “random box at the top”; hairpins fool cell overlap',
  },
  {
    id: 'belfountain',
    label: 'Belfountain',
    cls: 'single_arterial_escape',
    at: { lat: 43.7935, lng: -80.0088 },
    note: 'valley origin funnels every road into one approach (measured in Discover retries)',
  },
  // --- structural coverage ---
  {
    id: 'brampton-grid',
    label: 'Brampton (Bramalea)',
    cls: 'dense_grid',
    at: { lat: 43.7315, lng: -79.7624 },
  },
  {
    id: 'mississauga-edge',
    label: 'Mississauga city edge (Meadowvale)',
    cls: 'city_edge',
    at: { lat: 43.5995, lng: -79.7565 },
    note: 'urban exit before any good road; near-highway pull (401/407)',
  },
  {
    id: 'milton-nearhwy',
    label: 'Milton (401 corridor)',
    cls: 'near_highway',
    at: { lat: 43.5183, lng: -79.8774 },
  },
  {
    id: 'caledon-village',
    label: 'Caledon Village',
    cls: 'rural',
    at: { lat: 43.8668, lng: -79.9863 },
  },
  {
    id: 'erin-rural',
    label: 'Erin',
    cls: 'rural',
    at: { lat: 43.7736, lng: -80.0714 },
  },
  {
    id: 'hockley-curvy',
    label: 'Hockley Valley',
    cls: 'road_rich_curvy',
    at: { lat: 44.0378, lng: -79.9089 },
    note: 'the region’s best material — a planner that fails HERE fails everywhere',
  },
  {
    id: 'grand-valley-sparse',
    label: 'Grand Valley',
    cls: 'sparse_rural',
    at: { lat: 43.8977, lng: -80.3153 },
    note: 'long straight concession grid; few distinct rings possible',
  },
  {
    id: 'cobourg-lakeshore',
    label: 'Cobourg',
    cls: 'lakeshore_flat',
    at: { lat: 43.9593, lng: -78.1677 },
    note: 'the measured supply desert (2 cores under two sweep configs)',
  },
  {
    id: 'stcatharines-parallel',
    label: 'St. Catharines',
    cls: 'parallel_roads',
    at: { lat: 43.1594, lng: -79.2469 },
    note: 'QEW + parallel arterials 30–80 m apart — the cell-overlap fooler',
  },
  {
    id: 'oro-medonte-core',
    label: 'Oro-Medonte (Line 3)',
    cls: 'measured_core_nearby',
    at: { lat: 44.5202, lng: -79.5333 },
    note: 'sits on a known stored ring family — exercises the served path directly',
  },
  {
    id: 'hamilton-ribbons',
    label: 'Hamilton mountain brow',
    cls: 'ribbons_only',
    at: { lat: 43.2557, lng: -79.8711 },
    note: 'historically ribbon-rich/loop-poor (3 rings r33 → 11 r34)',
  },
  {
    id: 'keswick-desert',
    label: 'Keswick (Lake Simcoe east grid)',
    cls: 'supply_desert',
    at: { lat: 44.2312, lng: -79.4663 },
    asks: [45, 60, 90],
    note: 'flat shoreline grid; expected honest no-clean territory',
  },
];

export const GOLD_ASK_LADDER_MIN = [45, 60, 90, 120];
