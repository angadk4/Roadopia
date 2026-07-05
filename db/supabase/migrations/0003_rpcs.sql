-- 0003_rpcs.sql — spatial RPCs + search + trigram indexes (M2-T08; Spec §44/§49/§53).
--
-- All functions are STABLE, read-only, INVOKER rights: RLS applies to the caller
-- (routes/spots are deny-by-default until the M8 policies; the planner's
-- SECURITY DEFINER public/OSM-only variants land at SPK-13 — §55). curvy_segments
-- is public OSM-derived data → RLS enabled here with a read-for-all policy.
--
-- BD-13 fix included: the SPK-10 radius-form find_curvy_roads gets a geometry &&
-- envelope prefilter so the GiST index prunes before the exact geography distance.

-- --- trigram search indexes (§47.2/§53) -------------------------------------
create index if not exists routes_name_trgm on routes using gin (name gin_trgm_ops);
create index if not exists spots_name_trgm on spots using gin (name gin_trgm_ops);

-- --- curvy_segments Data-API posture (public OSM-derived data) ---------------
alter table curvy_segments enable row level security;
drop policy if exists curvy_segments_read_all on curvy_segments;
create policy curvy_segments_read_all on curvy_segments for select using (true);
grant select on curvy_segments to anon, authenticated;

-- --- find_curvy_roads — bbox|polygon form (§49/§50) --------------------------
-- Polygon (GeoJSON, jsonb) overrides the bbox when provided. Ranked most-curvy
-- first. The && prefilter keeps the GiST index in play (BD-13).
create or replace function find_curvy_roads(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_polygon jsonb default null,
  p_min_curviness double precision default 0.6,
  p_limit integer default 200
)
returns setof curvy_segments
language sql
stable
as $$
  select cs.*
  from curvy_segments cs
  where cs.circum_curvature_per_km >= p_min_curviness
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

-- --- find_curvy_roads_near — radius form (supersedes SPK-10's 0001 fn; BD-13 fix) ---
-- Renamed from the 0001 overload: PostgREST + PG default-args make overloading
-- `find_curvy_roads` ambiguous, and §49 reserves that name for the bbox|polygon tool.
drop function if exists find_curvy_roads(double precision, double precision, double precision, double precision, integer);
create or replace function find_curvy_roads_near(
  p_lon double precision,
  p_lat double precision,
  p_radius_m double precision,
  p_min_curviness double precision default 0.6,
  p_limit integer default 200
)
returns setof curvy_segments
language sql
stable
as $$
  select cs.*
  from curvy_segments cs
  where cs.circum_curvature_per_km >= p_min_curviness
    -- cheap GiST prefilter: expand the point by a safe degree over-approximation
    -- (1° lat ≈ 111.32 km; longitude shrinks with cos(lat) so this over-covers)
    and cs.geom && st_expand(
      st_setsrid(st_makepoint(p_lon, p_lat), 4326),
      p_radius_m / 111320.0 * 1.5
    )
    -- exact distance in metres
    and st_dwithin(
      cs.geom::geography,
      st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )
  order by cs.circum_curvature_per_km desc
  limit p_limit
$$;

-- --- find_spots (§49/§50) -----------------------------------------------------
-- Origin + radius (default 10 km) or GeoJSON polygon; optional type filter;
-- nearest-first. Invoker rights: visibility governed by RLS (M8 policies).
create or replace function find_spots(
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
language sql
stable
as $$
  select s.id, s.name, s.type,
         st_y(s.location)::double precision as lat,
         st_x(s.location)::double precision as lng,
         s.source
  from spots s
  where (p_types is null or s.type = any (p_types))
    and (
      case when p_polygon is not null
        then st_intersects(s.location, st_geomfromgeojson(p_polygon::text))
        else st_dwithin(
          s.location::geography,
          st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
          p_radius_m
        )
      end
    )
  order by st_distance(
    s.location::geography,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
  )
  limit p_limit
$$;

-- --- search_routes (§49/§53) ---------------------------------------------------
-- bbox + length range + tag filters + trigram name match, paged. Name given →
-- similarity-ranked; otherwise newest-first.
create or replace function search_routes(
  p_west double precision default null,
  p_south double precision default null,
  p_east double precision default null,
  p_north double precision default null,
  p_min_length_m double precision default null,
  p_max_length_m double precision default null,
  p_character_tags text[] default null,
  p_free_tags text[] default null,
  p_name text default null,
  p_page integer default 0,
  p_page_size integer default 20
)
returns setof routes
language sql
stable
as $$
  select r.*
  from routes r
  where (p_west is null
         or r.geometry && st_makeenvelope(p_west, p_south, p_east, p_north, 4326))
    and (p_min_length_m is null or r.distance_m >= p_min_length_m)
    and (p_max_length_m is null or r.distance_m <= p_max_length_m)
    and (p_character_tags is null or r.character_tags && p_character_tags)
    and (p_free_tags is null or r.free_tags && p_free_tags)
    and (p_name is null or r.name ilike '%' || p_name || '%' or r.name % p_name)
  order by
    case when p_name is not null then similarity(r.name, p_name) end desc nulls last,
    r.created_at desc
  limit p_page_size offset p_page * p_page_size
$$;

-- --- search_spots (§49/§53) ----------------------------------------------------
create or replace function search_spots(
  p_west double precision default null,
  p_south double precision default null,
  p_east double precision default null,
  p_north double precision default null,
  p_types text[] default null,
  p_name text default null,
  p_page integer default 0,
  p_page_size integer default 20
)
returns setof spots
language sql
stable
as $$
  select s.*
  from spots s
  where (p_west is null
         or s.location && st_makeenvelope(p_west, p_south, p_east, p_north, 4326))
    and (p_types is null or s.type = any (p_types))
    and (p_name is null or s.name ilike '%' || p_name || '%' or s.name % p_name)
  order by
    case when p_name is not null then similarity(s.name, p_name) end desc nulls last,
    s.created_at desc
  limit p_page_size offset p_page * p_page_size
$$;

-- --- Data-API execution grants (day-one posture) --------------------------------
grant execute on function find_curvy_roads(double precision, double precision, double precision, double precision, jsonb, double precision, integer) to anon, authenticated;
grant execute on function find_curvy_roads_near(double precision, double precision, double precision, double precision, integer) to anon, authenticated;
grant execute on function find_spots(double precision, double precision, double precision, jsonb, text[], integer) to anon, authenticated;
grant execute on function search_routes(double precision, double precision, double precision, double precision, double precision, double precision, text[], text[], text, integer, integer) to anon, authenticated;
grant execute on function search_spots(double precision, double precision, double precision, double precision, text[], text, integer, integer) to anon, authenticated;
