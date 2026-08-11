-- R34-U9 (BD-160): the serving read returns the FULL-resolution core geometry
-- alongside the simplified display line. The simplified ~225-vertex ring was
-- being used as ROUTING TRUTH (through-sample source), which is exactly the
-- Recovery §9 defect: simplified geometry is a rendering artifact. Full-res
-- sampling + a raised fidelity bar make "measured means measured" literal.
-- Additive column on the RETURN TABLE only; same guards, same definer shape.

drop function if exists discover_drive_cores(
  double precision, double precision, double precision, double precision,
  text, integer, text
);

create or replace function discover_drive_cores(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  serving_version text,
  max_rows integer default 20,
  kind_filter text default null
)
returns table (
  id               text,
  kind             text,
  name             text,
  bar_profile      text,
  geom_simplified  jsonb,
  geometry         jsonb,
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
    c.id, c.kind, c.name, c.bar_profile, c.geom_simplified, c.geometry,
    c.entry, c.exit,
    c.distance_m, c.duration_s, c.curviness, c.backroad_share, c.main_share,
    c.highway_share, c.hood_share, c.turns_per_10min, c.loopiness
  from drive_cores c
  where c.bbox && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    -- serving guards INSIDE the definer (a bad row can never be served):
    and c.highway_share = 0
    and c.generator_version = serving_version
    and (kind_filter is null or c.kind = kind_filter)
  order by
    (c.bar_profile = 'strict') desc,
    c.backroad_share * least(c.curviness, 3.0) desc,
    c.id asc
  limit greatest(1, least(max_rows, 50))
$$;

revoke all on function discover_drive_cores(
  double precision, double precision, double precision, double precision,
  text, integer, text
) from public;
grant execute on function discover_drive_cores(
  double precision, double precision, double precision, double precision,
  text, integer, text
) to anon, authenticated, service_role;
