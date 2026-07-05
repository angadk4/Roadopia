#!/usr/bin/env bash
# SPK-04 — build + serve Valhalla routing tiles on the VPS.
#
# Runs ON the VPS (Ubuntu + Docker; CX23 4 GB at time of the spike). Expects the
# workdir to contain either:
#   - region-routing.osm.pbf  (routing extract — BD-11 keep-list incl. motorway/trunk), or
#   - region-clipped.osm.pbf  (the SPK-08 corridor clip) → step 0 derives the routing
#     extract from it (same osmium filter as data/extract-routing.sh, pinned container).
#
# Steps: [0] derive routing extract if needed → [1] generate valhalla.json →
# [2] valhalla_build_tiles (timed + RAM-sampled via docker stats) → [3] serve on
# 127.0.0.1:8002 — LOOPBACK ONLY, nothing public (the backend colocates at M12).
# Tiles are served from the tile dir (tile_extract disabled — fine at this region size).
#
# Usage: bash build_tiles.sh [workdir]     (default /opt/roadopia/valhalla)
#        SERVE=0 bash build_tiles.sh …     (build only — e.g. when docker compose serves)
# Then:  python3 valhalla_probe.py         (latency p50/p95 + peak RSS + AC verdicts)
#
# Config precedence (M2-T03): if the workdir already holds a valhalla.json (ship the
# PINNED repo copy, infra/valhalla/valhalla.json — allow_hard_exclusions=true), it is
# used as-is; otherwise one is generated as a bootstrap fallback. The image is pinned
# by digest (v3.7.0) — bump deliberately, never implicitly.
set -euo pipefail

WORK="${1:-/opt/roadopia/valhalla}"
# Pinned: ghcr.io/valhalla/valhalla v3.7.0-7e1ddb194 (M2-T03 / BD-14)
VALHALLA_IMAGE=ghcr.io/valhalla/valhalla@sha256:8aebd555b84163ff9d98d3199380f1653113f6fa28f3043a13c6baf609338f29
OSMIUM_IMAGE=debian:bookworm-slim
PBF=region-routing.osm.pbf
SERVE="${SERVE:-1}"
cd "$WORK"
# Windows/MSYS: Docker needs a Windows-style path for the bind mount (as extract.sh).
if command -v cygpath >/dev/null 2>&1; then DOCKER_WORK="$(cygpath -w "$WORK")"; else DOCKER_WORK="$WORK"; fi
export MSYS_NO_PATHCONV=1

# --- 0. routing extract (same keep-list as data/extract-routing.sh) ---
if [ ! -f "$PBF" ]; then
  [ -f region-clipped.osm.pbf ] || { echo "ERROR: need $PBF or region-clipped.osm.pbf in $WORK" >&2; exit 1; }
  echo "==> [0/3] Derive routing extract (osmium tags-filter, incl. motorway/trunk)"
  docker run --rm -v "$DOCKER_WORK":/data -w /data "$OSMIUM_IMAGE" bash -c '
    set -e
    apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null
    osmium tags-filter --overwrite -o region-routing.osm.pbf region-clipped.osm.pbf \
      w/highway=motorway,trunk,primary,secondary,tertiary,unclassified,residential,living_street,motorway_link,trunk_link,primary_link,secondary_link,tertiary_link
    echo "-- routing extract fileinfo --"
    osmium fileinfo -e region-routing.osm.pbf | grep -E "Number of (nodes|ways)"
  '
fi
ls -lh "$PBF"

echo "==> [1/3] Config"
docker pull -q "$VALHALLA_IMAGE" >/dev/null
if [ -f valhalla.json ]; then
  echo "--> using existing (pinned) valhalla.json"
else
  echo "--> no valhalla.json in workdir — generating bootstrap config (prefer shipping infra/valhalla/valhalla.json)"
  docker run --rm "$VALHALLA_IMAGE" valhalla_build_config \
    --mjolnir-tile-dir /data/tiles \
    --mjolnir-tile-extract '' \
    --mjolnir-concurrency 2 \
    > valhalla.json
fi

# Elevation bbox follows the region (matches data/regions/<REGION_ID>.poly — swap
# both when the region changes; env-overridable, never silently hard-coded elsewhere).
ELEVATION_BBOX="${ELEVATION_BBOX:--80.45,42.8,-78.9,43.55}"
if [ "${ELEVATION:-1}" = "1" ] && [ ! -d elevation ]; then
  echo "==> [1.5/3] Download Tilezen elevation tiles for bbox $ELEVATION_BBOX (~150 MB; ELEVATION=0 to skip)"
  docker run --rm -v "$DOCKER_WORK":/data "$VALHALLA_IMAGE" \
    valhalla_build_elevation -b "$ELEVATION_BBOX" -o /data/elevation -d -p 4 >/dev/null
  du -sh elevation
fi

echo "==> [2/3] Build tiles (timed + RAM-sampled)"
mkdir -p tiles
docker rm -f valhalla-build >/dev/null 2>&1 || true
START=$(date +%s)
docker run -d --name valhalla-build -v "$DOCKER_WORK":/data "$VALHALLA_IMAGE" \
  valhalla_build_tiles -c /data/valhalla.json "/data/$PBF" >/dev/null
PEAK_MB=0
while [ "$(docker inspect -f '{{.State.Running}}' valhalla-build 2>/dev/null || echo false)" = "true" ]; do
  RAW=$(docker stats --no-stream --format '{{.MemUsage}}' valhalla-build 2>/dev/null | awk '{print $1}')
  MB=$(echo "$RAW" | awk '/GiB/{printf "%d", $1*1024; next} /MiB/{printf "%d", $1+0; next} {printf "%d", 0}')
  if [ -n "$MB" ] && [ "$MB" -gt "$PEAK_MB" ]; then PEAK_MB=$MB; fi
  sleep 2
done
RC=$(docker inspect -f '{{.State.ExitCode}}' valhalla-build)
BUILD_S=$(( $(date +%s) - START ))
echo "--- build log tail ---"
docker logs --tail 4 valhalla-build 2>&1 || true
docker rm valhalla-build >/dev/null
if [ "$RC" != "0" ]; then echo "ERROR: tile build failed (rc=$RC)" >&2; exit 1; fi
TILE_SIZE=$(du -sh tiles | cut -f1)
echo "==> build: ${BUILD_S}s | build peak RSS ~ ${PEAK_MB} MiB (2s sampling) | tiles: ${TILE_SIZE}"

if [ "$SERVE" != "1" ]; then
  echo "==> [3/3] SERVE=0 — build-only mode (serve via docker compose / existing service)"
  exit 0
fi
echo "==> [3/3] Serve on 127.0.0.1:8002 (loopback only)"
docker rm -f valhalla >/dev/null 2>&1 || true
docker run -d --name valhalla --restart unless-stopped \
  -p 127.0.0.1:8002:8002 -v "$DOCKER_WORK":/data "$VALHALLA_IMAGE" \
  valhalla_service /data/valhalla.json 1 >/dev/null
sleep 3
curl -sf http://127.0.0.1:8002/status >/dev/null || { echo "ERROR: /status not responding" >&2; exit 1; }
echo "==> Valhalla serving (loopback). Next: python3 valhalla_probe.py"
