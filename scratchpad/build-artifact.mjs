import { readFileSync, writeFileSync } from 'node:fs';

const root = 'c:/Coding Projects/Roadopia';
const def = JSON.parse(readFileSync(`${root}/scratchpad/audit-v2-default.json`, 'utf8'));
const bak = JSON.parse(readFileSync(`${root}/scratchpad/audit-v2-backroads.json`, 'utf8'));

const KEEP = [
  'label',
  'cluster',
  'lat',
  'lng',
  'status',
  'durationMin',
  'distanceKm',
  'curviness',
  'arterialPct',
  'urbanPct',
  'introMin',
  'countryScore',
  'uturns',
  'selfOverlap',
  'loopiness',
  'corridorDoubling',
  'disclosures',
];

function majority(arr) {
  const c = {};
  for (const x of arr) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}

function slim(route) {
  const out = {};
  for (const k of KEEP) if (route[k] !== undefined) out[k] = route[k];
  const coords = route.coords || [];
  const classes = route.classes || [];
  if (coords.length <= 2) {
    out.coords = coords;
    out.classes = classes;
    return out;
  }
  const step = Math.max(1, Math.ceil(coords.length / 110));
  const keptIdx = [];
  for (let i = 0; i < coords.length; i += step) keptIdx.push(i);
  if (keptIdx[keptIdx.length - 1] !== coords.length - 1) keptIdx.push(coords.length - 1);
  out.coords = keptIdx.map((i) => coords[i]);
  out.classes = [];
  for (let k = 0; k < keptIdx.length - 1; k++) {
    const span = classes.slice(keptIdx[k], Math.max(keptIdx[k] + 1, keptIdx[k + 1]));
    out.classes.push(span.length ? majority(span) : 'O');
  }
  return out;
}

const slimSet = (set) => ({
  anchor: set.anchor,
  brief: set.brief,
  count: set.count,
  routes: set.routes.map(slim),
});
const DATASETS = { default: slimSet(def), backroads: slimSet(bak) };

const readout = `
  <h2>Round 2 — the planner now knows what surrounds the road</h2>
  <p>Your two corrections are now mechanics, not opinions: <strong>(1)</strong> main roads through fields/forest are FINE — they're the teal lines now, and the planner no longer punishes them. <strong>(2)</strong> curvy streets inside neighbourhoods are NOT backroads — we extracted every built-up land-use polygon in the region (subdivisions, industrial, plazas) and measured that <strong>24% of the "curvy roads" near Mayfield were subdivision collectors</strong> wearing a backroad costume. They're now excluded from the planner's road corpus entirely.</p>
  <ul>
    <li><strong>Red now means "actually in town"</strong> — any road with built-up area on both sides or driving inside a subdivision. Teal = country main road (your "good way to connect two nicer roads"). Green = genuine country backroad.</li>
    <li><strong>The planner demotes town-heavy routes</strong> (after forgiving the unavoidable exit from your own town) and <strong>tells the truth about locked-in starts</strong>: routes now disclose "about N min through town before the drive opens up" when your home is deep in the grid.</li>
    <li><strong>What's still true:</strong> deep-grid homes (Mayfield core) can't conjure countryside inside 90 minutes — but the routes now spend those minutes ESCAPING on the fastest clean line instead of wandering town, and they say so honestly.</li>
  </ul>
  <p><strong>Toggle Default ↔ Backroads, click any home for the side-by-side.</strong> Cards are ranked worst-first by real in-town share.</p>
`;

let html = readFileSync(`${root}/scratchpad/mayfield-audit.html`, 'utf8');
html = html.replace('/*__DATA__*/ null', JSON.stringify(DATASETS));
html = html.replace('<!--__READOUT__-->', readout);
if (!html.startsWith('<title>')) html = '<title>Route Audit — Mayfield × Kennedy</title>\n' + html;
writeFileSync(`${root}/scratchpad/mayfield-audit.final.html`, html);
console.log(`wrote mayfield-audit.final.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
console.log(
  `default: ${DATASETS.default.routes.length} routes, backroads: ${DATASETS.backroads.routes.length}`,
);
