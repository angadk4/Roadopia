/**
 * R18-0 — one-time generator for the committed random-origin suite fixture
 * (eval/datasets/random-briefs-v1.json). Formalizes the 2026-07-16 40-route
 * audit protocol: random gazetteer town + coordinate jitter (~±5 km) × random
 * duration × random character × optional stop. Deterministic (mulberry32,
 * fixed seed) — but determinism of the SUITE comes from the committed fixture
 * file, never from re-running this script. Re-run only to mint a NEW versioned
 * fixture (random-briefs-v2.json …); never overwrite v1.
 *
 * Run: npx tsx experiments/gen_random_briefs.ts   (from eval/)
 */

import { writeFileSync } from 'node:fs';

const SEED = 1337;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A spread of gazetteer towns across the region (subset chosen for coverage:
// dense cities, small towns, lakeshore grids, funnel topologies, rural).
const TOWNS: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Hamilton', lat: 43.2557, lng: -79.8711 },
  { name: 'Waterdown', lat: 43.3316, lng: -79.8918 },
  { name: 'Kilbride', lat: 43.4046, lng: -79.9421 },
  { name: 'Caledon East', lat: 43.8628, lng: -79.8681 },
  { name: 'Belfountain', lat: 43.7926, lng: -80.0117 },
  { name: 'Erin', lat: 43.7817, lng: -80.0673 },
  { name: 'Orangeville', lat: 43.9199, lng: -80.0943 },
  { name: 'Creemore', lat: 44.3252, lng: -80.1062 },
  { name: 'Collingwood', lat: 44.5001, lng: -80.2169 },
  { name: 'Owen Sound', lat: 44.5672, lng: -80.9435 },
  { name: 'Barrie', lat: 44.3894, lng: -79.6903 },
  { name: 'Orillia', lat: 44.6082, lng: -79.4197 },
  { name: 'Uxbridge', lat: 44.1091, lng: -79.1204 },
  { name: 'Port Perry', lat: 44.1006, lng: -78.943 },
  { name: 'Peterborough', lat: 44.3091, lng: -78.3197 },
  { name: 'Cobourg', lat: 43.9593, lng: -78.1677 },
  { name: 'Kitchener', lat: 43.4516, lng: -80.4925 },
  { name: 'St. Jacobs', lat: 43.539, lng: -80.5528 },
  { name: 'Guelph', lat: 43.5448, lng: -80.2482 },
  { name: 'Cambridge', lat: 43.3616, lng: -80.3144 },
  { name: 'Brantford', lat: 43.1394, lng: -80.2644 },
  { name: 'St. Catharines', lat: 43.1594, lng: -79.2469 },
  { name: 'Pelham', lat: 43.0334, lng: -79.332 },
  { name: 'Dunnville', lat: 42.9046, lng: -79.6162 },
  { name: 'London', lat: 42.9849, lng: -81.2453 },
  { name: 'Stratford', lat: 43.3701, lng: -80.9822 },
  { name: 'St. Thomas', lat: 42.7784, lng: -81.1932 },
  { name: 'Port Stanley', lat: 42.6664, lng: -81.2135 },
  { name: 'Goderich', lat: 43.743, lng: -81.7107 },
  { name: 'Grand Bend', lat: 43.3128, lng: -81.7597 },
];

const DURS = [45, 60, 90, 120, 150, 180];
const CHARS = ['', 'twisty ', 'backroads ', 'scenic ', 'simple ', 'rural '];
const STOPS = ['', ' with a coffee stop', ' with a food stop', ' with a fuel stop'];

const rnd = mulberry32(SEED);
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;

const jobs: Array<{ brief: string; origin: { lat: number; lng: number } }> = [];
for (let i = 0; i < 30; i++) {
  const t = pick(TOWNS);
  const origin = {
    lat: Math.round((t.lat + (rnd() - 0.5) * 0.09) * 1e6) / 1e6,
    lng: Math.round((t.lng + (rnd() - 0.5) * 0.09) * 1e6) / 1e6,
  };
  const dur = pick(DURS);
  const ch = pick(CHARS);
  const st = pick(STOPS);
  const nohw = rnd() < 0.25 ? ', no highways' : '';
  jobs.push({ brief: `${dur} minute ${ch}loop from ${t.name}${st}${nohw}`, origin });
}

writeFileSync(
  new URL('../datasets/random-briefs-v1.json', import.meta.url),
  JSON.stringify(jobs, null, 2) + '\n',
  'utf8',
);
console.log(`wrote eval/datasets/random-briefs-v1.json (${jobs.length} briefs, seed ${SEED})`);
