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
  // --- south-central-ontario expansion (owner-directed, BD-19) ---
  georgetown: { name: 'Georgetown', lat: 43.6465, lng: -79.9207 },
  acton: { name: 'Acton', lat: 43.6327, lng: -80.0372 },
  caledon: { name: 'Caledon', lat: 43.8563, lng: -79.9985 },
  'caledon east': { name: 'Caledon East', lat: 43.87, lng: -79.863 },
  erin: { name: 'Erin', lat: 43.777, lng: -80.067 },
  belfountain: { name: 'Belfountain', lat: 43.7926, lng: -80.0117 },
  orangeville: { name: 'Orangeville', lat: 43.9199, lng: -80.0943 },
  hockley: { name: 'Hockley', lat: 43.99, lng: -80.02 },
  bolton: { name: 'Bolton', lat: 43.8828, lng: -79.737 },
  newmarket: { name: 'Newmarket', lat: 44.0592, lng: -79.4613 },
  aurora: { name: 'Aurora', lat: 44.0065, lng: -79.4504 },
  stouffville: { name: 'Stouffville', lat: 43.9706, lng: -79.2441 },
  uxbridge: { name: 'Uxbridge', lat: 44.1089, lng: -79.1204 },
  'port perry': { name: 'Port Perry', lat: 44.1006, lng: -78.943 },
  oshawa: { name: 'Oshawa', lat: 43.8971, lng: -78.8658 },
  whitby: { name: 'Whitby', lat: 43.8975, lng: -78.9429 },
  bowmanville: { name: 'Bowmanville', lat: 43.9126, lng: -78.688 },
  cobourg: { name: 'Cobourg', lat: 43.9593, lng: -78.1677 },
  'port hope': { name: 'Port Hope', lat: 43.9511, lng: -78.2926 },
  peterborough: { name: 'Peterborough', lat: 44.3091, lng: -78.3197 },
  lindsay: { name: 'Lindsay', lat: 44.3568, lng: -78.7422 },
  markham: { name: 'Markham', lat: 43.8561, lng: -79.337 },
  vaughan: { name: 'Vaughan', lat: 43.8361, lng: -79.4983 },
  'richmond hill': { name: 'Richmond Hill', lat: 43.8828, lng: -79.4403 },
  pickering: { name: 'Pickering', lat: 43.8509, lng: -79.0204 },
  toronto: { name: 'Toronto', lat: 43.6532, lng: -79.3832 },
  mississauga: { name: 'Mississauga', lat: 43.589, lng: -79.6441 },
  brampton: { name: 'Brampton', lat: 43.7315, lng: -79.7624 },
  oakville: { name: 'Oakville', lat: 43.4675, lng: -79.6877 },
  guelph: { name: 'Guelph', lat: 43.5448, lng: -80.2482 },
  cambridge: { name: 'Cambridge', lat: 43.3616, lng: -80.3144 },
  barrie: { name: 'Barrie', lat: 44.3894, lng: -79.6903 },
  // --- region v3 additions (owner round 2: K-W in-box, Haldimand, BD-20) ---
  kitchener: { name: 'Kitchener', lat: 43.4516, lng: -80.4925 },
  waterloo: { name: 'Waterloo', lat: 43.4643, lng: -80.5204 },
  cayuga: { name: 'Cayuga', lat: 42.9459, lng: -79.8563 },
  // --- rural / between-cities origins (owner round 3, BD-21) ---
  creemore: { name: 'Creemore', lat: 44.3266, lng: -80.1064 },
  'st. jacobs': { name: 'St. Jacobs', lat: 43.5387, lng: -80.5528 },
  'st jacobs': { name: 'St. Jacobs', lat: 43.5387, lng: -80.5528 },
  // --- region v4: owner coverage circle (BD-22) — Grey/Bruce, Georgian Bay,
  // Simcoe north, Trent Hills east ---
  collingwood: { name: 'Collingwood', lat: 44.5006, lng: -80.2169 },
  'owen sound': { name: 'Owen Sound', lat: 44.569, lng: -80.9406 },
  orillia: { name: 'Orillia', lat: 44.6082, lng: -79.4196 },
  midland: { name: 'Midland', lat: 44.7501, lng: -79.8845 },
  thornbury: { name: 'Thornbury', lat: 44.5626, lng: -80.452 },
  meaford: { name: 'Meaford', lat: 44.6066, lng: -80.5934 },
  'wasaga beach': { name: 'Wasaga Beach', lat: 44.5206, lng: -80.0165 },
  markdale: { name: 'Markdale', lat: 44.317, lng: -80.648 },
  campbellford: { name: 'Campbellford', lat: 44.307, lng: -77.7997 },
  dunnville: { name: 'Dunnville', lat: 42.9034, lng: -79.6162 },
  paris: { name: 'Paris', lat: 43.193, lng: -80.3844 },
  elora: { name: 'Elora', lat: 43.6829, lng: -80.431 },
  fergus: { name: 'Fergus', lat: 43.7054, lng: -80.3777 },
};

/** Famous nearby-but-OUTSIDE places → deterministic out-of-region redirect.
 *  (BD-19: the south-central-ontario expansion moved the GTA/Durham/headwaters
 *  cities INTO the region; only genuinely-outside places remain here.) */
const OUT_OF_REGION = new Set([
  'london',
  'ottawa',
  'kingston',
  'sudbury',
  'stratford',
  'montreal',
  'buffalo',
  'new york',
  'detroit',
  'windsor',
  'niagara falls ny',
]);

export function lookupInRegion(name: string): GazetteerHit | null {
  return IN_REGION[name.toLowerCase().trim()] ?? null;
}

export function isKnownOutOfRegion(name: string): boolean {
  return OUT_OF_REGION.has(name.toLowerCase().trim());
}
