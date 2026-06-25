#!/usr/bin/env bash
# SPK-10 — export the filtered road network to line-delimited GeoJSON for curvature
# compute. Reads data/region-filtered.osm.pbf (SPK-08 output) and writes
# data/curvature/roads.geojsonl (one LineString feature per line, RS-stripped).
#
# osmium runs in the same pinned Debian container as extract.sh (no host install).
# Needs Docker running and data/region-filtered.osm.pbf present (run data/extract.sh first).
set -euo pipefail

CURV_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$(cd "$CURV_DIR/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then DOCKER_DATA="$(cygpath -w "$DATA_DIR")"; else DOCKER_DATA="$DATA_DIR"; fi

if [ ! -f "$DATA_DIR/region-filtered.osm.pbf" ]; then
  echo "ERROR: data/region-filtered.osm.pbf not found — run data/extract.sh (SPK-08) first." >&2
  exit 1
fi

echo "==> Export filtered roads → GeoJSON-seq (linestrings only)"
MSYS_NO_PATHCONV=1 docker run --rm -v "${DOCKER_DATA}:/data" -w /data debian:bookworm-slim bash -c '
  set -e
  apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null
  osmium export region-filtered.osm.pbf \
    -f geojsonseq --geometry-types=linestring \
    -x print_record_separator=false \
    --overwrite -o curvature/roads.geojsonl
  echo "-- lines exported --"
  wc -l curvature/roads.geojsonl
'

echo "==> Done: data/curvature/roads.geojsonl"
ls -lh "$CURV_DIR/roads.geojsonl"
