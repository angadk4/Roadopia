/**
 * Tiny deterministic gazetteer for the rules parser (M3-T02; Protocol §18-A).
 *
 * IN_REGION: places inside the WGH/Niagara corridor (data/regions/wgh-niagara.poly),
 * resolved to coordinates at parse time — no geocoding call needed for the common
 * cases. OUT_OF_REGION: well-known nearby-but-outside places that should trip the
 * friendly redirect (§3.5 rule 3) deterministically. Anything unrecognized stays a
 * place-name string for the geocoding step (M6) — never guessed.
 */

export interface GazetteerHit {
  name: string;
  lat: number;
  lng: number;
}

const IN_REGION: Record<string, GazetteerHit> = {
  hamilton: { name: 'Hamilton', lat: 43.2557, lng: -79.8711 },
  dundas: { name: 'Dundas', lat: 43.2647, lng: -79.954 },
  ancaster: { name: 'Ancaster', lat: 43.218, lng: -79.987 },
  waterdown: { name: 'Waterdown', lat: 43.3316, lng: -79.8918 },
  burlington: { name: 'Burlington', lat: 43.3255, lng: -79.799 },
  milton: { name: 'Milton', lat: 43.5083, lng: -79.8774 },
  grimsby: { name: 'Grimsby', lat: 43.2, lng: -79.562 },
  smithville: { name: 'Smithville', lat: 43.0965, lng: -79.5482 },
  'st. catharines': { name: 'St. Catharines', lat: 43.1594, lng: -79.2469 },
  'st catharines': { name: 'St. Catharines', lat: 43.1594, lng: -79.2469 },
  thorold: { name: 'Thorold', lat: 43.1167, lng: -79.2 },
  'niagara falls': { name: 'Niagara Falls', lat: 43.0896, lng: -79.0849 },
  'niagara-on-the-lake': { name: 'Niagara-on-the-Lake', lat: 43.2553, lng: -79.0715 },
  'niagara on the lake': { name: 'Niagara-on-the-Lake', lat: 43.2553, lng: -79.0715 },
  welland: { name: 'Welland', lat: 42.9922, lng: -79.2482 },
  'port colborne': { name: 'Port Colborne', lat: 42.8866, lng: -79.2515 },
  'fort erie': { name: 'Fort Erie', lat: 42.904, lng: -78.928 },
  pelham: { name: 'Pelham', lat: 43.0332, lng: -79.3323 },
  fonthill: { name: 'Fonthill', lat: 43.0387, lng: -79.2843 },
  caledonia: { name: 'Caledonia', lat: 43.0731, lng: -79.9527 },
  brantford: { name: 'Brantford', lat: 43.1394, lng: -80.2644 },
  kilbride: { name: 'Kilbride', lat: 43.426, lng: -79.972 },
};

/** Famous nearby-but-OUTSIDE places → deterministic out-of-region redirect. */
const OUT_OF_REGION = new Set([
  'toronto',
  'mississauga',
  'oakville',
  'brampton',
  'guelph',
  'kitchener',
  'waterloo',
  'cambridge',
  'london',
  'ottawa',
  'montreal',
  'buffalo',
  'new york',
  'detroit',
  'windsor',
  'barrie',
  'oshawa',
]);

export function lookupInRegion(name: string): GazetteerHit | null {
  return IN_REGION[name.toLowerCase().trim()] ?? null;
}

export function isKnownOutOfRegion(name: string): boolean {
  return OUT_OF_REGION.has(name.toLowerCase().trim());
}
