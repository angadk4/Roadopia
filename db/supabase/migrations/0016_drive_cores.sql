-- 0016_drive_cores.sql — the pre-measured drive-core index (R25-U13, ACP-001).
--
-- WHY: audit-v11 measured Discover as "a commute wrapped around a 4.6 km road"
-- (79% connector; tapped drives 18.3% highway / 52.9% main; 180 routes, zero
-- validations). Owner decision (2026-07-26): an algorithmically generated,
-- HARD-MEASURED index of drive cores, built OFFLINE on the dev box (never the
-- VPS — a sweep is ~90k engine calls), loaded like the curvy corpus, and
-- browsed live with fresh get-there / get-home connectors. No hand-curation.
--
-- Every row was accepted by core_bars.ts (backend) — backroad ≥55%, main ≤30%,
-- highway 0 (600 m snap floor), hood ≤5%, turns ≤5/10min, u-turn/spur-free,
-- loop loopiness ≥0.25 / ribbon corridor bars — and carries its measured
-- metrics so the app can show honest numbers without recomputing anything.
--
-- LEAST-PRIVILEGE (Hard rule E): RLS deny-by-default; reads ONLY via the
-- SECURITY DEFINER function below, which hard-filters highway_share = 0 AND
-- the serving generator_version INSIDE the definer — a bad or stale row can
-- never be served regardless of caller. Mirrors 0015's pattern.

create table if not exists drive_cores (
  id                 text primary key,          -- deterministic (cell + rank), no RNG/now()
  kind               text not null check (kind in ('loop', 'ribbon')),
  name               text not null,             -- the featured road(s), human-readable
  cell               text not null,             -- sweep grid cell id (provenance)
  generator_version  text not null,             -- sweep build tag; the definer pins it
  bar_profile        text not null default 'strict'
                     check (bar_profile in ('strict', 'cell_relaxed')),
  geometry           jsonb not null,            -- full LineString (loader-validated)
  geom_simplified    jsonb not null,            -- ~8-10 m simplified — the SERVED geometry
  bbox               geometry(Polygon, 4326) not null, -- GiST browse window
  entry              jsonb not null,            -- {lat,lng}
  exit               jsonb not null,            -- {lat,lng}
  distance_m         double precision not null,
  duration_s         integer not null,          -- measured core drive time
  -- measured truth (core_bars vocabulary; fractions 0..1)
  curviness          double precision not null,
  backroad_share     double precision not null,
  main_share         double precision not null,
  highway_share      double precision not null,
  hood_share         double precision not null,
  turns_per_10min    double precision not null,
  loopiness          double precision,          -- loops only; null for ribbons
  created_at         timestamptz not null default now()
);

create index if not exists drive_cores_bbox_gist on drive_cores using gist (bbox);
create index if not exists drive_cores_kind_idx on drive_cores (kind);

alter table drive_cores enable row level security;
-- deny-by-default: NO policies. All reads go through the definer below.

create or replace function discover_drive_cores(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  serving_version text,
  max_rows integer default 20
)
returns table (
  id               text,
  kind             text,
  name             text,
  bar_profile      text,
  geom_simplified  jsonb,
  entry            jsonb,
  exit             jsonb,
  distance_m       double precision,
  duration_s       integer,
  curviness        double precision,
  backroad_share   double precision,
  main_share       double precision,
  highway_share    double precision,
  hood_share       double precision,
  turns_per_10min  double precision,
  loopiness        double precision
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id, c.kind, c.name, c.bar_profile,
    -- SIMPLIFIED geometry only (egress: a browse must not ship full polylines)
    c.geom_simplified,
    c.entry, c.exit, c.distance_m, c.duration_s,
    c.curviness, c.backroad_share, c.main_share, c.highway_share,
    c.hood_share, c.turns_per_10min, c.loopiness
  from drive_cores c
  where c.bbox && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    -- serving guards INSIDE the definer (a bad row can never be served):
    and c.highway_share = 0
    and c.generator_version = serving_version
  order by
    -- strict cores always above relaxed; then the measured drive quality
    (c.bar_profile = 'strict') desc,
    c.backroad_share * least(c.curviness, 3.0) desc,
    c.id asc
  limit greatest(1, least(max_rows, 50))
$$;

grant execute on function discover_drive_cores(
  double precision, double precision, double precision, double precision, text, integer
) to anon, authenticated, service_role;
