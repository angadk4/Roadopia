-- 0013_exclude_closed_rings.sql — R21-0(a): stop retrieving CLOSED-RING
-- segments (cul-de-sac bulbs, traffic circles, loop lanes).
--
-- The owner's device sighting ("random stop at Kuehne+Nagel" / "Standish Court
-- U-turn") is corpus poison: a closed ring sweeps ~2π of heading over a short
-- length, so circum_curvature_per_km (C7) reads MAXIMAL — Standish Court
-- (id 17950, 561 m, unclassified) scores 13.57, and industrial parcels mapped
-- with gaps at the road leave its urban_share at 0.00, so neither the class
-- filter (BD-21) nor the urban filter (R19) catches it. The planner then seeks
-- it as "the twistiest road around," drives out, and U-turns at the dead-end
-- bulb — the reversal lands on the basemap's Kuehne+Nagel POI label and reads
-- as a "stop".
--
-- Measured (local corpus, 133,865 segments): 753 closed rings exist; only 26
-- are otherwise retrievable (class + urban_share <= 0.6 + curviness >= 0.6),
-- ALL of them 115-664 m with curviness 6.17-46.2 — every one a cul-de-sac bulb
-- or circle, none a legitimate through-drive. Removing them costs the retrieval
-- pool 26 of 12,363 region-wide (0.2 %): no starvation, pure poison removal.
--
-- ST_IsClosed(LineString) = StartPoint equals EndPoint — exactly the ring
-- topology we want gone. Filtered INSIDE the definer RPC, pre-limit (the BD-21
-- lesson), so it precedes both the curvy-waypoint path and the return-anchor
-- path (plannerFindAnchorPoints calls this same fn with p_min_curviness := 0).
--
-- Extends BD-18 (was: residential closed rings only) to ALL closed rings.
-- CREATE OR REPLACE with the identical 0012 signature preserves grants; the
-- grant block is repeated for a clean fresh-deploy ordering (idempotent).

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
    and not st_isclosed(cs.geom)          -- R21-0(a): drop cul-de-sac/ring poison
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

-- down (manual): re-run 0012 (recreates the fn without the st_isclosed clause).
