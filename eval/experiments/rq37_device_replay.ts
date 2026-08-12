/**
 * RQ37 — replay the owner's device session THROUGH THE LIVE WIRE and render
 * what he actually saw. His 2026-08-11 pass: Discover browse at home + six
 * rapid /plan asks, verdict "still quite broken, same old mistakes" — while
 * the holdout instruments and his own blind sheet said fine. This probe
 * closes that gap with evidence: every serve at HIS origin, full SSE,
 * geometry captured, gates re-judged, and an SVG sheet for human eyes.
 *
 * Run: npx tsx eval/experiments/rq37_device_replay.ts
 * Writes eval/reports/rq37/device-replay.json + device-replay.html
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { selfIntersections, summarizeCrossings } from '../../backend/src/planner/crossings';
import { corridorDoublingRatio, loopiness } from '../../backend/src/planner/overlap';
import type { LineString } from '../../shared/src/types';

const API = process.env['API_URL'] ?? 'http://192.168.50.25:8080';
const HOME = { lat: 43.7565, lng: -79.8335 }; // his device origin area
const ASKS = [
  '45 minute backroads loop',
  '1 hour backroads loop',
  '90 minute backroads loop',
  '2 hour backroads loop',
  '1 hour twisty loop',
  '60 minute backroads loop',
];

interface Serve {
  brief: string;
  status: string;
  serveLine: string | null;
  disclosures: string[];
  durationMin: number | null;
  coords: Array<[number, number]>;
  knots: number;
  pierces: number;
  loopiness: number | null;
  corridorDoubling: number | null;
}

async function planOnce(brief: string): Promise<Serve> {
  const res = await fetch(`${API}/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      brief,
      origin: HOME,
      session_id: `rq37-${brief.length}-${brief.split(' ')[0]}`,
    }),
  });
  const text = await res.text();
  let status = '?';
  let serveLine: string | null = null;
  const disclosures: string[] = [];
  let coords: Array<[number, number]> = [];
  let durationS: number | null = null;
  for (const l of text.split('\n')) {
    if (!l.startsWith('data:')) continue;
    try {
      const e = JSON.parse(l.slice(5)) as {
        type?: string;
        status?: string;
        detail?: string;
        route?: { geometry?: LineString; duration_s?: number };
        disclosures?: string[];
        result?: { disclosures?: string[] };
      };
      if (e.type === 'done') status = e.status ?? '?';
      const d = e.detail ?? '';
      if (
        d.includes('served') ||
        d.includes('holding') ||
        d.includes('FINAL JUDGE') ||
        d.includes('no candidate')
      ) {
        serveLine = d;
      }
      if (e.type === 'route' && e.route?.geometry) {
        coords = e.route.geometry.coordinates as Array<[number, number]>;
        durationS = e.route.duration_s ?? null;
      }
      if (Array.isArray(e.disclosures)) disclosures.push(...e.disclosures);
      if (Array.isArray(e.result?.disclosures)) disclosures.push(...e.result.disclosures);
    } catch {
      /* heartbeat */
    }
  }
  const geo: LineString = { type: 'LineString', coordinates: coords };
  const xs =
    coords.length > 8 ? summarizeCrossings(selfIntersections(geo, HOME)) : { knots: 0, pierces: 0 };
  return {
    brief,
    status,
    serveLine,
    disclosures: [...new Set(disclosures)],
    durationMin: durationS !== null ? Math.round(durationS / 60) : null,
    coords,
    knots: xs.knots,
    pierces: xs.pierces,
    loopiness: coords.length > 8 ? loopiness(geo) : null,
    corridorDoubling: coords.length > 8 ? corridorDoublingRatio(geo, HOME) : null,
  };
}

function svgOf(coords: Array<[number, number]>, w = 420, h = 330): string {
  if (coords.length < 2)
    return `<svg width="${w}" height="${h}"><text x="20" y="40">no route</text></svg>`;
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const dx = x1 - x0 || 1e-9;
  const dy = y1 - y0 || 1e-9;
  const pad = 14;
  const pts = coords
    .map(
      (c) =>
        `${(pad + ((c[0] - x0) / dx) * (w - 2 * pad)).toFixed(1)},${(h - pad - ((c[1] - y0) / dy) * (h - 2 * pad)).toFixed(1)}`,
    )
    .join(' ');
  const o = `${(pad + ((HOME.lng - x0) / dx) * (w - 2 * pad)).toFixed(1)},${(h - pad - ((HOME.lat - y0) / dy) * (h - 2 * pad)).toFixed(1)}`;
  return `<svg width="${w}" height="${h}" style="background:#fafafa;border:1px solid #ddd"><polyline points="${pts}" fill="none" stroke="#c33" stroke-width="2"/><circle cx="${o.split(',')[0]}" cy="${o.split(',')[1]}" r="5" fill="#06c"/></svg>`;
}

async function main(): Promise<void> {
  const serves: Serve[] = [];
  for (const brief of ASKS) {
    await new Promise((r) => setTimeout(r, 3_000)); // SPK-14 pacing
    const s = await planOnce(brief);
    serves.push(s);
    console.log(
      `${brief.padEnd(28)} ${s.status.padEnd(12)} ${s.durationMin ?? '—'} min · x ${s.knots}/${s.pierces} · loopiness ${s.loopiness?.toFixed(2) ?? '—'} · cd ${s.corridorDoubling?.toFixed(2) ?? '—'}`,
    );
    if (s.serveLine) console.log(`   ${s.serveLine.slice(0, 180)}`);
    for (const d of s.disclosures.slice(0, 3)) console.log(`   » ${d.slice(0, 140)}`);
  }
  mkdirSync('eval/reports/rq37', { recursive: true });
  writeFileSync(
    'eval/reports/rq37/device-replay.json',
    JSON.stringify({ home: HOME, serves }, null, 1),
  );
  const cards = serves
    .map(
      (s) => `<div style="display:inline-block;margin:8px;vertical-align:top;font-family:monospace">
<h3>${s.brief}</h3>${svgOf(s.coords)}
<div>status ${s.status} · ${s.durationMin ?? '—'} min · x ${s.knots}/${s.pierces} · loop ${s.loopiness?.toFixed(2) ?? '—'} · dbl ${s.corridorDoubling?.toFixed(2) ?? '—'}</div>
<div style="max-width:420px;color:#555">${s.disclosures.map((d) => `» ${d}`).join('<br>')}</div>
</div>`,
    )
    .join('\n');
  writeFileSync(
    'eval/reports/rq37/device-replay.html',
    `<html><body><h2>Device replay @ home (${HOME.lat}, ${HOME.lng})</h2>${cards}</body></html>`,
  );
  console.log('wrote eval/reports/rq37/device-replay.{json,html}');
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
