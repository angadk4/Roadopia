/**
 * R32-U1 — A→B GOLD SUITE v1 (FROZEN 2026-08-09; Recovery §16).
 *
 * 25 corridors: the 10 historical (rq31/audit) + 15 new, stratified by
 * corridor structure — 43 % backroad is not called a ceiling until judged
 * here (Recovery §16.1). Canonical detour denominator: the DIRECT ROUTED
 * distance (U3 invariant), never crow-flies.
 *
 * ⚠️ FROZEN — same rules as loops_gold_v1. Holdout corridors live in
 * holdout_v1.ts and are acceptance-only.
 */
import type { LatLng } from '../../shared/src/types';

export interface AtobFixture {
  id: string;
  label: string;
  cls:
    | 'historical'
    | 'short_local'
    | 'long_cross_region'
    | 'highway_shadow'
    | 'lakeshore'
    | 'curvy_corridor'
    | 'grid_slog'
    | 'escarpment';
  a: LatLng;
  b: LatLng;
}

export const ATOB_GOLD_V1: AtobFixture[] = [
  // --- the historical 10 (rq31 + audit corridors) ---
  {
    id: 'ab-hamilton-guelph',
    label: 'Hamilton→Guelph',
    cls: 'historical',
    a: { lat: 43.2557, lng: -79.8711 },
    b: { lat: 43.5448, lng: -80.2482 },
  },
  {
    id: 'ab-brampton-belfountain',
    label: 'Brampton→Belfountain',
    cls: 'historical',
    a: { lat: 43.7315, lng: -79.7624 },
    b: { lat: 43.7935, lng: -80.0088 },
  },
  {
    id: 'ab-southfields-hockley',
    label: 'Southfields→Hockley',
    cls: 'historical',
    a: { lat: 43.7565, lng: -79.8335 },
    b: { lat: 44.0378, lng: -79.9089 },
  },
  {
    id: 'ab-guelph-erin',
    label: 'Guelph→Erin',
    cls: 'historical',
    a: { lat: 43.5448, lng: -80.2482 },
    b: { lat: 43.7736, lng: -80.0714 },
  },
  {
    id: 'ab-barrie-collingwood',
    label: 'Barrie→Collingwood',
    cls: 'historical',
    a: { lat: 44.3894, lng: -79.6903 },
    b: { lat: 44.5001, lng: -80.2169 },
  },
  {
    id: 'ab-cobourg-uxbridge',
    label: 'Cobourg→Uxbridge',
    cls: 'historical',
    a: { lat: 43.9593, lng: -78.1677 },
    b: { lat: 44.1091, lng: -79.1204 },
  },
  {
    id: 'ab-stratford-woodstock',
    label: 'Stratford→Woodstock',
    cls: 'historical',
    a: { lat: 43.3701, lng: -80.9822 },
    b: { lat: 43.1315, lng: -80.757 },
  },
  {
    id: 'ab-orangeville-creemore',
    label: 'Orangeville→Creemore',
    cls: 'historical',
    a: { lat: 43.9199, lng: -80.0943 },
    b: { lat: 44.3236, lng: -80.1044 },
  },
  {
    id: 'ab-london-grandbend',
    label: 'London→Grand Bend',
    cls: 'historical',
    a: { lat: 42.9849, lng: -81.2453 },
    b: { lat: 43.3167, lng: -81.7539 },
  },
  {
    id: 'ab-owensound-collingwood',
    label: 'Owen Sound→Collingwood',
    cls: 'historical',
    a: { lat: 44.569, lng: -80.9406 },
    b: { lat: 44.5001, lng: -80.2169 },
  },
  // --- 15 new, stratified ---
  {
    id: 'ab-caledon-erin',
    label: 'Caledon Village→Erin',
    cls: 'short_local',
    a: { lat: 43.8668, lng: -79.9863 },
    b: { lat: 43.7736, lng: -80.0714 },
  },
  {
    id: 'ab-inglewood-belfountain',
    label: 'Inglewood→Belfountain',
    cls: 'short_local',
    a: { lat: 43.7986, lng: -79.9364 },
    b: { lat: 43.7935, lng: -80.0088 },
  },
  {
    id: 'ab-milton-cambridge',
    label: 'Milton→Cambridge',
    cls: 'highway_shadow',
    a: { lat: 43.5183, lng: -79.8774 },
    b: { lat: 43.3616, lng: -80.3144 },
  },
  {
    id: 'ab-mississauga-guelph',
    label: 'Mississauga→Guelph',
    cls: 'highway_shadow',
    a: { lat: 43.589, lng: -79.6441 },
    b: { lat: 43.5448, lng: -80.2482 },
  },
  {
    id: 'ab-oakville-stcatharines',
    label: 'Oakville→St. Catharines',
    cls: 'lakeshore',
    a: { lat: 43.4675, lng: -79.6877 },
    b: { lat: 43.1594, lng: -79.2469 },
  },
  {
    id: 'ab-cobourg-picton',
    label: 'Cobourg→Brighton',
    cls: 'lakeshore',
    a: { lat: 43.9593, lng: -78.1677 },
    b: { lat: 44.0412, lng: -77.7523 },
  },
  {
    id: 'ab-orangeville-hockley',
    label: 'Orangeville→Hockley',
    cls: 'curvy_corridor',
    a: { lat: 43.9199, lng: -80.0943 },
    b: { lat: 44.0378, lng: -79.9089 },
  },
  {
    id: 'ab-collingwood-creemore',
    label: 'Collingwood→Creemore',
    cls: 'curvy_corridor',
    a: { lat: 44.5001, lng: -80.2169 },
    b: { lat: 44.3236, lng: -80.1044 },
  },
  {
    id: 'ab-flesherton-durham',
    label: 'Flesherton→Durham',
    cls: 'curvy_corridor',
    a: { lat: 44.2612, lng: -80.5495 },
    b: { lat: 44.1786, lng: -80.8156 },
  },
  {
    id: 'ab-brampton-newmarket',
    label: 'Brampton→Newmarket',
    cls: 'grid_slog',
    a: { lat: 43.7315, lng: -79.7624 },
    b: { lat: 44.0592, lng: -79.4613 },
  },
  {
    id: 'ab-stratford-listowel',
    label: 'Stratford→Listowel',
    cls: 'grid_slog',
    a: { lat: 43.3701, lng: -80.9822 },
    b: { lat: 43.7351, lng: -80.9533 },
  },
  {
    id: 'ab-hamilton-portdover',
    label: 'Hamilton→Port Dover',
    cls: 'escarpment',
    a: { lat: 43.2557, lng: -79.8711 },
    b: { lat: 42.7834, lng: -80.2033 },
  },
  {
    id: 'ab-georgetown-belfountain',
    label: 'Georgetown→Belfountain',
    cls: 'escarpment',
    a: { lat: 43.6465, lng: -79.9182 },
    b: { lat: 43.7935, lng: -80.0088 },
  },
  {
    id: 'ab-peterborough-bancroft',
    label: 'Peterborough→Apsley',
    cls: 'long_cross_region',
    a: { lat: 44.3091, lng: -78.3197 },
    b: { lat: 44.7501, lng: -78.1 },
  },
  {
    id: 'ab-guelph-owensound',
    label: 'Guelph→Owen Sound',
    cls: 'long_cross_region',
    a: { lat: 43.5448, lng: -80.2482 },
    b: { lat: 44.569, lng: -80.9406 },
  },
];
