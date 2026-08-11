#!/usr/bin/env bash
# R32-U4 — ISOLATED Valhalla 3.8.3 upgrade experiment (Recovery §5.3).
#
# Rules: same config, same extract, tiles rebuilt by each version itself;
# NOTHING else changes (no costing edits, no planner flags). The candidate
# runs on :8003 next to the incumbent on :8002 so every comparison is
# side-by-side on one machine. Adoption needs: frozen gold suite A/B clean
# (no structural regressions, latency not worse) + a decision-log entry.
# [HUMAN] runs this (Docker pulls + tile build time); Claude runs the suites.
set -euo pipefail
cd "$(dirname "$0")/../.."

IMG="ghcr.io/valhalla/valhalla:3.8.3"
PORT=8003
DATA_DIR="$(pwd)/data/valhalla-383"

echo "== 1. pull =="
docker pull "$IMG"

echo "== 2. build tiles with 3.8.3 itself (never reuse 3.7 tiles) =="
mkdir -p "$DATA_DIR"
cp infra/valhalla/valhalla.json "$DATA_DIR/valhalla.json"
# same routing extract the 3.7 tiles were built from:
EXTRACT="$(pwd)/data/ontario-routing.osm.pbf"
[ -f "$EXTRACT" ] || { echo "extract not found: $EXTRACT (adjust path)"; exit 1; }
docker run --rm -v "$DATA_DIR:/custom_files" -v "$EXTRACT:/custom_files/extract.osm.pbf:ro" \
  "$IMG" valhalla_build_tiles -c /custom_files/valhalla.json /custom_files/extract.osm.pbf

echo "== 3. serve on :$PORT =="
docker run -d --name valhalla-383 -p 127.0.0.1:$PORT:8002 \
  -v "$DATA_DIR:/custom_files" "$IMG"

echo "== 4. verify =="
sleep 5
curl -s "http://127.0.0.1:$PORT/status" | head -c 200; echo

cat <<'NEXT'

== 5. the A/B (Claude runs these) ==
  VALHALLA_URL=http://127.0.0.1:8002 AUDIT_SUITE=gold-v1 npx tsx eval/audit_v13.ts   # incumbent
  VALHALLA_URL=http://127.0.0.1:8003 AUDIT_SUITE=gold-v1 npx tsx eval/audit_v13.ts   # candidate
  VALHALLA_URL=http://127.0.0.1:8003 npx tsx eval/experiments/rq32_hard_exclusions.ts
Compare manifests (both artifacts embed engine version + tileset id), then
adopt-or-refuse with a BD entry. Teardown: docker rm -f valhalla-383
NEXT
