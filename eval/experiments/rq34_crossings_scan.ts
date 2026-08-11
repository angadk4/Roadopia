/**
 * BD-161 — offline scan: how common are self-intersections ("the square
 * within the loop") in what we've been serving, and WHICH TIER makes them?
 * Runs the new detector over saved audit artifacts (coords are 5-dp — fine
 * at 60 m resolution).
 *
 * Run: npx tsx eval/experiments/rq34_crossings_scan.ts <artifact.json> [...]
 */
import { readFileSync } from 'node:fs';

import { selfIntersections } from '../../backend/src/planner/crossings';

interface Row {
  kind: string;
  label: string;
  brief?: string;
  servedTier?: string | null;
  coords: Array<[number, number]>;
}

for (const path of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(path, 'utf8')) as { routes: Row[] };
  const rows = d.routes.filter((r) => r.coords && r.coords.length > 8);
  const byTier = new Map<string, { n: number; crossed: number; total: number }>();
  const examples: string[] = [];
  for (const r of rows) {
    const origin = { lat: r.coords[0]![1], lng: r.coords[0]![0] };
    const hits = selfIntersections({ type: 'LineString', coordinates: r.coords }, origin);
    const tier = r.kind === 'atob' ? 'atob' : (r.servedTier ?? 'unknown');
    const t = byTier.get(tier) ?? { n: 0, crossed: 0, total: 0 };
    t.n++;
    if (hits.length > 0) {
      t.crossed++;
      t.total += hits.length;
      if (examples.length < 8) {
        examples.push(`${tier.padEnd(9)} ${r.label} ${r.brief ?? ''} — ${hits.length} crossing(s)`);
      }
    }
    byTier.set(tier, t);
  }
  console.log(`\n=== ${path} ===`);
  for (const [tier, t] of [...byTier.entries()].sort()) {
    console.log(
      `  ${tier.padEnd(9)} ${t.crossed}/${t.n} routes crossed (${t.total} crossings total)`,
    );
  }
  for (const e of examples) console.log(`    e.g. ${e}`);
}
