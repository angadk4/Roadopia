-- 0008_map_spots.sql — the map-home spot read (M7-T09 feedback round / FB-1).
--
-- WHY: the map needs ALL region spots (5,040), but every row-returning path is
-- capped by PostgREST's max-rows (1,000/response) — and planner_find_spots is
-- additionally NEAREST-FIRST, so the app's pins truncated to a 22.8 km disc
-- around the seed-route centre (only Mississauga/Toronto/Oakville showed).
-- Returning ONE jsonb aggregate bypasses the row cap; ordering by id keeps the
-- selection spatially unbiased (the limit is a safety valve above corpus size,
-- not a truncator). Viewport-scoped loading is the M8 egress follow-up (§44).
--
-- SECURITY INVOKER: RLS binds the caller — anon sees ONLY source='osm' rows
-- via the 0007 spots_osm_read policy (zero private leakage, SPK-13 posture).
create or replace function map_spots(p_limit integer default 6000)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from (
    select s.id,
           s.name,
           s.type,
           st_y(s.location)::double precision as lat,
           st_x(s.location)::double precision as lng,
           s.source
    from spots s
    order by s.id
    limit p_limit
  ) t
$$;

grant execute on function map_spots(integer) to anon, authenticated;
