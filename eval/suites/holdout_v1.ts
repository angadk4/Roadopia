/**
 * R32-U1 — HOLDOUT v1 (FROZEN 2026-08-09; Recovery §4.3).
 *
 * ██ NEVER TUNE AGAINST THIS FILE. ██
 *
 * These fixtures exist for ONE purpose: acceptance judgment of an
 * already-chosen change (final adopt-or-refuse + blind human review). No
 * parameter, threshold, profile, or ranking weight may be selected, adjusted,
 * or "sanity-checked" against holdout results. If a development iteration
 * accidentally consumes it, say so in the decision log and cut a v2 holdout.
 *
 * (The discipline this enforces: R25-era levers were repeatedly tuned and
 * judged on the same fixed suite; BD-141's registered/holdout split is the
 * pattern that finally produced trustworthy adoptions.)
 */
import type { LoopFixture } from './loops_gold_v1';

export const LOOPS_HOLDOUT_V1: LoopFixture[] = [
  {
    id: 'h-bolton',
    label: 'Bolton',
    cls: 'funnel_subdivision',
    at: { lat: 43.8756, lng: -79.7371 },
  },
  {
    id: 'h-creemore',
    label: 'Creemore',
    cls: 'road_rich_curvy',
    at: { lat: 44.3236, lng: -80.1044 },
  },
  { id: 'h-fergus', label: 'Fergus', cls: 'rural', at: { lat: 43.7059, lng: -80.3777 } },
  {
    id: 'h-uxbridge',
    label: 'Uxbridge',
    cls: 'hairpin_terrain',
    at: { lat: 44.1091, lng: -79.1204 },
  },
  {
    id: 'h-dunnville',
    label: 'Dunnville',
    cls: 'lakeshore_flat',
    at: { lat: 42.9057, lng: -79.6167 },
  },
  {
    id: 'h-georgetown',
    label: 'Georgetown',
    cls: 'city_edge',
    at: { lat: 43.6465, lng: -79.9182 },
  },
  {
    id: 'h-shelburne',
    label: 'Shelburne',
    cls: 'sparse_rural',
    at: { lat: 44.0787, lng: -80.2041 },
  },
  { id: 'h-ancaster', label: 'Ancaster', cls: 'near_highway', at: { lat: 43.2178, lng: -79.9873 } },
  {
    id: 'h-port-perry',
    label: 'Port Perry',
    cls: 'measured_core_nearby',
    at: { lat: 44.1053, lng: -78.9448 },
  },
  { id: 'h-newmarket', label: 'Newmarket', cls: 'dense_grid', at: { lat: 44.0592, lng: -79.4613 } },
];

/** A→B holdout corridors (5) — same rule: acceptance only. */
export const ATOB_HOLDOUT_V1: Array<{
  id: string;
  a: { lat: number; lng: number };
  b: { lat: number; lng: number };
  label: string;
}> = [
  {
    id: 'h-ab-1',
    label: 'Georgetown→Elora',
    a: { lat: 43.6465, lng: -79.9182 },
    b: { lat: 43.6833, lng: -80.4333 },
  },
  {
    id: 'h-ab-2',
    label: 'Bolton→Creemore',
    a: { lat: 43.8756, lng: -79.7371 },
    b: { lat: 44.3236, lng: -80.1044 },
  },
  {
    id: 'h-ab-3',
    label: 'Ancaster→Port Dover',
    a: { lat: 43.2178, lng: -79.9873 },
    b: { lat: 42.7834, lng: -80.2033 },
  },
  {
    id: 'h-ab-4',
    label: 'Newmarket→Beaverton',
    a: { lat: 44.0592, lng: -79.4613 },
    b: { lat: 44.4333, lng: -79.15 },
  },
  {
    id: 'h-ab-5',
    label: 'Shelburne→Owen Sound',
    a: { lat: 44.0787, lng: -80.2041 },
    b: { lat: 44.569, lng: -80.9406 },
  },
];
