// First-hand evidence for the planner audit: plan loops / A→B / Discover against
// the LOCAL stack from the eval origins + the owner's home, and measure what
// comes back the way a driver would notice it. Writes probe_results_<tag>.json.
//
//   node planner_probe.mjs loops|atob|discover|all [tag]
//
// Rate limits: /plan is 6/min + 30/h per IP and 3/min per session, so requests
// rotate over the three local interfaces and use a fresh session id each.
import fs from 'node:fs';

const MODE = process.argv[2] ?? 'all';
const TAG = process.argv[3] ?? 'before';
const OUT = `eval/experiments/out/probe_results_${TAG}.json`; // run from the repo root
const HOSTS = ['127.0.0.1', '192.168.50.25', '172.19.80.1'];
const VALHALLA = 'http://127.0.0.1:8002';

const ORIGINS = [
  { id: 'home', name: 'Owner home (Milton N)', lat: 43.5312, lng: -79.8827 },
  ...JSON.parse(fs.readFileSync('eval/datasets/origins.json', 'utf8')).map((o) => ({
    id: o.id,
    name: o.name,
    lat: o.lat,
    lng: o.lng,
  })),
];

let hostIdx = 0;
let seq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const host = HOSTS[hostIdx++ % HOSTS.length];
    const res = await fetch(`http://${host}:8080${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-id': `probe-${TAG}-${++seq}` },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? '10');
      await sleep((wait + 1) * 1000);
      continue;
    }
    return { status: res.status, text: await res.text() };
  }
  return { status: 429, text: '' };
}

function parseSse(text) {
  const events = [];
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(6)));
    } catch {}
  }
  return events;
}

// --- geometry measures --------------------------------------------------------
const LAT_M = 111_320;
const toXY = (lng, lat, lat0) => [lng * LAT_M * Math.cos((lat0 * Math.PI) / 180), lat * LAT_M];
function lengthM(coords) {
  let s = 0;
  const lat0 = coords[0]?.[1] ?? 43;
  for (let i = 1; i < coords.length; i++) {
    const a = toXY(coords[i - 1][0], coords[i - 1][1], lat0);
    const b = toXY(coords[i][0], coords[i][1], lat0);
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}
/** Heading-change per km over the polyline (a driver-visible twistiness proxy). */
function bendPerKm(coords) {
  const lat0 = coords[0]?.[1] ?? 43;
  let turn = 0;
  let prev = null;
  for (let i = 1; i < coords.length; i++) {
    const a = toXY(coords[i - 1][0], coords[i - 1][1], lat0);
    const b = toXY(coords[i][0], coords[i][1], lat0);
    const h = Math.atan2(b[0] - a[0], b[1] - a[1]);
    if (prev !== null) {
      let d = Math.abs(h - prev);
      if (d > Math.PI) d = 2 * Math.PI - d;
      turn += d;
    }
    prev = h;
  }
  const km = lengthM(coords) / 1000;
  return km > 0 ? (turn * 180) / Math.PI / km : 0;
}
/** Share of the line that runs within 25 m of an EARLIER, non-adjacent part
 *  of itself — an out-and-back stem or a repeated road (what a driver calls
 *  "we already drove this"). */
function retraceShare(coords) {
  if (coords.length < 3) return 0;
  const lat0 = coords[0][1];
  const pts = coords.map((c) => toXY(c[0], c[1], lat0));
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const cell = 50;
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  let retraced = 0;
  for (let i = 1; i < pts.length; i++) {
    // is vertex i within 25 m of any vertex j with cum[i]-cum[j] > 400 m?
    const [x, y] = pts[i];
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++)
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const bucket = grid.get(key(x + dx * cell, y + dy * cell));
        if (!bucket) continue;
        for (const j of bucket) {
          if (cum[i] - cum[j] < 400) continue;
          if (Math.hypot(pts[j][0] - x, pts[j][1] - y) <= 25) {
            hit = true;
            break;
          }
        }
      }
    if (hit) retraced += cum[i] - cum[i - 1];
    const k = key(x, y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return cum[cum.length - 1] > 0 ? retraced / cum[cum.length - 1] : 0;
}
function maneuverStats(maneuvers) {
  const ms = maneuvers ?? [];
  const uturns = ms.filter((m) => /uturn/.test(m.type)).length;
  const names = ms.map((m) => (m.street_names ?? []).join('/')).filter((n) => n !== '');
  const runs = [];
  for (const n of names) if (runs[runs.length - 1] !== n) runs.push(n);
  const seen = new Map();
  for (const n of runs) seen.set(n, (seen.get(n) ?? 0) + 1);
  const repeatedRoads = [...seen.values()].filter((c) => c > 1).length;
  return { maneuvers: ms.length, uturns, distinctRoads: seen.size, repeatedRoads };
}

// --- modes ----------------------------------------------------------------------
async function plan(body) {
  const t0 = Date.now();
  const { status, text } = await post('/plan', { brief: '', ...body });
  const ms = Date.now() - t0;
  if (status !== 200) return { status, ms, error: text.slice(0, 200) };
  const ev = parseSse(text);
  const route = ev.find((e) => e.type === 'route')?.route ?? null;
  const done = ev.find((e) => e.type === 'done')?.status ?? null;
  const err = ev.find((e) => e.type === 'error')?.message ?? null;
  const steps = ev
    .filter((e) => e.type === 'step' && e.status === 'completed')
    .map((e) => `${e.step}${e.detail ? `(${e.detail})` : ''}`);
  const alternates = ev.filter((e) => e.type === 'alternate').length;
  if (!route) return { status, ms, done, error: err, steps };
  const coords = route.geometry.coordinates;
  return {
    status,
    ms,
    done,
    steps,
    alternates,
    distance_km: +(route.distance_m / 1000).toFixed(1),
    duration_min: Math.round(route.duration_s / 60),
    curviness: route.curviness,
    urban_share: route.urban_share ?? null,
    arterial_share: route.arterial_share ?? null,
    country_score: route.country_score ?? null,
    legs: route.legs
      ? {
          there: route.legs.there_pct,
          drive: route.legs.drive_pct,
          home: route.legs.home_pct,
          driveBackroad: route.legs.drive_backroad_pct,
        }
      : null,
    tags: route.character_tags,
    highway: route.highway_flag,
    stops: (route.stops ?? []).map(
      (s) =>
        `${s.name} (${s.requested_type}${s.arrival_s !== null ? ` ~${Math.round(s.arrival_s / 60)}m` : ''})`,
    ),
    bend_deg_per_km: +bendPerKm(coords).toFixed(0),
    retrace_share: +retraceShare(coords).toFixed(2),
    ...maneuverStats(route.maneuvers),
    firstTurns: (route.maneuvers ?? []).slice(0, 4).map((m) => m.instruction),
    geometry: coords,
  };
}

async function directRoute(a, b) {
  const res = await fetch(`${VALHALLA}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locations: [
        { lat: a.lat, lon: a.lng },
        { lat: b.lat, lon: b.lng },
      ],
      costing: 'auto',
    }),
  });
  const j = await res.json();
  const leg = j.trip?.legs?.[0];
  if (!leg) return null;
  // decode polyline6
  const coords = [];
  let idx = 0,
    lat = 0,
    lng = 0;
  const s = leg.shape;
  while (idx < s.length) {
    let b,
      shift = 0,
      result = 0;
    do {
      b = s.charCodeAt(idx++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = s.charCodeAt(idx++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e6, lat / 1e6]);
  }
  return {
    distance_km: +j.trip.summary.length.toFixed(1),
    duration_min: Math.round(j.trip.summary.time / 60),
    bend_deg_per_km: +bendPerKm(coords).toFixed(0),
  };
}

const results = { tag: TAG, at: new Date().toISOString(), loops: [], atob: [], discover: [] };

if (MODE === 'loops' || MODE === 'all') {
  const cases = [];
  for (const o of ORIGINS) cases.push({ origin: o, preset: 'backroads', duration_target_s: 5400 });
  for (const o of ORIGINS.slice(0, 4)) {
    cases.push({ origin: o, preset: 'backroads', duration_target_s: 2700 });
    cases.push({ origin: o, preset: 'twisty', duration_target_s: 5400 });
    cases.push({ origin: o, preset: 'backroads', duration_target_s: 5400, again: true }); // same ask twice
  }
  cases.push({
    origin: ORIGINS[0],
    preset: 'backroads',
    duration_target_s: 5400,
    stops: [{ type: 'coffee', count: 1, importance: 'required' }],
  });
  for (const c of cases) {
    const r = await plan({
      origin: { lat: c.origin.lat, lng: c.origin.lng },
      shape: 'loop',
      preset: c.preset,
      duration_target_s: c.duration_target_s,
      ...(c.stops ? { stops: c.stops } : {}),
    });
    const row = {
      origin: c.origin.id,
      preset: c.preset,
      target_min: c.duration_target_s / 60,
      again: !!c.again,
      stopsAsked: !!c.stops,
      ...r,
    };
    results.loops.push(row);
    const g = row.geometry;
    delete row.geometry;
    console.log(
      `${row.origin.padEnd(16)} ${c.preset.padEnd(9)} ${String(row.target_min).padStart(3)}m ${c.again ? 'x2' : '  '} → ${r.done ?? r.status} ${String(r.ms).padStart(6)}ms` +
        (r.distance_km !== undefined
          ? ` | ${r.distance_km} km ${r.duration_min} min | curv ${r.curviness?.toFixed(2)} bend ${r.bend_deg_per_km}°/km | urban ${r.urban_share?.toFixed(2)} art ${r.arterial_share?.toFixed(2)} | legs ${r.legs ? `${r.legs.there}/${r.legs.drive}/${r.legs.home} bk${r.legs.driveBackroad ?? '-'}` : '-'} | retrace ${r.retrace_share} uturn ${r.uturns} roads ${r.distinctRoads} rep ${r.repeatedRoads} | ${r.stops.join(', ')} | ${(r.tags ?? []).join(',')}`
          : ` | ${r.error ?? ''} ${(r.steps ?? []).slice(-3).join(' ')}`),
    );
    row.geometry = g;
  }
  // sameness across the repeated asks
  for (const o of ORIGINS.slice(0, 4)) {
    const a = results.loops.find(
      (r) =>
        r.origin === o.id &&
        r.preset === 'backroads' &&
        r.target_min === 90 &&
        !r.again &&
        !r.stopsAsked,
    );
    const b = results.loops.find(
      (r) => r.origin === o.id && r.preset === 'backroads' && r.target_min === 90 && r.again,
    );
    if (a?.geometry && b?.geometry) {
      const same = JSON.stringify(a.geometry) === JSON.stringify(b.geometry);
      console.log(`  same ask twice @${o.id}: ${same ? 'IDENTICAL loop' : 'different loop'}`);
    }
  }
}

if (MODE === 'atob' || MODE === 'all') {
  const pairs = [
    ['home', { lat: 43.683, lng: -80.431, name: 'Elora' }],
    ['org-hamilton', { lat: 44.3266, lng: -80.1064, name: 'Creemore' }],
    ['org-grimsby', { lat: 43.7926, lng: -80.0117, name: 'Belfountain' }],
    ['org-mississauga', { lat: 44.1006, lng: -78.943, name: 'Port Perry' }],
    ['org-newmarket', { lat: 43.99, lng: -80.02, name: 'Hockley' }],
    ['org-hamilton', { lat: 43.2, lng: -79.562, name: 'Grimsby' }],
  ];
  for (const [fromId, to] of pairs) {
    const from = ORIGINS.find((o) => o.id === fromId);
    const direct = await directRoute(from, to);
    const r = await plan({
      origin: { lat: from.lat, lng: from.lng },
      destination: { lat: to.lat, lng: to.lng },
      shape: 'a_to_b',
      preset: 'backroads',
    });
    const row = { from: from.id, to: to.name, direct, ...r };
    results.atob.push(row);
    const g = row.geometry;
    delete row.geometry;
    console.log(
      `${from.id.padEnd(16)} → ${to.name.padEnd(11)} ${r.done ?? r.status} ${String(r.ms).padStart(6)}ms` +
        (r.distance_km !== undefined
          ? ` | planner ${r.distance_km} km ${r.duration_min} min bend ${r.bend_deg_per_km}°/km curv ${r.curviness?.toFixed(2)} urban ${r.urban_share?.toFixed(2)} art ${r.arterial_share?.toFixed(2)} hwy ${r.highway} | direct ${direct?.distance_km} km ${direct?.duration_min} min bend ${direct?.bend_deg_per_km}°/km | ratio ${direct ? (r.duration_min / direct.duration_min).toFixed(2) : '-'}× | ${(r.tags ?? []).join(',')}`
          : ` | ${r.error ?? ''} ${(r.steps ?? []).slice(-3).join(' ')}`),
    );
    row.geometry = g;
  }
}

if (MODE === 'discover' || MODE === 'all') {
  for (const o of ORIGINS) {
    const t0 = Date.now();
    const { status, text } = await post('/discover', { origin: { lat: o.lat, lng: o.lng }, v: 2 });
    const ms = Date.now() - t0;
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    const drives = body?.drives ?? [];
    const row = {
      origin: o.id,
      status,
      ms,
      count: drives.length,
      disclosures: body?.disclosures ?? [],
      drives: drives.slice(0, 6).map((d) => ({
        name: d.name,
        kind: d.kind,
        bar: d.barProfile,
        core_min: Math.round(d.core.duration_s / 60),
        out_min: Math.round(d.connectorOut.duration_s / 60),
        home_min: Math.round(d.connectorHome.duration_s / 60),
        curv: d.core.curviness,
        backroad: d.core.backroadShare,
        sameWayHome: d.sameWayHome,
      })),
    };
    results.discover.push(row);
    console.log(
      `${o.id.padEnd(16)} ${status} ${String(ms).padStart(5)}ms drives=${drives.length} ${row.disclosures.join(' | ')}`,
    );
    for (const d of row.drives)
      console.log(
        `    ${d.kind.padEnd(6)} ${d.bar.padEnd(12)} core ${String(d.core_min).padStart(3)}m there ${String(d.out_min).padStart(3)}m home ${String(d.home_min).padStart(3)}m | curv ${d.curv.toFixed(2)} bk ${d.backroad.toFixed(2)} ${d.sameWayHome ? 'sameWayHome' : ''} | ${d.name}`,
      );
  }
}

fs.writeFileSync(OUT, JSON.stringify(results));
console.log(`\nwrote ${OUT}`);
