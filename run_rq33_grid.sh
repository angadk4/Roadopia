#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
export TSX_TSCONFIG_PATH=backend/tsconfig.json
ARMS="P1_auto P2_d15 P3_d30 P4_d45 P5_d30_man P6_d30_manstrong P7_d30_svc P8_d30_man_svc P9_pen_only"
echo "== incumbent =="
ARM_LABEL=P0_incumbent SURFACE=atob npx tsx eval/experiments/rq33_profiles.ts || echo "ARM FAILED: P0 atob"
DRIVE_FIRST=off ARM_LABEL=P0_incumbent SURFACE=loops npx tsx eval/experiments/rq33_profiles.ts || echo "ARM FAILED: P0 loops"
for a in $ARMS; do
  echo "== $a =="
  PROFILE_EXPERIMENT=$a SURFACE=atob npx tsx eval/experiments/rq33_profiles.ts || echo "ARM FAILED: $a atob"
  DRIVE_FIRST=off PROFILE_EXPERIMENT=$a SURFACE=loops npx tsx eval/experiments/rq33_profiles.ts || echo "ARM FAILED: $a loops"
done
echo "== grid complete =="
