-- 0005_planner_definer.sql — SPK-13: least-privilege SECURITY DEFINER planner
-- read path (Master Spec §55/§37; frozen decision 27; M6-T02).
--
-- The open (anonymous) /plan endpoint must be STRUCTURALLY incapable of
-- exfiltrating private rows, even though the backend process may hold
-- privileged DB credentials. Mechanism: the planner's ONLY spatial reads go
-- through these two functions, whose SQL is scoped to public/OSM data by
-- construction:
--
--   planner_find_curvy_roads — reads curvy_segments only (public OSM-derived
--       corpus; RLS read-for-all since 0003). Same contract as
--       find_curvy_roads (0004), definer-hardened for the anon call path.
--   planner_find_spots       — reads spots WHERE source = 'osm' ONLY. User
--       spots (source='user') are NEVER returned regardless of caller, RLS
--       state, or future M8 visibility policies. §55: "scoped to public/OSM
--       data only — it cannot select private routes/spots."
--
-- PERFORMANCE (measured, M6-T02): SECURITY DEFINER prevents SQL-function
-- inlining, so a `language sql` body re-evaluates st_geomfromgeojson(...)
-- PER ROW under a generic plan — a real isochrone polygon (hundreds of
-- vertices) took the canonical planner run from ~2 s to ~48 s. These bodies
-- are therefore plpgsql: the geometry folds ONCE into a variable, the &&
-- qual stays GiST-driven, and measured latency returns to the inlined
-- INVOKER baseline.
--
-- SECURITY DEFINER hygiene: fixed search_path; EXECUTE revoked from PUBLIC,
-- granted to anon + authenticated + service_role explicitly.
-- The SPK-13 leakage test (db/tests/rls_planner.test.ts) asserts, AS THE
-- ANON ROLE: direct table reads return zero rows (deny-by-default RLS),
-- INVOKER RPCs return zero private rows, and these definer functions return
-- public/OSM rows but never a private one.

-- --- planner_find_curvy_roads (definer twin of find_curvy_roads) -----------
create or replace function planner_find_curvy_roads(
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
    and cs.geom && g
    and (p_polygon is null or st_intersects(cs.geom, g))
  order by cs.circum_curvature_per_km desc
  limit p_limit;
end
$$;

revoke execute on function planner_find_curvy_roads(
  double precision, double precision, double precision, double precision,
  jsonb, double precision, integer, text[]
) from public;
grant execute on function planner_find_curvy_roads(
  double precision, double precision, double precision, double precision,
  jsonb, double precision, integer, text[]
) to anon, authenticated, service_role;

-- --- planner_find_spots (public/OSM only — the §55 scoping) -----------------
create or replace function planner_find_spots(
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision default 10000,
  p_polygon jsonb default null,
  p_types text[] default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  name text,
  type text,
  lat double precision,
  lng double precision,
  source text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  g geometry := case
    when p_polygon is not null then st_geomfromgeojson(p_polygon::text)
  end;
  pt geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
begin
  return query
  select s.id, s.name, s.type,
         st_y(s.location)::double precision as lat,
         st_x(s.location)::double precision as lng,
         s.source
  from spots s
  where s.source = 'osm'  -- the security boundary: public/OSM rows ONLY (§55)
    and (p_types is null or s.type = any (p_types))
    and (
      (g is not null and st_intersects(s.location, g))
      or (g is null and st_dwithin(s.location::geography, pt, p_radius_m))
    )
  order by st_distance(s.location::geography, pt)
  limit p_limit;
end
$$;

revoke execute on function planner_find_spots(
  double precision, double precision, double precision, jsonb, text[], integer
) from public;
grant execute on function planner_find_spots(
  double precision, double precision, double precision, jsonb, text[], integer
) to anon, authenticated, service_role;
