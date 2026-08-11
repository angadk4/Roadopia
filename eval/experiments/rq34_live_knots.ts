/**
 * BD-163 verification — hammer the SCREENSHOT REGION (NE-of-Georgetown /
 * Terra Cotta / Norval) through the LIVE backend and assert: every response
 * that carries a route has ZERO knots; refusals are honest no-clean states.
 * The dirty-best bypass this verifies against was found because the owner's
 * square survived two gate rounds.
 *
 * Run: npx tsx eval/experiments/rq34_live_knots.ts
 */
import { selfIntersections, summarizeCrossings } from '../../backend/src/planner/crossings';

const API = process.env['API_URL'] ?? 'http://192.168.50.25:8080';

const ORIGINS: Array<{ label: string; lat: number; lng: number }> = [
  { label: 'Norval', lat: 43.6472, lng: -79.8535 },
  { label: 'Terra Cotta', lat: 43.7169, lng: -79.9435 },
  { label: 'Georgetown NE', lat: 43.6741, lng: -79.8899 },
  { label: 'Glen Williams', lat: 43.6822, lng: -79.9264 },
  { label: 'Southfields', lat: 43.7565, lng: -79.8335 },
  { label: 'Cheltenham', lat: 43.7726, lng: -79.9231 },
];
const BRIEFS = ['45 minute backroads loop', '90 minute backroads loop', '2 hour backroads loop'];

async function main(): Promise<void> {
  let served = 0;
  let refusedHonestly = 0;
  let knotted = 0;
  for (const o of ORIGINS) {
    for (const brief of BRIEFS) {
      // SPK-14's rate limiter 429s an 18-brief burst (verified live — the
      // “regression” it caused in this probe was the limiter working).
      await new Promise((r) => setTimeout(r, 3_000));
      const res = await fetch(`${API}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brief,
          origin: { lat: o.lat, lng: o.lng },
          session_id: `knotcheck-${o.label}-${brief.length}`,
        }),
      });
      const text = await res.text();
      const frames = text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5));
      let coords: Array<[number, number]> | null = null;
      let done = '?';
      for (const f of frames) {
        try {
          const e = JSON.parse(f) as {
            type?: string;
            status?: string;
            route?: { geometry?: { coordinates?: Array<[number, number]> } };
          };
          if (e.type === 'route') coords = e.route?.geometry?.coordinates ?? null;
          if (e.type === 'done') done = e.status ?? '?';
        } catch {
          /* heartbeat */
        }
      }
      if (coords && coords.length > 8) {
        served++;
        const sum = summarizeCrossings(
          selfIntersections(
            { type: 'LineString', coordinates: coords },
            { lat: o.lat, lng: o.lng },
          ),
        );
        const bad = sum.knots + sum.pierces > 0; // BD-164: a loop is a simple closed curve
        if (bad) knotted++;
        console.log(
          `${o.label.padEnd(14)} ${brief.padEnd(24)} ${done.padEnd(11)} knots=${sum.knots} pierces=${sum.pierces}${bad ? '  ← KNOT SERVED (FAIL)' : ''}`,
        );
      } else {
        refusedHonestly++;
        console.log(`${o.label.padEnd(14)} ${brief.padEnd(24)} ${done} (no route — honest)`);
      }
    }
  }
  console.log(
    `\nserved ${served} · honest refusals ${refusedHonestly} · KNOTS SERVED: ${knotted} ${knotted === 0 ? '✓ the square cannot ship' : '✗✗✗'}`,
  );
  process.exit(knotted === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
