#!/usr/bin/env bash
# SPK-08 — OSM extract + road-class/POI filter (data-pipeline gate).
#
# Downloads the Geofabrik Ontario extract, clips it to data/region.poly (the
# Western Golden Horseshoe / Niagara corridor), and tag-filters to drive-worthy
# road classes + car-spot POIs. Prints the size at each stage + filtered counts.
#
# Idempotent: re-running skips the download (resumable) and overwrites derived files.
# osmium runs in a pinned Debian container — no host install. Needs Docker running
# and ~2 GB free for the Ontario download.
#
# Road classes kept (Backlog SPK-08 guidance): primary / secondary / tertiary /
# unclassified / residential (+ _link). Dropped: service / parking / driveway /
# track / path / footway / motorway / trunk. POIs kept: cafe / fuel / restaurant /
# viewpoint / peak (car-spot seeds). Adjust the tags-filter line to re-tune.
set -euo pipefail

DATA_DIR="$(cd "$(dirname "$0")" && pwd)"
# Windows/MSYS: Docker needs a Windows-style path for the bind mount.
if command -v cygpath >/dev/null 2>&1; then DOCKER_DATA="$(cygpath -w "$DATA_DIR")"; else DOCKER_DATA="$DATA_DIR"; fi

ONTARIO_URL="https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf"

cd "$DATA_DIR"

echo "==> 1/3  Download Ontario extract (skip if already present)"
if [ ! -f ontario-latest.osm.pbf ]; then
  curl -L --fail --retry 3 -C - -o ontario-latest.osm.pbf "$ONTARIO_URL"
fi

echo "==> 2/3 + 3/3  Clip to region.poly + tag-filter (osmium in Docker)"
MSYS_NO_PATHCONV=1 docker run --rm -v "${DOCKER_DATA}:/data" -w /data debian:bookworm-slim bash -c '
  set -e
  apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null
  echo "-- clip to region --"
  osmium extract --polygon region.poly --strategy complete_ways --overwrite \
    -o region-clipped.osm.pbf ontario-latest.osm.pbf
  echo "-- tag-filter: drive-worthy roads + car-spot POIs --"
  osmium tags-filter --overwrite -o region-filtered.osm.pbf region-clipped.osm.pbf \
    w/highway=primary,secondary,tertiary,unclassified,residential,primary_link,secondary_link,tertiary_link \
    n/amenity=cafe,fuel,restaurant n/tourism=viewpoint n/natural=peak
  echo "-- filtered fileinfo --"
  osmium fileinfo -e region-filtered.osm.pbf
'

echo "==> Sizes:"
ls -lh ontario-latest.osm.pbf region-clipped.osm.pbf region-filtered.osm.pbf
