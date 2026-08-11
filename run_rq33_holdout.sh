#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
export TSX_TSCONFIG_PATH=backend/tsconfig.json
echo "== holdout loops: incumbent =="
DRIVE_FIRST=off SURFACE=loops npx tsx eval/experiments/rq33_holdout.ts || echo "FAILED loops P0"
echo "== holdout loops: P4_d45 =="
DRIVE_FIRST=off PROFILE_EXPERIMENT=P4_d45 SURFACE=loops npx tsx eval/experiments/rq33_holdout.ts || echo "FAILED loops P4"
echo "== holdout atob: incumbent =="
SURFACE=atob npx tsx eval/experiments/rq33_holdout.ts || echo "FAILED atob P0"
echo "== holdout atob: P6_d30_manstrong =="
PROFILE_EXPERIMENT=P6_d30_manstrong SURFACE=atob npx tsx eval/experiments/rq33_holdout.ts || echo "FAILED atob P6"
echo "== holdout arms complete =="
