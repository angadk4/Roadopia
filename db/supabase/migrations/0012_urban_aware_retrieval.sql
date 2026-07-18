-- 0012_urban_aware_retrieval.sql — R19: the retrieval corpus stops feeding
-- the planner curvy SUBDIVISION COLLECTORS (measured: 24 % of the top-300
-- around Mayfield × Kennedy sit inside built-up landuse at avg curviness 3.31
-- — statistically identical to genuine country roads, so they were winning
-- waypoint seats; the owner's "green stuff entering neighbourhoods").
--
-- Mechanism: planner_find_curvy_roads gains p_max_urban_share (filter INSIDE
-- the RPC, pre-limit — the BD-21 lesson: post-limit filtering starves the
-- pool with junk that already consumed the seats). Default 1.0 = no filter,
-- so existing callers are byte-identical until the backend opts in.
--
-- Postgres note: adding a defaulted parameter to an existing function creates
-- an OVERLOAD (ambiguous with named-arg callers), so the old signature is
-- DROPPED and recreated. Same SECURITY DEFINER hygiene as 0005.

drop function if exists planner_find_curvy_roads(
  double precision, double precision, double precision, double precision,
  jsonb, double precision, integer, text[]
);

create or replace function planner_find_curvy_roads(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_polygon jsonb default null,
  p_min_curviness double precision default 0.6,
  p_limit integer default 200,
  p_exclude_highway text[] default null,
  p_max_urban_share double precision default 1.0
)
returns setof curvy_segments
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  g geometry := coalesce(
    st_geomfromgeojson(p_polygon::text),
    st_makeenvelope(p_west, p_south, p_east, p_north, 4326)
  );
begin
  return query
  select cs.*
  from curvy_segments cs
  where cs.circum_curvature_per_km >= p_min_curviness
    and (p_exclude_highway is null or cs.highway <> all (p_exclude_highway))
    and cs.urban_share <= p_max_urban_share
    and cs.geom && g
    and (p_polygon is null or st_intersects(cs.geom, g))
  order by cs.circum_curvature_per_km desc
  limit p_limit;
end
$$;

revoke execute on function planner_find_curvy_roads(
  double precision, double precision, double precision, double precision,
  jsonb, double precision, integer, text[], double precision
) from public;
grant execute on function planner_find_curvy_roads(
  double precision, double precision, double precision, double precision,
  jsonb, double precision, integer, text[], double precision
) to anon, authenticated, service_role;

-- down (manual): recreate the 0005 signature (drop this one first).
