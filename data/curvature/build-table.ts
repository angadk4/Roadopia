/**
 * SPK-10 — build the `curvy_segments` support table from the exported road network.
 *
 * Reads data/curvature/roads.geojsonl (osmium export; one LineString feature per line),
 * computes curvature for every drive-worthy way, and writes:
 *   • curvy_segments.tsv  — way-level rows (tab-delimited, WKT geometry) for the
 *                           PostGIS loader (load.ts).
 *   • labeled-ways.json   — only ways whose name matches the hand-label set, with a
 *                           centroid, for the ranking report (rank-report.ts).
 * Prints a coverage/size summary so the spike can judge the table footprint.
 *
 * Run: pnpm -C data curvature:build   (after data/curvature/export.sh)
 */

import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeCurvature, DEFAULT_PARAMS, type Tags } from './compute';
import { baseName, LABEL_BASENAME_SET } from './labels';
import { percentile } from './stats';
import type { LonLat } from './geometry';

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT = join(HERE, 'roads.geojsonl');
const TSV_OUT = join(HERE, 'curvy_segments.tsv');
const LABELED_OUT = join(HERE, 'labeled-ways.json');

interface LabeledWay {
  name: string;
  highway: string;
  lengthM: number;
  c2: number;
  c7: number;
  lon: number;
  lat: number;
}

function centroid(coords: readonly LonLat[]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const c of coords) {
    sx += c[0];
    sy += c[1];
  }
  return [sx / coords.length, sy / coords.length];
}

function toWkt(coords: readonly LonLat[]): string {
  return `LINESTRING(${coords.map((c) => `${c[0]} ${c[1]}`).join(',')})`;
}

async function main(): Promise<void> {
  const rl = createInterface({ input: createReadStream(INPUT, 'utf8'), crlfDelay: Infinity });

  const rows: string[] = [];
  const labeled: LabeledWay[] = [];
  let total = 0;
  let scored = 0;
  let skipped = 0;
  const lengths: number[] = [];
  const c7s: number[] = [];

  for await (const raw of rl) {
    // strip any RFC8142 record-separator (0x1e) and skip blanks
    const line = raw.replace(/^\x1e/, '').trim();
    if (!line) continue;
    total++;
    let feat: {
      id?: string | number;
      properties?: Record<string, string>;
      geometry?: { type: string; coordinates: LonLat[] };
    };
    try {
      feat = JSON.parse(line) as typeof feat;
    } catch {
      continue;
    }
    if (!feat.geometry || feat.geometry.type !== 'LineString') continue;
    const coords = feat.geometry.coordinates;
    if (!coords || coords.length < 2) continue;

    const props = feat.properties ?? {};
    const highway = props['highway'];
    if (!highway) continue;
    const name = props['name'] ?? '';
    const tags: Tags = props as Tags;
    const idRaw = feat.id ?? props['@id'] ?? props['id'] ?? `row${total}`;
    const osmId = String(idRaw).replace(/^w/, '');

    const r = computeCurvature(coords, DEFAULT_PARAMS, highway, tags);
    if (r.skipped) {
      skipped++;
      continue;
    }
    scored++;
    lengths.push(r.lengthM);
    c7s.push(r.circumCurvaturePerKm);

    rows.push(
      [
        osmId,
        name.replace(/\t/g, ' '),
        highway,
        r.lengthM.toFixed(1),
        r.headingChangePerKm.toFixed(4),
        r.circumCurvaturePerKm.toFixed(6),
        r.significantTurnsPerKm.toFixed(4),
        toWkt(coords),
      ].join('\t'),
    );

    if (name && LABEL_BASENAME_SET.has(baseName(name))) {
      const [lon, lat] = centroid(coords);
      labeled.push({
        name,
        highway,
        lengthM: r.lengthM,
        c2: r.headingChangePerKm,
        c7: r.circumCurvaturePerKm,
        lon,
        lat,
      });
    }
  }

  await writeFile(TSV_OUT, rows.join('\n') + '\n', 'utf8');
  await writeFile(LABELED_OUT, JSON.stringify(labeled, null, 0), 'utf8');

  // Rough on-disk estimate: bytes of the TSV (geometry dominates; PostGIS is comparable).
  const tsvBytes = Buffer.byteLength(rows.join('\n'), 'utf8');

  console.log('=== SPK-10 build-table summary ===');
  console.log(`features read:        ${total}`);
  console.log(`scored (curvy_segments rows): ${scored}`);
  console.log(`skipped (short/junction/degenerate): ${skipped}`);
  console.log(`labeled-set ways matched:    ${labeled.length}`);
  // reduce, not spread: Math.max(...arr) exceeds the V8 argument limit past
  // ~124k rows (hit at region v5's 133 865 segments)
  const maxOf = (arr: number[]): number => arr.reduce((m, v) => (v > m ? v : m), -Infinity);
  console.log(
    `length m  — p50 ${percentile(lengths, 0.5).toFixed(0)} / p90 ${percentile(lengths, 0.9).toFixed(0)} / max ${maxOf(lengths).toFixed(0)}`,
  );
  console.log(
    `C7 (1/km) — p50 ${percentile(c7s, 0.5).toFixed(2)} / p90 ${percentile(c7s, 0.9).toFixed(2)} / p99 ${percentile(c7s, 0.99).toFixed(2)} / max ${maxOf(c7s).toFixed(2)}`,
  );
  console.log(`TSV size: ${(tsvBytes / 1e6).toFixed(2)} MB (geometry-dominated proxy for table size)`);
  console.log(`wrote ${TSV_OUT}`);
  console.log(`wrote ${LABELED_OUT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
