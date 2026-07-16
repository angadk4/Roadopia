/**
 * M2-T09 — extract car-spot POIs from the canonical filtered extract.
 *
 * Reads data/pois.geojsonl (osmium point export of region-filtered.osm.pbf —
 * committed script: data/pois_export.sh) and writes data/pois.json rows for the
 * seeder: OSM cafés → 'coffee', fuel → 'fuel', viewpoints → 'viewpoint',
 * restaurants + fast food → 'food' (R16-1 — the Plan screen's food stops).
 * Peaks are left for a later curation pass. Unnamed POIs get a generic name.
 *
 * Run: pnpm -C data pois:extract       (after the osmium point export)
 */

import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT = join(HERE, 'pois.geojsonl');
const OUTPUT = join(HERE, 'pois.json');

interface PoiRow {
  type: 'coffee' | 'fuel' | 'viewpoint' | 'food';
  name: string;
  lon: number;
  lat: number;
}

const GENERIC: Record<PoiRow['type'], string> = {
  coffee: 'Café',
  fuel: 'Fuel station',
  viewpoint: 'Viewpoint',
  food: 'Restaurant',
};

function classify(props: Record<string, string>): PoiRow['type'] | null {
  if (props['amenity'] === 'cafe') return 'coffee';
  if (props['amenity'] === 'fuel') return 'fuel';
  if (props['tourism'] === 'viewpoint') return 'viewpoint';
  // cafe stays 'coffee' — food = sit-down + fast food (R16-1)
  if (props['amenity'] === 'restaurant' || props['amenity'] === 'fast_food') return 'food';
  return null;
}

async function main(): Promise<void> {
  const rl = createInterface({ input: createReadStream(INPUT, 'utf8'), crlfDelay: Infinity });
  const rows: PoiRow[] = [];
  const counts: Record<string, number> = {};

  for await (const raw of rl) {
    const line = raw.replace(/^\x1e/, '').trim();
    if (!line) continue;
    let feat: {
      properties?: Record<string, string>;
      geometry?: { type: string; coordinates: [number, number] };
    };
    try {
      feat = JSON.parse(line) as typeof feat;
    } catch {
      continue;
    }
    if (feat.geometry?.type !== 'Point' || !feat.properties) continue;
    const type = classify(feat.properties);
    if (!type) continue;
    const [lon, lat] = feat.geometry.coordinates;
    rows.push({
      type,
      name: (feat.properties['name'] ?? '').trim() || GENERIC[type],
      lon,
      lat,
    });
    counts[type] = (counts[type] ?? 0) + 1;
  }

  await writeFile(OUTPUT, JSON.stringify(rows), 'utf8');
  console.log('=== extract_pois (M2-T09) ===');
  console.log(`rows: ${rows.length}`, counts);
  console.log(`wrote ${OUTPUT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
