-- 0004_curvy_class_filter.sql — find_curvy_roads learns p_exclude_highway (BD-21).
--
-- Owner round 3 root cause: retrieval ranks by raw circum_curvature_per_km, and
-- residential streets are 66 % of the corpus / 98 % of the top-500 by that metric
-- (short suburban curls score huge per-km curvature). Any dense-area Ω therefore
-- returned almost exclusively subdivision geometry and the real country roads
-- never reached the generator. The class filter must live INSIDE the function so
-- it applies BEFORE the ORDER BY/LIMIT — filtering client-side after the limit
-- starves dense areas (top-300 in a city ring ≈ all residential).
--
-- Additive param, default null = exact old behaviour. A default-arg signature
-- change on a SQL function requires drop + recreate + re-grant (grants die with
-- the dropped function).

drop function if exists find_curvy_roads(
  double precision, double precision, double precision, double precision,
  jsonb, double precision, integer
);

create function find_curvy_roads(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_polygon jsonb default null,
  p_min_curviness double precision default 0.6,
  p_limit integer default 200,
  p_exclude_highway text[] default null
)
returns setof curvy_segments
language sql
stable
as $$
  select cs.*
  from curvy_segments cs
  where cs.circum_curvature_per_km >= p_min_curviness
    and (p_exclude_highway is null or cs.highway <> all (p_exclude_highway))
    and cs.geom && coalesce(
      st_geomfromgeojson(p_polygon::text),
      st_makeenvelope(p_west, p_south, p_east, p_north, 4326)
    )
    and (
      p_polygon is null
      or st_intersects(cs.geom, st_geomfromgeojson(p_polygon::text))
    )
  order by cs.circum_curvature_per_km desc
  limit p_limit
$$;

grant execute on function find_curvy_roads(
  double precision, double precision, double precision, double precision,
  jsonb, double precision, integer, text[]
) to anon, authenticated;
