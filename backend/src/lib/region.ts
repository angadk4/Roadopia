/**
 * Region boundary checks (M6-T03; Hard rule K: "coords within the region
 * `.poly`"; M2-T01: no script may hard-code a region or bbox).
 *
 * Parses the Osmosis `.poly` format the data pipeline already uses
 * (name / numbered sections of "lng lat" pairs / END) and answers
 * point-in-region via ray casting — general polygons, not just the current
 * rectangular v5 box, so a future coastline-shaped region needs no code
 * change here.
 */

import { readFileSync } from 'node:fs';

import type { LatLng } from '@shared/types';

export interface RegionBoundary {
  id: string;
  contains(p: LatLng): boolean;
}

type Ring = Array<[number, number]>; // [lng, lat]

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function parsePoly(text: string, id: string): RegionBoundary {
  const lines = text.split(/\r?\n/);
  const rings: Ring[] = [];
  let current: Ring | null = null;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line === 'END') {
      if (current && current.length >= 3) rings.push(current);
      current = null;
      continue;
    }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      (current ??= []).push([parts[0]!, parts[1]!]);
    } else if (current === null) {
      current = []; // section header line (e.g. "1")
    }
  }
  if (rings.length === 0) throw new Error(`region poly '${id}' contains no rings`);
  return {
    id,
    contains: (p: LatLng) => rings.some((ring) => pointInRing(p.lng, p.lat, ring)),
  };
}

export function loadRegionPoly(path: string, id: string): RegionBoundary {
  return parsePoly(readFileSync(path, 'utf8'), id);
}
