-- 0015_discover_seed_drives.sql — the hand-picked classic drives read (R24-U4).
--
-- WHY: R24 makes Discover a curated menu that BLENDS the auto-ranked corpus roads
-- with the 8 hand-picked "classic" drives already seeded in `routes`
-- (free_tags{seed}, visibility public) — Snake Road, Hockley Valley, Forks of the
-- Credit, etc. These sat unused since M7. Discover (backend, browsing-class) needs
-- their geometry + endpoints to surface them and pre-build an out-and-back.
--
-- LEAST-PRIVILEGE (Hard rule E): SECURITY DEFINER with a fixed search_path and a
-- hard WHERE visibility='public' AND 'seed'=any(free_tags) — it can NEVER return a
-- private or owner-scoped row regardless of the caller's role (mirrors the
-- planner_find_* definer read path). Region-wide (~8 rows); no user input.

create or replace function discover_seed_drives()
returns table (
  id          text,
  name        text,
  geometry    jsonb,
  waypoints   jsonb,
  is_loop     boolean,
  distance_m  double precision,
  duration_s  integer,
  curviness   double precision
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    r.id::text,
    r.name,
    -- FULL geometry (not simplified): Discover measures curviness from it (an
    -- honest curveWord) and draws the amber line; 8 rows, egress negligible.
    st_asgeojson(r.geometry)::jsonb,
    r.waypoints,
    r.is_loop,
    r.distance_m,
    r.duration_s,
    r.curviness
  from routes r
  where r.visibility = 'public'
    and 'seed' = any(r.free_tags)
  order by r.distance_m asc
$$;

grant execute on function discover_seed_drives() to anon, authenticated, service_role;
