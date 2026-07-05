#!/usr/bin/env bash
# SPK-04 prep — routing-variant extract (the BD-11 finding).
#
# The SPK-08 filter (extract.sh → region-filtered.osm.pbf) is tuned for the scenic/
# curvy dataset and DROPS motorway/trunk. Valhalla routing tiles need a *connected
# drivable network* — including motorway/trunk — so highway-avoidance (the Tier-2 soft
# fallback) has something to fall back onto. This re-filters the already-clipped
# corridor (region-clipped.osm.pbf, from extract.sh) with the broader keep-list.
#
# Reuses the existing clip — no 921 MB re-download. osmium in the pinned Debian
# container (same pattern as extract.sh). Output: region-routing.osm.pbf (gitignored),
# the tile input for data/build_tiles.sh on the VPS.
set -euo pipefail

DATA_DIR="$(cd "$(dirname "$0")" && pwd)"
if command -v cygpath >/dev/null 2>&1; then DOCKER_DATA="$(cygpath -w "$DATA_DIR")"; else DOCKER_DATA="$DATA_DIR"; fi

if [ ! -f "$DATA_DIR/region-clipped.osm.pbf" ]; then
  echo "ERROR: region-clipped.osm.pbf not found — run data/extract.sh (SPK-08) first." >&2
  exit 1
fi

echo "==> Routing tag-filter (drivable network incl. motorway/trunk)"
MSYS_NO_PATHCONV=1 docker run --rm -v "${DOCKER_DATA}:/data" -w /data debian:bookworm-slim bash -c '
  set -e
  apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null
  osmium tags-filter --overwrite -o region-routing.osm.pbf region-clipped.osm.pbf \
    w/highway=motorway,trunk,primary,secondary,tertiary,unclassified,residential,living_street,motorway_link,trunk_link,primary_link,secondary_link,tertiary_link
  echo "-- routing fileinfo --"
  osmium fileinfo -e region-routing.osm.pbf | grep -E "Number of (nodes|ways|relations)"
'

echo "==> Sizes:"
ls -lh region-clipped.osm.pbf region-filtered.osm.pbf region-routing.osm.pbf
