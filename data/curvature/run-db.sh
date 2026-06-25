#!/usr/bin/env bash
# SPK-10 — measure curvy_segments footprint + find_curvy_roads latency in PostGIS.
#
# Spins a throwaway postgis/postgis container (same engine as the Supabase local db,
# but far faster to start than the full stack), applies the 0001 migration, loads
# curvy_segments.tsv, and prints size + latency. The migration itself lives in
# db/supabase/migrations and is applied by `supabase db reset` in the real workflow;
# this script just benchmarks it in isolation. Needs Docker + curvature:build first.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NAME=roadopia-spk10-pg
PORT=54329
IMAGE=postgis/postgis:16-3.4

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "==> Starting $IMAGE on :$PORT"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p ${PORT}:5432 "$IMAGE" >/dev/null

echo "==> Waiting for postgres to accept connections"
sleep 3
ready=0
for i in $(seq 1 60); do
  # require a real query to succeed — pg_isready returns true mid-bootstrap, before
  # the postgis-init restart, so connections opened then get dropped.
  if docker exec "$NAME" psql -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "postgres did not become ready" >&2; exit 1; }
sleep 1

export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"
echo "==> Loading + measuring"
( cd "$HERE/../.." && pnpm -C data exec tsx curvature/load.ts )
