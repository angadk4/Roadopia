#!/usr/bin/env bash
# M2-T02 (evolved from SPK-08) — reproducible OSM acquisition + clip + tag-filter.
#
# One idempotent pipeline (Spec §46): download Geofabrik Ontario → osmium extract
# --polygon <region .poly> → osmium tags-filter (drive-worthy roads + car-spot POIs)
# → write data/extract-manifest.json recording WHAT was extracted WHEN from WHICH
# snapshot with WHICH parameters (the reproducibility record).
#
# Region comes from REGION_POLY_PATH (M2-T01; Spec §46) — never a hard-coded box.
# osmium runs in a pinned Debian container (no host install; needs Docker).
#
# Idempotence + reproducibility:
#   - Download is skipped if the .pbf exists (Geofabrik updates DAILY — a kept local
#     snapshot keeps the pipeline reproducible; delete the .pbf to take a new snapshot;
#     a fresh download is checksum-verified against Geofabrik's .md5).
#   - osmium stages are deterministic: same input + same params → byte-identical
#     outputs (manifest records md5s; re-run and compare to prove it).
#
# Road classes kept (SPK-08/BD-11 scenic set): primary/secondary/tertiary/
# unclassified/residential (+_link). POIs: cafe/fuel/restaurant/viewpoint/peak.
# (The broader ROUTING network for Valhalla tiles is data/extract-routing.sh.)
set -euo pipefail

DATA_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$DATA_DIR/.." && pwd)"
# Windows/MSYS: Docker needs a Windows-style path for the bind mount.
if command -v cygpath >/dev/null 2>&1; then DOCKER_DATA="$(cygpath -w "$DATA_DIR")"; else DOCKER_DATA="$DATA_DIR"; fi

SOURCE_URL="https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf"
SOURCE_FILE="ontario-latest.osm.pbf"
OSMIUM_IMAGE="debian:bookworm-slim"
ROAD_FILTER="w/highway=primary,secondary,tertiary,unclassified,residential,primary_link,secondary_link,tertiary_link"
POI_FILTER="n/amenity=cafe,fuel,restaurant n/tourism=viewpoint n/natural=peak"

# --- Region from env (M2-T01) ---
REGION_ID="${REGION_ID:-south-central-ontario}"
REGION_POLY_PATH="${REGION_POLY_PATH:-data/regions/south-central-ontario.poly}"
case "$REGION_POLY_PATH" in
  /*) POLY_ABS="$REGION_POLY_PATH" ;;
  *) POLY_ABS="$REPO_DIR/$REGION_POLY_PATH" ;;
esac
[ -f "$POLY_ABS" ] || { echo "ERROR: region poly not found: $POLY_ABS (set REGION_POLY_PATH)" >&2; exit 1; }
case "$POLY_ABS" in
  "$DATA_DIR"/*) POLY_REL="${POLY_ABS#"$DATA_DIR"/}" ;;
  *) echo "ERROR: REGION_POLY_PATH must live under data/ (got: $POLY_ABS)" >&2; exit 1 ;;
esac
echo "==> Region: $REGION_ID ($POLY_REL)"

cd "$DATA_DIR"

echo "==> 1/3  Acquire Ontario snapshot (skip if present — delete to re-snapshot)"
DOWNLOADED=no
if [ ! -f "$SOURCE_FILE" ]; then
  curl -L --fail --retry 3 -C - -o "$SOURCE_FILE" "$SOURCE_URL"
  DOWNLOADED=yes
  # Verify a FRESH download against Geofabrik's published md5 (fail = corrupt transfer).
  echo "--> checksum-verify fresh download"
  UPSTREAM_MD5=$(curl -sL --fail "$SOURCE_URL.md5" | awk '{print $1}')
  LOCAL_MD5=$(md5sum "$SOURCE_FILE" | awk '{print $1}')
  if [ "$UPSTREAM_MD5" != "$LOCAL_MD5" ]; then
    echo "ERROR: md5 mismatch on fresh download (upstream $UPSTREAM_MD5 != local $LOCAL_MD5)" >&2
    exit 1
  fi
else
  LOCAL_MD5=$(md5sum "$SOURCE_FILE" | awk '{print $1}')
  echo "--> using existing snapshot (md5 $LOCAL_MD5); delete $SOURCE_FILE to re-download"
fi

echo "==> 2/3  Clip + tag-filter (osmium in $OSMIUM_IMAGE)"
MSYS_NO_PATHCONV=1 docker run --rm -v "${DOCKER_DATA}:/data" -w /data \
  -e POLY_REL="$POLY_REL" -e ROAD_FILTER="$ROAD_FILTER" -e POI_FILTER="$POI_FILTER" \
  -e SOURCE_FILE="$SOURCE_FILE" \
  "$OSMIUM_IMAGE" bash -c '
  set -e
  apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null
  osmium --version | head -1 > .osmium-version.tmp
  echo "-- clip to region ($POLY_REL) --"
  osmium extract --polygon "$POLY_REL" --strategy complete_ways --overwrite \
    -o region-clipped.osm.pbf "$SOURCE_FILE"
  echo "-- tag-filter: drive-worthy roads + car-spot POIs --"
  # $ROAD_FILTER / $POI_FILTER are space-separated osmium filter expressions.
  # shellcheck disable=SC2086
  osmium tags-filter --overwrite -o region-filtered.osm.pbf region-clipped.osm.pbf \
    $ROAD_FILTER $POI_FILTER
  osmium fileinfo -e -g data.count.nodes region-filtered.osm.pbf > .filtered-nodes.tmp
  osmium fileinfo -e -g data.count.ways  region-filtered.osm.pbf > .filtered-ways.tmp
'

echo "==> 3/3  Write extract manifest"
EXTRACT_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OSMIUM_VERSION=$(tr -d '\r\n' < .osmium-version.tmp)
FILTERED_NODES=$(tr -d '\r\n ' < .filtered-nodes.tmp)
FILTERED_WAYS=$(tr -d '\r\n ' < .filtered-ways.tmp)
rm -f .osmium-version.tmp .filtered-nodes.tmp .filtered-ways.tmp
POLY_MD5=$(md5sum "$POLY_ABS" | awk '{print $1}')
CLIPPED_MD5=$(md5sum region-clipped.osm.pbf | awk '{print $1}')
FILTERED_MD5=$(md5sum region-filtered.osm.pbf | awk '{print $1}')
SOURCE_BYTES=$(stat -c %s "$SOURCE_FILE")
CLIPPED_BYTES=$(stat -c %s region-clipped.osm.pbf)
FILTERED_BYTES=$(stat -c %s region-filtered.osm.pbf)

cat > extract-manifest.json <<EOF
{
  "region_id": "$REGION_ID",
  "region_poly": { "path": "$REGION_POLY_PATH", "md5": "$POLY_MD5" },
  "source": {
    "url": "$SOURCE_URL",
    "file": "$SOURCE_FILE",
    "md5": "$LOCAL_MD5",
    "bytes": $SOURCE_BYTES,
    "freshly_downloaded": "$DOWNLOADED"
  },
  "extract_date": "$EXTRACT_DATE",
  "osmium": { "image": "$OSMIUM_IMAGE", "version": "$OSMIUM_VERSION" },
  "filter": {
    "roads": "$ROAD_FILTER",
    "pois": "$POI_FILTER"
  },
  "outputs": {
    "clipped":  { "file": "region-clipped.osm.pbf",  "md5": "$CLIPPED_MD5",  "bytes": $CLIPPED_BYTES },
    "filtered": { "file": "region-filtered.osm.pbf", "md5": "$FILTERED_MD5", "bytes": $FILTERED_BYTES,
                  "nodes": $FILTERED_NODES, "ways": $FILTERED_WAYS }
  }
}
EOF
cat extract-manifest.json
echo "==> Sizes:"
ls -lh "$SOURCE_FILE" region-clipped.osm.pbf region-filtered.osm.pbf
