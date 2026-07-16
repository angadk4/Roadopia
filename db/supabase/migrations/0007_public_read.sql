-- 0007_public_read.sql — public-visibility read floor + map-shaped read (M7-T02).
--
-- WHY NOW (not M8): FR-010 requires the anonymous map to render seeded PUBLIC
-- routes on first launch through the sanctioned direct-Supabase read path
-- (Spec §49.1 search_routes / §41 "CRUD + spatial RPC (RLS)"). Until this
-- migration, routes/spots were RLS-deny-by-default (0002 posture note: "until
-- the M8 visibility policies land") — so the M8 PUBLIC-read slice lands here,
-- pulled forward by the M7-T02 dependency. Ownership/write policies remain M8.
--
-- SPK-13 invariant PRESERVED: zero private leakage. These policies expose
-- exactly the rows the product defines as public — nothing owner-scoped:
--   routes: visibility = 'public'
--   spots:  source = 'osm' (user spots stay invisible until M8/M10 policies)
-- Re-verified in db/tests/rls_planner.test.ts + rls_public_read.test.ts.

create policy routes_public_read on routes
  for select
  using (visibility = 'public');

create policy spots_osm_read on spots
  for select
  using (source = 'osm');

-- --- map_routes — the map-home read (§44 egress discipline) -----------------
-- PostgREST serializes raw geometry columns as WKB hex, which the app cannot
-- render; the map needs GeoJSON and the SIMPLIFIED line (§44: "map/list
-- payloads use geometry_simplified"). SECURITY INVOKER — RLS (the policy
-- above) binds the caller, so anon receives public rows only.
create or replace function map_routes(p_limit integer default 50)
returns table (
  id             uuid,
  name           text,
  description    text,
  geometry       jsonb,
  bbox           jsonb,
  is_loop        boolean,
  distance_m     double precision,
  duration_s     integer,
  curviness      double precision,
  climb_m        double precision,
  character_tags text[],
  intensity      text,
  free_tags      text[],
  origin_type    text,
  visibility     text
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    r.id,
    r.name,
    r.description,
    st_asgeojson(coalesce(r.geometry_simplified, r.geometry))::jsonb,
    case when r.bbox is not null then st_asgeojson(r.bbox)::jsonb end,
    r.is_loop,
    r.distance_m,
    r.duration_s,
    r.curviness,
    r.climb_m,
    r.character_tags,
    r.intensity,
    r.free_tags,
    r.origin_type,
    r.visibility
  from routes r
  order by r.created_at desc
  limit p_limit
$$;

grant execute on function map_routes(integer) to anon, authenticated;
