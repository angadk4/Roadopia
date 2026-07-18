-- 0011_landuse_context.sql — R19: road CONTEXT, not road class (owner
-- directive 2026-07-18: "main roads are fine when surrounded by fields or
-- forest; curvy roads inside neighbourhoods are not backroads").
--
-- Three pieces:
--   1. landuse_zones — OSM landuse polygons: kind 'built' (residential/
--      industrial/commercial/retail — the neighbourhood detector) and 'rural'
--      (farmland/meadow/orchard/vineyard/farmyard — loaded for later
--      [GATE-S]-class work; R19 consumes only 'built'). Loaded offline by
--      data/load_landuse.ts from the region extract.
--   2. curvy_segments.urban_share — per-segment fraction of length INSIDE
--      built polygons (buffer 0: OSM landuse=residential covers the whole
--      subdivision incl. its streets, while polygons stop at boundary
--      arterials — so an edge arterial like Mayfield Rd measures ~0, exactly
--      the owner's "edge main road is fine" semantics). Computed offline by
--      data/compute_urban_share.sql; DEFAULT 0 keeps old rows/tests valid
--      (fail-open: unmeasured = not-urban, retrieval keeps behaving).
--   3. planner_built_areas — SECURITY DEFINER read (0005 pattern; public OSM
--      data by construction) returning simplified built polygons for a bbox.
--      The backend caches them once per region in an in-memory point-in-
--      polygon index and measures every ROUTE's urban share without extra
--      engine or DB calls.

create table if not exists landuse_zones (
  id   bigserial primary key,
  kind text not null,
  geom geometry(Geometry, 4326) not null
);
create index if not exists landuse_zones_geom_idx on landuse_zones using gist (geom);

alter table curvy_segments add column if not exists urban_share double precision not null default 0;
create index if not exists curvy_segments_urban_idx on curvy_segments (urban_share);

create or replace function planner_built_areas(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_limit integer default 20000
)
returns table (geojson text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  box geometry := st_makeenvelope(p_west, p_south, p_east, p_north, 4326);
begin
  return query
  select st_asgeojson(lz.geom) as geojson
  from landuse_zones lz
  where lz.kind = 'built'
    and lz.geom && box
  order by lz.id
  limit greatest(1, least(p_limit, 50000));
end
$$;

revoke execute on function planner_built_areas(
  double precision, double precision, double precision, double precision, integer
) from public;
grant execute on function planner_built_areas(
  double precision, double precision, double precision, double precision, integer
) to anon, authenticated, service_role;

-- down (manual):
--   drop function if exists planner_built_areas(double precision, double precision, double precision, double precision, integer);
--   drop index if exists curvy_segments_urban_idx;
--   alter table curvy_segments drop column if exists urban_share;
--   drop index if exists landuse_zones_geom_idx;
--   drop table if exists landuse_zones;
